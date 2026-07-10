/**
 * ADB Client — wraps Android Debug Bridge commands
 *
 * Uses node:child_process (spawn/execSync) to run adb commands.
 * Heavy operations (logcat, screenshot, hierarchy dump) use async spawn
 * so they don't block the event loop.
 *
 * No external dependencies required — ADB must be installed separately
 * via Android SDK Platform Tools.
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

/** Node in the Android UI hierarchy (from uiautomator dump) */
export interface UiNode {
  index: string;
  text: string;
  resourceId: string;
  className: string;
  packageName: string;
  contentDesc: string;
  checkable: string;
  checked: string;
  clickable: string;
  enabled: string;
  focusable: string;
  focused: string;
  scrollable: string;
  longClickable: string;
  password: string;
  selected: string;
  bounds: string; // "[x1,y1][x2,y2]"
  children: UiNode[];
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
  private devicePrefix(deviceId?: string): string[] {
    return deviceId ? [this.adbPath, "-s", deviceId] : [this.adbPath];
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
   * ⚡ ASYNC: Spawn ADB with args and return stdout/stderr as Promise.
   * Non-blocking — doesn't freeze the event loop.
   */
  private runAsync(
    args: string[],
    options?: { timeout?: number; binary?: boolean },
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.adbPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: options?.timeout ?? 15_000,
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += options?.binary ? data.toString("binary") : data.toString("utf-8");
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });

      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, code }));
    });
  }

  // ─── Synchronous (fast) operations ───────────────────────────────

  isAvailable(): boolean {
    try {
      this.runSync(`${this.adbPath} --version`);
      return true;
    } catch {
      return false;
    }
  }

  listDevices(): AdbDevice[] {
    const output = this.runSync(`${this.adbPath} devices -l`);
    const lines = output.split("\n").filter((l) => l.trim() && !l.startsWith("List of"));
    return lines.map((line) => {
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

  tap(x: number, y: number, deviceId?: string): void {
    this.runSync(`${this.devicePrefix(deviceId).join(" ")} shell input tap ${x} ${y}`);
  }

  type(text: string, deviceId?: string): void {
    const escaped = text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, "\\$");
    this.runSync(`${this.devicePrefix(deviceId).join(" ")} shell input text "${escaped}"`);
  }

  swipe(x1: number, y1: number, x2: number, y2: number, durationMs?: number, deviceId?: string): void {
    const cmd = durationMs
      ? `${this.devicePrefix(deviceId).join(" ")} shell input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`
      : `${this.devicePrefix(deviceId).join(" ")} shell input swipe ${x1} ${y1} ${x2} ${y2}`;
    this.runSync(cmd);
  }

  keyevent(key: string | number, deviceId?: string): void {
    this.runSync(`${this.devicePrefix(deviceId).join(" ")} shell input keyevent ${key}`);
  }

  /** Long press at coordinates */
  longPress(x: number, y: number, durationMs = 1000, deviceId?: string): void {
    // Long press is swipe from (x,y) to (x,y) with duration
    this.swipe(x, y, x, y, durationMs, deviceId);
  }

  /** Pinch gesture (zoom) */
  pinch(
    centerX: number,
    centerY: number,
    distance: number,
    action: "in" | "out",
    deviceId?: string,
  ): void {
    const prefix = this.devicePrefix(deviceId).join(" ");
    if (action === "out") {
      // Two fingers moving outward from center
      this.runSync(`${prefix} shell input swipe ${centerX} ${centerY} ${centerX - distance} ${centerY - distance} 500`);
      this.runSync(`${prefix} shell input swipe ${centerX} ${centerY} ${centerX + distance} ${centerY + distance} 500`);
    } else {
      // Two fingers moving inward toward center
      this.runSync(`${prefix} shell input swipe ${centerX - distance} ${centerY - distance} ${centerX} ${centerY} 500`);
      this.runSync(`${prefix} shell input swipe ${centerX + distance} ${centerY + distance} ${centerX} ${centerY} 500`);
    }
  }

  // ─── Async (non-blocking) operations ──────────────────────────

  /**
   * ⚡ ASYNC: Take a screenshot and return as base64 with dimensions.
   * Non-blocking — doesn't freeze the event loop.
   */
  async screenshotAsync(
    deviceId?: string,
    compress?: boolean,
  ): Promise<AdbScreenshotResult> {
    const prefix = this.devicePrefix(deviceId);
    const result = await this.runAsync(
      [...prefix.slice(1), "exec-out", "screencap", "-p"],
      { timeout: 10_000, binary: true },
    );

    let width = 0;
    let height = 0;
    try {
      const wmResult = await this.runAsync(
        [...prefix.slice(1), "shell", "wm", "size"],
        { timeout: 5_000 },
      );
      const match = wmResult.stdout.match(/(\d+)x(\d+)/);
      if (match) {
        width = parseInt(match[1]!, 10);
        height = parseInt(match[2]!, 10);
      }
    } catch {
      // Non-critical
    }

    const base64 = Buffer.from(result.stdout, "binary").toString("base64");

    return {
      base64: compress ? this.compressBase64(base64) : base64,
      width,
      height,
    };
  }

  /**
   * ⚡ ASYNC: Dump UI hierarchy from current screen (uiautomator dump).
   * Returns parsed UI node tree for AI to understand screen layout.
   * Non-blocking — doesn't freeze the event loop.
   */
  async dumpUiHierarchy(deviceId?: string): Promise<UiNode | null> {
    const prefix = this.devicePrefix(deviceId);

    // Try /sdcard/ first (universally writable on all Android devices)
    // Fallback to /data/local/tmp/ for rooted devices
    const paths = ["/sdcard/fennec_ui.xml", "/data/local/tmp/fennec_ui.xml"];

    for (const dumpPath of paths) {
      await this.runAsync(
        [...prefix.slice(1), "shell", "uiautomator", "dump", dumpPath],
        { timeout: 10_000 },
      );

      const xmlResult = await this.runAsync(
        [...prefix.slice(1), "shell", "cat", dumpPath],
        { timeout: 5_000 },
      );

      if (xmlResult.stdout && xmlResult.stdout.trim().length > 0) {
        return this.parseUiXml(xmlResult.stdout);
      }
    }

    return null;
  }

  /**
   * ⚡ ASYNC: Get logcat logs (non-blocking).
   */
  async getLogcatAsync(
    options?: { lines?: number; tag?: string; level?: string },
    deviceId?: string,
  ): Promise<LogcatEntry[]> {
    const prefix = this.devicePrefix(deviceId);
    const args: string[] = [...prefix.slice(1), "logcat", "-d"];

    if (options?.tag) {
      args.push("-s", options.tag);
    }
    if (options?.lines) {
      args.push("-t", String(options.lines));
    }

    const result = await this.runAsync(args, { timeout: 10_000 });
    const lines = result.stdout.split("\n");
    const entries: LogcatEntry[] = [];

    for (const line of lines) {
      try {
        const entry = this.parseLogcatLine(line);
        if (entry) {
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

  // ─── Synchronous convenience methods ────────────────────────────

  /**
   * ⚡ ASYNC: Install APK.
   */
  async installApkAsync(apkPath: string, deviceId?: string): Promise<string> {
    const prefix = this.devicePrefix(deviceId);
    const result = await this.runAsync(
      [...prefix.slice(1), "install", apkPath],
      { timeout: 60_000 },
    );
    return result.stdout + result.stderr;
  }

  installApk(apkPath: string, deviceId?: string): string {
    this.runSyncBuffer(`${this.devicePrefix(deviceId).join(" ")} install "${apkPath}"`);
    return "Install initiated";
  }

  uninstallPackage(packageName: string, deviceId?: string): string {
    return this.runSync(`${this.devicePrefix(deviceId).join(" ")} uninstall "${packageName}"`);
  }

  launchApp(packageName: string, activity?: string, deviceId?: string): string {
    const target = activity
      ? `${packageName}/${activity}`
      : `${packageName}/.MainActivity`;
    return this.runSync(`${this.devicePrefix(deviceId).join(" ")} shell am start -n "${target}"`);
  }

  stopApp(packageName: string, deviceId?: string): string {
    return this.runSync(`${this.devicePrefix(deviceId).join(" ")} shell am force-stop "${packageName}"`);
  }

  clearAppData(packageName: string, deviceId?: string): string {
    return this.runSync(`${this.devicePrefix(deviceId).join(" ")} shell pm clear "${packageName}"`);
  }

  getDeviceProps(deviceId?: string): Record<string, string> {
    const output = this.runSync(`${this.devicePrefix(deviceId).join(" ")} shell getprop`);
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
   * Find WebView process PIDs by scanning Unix sockets.
   * Returns PIDs that have a webview_devtools_remote socket.
   */
  findWebViewPids(deviceId?: string): number[] {
    try {
      const prefix = this.devicePrefix(deviceId).join(" ");
      const output = this.runSync(`${prefix} shell "grep -a webview_devtools_remote /proc/net/unix 2>/dev/null || true"`);
      const pids: number[] = [];
      for (const line of output.split("\n")) {
        // Format: ... webview_devtools_remote_<pid>
        const match = line.match(/webview_devtools_remote_(\d+)/);
        if (match) {
          pids.push(parseInt(match[1]!, 10));
        }
      }
      return [...new Set(pids)];
    } catch {
      return [];
    }
  }

  /**
   * Forward a WebView Chrome DevTools port to localhost.
   * Returns the local port number, or null if forwarding failed.
   */
  forwardWebViewPort(pid: number, hostPort: number, deviceId?: string): boolean {
    try {
      const prefix = this.devicePrefix(deviceId).join(" ");
      this.runSync(
        `${prefix} forward tcp:${hostPort} localabstract:webview_devtools_remote_${pid}`,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a port forwarding rule.
   */
  removeForward(hostPort: number, deviceId?: string): void {
    try {
      const prefix = this.devicePrefix(deviceId).join(" ");
      this.runSync(`${prefix} forward --remove tcp:${hostPort}`);
    } catch {
      // Best-effort
    }
  }

  /**
   * List all ADB port forwarding rules.
   */
  listForwards(deviceId?: string): string[] {
    try {
      const prefix = this.devicePrefix(deviceId).join(" ");
      const output = this.runSync(`${prefix} forward --list`);
      return output.split("\n").filter((l) => l.trim());
    } catch {
      return [];
    }
  }

  /** ⚡ ASYNC: Get current foreground activity */
  async getCurrentActivity(deviceId?: string): Promise<string | null> {
    const prefix = this.devicePrefix(deviceId);
    const result = await this.runAsync(
      [...prefix.slice(1), "shell", "dumpsys", "window", "windows"],
      { timeout: 5_000 },
    );
    const match = result.stdout.match(/mCurrentFocus=.*? (\S+)\/(\S+)/);
    return match ? `${match[1]}/${match[2]}` : null;
  }

  // ─── Sync logcat (backward compat) ──────────────────────────────

  getLogcat(
    options?: { lines?: number; tag?: string; level?: string },
    deviceId?: string,
  ): LogcatEntry[] {
    let cmd = `${this.devicePrefix(deviceId).join(" ")} logcat -d`;
    if (options?.tag) cmd += ` -s "${options.tag}"`;
    if (options?.lines) cmd += ` -t ${options.lines}`;

    const output = this.runSync(cmd);
    const entries: LogcatEntry[] = [];

    for (const line of output.split("\n")) {
      try {
        const entry = this.parseLogcatLine(line);
        if (entry) {
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

  // ─── Parsing ──────────────────────────────────────────────────

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
   * Parse uiautomator XML dump into a structured UI node tree.
   */
  private parseUiXml(xml: string): UiNode {
    // Remove XML declaration and DOCTYPE
    const clean = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, "").trim();

    // Parse recursively
    const parseNode = (xmlStr: string, startIdx: number): { node: UiNode; endIdx: number } => {
      const node: UiNode = {
        index: "", text: "", resourceId: "", className: "", packageName: "",
        contentDesc: "", checkable: "", checked: "", clickable: "", enabled: "",
        focusable: "", focused: "", scrollable: "", longClickable: "",
        password: "", selected: "", bounds: "", children: [],
      };

      // Extract attributes from <node ...>
      const attrMatch = xmlStr.slice(startIdx).match(/^<node\s+([^>]*?)>/);
      if (!attrMatch) {
        // Self-closing or text node
        const closeIdx = xmlStr.indexOf(">", startIdx);
        return { node, endIdx: closeIdx + 1 };
      }

      // Parse attributes
      const attrs = attrMatch[1]!;
      const attrRegex = /([\w-]+)\s*=\s*"([^"]*)"/g;
      let m;
      while ((m = attrRegex.exec(attrs)) !== null) {
        const key = m[1]!;
        const val = m[2]!;
        switch (key) {
          case "index": node.index = val; break;
          case "text": node.text = val; break;
          case "resource-id": node.resourceId = val; break;
          case "class": node.className = val; break;
          case "package": node.packageName = val; break;
          case "content-desc": node.contentDesc = val; break;
          case "checkable": node.checkable = val; break;
          case "checked": node.checked = val; break;
          case "clickable": node.clickable = val; break;
          case "enabled": node.enabled = val; break;
          case "focusable": node.focusable = val; break;
          case "focused": node.focused = val; break;
          case "scrollable": node.scrollable = val; break;
          case "long-clickable": node.longClickable = val; break;
          case "password": node.password = val; break;
          case "selected": node.selected = val; break;
          case "bounds": node.bounds = val; break;
        }
      }

      let pos = startIdx + attrMatch[0].length;

      // Parse children
      while (pos < xmlStr.length) {
        const next = xmlStr.slice(pos);
        if (next.startsWith("</node>")) {
          return { node, endIdx: pos + 7 };
        }
        if (next.startsWith("<node ")) {
          const child = parseNode(xmlStr, pos);
          node.children.push(child.node);
          pos = child.endIdx;
        } else {
          pos = xmlStr.indexOf(">", pos) + 1;
          if (pos <= 0) break;
        }
      }

      return { node, endIdx: pos };
    };

    const result = parseNode(clean, 0);
    return result.node;
  }

  /**
   * Compress base64 string (remove newlines, basic reduction).
   */
  private compressBase64(b64: string): string {
    // Remove newlines and whitespace
    return b64.replace(/\s/g, "");
  }

  /**
   * Build a flat summary of the UI hierarchy for AI consumption.
   * Returns only interactive/relevant elements (buttons, texts, inputs).
   */
  flattenUiHierarchy(node: UiNode, depth = 0): Array<{
    text: string;
    className: string;
    resourceId: string;
    contentDesc: string;
    bounds: string;
    clickable: boolean;
    scrollable: boolean;
    checked: boolean;
    depth: number;
  }> {
    const result: Array<{
      text: string;
      className: string;
      resourceId: string;
      contentDesc: string;
      bounds: string;
      clickable: boolean;
      scrollable: boolean;
      checked: boolean;
      depth: number;
    }> = [];

    // Only include elements with text or content description that are interactive
    const hasContent = node.text || node.contentDesc || node.resourceId;
    const isInteractive = node.clickable === "true" || node.scrollable === "true" ||
      node.className.includes("Button") || node.className.includes("EditText") ||
      node.className.includes("TextView") || node.className.includes("Image");

    if (hasContent && isInteractive) {
      result.push({
        text: node.text,
        className: node.className,
        resourceId: node.resourceId,
        contentDesc: node.contentDesc,
        bounds: node.bounds,
        clickable: node.clickable === "true",
        scrollable: node.scrollable === "true",
        checked: node.checked === "true",
        depth,
      });
    }

    // Recurse children (limit depth to avoid overwhelming the AI)
    if (depth < 15) {
      for (const child of node.children) {
        result.push(...this.flattenUiHierarchy(child, depth + 1));
      }
    }

    return result;
  }
}
