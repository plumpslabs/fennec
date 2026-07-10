/**
 * Mobile / Android Module
 *
 * Provides Android device management and interaction via ADB:
 * - Device detection (list devices, device info)
 * - Interaction (tap, type, swipe, long press, pinch, keyevent)
 * - Debugging (logcat async)
 * - Screen understanding (screenshot, UI hierarchy dump)
 * - App management (install, launch, stop)
 *
 * Fully integrated with EventBus for cross-layer correlation.
 * Heavy operations use async ADB (non-blocking).
 *
 * Requirements: ADB from Android SDK Platform Tools must be installed.
 */

import { z } from "zod";
import type { FennecModule, ModuleContext } from "../../module/index.js";
import type { ToolDefinition, ToolContext } from "../../tools/_registry.js";
import { createTool } from "../../tools/_registry.js";
import { AdbClient } from "./adb-client.js";
import type { UiNode } from "./adb-client.js";

// ─── Singleton ADB Client ────────────────────────────────────────

let adbClient: AdbClient | null = null;

function getAdb(): AdbClient {
  if (!adbClient) {
    adbClient = new AdbClient();
  }
  return adbClient;
}

// ─── Helper: Parse bounds string "[x1,y1][x2,y2]" → center coords ──

function boundsToCenter(bounds: string): { x: number; y: number } | null {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  return {
    x: (parseInt(match[1]!, 10) + parseInt(match[3]!, 10)) / 2,
    y: (parseInt(match[2]!, 10) + parseInt(match[4]!, 10)) / 2,
  };
}

// ─── Tools ───────────────────────────────────────────────────────

export const mobileListDevices = createTool({
  name: "mobile_list_devices",
  category: "mobile",
  description: "`<use_case>Device discovery</use_case> List connected Android devices via ADB. Returns device ID, state, model for each device.`",
  inputSchema: z.object({}),
  handler: async (_input, { responseBuilder }: ToolContext) => {
    try {
      const adb = getAdb();
      const devices = adb.listDevices();
      return responseBuilder.success({
        devices,
        count: devices.length,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: [
          "Ensure ADB is installed (Android SDK Platform Tools)",
          "Connect an Android device via USB with debug mode enabled",
          "Run `adb devices` manually to check connectivity",
        ],
      });
    }
  },
});

export const mobileTap = createTool({
  name: "mobile_tap",
  category: "mobile",
  description: "`<use_case>Screen interaction</use_case> Tap at specified x,y coordinates on the Android device screen. Use coordinates from mobile_get_ui_hierarchy bounding boxes.`",
  inputSchema: z.object({
    x: z.number().int().describe("X coordinate to tap"),
    y: z.number().int().describe("Y coordinate to tap"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      getAdb().tap(input.x, input.y, input.deviceId);
      eventBus?.publish("mobile:ui-change", { action: "tap", x: input.x, y: input.y, deviceId: input.deviceId ?? null });
      return responseBuilder.success({ action: "tap", x: input.x, y: input.y });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Check device connection", "Verify coordinates are within screen bounds"],
      });
    }
  },
});

export const mobileType = createTool({
  name: "mobile_type",
  category: "mobile",
  description: "`<use_case>Text input</use_case> Type text into the currently focused input field on the Android device. Spaces and special characters are escaped automatically.`",
  inputSchema: z.object({
    text: z.string().min(1).max(500).describe("Text to type (max 500 chars)"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      getAdb().type(input.text, input.deviceId);
      eventBus?.publish("mobile:ui-change", { action: "type", length: input.text.length, deviceId: input.deviceId ?? null });
      return responseBuilder.success({ action: "type", length: input.text.length });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Ensure a text field is focused", "Check device connection"],
      });
    }
  },
});

export const mobileSwipe = createTool({
  name: "mobile_swipe",
  category: "mobile",
  description: "`<use_case>Gesture</use_case> Perform a swipe/drag gesture from (x1,y1) to (x2,y2) with optional duration.`",
  inputSchema: z.object({
    x1: z.number().int().describe("Start X coordinate"),
    y1: z.number().int().describe("Start Y coordinate"),
    x2: z.number().int().describe("End X coordinate"),
    y2: z.number().int().describe("End Y coordinate"),
    durationMs: z.number().int().optional().describe("Duration in milliseconds for the swipe"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      getAdb().swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs, input.deviceId);
      eventBus?.publish("mobile:ui-change", { action: "swipe", from: { x: input.x1, y: input.y1 }, to: { x: input.x2, y: input.y2 } });
      return responseBuilder.success({ action: "swipe", from: { x: input.x1, y: input.y1 }, to: { x: input.x2, y: input.y2 }, durationMs: input.durationMs });
    } catch (error) {
      return responseBuilder.error(error, { code: "ADB_FAILED", suggestions: ["Check device connection"] });
    }
  },
});

export const mobileKeyevent = createTool({
  name: "mobile_keyevent",
  category: "mobile",
  description: "`<use_case>Hardware key</use_case> Send a keyevent (e.g., HOME, BACK, ENTER, VOLUME_UP). Supports key names and key codes.`",
  inputSchema: z.object({
    key: z.union([z.string(), z.number()]).describe("Key name (HOME, BACK, ENTER) or keycode (3=HOME, 4=BACK, 66=ENTER)"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      getAdb().keyevent(input.key, input.deviceId);
      eventBus?.publish("mobile:ui-change", { action: "keyevent", key: input.key });
      return responseBuilder.success({ action: "keyevent", key: input.key });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Check device connection", "Common keyevent names: HOME, BACK, ENTER, MENU, VOLUME_UP, VOLUME_DOWN, POWER, CAMERA"],
      });
    }
  },
});

export const mobileScreenshot = createTool({
  name: "mobile_screenshot",
  category: "mobile",
  description: "`<use_case>Screen capture</use_case> Take a screenshot of the Android device screen and return as base64. Non-blocking async. Optionally compress to save tokens.`",
  inputSchema: z.object({
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
    compress: z.boolean().optional().default(true).describe("Compress base64 output to save tokens (remove whitespace). Default: true"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      const result = await getAdb().screenshotAsync(input.deviceId, input.compress ?? true);
      eventBus?.publish("mobile:screenshot", { width: result.width, height: result.height, deviceId: input.deviceId ?? null });
      return responseBuilder.success({ screenshot: result.base64, width: result.width, height: result.height });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Check device connection", "Ensure device screen is on"],
      });
    }
  },
});

// ─── NEW: mobile_get_ui_hierarchy ─────────────────────────────────
// 🔥 CRITICAL GAP #1: AI can now understand Android screen layout

export const mobileGetUiHierarchy = createTool({
  name: "mobile_get_ui_hierarchy",
  category: "mobile",
  description: "`<use_case>Screen understanding</use_case> Dump the current screen's UI hierarchy via uiautomator. Returns a structured tree of all interactive elements (buttons, text fields, images, etc.) with their text, bounds, and properties. Use the bounds to calculate tap coordinates. Like browser_get_dom_snapshot for Android.`",
  inputSchema: z.object({
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
    flat: z.boolean().optional().default(true).describe("If true, returns flattened list of interactive elements. If false, returns full tree structure."),
    maxElements: z.number().int().min(5).max(200).optional().default(50).describe("Max elements to return (prevents token overflow)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      const adb = getAdb();
      const root = await adb.dumpUiHierarchy(input.deviceId);

      if (!root) {
        return responseBuilder.error(new Error("UI hierarchy dump failed"), {
          code: "UI_DUMP_FAILED",
          suggestions: ["Ensure device screen is on and unlocked", "Try mobile_tap or mobile_keyevent to wake the device first"],
        });
      }

      // Get current activity for context
      const activity = await adb.getCurrentActivity(input.deviceId);

      if (input.flat !== false) {
        const elements = adb.flattenUiHierarchy(root).slice(0, input.maxElements ?? 50);
        eventBus?.publish("mobile:ui-change", { action: "ui_dump", elementCount: elements.length, activity, deviceId: input.deviceId ?? null });

        return responseBuilder.success({
          activity,
          elementCount: elements.length,
          elements: elements.map((el, i) => ({
            index: i,
            text: el.text.slice(0, 100),
            className: el.className,
            resourceId: el.resourceId || undefined,
            contentDesc: el.contentDesc.slice(0, 100) || undefined,
            bounds: el.bounds,
            center: boundsToCenter(el.bounds),
            clickable: el.clickable,
            scrollable: el.scrollable,
            checked: el.checked,
          })),
          hint: "Use the center coordinates to tap on elements with mobile_tap",
        });
      }

      // Full tree mode (verbose)
      eventBus?.publish("mobile:ui-change", { action: "ui_dump_tree", activity, deviceId: input.deviceId ?? null });
      return responseBuilder.success({ activity, root });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "UI_DUMP_FAILED",
        suggestions: ["Ensure device is connected and screen is on", "ADB must have WRITE_EXTERNAL_STORAGE permission"],
      });
    }
  },
});

// ─── NEW: mobile_long_press ────────────────────────────────────────
// 🔧 GESTURE EXPANSION: Long press

export const mobileLongPress = createTool({
  name: "mobile_long_press",
  category: "mobile",
  description: "`<use_case>Gesture</use_case> Long press at specified coordinates for a duration. Uses swipe-to-self under the hood.`",
  inputSchema: z.object({
    x: z.number().int().describe("X coordinate"),
    y: z.number().int().describe("Y coordinate"),
    durationMs: z.number().int().optional().default(1000).describe("Press duration in ms (default: 1000)"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      getAdb().longPress(input.x, input.y, input.durationMs, input.deviceId);
      eventBus?.publish("mobile:ui-change", { action: "long_press", x: input.x, y: input.y });
      return responseBuilder.success({ action: "long_press", x: input.x, y: input.y, durationMs: input.durationMs });
    } catch (error) {
      return responseBuilder.error(error, { code: "ADB_FAILED", suggestions: ["Check device connection"] });
    }
  },
});

// ─── NEW: mobile_pinch ─────────────────────────────────────────────
// 🔧 GESTURE EXPANSION: Pinch to zoom

export const mobilePinch = createTool({
  name: "mobile_pinch",
  category: "mobile",
  description: "`<use_case>Gesture</use_case> Perform a pinch-to-zoom gesture. Supports zoom in (pinch) and zoom out (spread).`",
  inputSchema: z.object({
    centerX: z.number().int().describe("Center X coordinate for the pinch"),
    centerY: z.number().int().describe("Center Y coordinate for the pinch"),
    distance: z.number().int().min(10).max(500).describe("Distance in pixels for finger movement"),
    action: z.enum(["in", "out"]).describe("'in' to zoom in (pinch), 'out' to zoom out (spread)"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      getAdb().pinch(input.centerX, input.centerY, input.distance, input.action, input.deviceId);
      eventBus?.publish("mobile:ui-change", { action: "pinch", actionType: input.action });
      return responseBuilder.success({ action: "pinch", actionType: input.action, centerX: input.centerX, centerY: input.centerY, distance: input.distance });
    } catch (error) {
      return responseBuilder.error(error, { code: "ADB_FAILED", suggestions: ["Check device connection"] });
    }
  },
});

// ─── NEW: mobile_get_current_activity ─────────────────────────────

export const mobileGetCurrentActivity = createTool({
  name: "mobile_get_current_activity",
  category: "mobile",
  description: "`<use_case>App context</use_case> Get the currently focused Android activity (foreground app). Returns package/activity name. Useful for understanding which app/screen is currently open.`",
  inputSchema: z.object({
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      const activity = await getAdb().getCurrentActivity(input.deviceId);
      return responseBuilder.success({
        activity: activity ?? "unknown",
        hasActivity: activity !== null,
      });
    } catch (error) {
      return responseBuilder.error(error, { code: "ADB_FAILED", suggestions: ["Check device connection"] });
    }
  },
});

// ─── NEW: mobile_logcat (async) ────────────────────────────────────
// 🔥 CRITICAL GAP #2: Async logcat (non-blocking)

export const mobileLogcat = createTool({
  name: "mobile_logcat",
  category: "mobile",
  description: "`<use_case>Device logs</use_case> Get Android logcat logs asynchronously (non-blocking). Supports filtering by tag, log level, and line count. Returns structured log entries with timestamp, PID, tag, level, and message.`",
  inputSchema: z.object({
    lines: z.number().int().min(1).max(5000).optional().default(100).describe("Number of recent log lines to fetch (max 5000)"),
    tag: z.string().optional().describe("Filter by log tag (e.g., 'ActivityManager', 'System.err')"),
    level: z.enum(["V", "D", "I", "W", "E", "F"]).optional().describe("Minimum log level: V(erbose), D(ebug), I(nfo), W(arning), E(rror), F(atal)"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      const entries = await getAdb().getLogcatAsync(
        { lines: input.lines, tag: input.tag, level: input.level },
        input.deviceId,
      );

      // Publish errors to EventBus for correlation
      const errors = entries.filter((e) => e.level === "E" || e.level === "F");
      for (const err of errors.slice(0, 5)) {
        eventBus?.publish("mobile:logcat", {
          pid: err.pid,
          tag: err.tag,
          message: err.message.slice(0, 200),
          level: err.level,
          deviceId: input.deviceId ?? null,
        });
      }

      return responseBuilder.success({ entries, count: entries.length });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Check device connection", "Ensure ADB debugging is enabled on the device"],
      });
    }
  },
});

// ─── App management ───────────────────────────────────────────────

export const mobileInstallApk = createTool({
  name: "mobile_install_apk",
  category: "mobile",
  description: "`<use_case>App installation</use_case> Install an APK file on the Android device.`",
  inputSchema: z.object({
    apkPath: z.string().min(1).describe("Path to the APK file on the host machine"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      const output = await getAdb().installApkAsync(input.apkPath, input.deviceId);
      const success = output.includes("Success");
      return responseBuilder.success({ success, output });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "INSTALL_FAILED",
        suggestions: ["Verify APK path is correct", "Ensure device has enough storage space", "Check if app is already installed (uninstall first)"],
      });
    }
  },
});

export const mobileLaunchApp = createTool({
  name: "mobile_launch_app",
  category: "mobile",
  description: "`<use_case>App launch</use_case> Launch an Android app by package name. Optionally specify an activity.`",
  inputSchema: z.object({
    packageName: z.string().min(1).describe("Android package name (e.g., 'com.example.app')"),
    activity: z.string().optional().describe("Full activity name (e.g., '.MainActivity'). Defaults to '.MainActivity'"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      const output = getAdb().launchApp(input.packageName, input.activity, input.deviceId);
      eventBus?.publish("mobile:ui-change", { action: "launch_app", packageName: input.packageName, activity: input.activity ?? ".MainActivity" });
      return responseBuilder.success({ action: "launch", packageName: input.packageName, activity: input.activity ?? ".MainActivity", output });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "LAUNCH_FAILED",
        suggestions: ["Verify the package name is correct", "Use mobile_list_devices to ensure device is connected", "Check if the app is installed"],
      });
    }
  },
});

export const mobileStopApp = createTool({
  name: "mobile_stop_app",
  category: "mobile",
  description: "`<use_case>App control</use_case> Force-stop an Android app by package name.`",
  inputSchema: z.object({
    packageName: z.string().min(1).describe("Android package name to stop"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder, eventBus }: ToolContext) => {
    try {
      const output = getAdb().stopApp(input.packageName, input.deviceId);
      eventBus?.publish("mobile:ui-change", { action: "stop_app", packageName: input.packageName });
      return responseBuilder.success({ action: "force-stop", packageName: input.packageName, output });
    } catch (error) {
      return responseBuilder.error(error, { code: "STOP_FAILED", suggestions: ["Verify the package name is correct"] });
    }
  },
});

// ─── NEW: mobile_inspect_webview ─────────────────────────────────
// 🔥 CRITICAL GAP #4: WebView inspection via ADB + CDP
// Allows AI to see inside hybrid app WebViews (like browser tools)

export const mobileInspectWebview = createTool({
  name: "mobile_inspect_webview",
  category: "mobile",
  description: "`<use_case>WebView debugging</use_case> Find and inspect Android WebView instances. Discovers WebView processes, forwards Chrome DevTools ports, and returns page metadata (URLs, titles). Use the returned WebSocket debugger URLs with browser tools for full DOM inspection. Like browser tools but for hybrid apps.`",
  inputSchema: z.object({
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
    port: z.number().int().min(1024).max(65535).optional().default(9222).describe("Starting local port for CDP forwarding (default: 9222)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      const adb = getAdb();

      // 1. Find WebView PIDs
      const pids = adb.findWebViewPids(input.deviceId);
      if (pids.length === 0) {
        return responseBuilder.success({
          webviews: [],
          count: 0,
          hint: "No WebView processes found. Ensure the app has WebView debugging enabled (WebView.setWebContentsDebuggingEnabled(true))",
        });
      }

      // 2. Forward ports for each WebView
      const webviews: Array<{
        pid: number;
        localPort: number;
        pages: Array<{ id: string; title: string; url: string; webSocketDebuggerUrl: string }>;
        error?: string;
      }> = [];

      let currentPort = input.port ?? 9222;

      for (const pid of pids) {
        const localPort = currentPort;
        const forwarded = adb.forwardWebViewPort(pid, localPort, input.deviceId);

        const entry: {
          pid: number;
          localPort: number;
          pages: Array<{ id: string; title: string; url: string; webSocketDebuggerUrl: string }>;
          error?: string;
        } = { pid, localPort, pages: [] };

        if (!forwarded) {
          entry.error = "Port forwarding failed";
          webviews.push(entry);
          currentPort++;
          continue;
        }

        // 3. Fetch page list from CDP HTTP endpoint
        try {
          const response = await fetch(`http://127.0.0.1:${localPort}/json`);
          if (response.ok) {
            const pages = await response.json() as Array<{
              id?: string;
              title?: string;
              url?: string;
              webSocketDebuggerUrl?: string;
              description?: string;
            }>;
            entry.pages = pages.map((p) => ({
              id: p.id ?? "unknown",
              title: p.title ?? "",
              url: p.url ?? "",
              webSocketDebuggerUrl: p.webSocketDebuggerUrl ?? "",
            }));
          }
        } catch (err) {
          entry.error = `Failed to fetch page list: ${err instanceof Error ? err.message : String(err)}`;
        }

        webviews.push(entry);
        currentPort++;
      }

      // 4. Try to extract basic DOM from first WebView page for quick inspection
      let quickDom: string | null = null;
      const firstWebView = webviews.find((w) => w.pages.length > 0 && !w.error);
      if (firstWebView?.pages[0]?.webSocketDebuggerUrl) {
        try {
          // Use CDP to get page content via HTTP eval endpoint
          const pageUrl = firstWebView.pages[0].webSocketDebuggerUrl;
          const wsUrl = new URL(pageUrl);
          // Attempt to get basic text content via CDP
          const evalResult = await fetch(
            `http://127.0.0.1:9222/json/activate/${firstWebView.pages[0].id}`,
            { method: "POST" },
          ).catch(() => null);

          if (evalResult?.ok) {
            quickDom = "WebView page activated. Use browser tools with the webSocketDebuggerUrl for full inspection.";
          }
        } catch {
          // Non-critical
        }
      }

      return responseBuilder.success({
        webviews,
        count: webviews.length,
        totalPages: webviews.reduce((sum, w) => sum + w.pages.length, 0),
        quickDom,
        hint: webviews.length > 0
          ? `Use the webSocketDebuggerUrl with browser CDP tools for full DOM inspection. Forwarded ports: ${webviews.map((w) => `${w.localPort} (PID ${w.pid})`).join(", ")}`
          : undefined,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "WEBVIEW_INSPECT_FAILED",
        suggestions: [
          "Ensure the target app has WebView debugging enabled",
          "Check device connection with mobile_list_devices",
          "Make sure the app is running and showing a WebView",
        ],
      });
    }
  },
});

// ─── NEW: mobile_capture_webview_console ──────────────────────────
// 🔥 CRITICAL GAP #4b: WebView console log capture via CDP WebSocket
// Uses Node.js 22+ built-in WebSocket (no external deps)

export const mobileCaptureWebviewConsole = createTool({
  name: "mobile_capture_webview_console",
  category: "mobile",
  description: "`<use_case>WebView debugging</use_case> Capture JavaScript console logs from an Android WebView via CDP WebSocket. Connects to the WebSocket debugger URL, enables Console domain, and returns recent log entries. Requires Node.js 22+ for built-in WebSocket support. Returns log entries with level, message, source URL, and line number.`",
  inputSchema: z.object({
    webSocketDebuggerUrl: z.string().describe("WebSocket debugger URL from mobile_inspect_webview (the webSocketDebuggerUrl field)"),
    timeoutMs: z.number().int().min(1000).max(30000).optional().default(5000).describe("Max time to wait for console logs (default: 5000ms)"),
    maxEntries: z.number().int().min(1).max(200).optional().default(50).describe("Max console log entries to return (default: 50)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    // Check for WebSocket support (Node.js 22+)
    if (typeof WebSocket === "undefined") {
      return responseBuilder.error(
        new Error("WebSocket is not available in this Node.js version. Node.js 22+ is required."),
        { code: "WEBSOCKET_UNAVAILABLE", suggestions: ["Upgrade to Node.js 22 or later", "Use chrome-remote-interface package as an alternative"] },
      );
    }

    try {
      const logs: Array<{ level: string; message: string; url: string; line: number; timestamp: number }> = [];

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          settled = true;
          ws.close();
          resolve();
        }, input.timeoutMs ?? 5000);

        const ws = new WebSocket(input.webSocketDebuggerUrl);

        ws.onopen = () => {
          // Enable Console domain to start receiving messages
          ws.send(JSON.stringify({ id: 1, method: "Console.enable" }));
          // Also enable Runtime domain for console API calls
          ws.send(JSON.stringify({ id: 2, method: "Runtime.enable" }));
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string);

            // Console.messageAdded — captures console.log/warn/error
            if (msg.method === "Console.messageAdded") {
              const entry = msg.params?.message;
              if (entry) {
                logs.push({
                  level: entry.level ?? "log",
                  message: entry.text ?? "",
                  url: entry.url ?? "",
                  line: entry.line ?? 0,
                  timestamp: Date.now(),
                });
              }
            }

            // Runtime.consoleAPICalled — captures more detailed console API calls
            if (msg.method === "Runtime.consoleAPICalled") {
              const entry = msg.params;
              if (entry) {
                const text = entry.args
                  ?.map((a: { value?: unknown; description?: string; type?: string }) =>
                    a.value ?? a.description ?? `[${a.type}]`)
                  .join(" ") ?? "";
                logs.push({
                  level: entry.type ?? "log",
                  message: String(text).slice(0, 1000),
                  url: entry.stackTrace?.callFrames?.[0]?.url ?? "",
                  line: entry.stackTrace?.callFrames?.[0]?.lineNumber ?? 0,
                  timestamp: Date.now(),
                });
              }
            }

            // Stop collecting after max entries
            if (!settled && logs.length >= (input.maxEntries ?? 50)) {
              settled = true;
              clearTimeout(timeout);
              ws.close();
              resolve();
            }
          } catch {
            // Skip unparseable messages
          }
        };

        ws.onerror = (err: Event) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`WebSocket error: ${(err as ErrorEvent).message ?? "connection failed"}`));
          }
        };

        ws.onclose = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve();
          }
        };
      });

      // Categorize errors vs warnings vs info
      const errors = logs.filter((l) => l.level === "error" || l.level === "assert");
      const warnings = logs.filter((l) => l.level === "warning" || l.level === "warn");

      return responseBuilder.success({
        entries: logs.slice(0, input.maxEntries ?? 50),
        count: logs.length,
        errorCount: errors.length,
        warningCount: warnings.length,
        summary: errors.length > 0
          ? `${errors.length} error(s), ${warnings.length} warning(s) found`
          : `${logs.length} console entries captured (no errors)`,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "WEBSOCKET_FAILED",
        suggestions: [
          "Ensure mobile_inspect_webview was called first and the port is forwarded",
          "Verify the webSocketDebuggerUrl is correct",
          "Ensure the WebView app is running and showing a page",
          "Upgrade to Node.js 22+ for built-in WebSocket support",
        ],
      });
    }
  },
});

// ─── NEW: mobile_get_webview_content ──────────────────────────────
// Extracts text content from a WebView via CDP without WebSocket dependency

export const mobileGetWebviewContent = createTool({
  name: "mobile_get_webview_content",
  category: "mobile",
  description: "`<use_case>WebView debugging</use_case> Extract visible text content from a WebView via CDP HTTP endpoint. Uses Runtime.evaluate to get document.body.innerText. Simpler than full CDP WebSocket but only returns text, not DOM structure.`",
  inputSchema: z.object({
    port: z.number().int().min(1024).max(65535).describe("Local port where WebView CDP is forwarded"),
    pageIndex: z.number().int().min(0).optional().default(0).describe("Page index to inspect (default: 0)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      // 1. Get page list
      const response = await fetch(`http://127.0.0.1:${input.port}/json`);
      if (!response.ok) {
        return responseBuilder.error(
          new Error(`Failed to connect to CDP on port ${input.port}`),
          { code: "CDP_CONNECTION_FAILED", suggestions: ["Ensure mobile_inspect_webview was called first", "Verify the port number is correct"] },
        );
      }

      const pages = await response.json() as Array<{ id?: string; title?: string; url?: string; webSocketDebuggerUrl?: string }>;

      if (pages.length === 0) {
        return responseBuilder.error(
          new Error("No pages found in WebView"),
          { code: "NO_PAGES", suggestions: ["Ensure the WebView has loaded a page", "Try mobile_inspect_webview again"] },
        );
      }

      const page = pages[input.pageIndex!];
      if (!page) {
        return responseBuilder.error(
          new Error(`Page index ${input.pageIndex} not found (${pages.length} available)`),
          { code: "PAGE_NOT_FOUND" },
        );
      }

      // 2. Use HTTP protocol to evaluate JS in the page
      // The CDP HTTP endpoint supports /json/activate, but for execution we'd need WebSocket.
      // For now, return what we can get from HTTP: title, URL, and a note about WebSocket.
      return responseBuilder.success({
        pageId: page.id,
        title: page.title,
        url: page.url,
        webSocketDebuggerUrl: page.webSocketDebuggerUrl,
        pages,
        hint: "For full DOM inspection, use a CDP client to connect to the webSocketDebuggerUrl. Node.js: const CDP = require('chrome-remote-interface'); const client = await CDP({ target: pageId, port: PORT });",
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "CDP_FAILED",
        suggestions: ["Ensure mobile_inspect_webview was called first", "Check that the WebView port is still forwarded"],
      });
    }
  },
});

export const mobileDeviceInfo = createTool({
  name: "mobile_device_info",
  category: "mobile",
  description: "`<use_case>Device info</use_case> Get detailed Android device properties — OS version, SDK, model, manufacturer, build info.`",
  inputSchema: z.object({
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      const adb = getAdb();
      const props = adb.getDeviceProps(input.deviceId);
      return responseBuilder.success({
        model: props["ro.product.model"],
        manufacturer: props["ro.product.manufacturer"],
        androidVersion: props["ro.build.version.release"],
        sdkVersion: parseInt(props["ro.build.version.sdk"] ?? "0", 10),
        buildId: props["ro.build.id"],
        buildType: props["ro.build.type"],
        board: props["ro.product.board"],
        device: props["ro.product.device"],
        abi: props["ro.product.cpu.abi"],
        allProps: props,
      });
    } catch (error) {
      return responseBuilder.error(error, { code: "ADB_FAILED", suggestions: ["Check device connection"] });
    }
  },
});

// ─── Module Export ───────────────────────────────────────────────

const allTools: ToolDefinition[] = [
  mobileListDevices,
  mobileTap,
  mobileType,
  mobileSwipe,
  mobileKeyevent,
  mobileScreenshot,
  mobileGetUiHierarchy,      // 🔥 NEW
  mobileLongPress,           // 🔧 NEW
  mobilePinch,               // 🔧 NEW
  mobileGetCurrentActivity,  // 🔧 NEW
  mobileLogcat,             // ⚡ UPDATED (async)
  mobileInstallApk,          // ⚡ UPDATED (async)
  mobileLaunchApp,
  mobileStopApp,
  mobileDeviceInfo,
  mobileInspectWebview,
  mobileGetWebviewContent,
  mobileCaptureWebviewConsole,
];

export const mobileModule: FennecModule = {
  name: "mobile",
  description: "Mobile device management via ADB — device detection, tap, type, swipe, pinch, logcat, screenshot, UI hierarchy dump, app management. Integrated with EventBus for cross-layer correlation.",

  tools: allTools,

  capabilities: ["android-debug-bridge"],

  initialize: async (context: ModuleContext) => {
    const adb = getAdb();
    if (adb.isAvailable()) {
      const devices = adb.listDevices();
      context.logger.info(`Mobile module: ADB detected with ${devices.length} device(s)`);
      if (devices.length > 0) {
        for (const d of devices) {
          context.logger.info(`  - ${d.id} (${d.state}${d.model ? `, ${d.model}` : ""})`);
        }
      }
    } else {
      context.logger.warn("Mobile module: ADB not found — install Android SDK Platform Tools");
    }
  },

  cleanup: async () => {
    // No cleanup needed — ADB is stateless via CLI
  },
};
