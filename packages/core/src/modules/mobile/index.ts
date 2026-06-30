/**
 * Mobile / Android Module (STUB)
 *
 * Will provide tools for Android device management via ADB:
 * - Device detection (adb devices)
 * - Interaction (tap, swipe, type, long press)
 * - Debugging (logcat, crash, ANR)
 * - App management (install APK, launch, stop)
 * - Expo / Flutter bridge
 *
 * @module mobile
 */

import type { FennecModule, ModuleContext } from "../../module/index.js";
import type { ToolDefinition } from "../../tools/_registry.js";

export const mobileModule: FennecModule = {
  name: "mobile",
  description: "Mobile device management via ADB — device detection, tap, swipe, logcat, app management",

  tools: [] as ToolDefinition[],

  capabilities: [],

  initialize: async (context: ModuleContext) => {
    // Check ADB availability
    try {
      const { execSync } = await import("node:child_process");
      execSync("adb --version", { stdio: "ignore", timeout: 2000 });
      context.logger.info("Mobile module: ADB detected");
    } catch {
      context.logger.warn("Mobile module: ADB not found — install Android platform tools");
    }
  },
};
