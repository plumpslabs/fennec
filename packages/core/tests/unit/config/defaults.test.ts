import { describe, it, expect } from "vitest";
import { defaultConfig } from "../../../src/config/defaults.js";

describe("defaultConfig", () => {
  it("should have all required browser configs", () => {
    expect(defaultConfig.browser).toBeDefined();
    expect(defaultConfig.browser.type).toBe("chromium");
    expect(defaultConfig.browser.headless).toBe(true);
    expect(defaultConfig.browser.defaultTimeout).toBe(30000);
    expect(defaultConfig.browser.viewport).toEqual({ width: 1280, height: 720 });
    expect(defaultConfig.browser.locale).toBe("en-US");
    expect(defaultConfig.browser.ignoreHTTPSErrors).toBe(false);
  });

  it("should have reasonable session defaults", () => {
    expect(defaultConfig.session.maxSessions).toBe(10);
    expect(defaultConfig.session.idleTimeoutSecs).toBe(1800);
    expect(defaultConfig.session.persistPath).toBe("./.fennec/sessions");
  });

  it("should have secure process defaults", () => {
    expect(defaultConfig.process.maxProcesses).toBe(10);
    expect(defaultConfig.process.logBufferLines).toBe(2000);
    expect(defaultConfig.process.spawnAllowlist).toContain("npm");
    expect(defaultConfig.process.spawnAllowlist).toContain("node");
    expect(defaultConfig.process.spawnAllowlist).toContain("pnpm");
  });

  it("should have secure defaults enabled", () => {
    expect(defaultConfig.security.sandbox).toBe(true);
    expect(defaultConfig.security.allowProcessSpawn).toBe(true);
    expect(defaultConfig.security.allowProcessKill).toBe(false);
    expect(defaultConfig.security.allowFileProtocol).toBe(false);
    expect(defaultConfig.security.allowCDPRawAccess).toBe(false);
    expect(defaultConfig.security.allowJSEvaluation).toBe(true);
    expect(defaultConfig.security.maxExportSizeMB).toBe(10);
  });

  it("should have reasonable correlation defaults", () => {
    expect(defaultConfig.correlation.windowMs).toBe(500);
    expect(defaultConfig.correlation.enableRootCauseInference).toBe(true);
    expect(defaultConfig.correlation.minConfidence).toBe(0.7);
  });

  it("should default to stdio transport", () => {
    expect(defaultConfig.transport.type).toBe("stdio");
    expect(defaultConfig.transport.port).toBe(3333);
    expect(defaultConfig.transport.host).toBe("127.0.0.1");
  });

  it("should have info logging by default", () => {
    expect(defaultConfig.logging.level).toBe("info");
    expect(defaultConfig.logging.format).toBe("pretty");
    expect(defaultConfig.logging.file).toBeNull();
  });
});
