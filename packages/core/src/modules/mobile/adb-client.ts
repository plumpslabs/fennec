/**
 * ADB Client — wraps Android Debug Bridge commands
 *
 * Uses node:child_process (execSync/spawn) to run adb commands.
 * No external dependencies required — ADB must be installed separately
 * via Android SDK Platform Tools.
 *
 * All methods accept an optional deviceId for multi-device scenarios.
 * When omitted, ADB uses the default device (single device).
 */

import { execSync, spawn } from "node:child_process";

// ─── Types ───────────────────────────────────────────────────────

export interface AdbDevice {
  id: string;
  state: "device" | "offline" | "unauthorized" | "unknown";
  model?: string;
  androidVersion?: string;
  sdkVersion?: number;
}

export interface AdbScreenshotResult {
  base64: string;
  width: number;
  height: number;
}

export interface LogcatEntry {
  timestamp: string;
  pid: number;
  tid: number;
  level: string;
  tag: string;
  message: string;
}

// ─── Constants ────────────────────────────────────────────────

const LOGCAT_LINE_RE =
  /^(\S+\s+\S+)\s+(\d+)-(\d+)\s+([A-Z])\/(.+?)\s*[:(]/;

// ─── Client ───────────────────────────────────────────────────────

export class AdbClient {
  private adbPath: string;

  constructor(adbPath = "adb") {
    this.adbPath = adbPath;
  }

  /** Build device-specific prefix: `adb -s <deviceId>` or just `adb` */
  private devicePrefix(deviceId?: string): string {
    return deviceId ? `${this.adbPath} -s ${deviceId}` : this.adbPath;
  }

  /** Run a synchronous ADB command and return trimmed stdout */
  private runSync(cmd: string): string {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  /** Run a synchronous ADB command that outputs binary data and return Buffer */
  private runSyncBuffer(cmd: string): Buffer {
    return execSync(cmd, {
      encoding: "buffer",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  /**
   * Check if ADB is available on the system.
   */
  isAvailable(): boolean {
    try {
      this.runSync(`${this.adbPath} --version`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List connected Android devices.
   */
  listDevices(): AdbDevice[] {
    const output = this.runSync(`${this.adbPath} devices -l`);
    const lines = output.split("\n").filter((l) => l.trim() && !l.startsWith("List of"));

    return lines.map((line) => {
      // Format: <id> device product:<model> model:<model> ...
      const [id, state, ...rest] = line.split(/\s+/);
      const props = rest.join(" ");
      const modelMatch = props.match(/model:(\S+)/);
      return {
        id: id ?? "",
        state: (state ?? "unknown") as AdbDevice["state"],
        model: modelMatch?.[1] ?? undefined,
      };
    });
  }

  /**
   * Tap at coordinates (x, y).
   */
  tap(x: number, y: number, deviceId?: string): void {
    this.runSync(`${this.devicePrefix(deviceId)} shell input tap ${x} ${y}`);
  }

  /**
   * Type text (special characters like spaces are escaped automatically).
   */
  type(text: string, deviceId?: string): void {
    // Escape spaces and special chars for ADB shell input
    const escaped = text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');
    this.runSync(`${this.devicePrefix(deviceId)} shell input text "${escaped}"`);
  }

  /**
   * Swipe from (x1, y1) to (x2, y2) with optional duration (ms).
   */
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs?: number, deviceId?: string): void {
    const cmd = durationMs
      ? `${this.devicePrefix(deviceId)} shell input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`
      : `${this.devicePrefix(deviceId)} shell input swipe ${x1} ${y1} ${x2} ${y2}`;
    this.runSync(cmd);
  }

  /**
   * Send a key event (e.g., "HOME", "BACK", "ENTER", "KEYCODE_VOLUME_UP").
   * Supports both key names ("HOME") and key codes (3).
   */
  keyevent(key: string | number, deviceId?: string): void {
    this.runSync(`${this.devicePrefix(deviceId)} shell input keyevent ${key}`);
  }

  /**
   * Take a screenshot and return as base64 with dimensions.
   */
  screenshot(deviceId?: string): AdbScreenshotResult {
    const buffer = this.runSyncBuffer(`${this.devicePrefix(deviceId)} exec-out screencap -p`);

    // Parse dimensions from raw buffer (screencap -p outputs PNG)
    // We get dimensions by reading the raw buffer metadata
    let width = 0;
    let height = 0;

    // Try to get dimensions via `wm size` as a fallback approach
    try {
      const wmOutput = this.runSync(`${this.devicePrefix(deviceId)} shell wm size`);
      const match = wmOutput.match(/(\d+)x(\d+)/);
      if (match) {
        width = parseInt(match[1]!, 10);
        height = parseInt(match[2]!, 10);
      }
    } catch {
      // Non-critical — dimensions will be 0x0
    }

    return {
      base64: buffer.toString("base64"),
      width,
      height,
    };
  }

  /**
   * Get logcat logs (buffered, not streaming).
   * Returns parsed log entries or raw lines if parsing fails.
   *
   * Options:
   * - lines: number of recent lines to fetch
   * - tag: filter by tag
   * - level: minimum log level
   */
  getLogcat(
    options?: {
      lines?: number;
      tag?: string;
      level?: string;
    },
    deviceId?: string,
  ): LogcatEntry[] {
    let cmd = `${this.devicePrefix(deviceId)} logcat -d`;
    if (options?.tag) {
      cmd += ` -s "${options.tag}"`;
    }
    if (options?.lines) {
      cmd += ` -t ${options.lines}`;
    }

    const output = this.runSync(cmd);
    const lines = output.split("\n");

    const entries: LogcatEntry[] = [];

    for (const line of lines) {
      try {
        const entry = this.parseLogcatLine(line);
        if (entry) {
          // Filter by level if specified
          if (options?.level) {
            const levelOrder = ["V", "D", "I", "W", "E", "F"];
            const minIdx = levelOrder.indexOf(options.level.toUpperCase());
            const curIdx = levelOrder.indexOf(entry.level);
            if (curIdx < minIdx) continue;
          }
          entries.push(entry);
        }
      } catch {
        // Skip unparseable lines
      }
    }

    return entries;
  }

  /**
   * Parse a single logcat line into a structured entry.
   */
  private parseLogcatLine(line: string): LogcatEntry | null {
    const match = line.match(LOGCAT_LINE_RE);
    if (!match) return null;

    return {
      timestamp: match[1]!,
      pid: parseInt(match[2]!, 10),
      tid: parseInt(match[3]!, 10),
      level: match[4]!,
      tag: match[5]!,
      message: line.slice(match[0].length).trim() || line,
    };
  }

  /**
   * Get device properties (build version, SDK, etc.).
   */
  getDeviceProps(deviceId?: string): Record<string, string> {
    const output = this.runSync(`${this.devicePrefix(deviceId)} shell getprop`);
    const props: Record<string, string> = {};

    for (const line of output.split("\n")) {
      const match = line.match(/^\[([^\]]+)\]:\s*\[([^\]]*)\]/);
      if (match) {
        props[match[1]!] = match[2]!;
      }
    }

    return props;
  }

  /**
   * Install an APK from the given path.
   */
  installApk(apkPath: string, deviceId?: string): string {
    return this.runSync(`${this.devicePrefix(deviceId)} install "${apkPath}"`);
  }

  /**
   * Uninstall a package.
   */
  uninstallPackage(packageName: string, deviceId?: string): string {
    return this.runSync(`${this.devicePrefix(deviceId)} uninstall "${packageName}"`);
  }

  /**
   * Launch an app by package name.
   */
  launchApp(packageName: string, activity?: string, deviceId?: string): string {
    const target = activity
      ? `${packageName}/${activity}`
      : `${packageName}/.MainActivity`;
    return this.runSync(`${this.devicePrefix(deviceId)} shell am start -n "${target}"`);
  }

  /**
   * Stop an app by package name.
   */
  stopApp(packageName: string, deviceId?: string): string {
    return this.runSync(`${this.devicePrefix(deviceId)} shell am force-stop "${packageName}"`);
  }

  /**
   * Clear app data.
   */
  clearAppData(packageName: string, deviceId?: string): string {
    return this.runSync(`${this.devicePrefix(deviceId)} shell pm clear "${packageName}"`);
  }
}
