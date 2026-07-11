import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigLoader } from "../../../src/config/ConfigLoader.js";

describe("ConfigLoader", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  it("should load default config when no path provided", () => {
    const loader = new ConfigLoader();
    const config = loader.getConfig();
    expect(config.browser.type).toBe("chromium");
    expect(config.browser.headless).toBe(true);
  });

  it("should override config with environment variables", () => {
    process.env.FENNEC_BROWSER_TYPE = "firefox";
    process.env.FENNEC_HEADLESS = "false";
    process.env.FENNEC_DEFAULT_TIMEOUT = "5000";
    process.env.FENNEC_TRANSPORT_TYPE = "sse";
    process.env.FENNEC_PORT = "4444";
    process.env.FENNEC_LOG_LEVEL = "debug";
    process.env.FENNEC_SANDBOX = "false";

    const loader = new ConfigLoader();
    const config = loader.getConfig();

    expect(config.browser.type).toBe("firefox");
    expect(config.browser.headless).toBe(false);
    expect(config.browser.defaultTimeout).toBe(5000);
    expect(config.transport.type).toBe("sse");
    expect(config.transport.port).toBe(4444);
    expect(config.logging.level).toBe("debug");
    expect(config.security.sandbox).toBe(false);
  });

  it("should override security process permissions via environment variables", () => {
    process.env.FENNEC_SECURITY_ALLOW_PROCESS_SPAWN = "true";
    process.env.FENNEC_SECURITY_ALLOW_PROCESS_KILL = "true";
    process.env.FENNEC_SECURITY_ALLOW_JS_EVALUATION = "false";

    const loader = new ConfigLoader();
    const config = loader.getConfig();

    expect(config.security.allowProcessSpawn).toBe(true);
    expect(config.security.allowProcessKill).toBe(true);
    expect(config.security.allowJSEvaluation).toBe(false);
  });

  it("should treat non-'false' security env values as enabled", () => {
    process.env.FENNEC_SECURITY_ALLOW_PROCESS_KILL = "1";

    const loader = new ConfigLoader();
    expect(loader.getConfig().security.allowProcessKill).toBe(true);
  });

  it("should handle viewport env variables", () => {
    process.env.FENNEC_VIEWPORT_WIDTH = "1920";
    process.env.FENNEC_VIEWPORT_HEIGHT = "1080";

    const loader = new ConfigLoader();
    const config = loader.getConfig();

    expect(config.browser.viewport.width).toBe(1920);
    expect(config.browser.viewport.height).toBe(1080);
  });

  it("should provide type-safe get method", () => {
    const loader = new ConfigLoader();
    const browser = loader.get("browser");
    expect(browser.type).toBe("chromium");

    const security = loader.get("security");
    expect(security.sandbox).toBe(true);
    expect(security.allowProcessKill).toBe(false);
  });
});
