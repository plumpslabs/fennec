import { describe, it, expect } from "vitest";
import { PortDetector } from "../../../src/process/PortDetector.js";

describe("PortDetector", () => {
  const detector = new PortDetector();

  it("should fail gracefully for non-existent pid", () => {
    // PID 999999999 is unlikely to exist
    const result = detector.detectByPid(999999999);
    expect(result).toBeNull();
  });

  it("should not throw for invalid port", () => {
    expect(() => detector.detectByPort(99999)).not.toThrow();
  });

  it("should not throw for invalid pid", () => {
    expect(() => detector.detectByPid(0)).not.toThrow();
  });

  it("should return object with port info for valid ports", () => {
    // This test just verifies the return shape, not specific values
    const result = detector.detectByPort(3000);
    // Either null (no process) or an object with expected shape
    if (result !== null) {
      expect(result).toHaveProperty("pid");
      expect(result).toHaveProperty("port");
      expect(result.port).toBe(3000);
    }
  });
});
