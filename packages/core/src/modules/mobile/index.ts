/**
 * Mobile / Android Module
 *
 * Provides Android device management and interaction via ADB:
 * - Device detection (list devices, device info)
 * - Interaction (tap, type, swipe, keyevent)
 * - Debugging (logcat)
 * - Screenshots
 * - App management (install, uninstall, launch, stop)
 *
 * Requirements: ADB from Android SDK Platform Tools must be installed.
 *
 * @module mobile
 */

import { z } from "zod";
import type { FennecModule, ModuleContext } from "../../module/index.js";
import type { ToolDefinition, ToolContext } from "../../tools/_registry.js";
import { createTool } from "../../tools/_registry.js";
import { AdbClient } from "./adb-client.js";

// ─── Singleton ADB Client ────────────────────────────────────────

let adbClient: AdbClient | null = null;

function getAdb(): AdbClient {
  if (!adbClient) {
    adbClient = new AdbClient();
  }
  return adbClient;
}

// ─── Tools ───────────────────────────────────────────────────────

export const mobileListDevices = createTool({
  name: "mobile_list_devices",
  category: "mobile",
  description: "`<use_case>Device discovery</use_case> List connected Android devices via ADB. Returns device ID, state, model for each device.`",
  inputSchema: z.object({}),
  handler: async (_input, { responseBuilder, logger }: ToolContext) => {
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
  description: "`<use_case>Screen interaction</use_case> Tap at specified x,y coordinates on the Android device screen.`",
  inputSchema: z.object({
    x: z.number().int().describe("X coordinate to tap"),
    y: z.number().int().describe("Y coordinate to tap"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      getAdb().tap(input.x, input.y, input.deviceId);
      return responseBuilder.success({
        action: "tap",
        x: input.x,
        y: input.y,
      });
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
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      getAdb().type(input.text, input.deviceId);
      return responseBuilder.success({
        action: "type",
        length: input.text.length,
      });
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
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      getAdb().swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs, input.deviceId);
      return responseBuilder.success({
        action: "swipe",
        from: { x: input.x1, y: input.y1 },
        to: { x: input.x2, y: input.y2 },
        durationMs: input.durationMs,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Check device connection"],
      });
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
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      getAdb().keyevent(input.key, input.deviceId);
      return responseBuilder.success({
        action: "keyevent",
        key: input.key,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: [
          "Check device connection",
          "Common keyevent names: HOME, BACK, ENTER, MENU, VOLUME_UP, VOLUME_DOWN, POWER, CAMERA",
        ],
      });
    }
  },
});

export const mobileScreenshot = createTool({
  name: "mobile_screenshot",
  category: "mobile",
  description: "`<use_case>Screen capture</use_case> Take a screenshot of the Android device screen and return it as base64.`",
  inputSchema: z.object({
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      const result = getAdb().screenshot(input.deviceId);
      return responseBuilder.success({
        screenshot: result.base64,
        width: result.width,
        height: result.height,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Check device connection", "Ensure device screen is on"],
      });
    }
  },
});

export const mobileLogcat = createTool({
  name: "mobile_logcat",
  category: "mobile",
  description: "`<use_case>Device logs</use_case> Get Android logcat logs. Supports filtering by tag, log level, and line count. Returns structured log entries with timestamp, PID, tag, level, and message.`",
  inputSchema: z.object({
    lines: z.number().int().min(1).max(5000).optional().default(100).describe("Number of recent log lines to fetch (max 5000)"),
    tag: z.string().optional().describe("Filter by log tag (e.g., 'ActivityManager', 'System.err')"),
    level: z.enum(["V", "D", "I", "W", "E", "F"]).optional().describe("Minimum log level: V(erbose), D(ebug), I(nfo), W(arning), E(rror), F(atal)"),
    deviceId: z.string().optional().describe("Target device ID (omit for single device)"),
  }),
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      const entries = getAdb().getLogcat(
        { lines: input.lines, tag: input.tag, level: input.level },
        input.deviceId,
      );
      return responseBuilder.success({
        entries,
        count: entries.length,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Check device connection", "Ensure ADB debugging is enabled on the device"],
      });
    }
  },
});

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
      const output = getAdb().installApk(input.apkPath, input.deviceId);
      const success = output.includes("Success");
      return responseBuilder.success({
        success,
        output,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "INSTALL_FAILED",
        suggestions: [
          "Verify APK path is correct",
          "Ensure device has enough storage space",
          "Check if app is already installed (uninstall first)",
        ],
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
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      const output = getAdb().launchApp(input.packageName, input.activity, input.deviceId);
      return responseBuilder.success({
        action: "launch",
        packageName: input.packageName,
        activity: input.activity ?? ".MainActivity",
        output,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "LAUNCH_FAILED",
        suggestions: [
          "Verify the package name is correct",
          "Use `mobile_list_devices` to ensure device is connected",
          "Check if the app is installed on the device",
        ],
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
  handler: async (input, { responseBuilder }: ToolContext) => {
    try {
      const output = getAdb().stopApp(input.packageName, input.deviceId);
      return responseBuilder.success({
        action: "force-stop",
        packageName: input.packageName,
        output,
      });
    } catch (error) {
      return responseBuilder.error(error, {
        code: "STOP_FAILED",
        suggestions: ["Verify the package name is correct"],
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
      return responseBuilder.error(error, {
        code: "ADB_FAILED",
        suggestions: ["Check device connection"],
      });
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
  mobileLogcat,
  mobileInstallApk,
  mobileLaunchApp,
  mobileStopApp,
  mobileDeviceInfo,
];

export const mobileModule: FennecModule = {
  name: "mobile",
  description: "Mobile device management via ADB — device detection, tap, type, swipe, logcat, screenshot, app management",

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
