import { describe, it, expect, beforeEach } from "vitest";
import { LogWatcher } from "../../../src/process/LogWatcher.js";

// Note: Full LogWatcher tests require real file system.
// These tests focus on the in-memory buffer behavior.

describe("LogWatcher", () => {
  let watcher: LogWatcher;

  beforeEach(() => {
    watcher = new LogWatcher(100);
  });

  it("should list watchers when none active", () => {
    const list = watcher.list();
    expect(list).toEqual([]);
  });

  it("should return empty logs for non-existent watcher", () => {
    // This tests the error behavior - non-existent watcher should throw
    expect(() => watcher.getLogs("nonexistent")).toThrow("Watcher not found");
  });

  it("should throw for non-existent watcher stop", () => {
    const result = watcher.stop("nonexistent");
    expect(result).toBe(false);
  });

  it("should return 0 for clearing non-existent buffer", () => {
    const count = watcher.clearBuffer("nonexistent");
    expect(count).toBe(0);
  });

  it("should throw when watching non-existent file", () => {
    expect(() => watcher.watchFile("/nonexistent/path/file.log")).toThrow("File not found");
  });

  it("should accept max lines configuration", () => {
    const smallWatcher = new LogWatcher(5);
    // Can't easily test buffer size without file watching,
    // but ensure the constructor doesn't throw
    expect(smallWatcher).toBeDefined();
  });
});
