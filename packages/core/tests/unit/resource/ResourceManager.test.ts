import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ResourceManager } from "../../../src/resource/ResourceManager.js";

describe("ResourceManager", () => {
  let rm: ResourceManager;

  beforeEach(() => {
    rm = new ResourceManager({}, 300);
  });

  afterEach(async () => {
    rm.stopAutoCleanup();
    rm.stopHealthChecks();
    await rm.releaseAll();
  });

  it("should start with zero resources", () => {
    expect(rm.totalCount).toBe(0);
  });

  it("should register a resource", () => {
    const resource = {
      id: "test-1",
      type: "browser_page" as const,
      name: "Test Page",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      metadata: {},
      cleanup: () => {},
    };

    const result = rm.register(resource);
    expect(result).toBe(true);
    expect(rm.totalCount).toBe(1);
  });

  it("should get a resource by ID", () => {
    const resource = {
      id: "test-1",
      type: "browser_page" as const,
      name: "Test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      metadata: {},
      cleanup: () => {},
    };

    rm.register(resource);
    const found = rm.get("test-1");
    expect(found).toBeDefined();
    expect(found!.id).toBe("test-1");
  });

  it("should return null for unknown resource", () => {
    expect(rm.get("nonexistent")).toBeNull();
  });

  it("should unregister a resource", () => {
    rm.register({
      id: "test-1",
      type: "browser_page" as const,
      name: "Test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      metadata: {},
      cleanup: () => {},
    });

    expect(rm.unregister("test-1")).toBe(true);
    expect(rm.totalCount).toBe(0);
  });

  it("should return false when unregistering unknown resource", () => {
    expect(rm.unregister("nonexistent")).toBe(false);
  });

  it("should find resources by predicate", () => {
    rm.register({
      id: "a", type: "browser_page" as const, name: "Page A",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });
    rm.register({
      id: "b", type: "process" as const, name: "Process B",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });

    const found = rm.find((r) => r.type === "browser_page");
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("a");
  });

  it("should get resources by type", () => {
    rm.register({
      id: "p1", type: "process" as const, name: "Proc 1",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });
    rm.register({
      id: "p2", type: "process" as const, name: "Proc 2",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });

    expect(rm.getByType("process")).toHaveLength(2);
    expect(rm.getByType("browser_page")).toHaveLength(0);
  });

  it("should touch a resource to update lastUsedAt", async () => {
    const resource = {
      id: "test-1",
      type: "browser_page" as const,
      name: "Test",
      createdAt: Date.now(),
      lastUsedAt: Date.now() - 100000,
      metadata: {},
      cleanup: () => {},
    };

    rm.register(resource);
    await new Promise((r) => setTimeout(r, 10));

    rm.touch("test-1");
    const found = rm.get("test-1");
    expect(found!.lastUsedAt).toBeGreaterThan(resource.createdAt);
  });

  it("should release a resource (cleanup + unregister)", async () => {
    let cleaned = false;
    rm.register({
      id: "test-1",
      type: "browser_page" as const,
      name: "Test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      metadata: {},
      cleanup: () => { cleaned = true; },
    });

    const released = await rm.release("test-1");
    expect(released).toBe(true);
    expect(cleaned).toBe(true);
    expect(rm.get("test-1")).toBeNull();
  });

  it("should handle cleanup errors gracefully", async () => {
    rm.register({
      id: "test-1",
      type: "browser_page" as const,
      name: "Test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      metadata: {},
      cleanup: () => { throw new Error("Cleanup failed"); },
    });

    // Should not throw
    await expect(rm.release("test-1")).resolves.toBe(true);
  });

  it("should release all resources", async () => {
    rm.register({
      id: "a", type: "browser_page" as const, name: "A",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });
    rm.register({
      id: "b", type: "process" as const, name: "B",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });

    await rm.releaseAll();
    expect(rm.totalCount).toBe(0);
  });

  it("should count resources by type", () => {
    rm.register({
      id: "a", type: "browser_page" as const, name: "A",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });
    rm.register({
      id: "b", type: "browser_page" as const, name: "B",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });
    rm.register({
      id: "c", type: "process" as const, name: "C",
      createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
    });

    const counts = rm.countByType();
    expect(counts["browser_page"]).toBe(2);
    expect(counts["process"]).toBe(1);
  });

  describe("health check", () => {
    it("should report all healthy when no health checks defined", async () => {
      rm.register({
        id: "a", type: "browser_page" as const, name: "A",
        createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
      });

      const report = await rm.runHealthCheck();
      expect(report.healthy).toBe(true);
      expect(report.totalResources).toBe(1);
    });

    it("should detect unhealthy resources", async () => {
      rm.register({
        id: "a", type: "browser_page" as const, name: "A",
        createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
        healthCheck: () => false,
      });

      const report = await rm.runHealthCheck();
      expect(report.healthy).toBe(false);
      expect(report.zombieCount).toBe(1);
    });

    it("should handle health check that throws", async () => {
      rm.register({
        id: "a", type: "browser_page" as const, name: "A",
        createdAt: Date.now(), lastUsedAt: Date.now(), metadata: {}, cleanup: () => {},
        healthCheck: () => { throw new Error("Health check failed"); },
      });

      const report = await rm.runHealthCheck();
      expect(report.healthy).toBe(false);
      expect(report.zombieCount).toBe(1);
    });
  });

  describe("idle cleanup", () => {
    it("should cleanup idle resources", async () => {
      // Create manager with short idle timeout
      const rmShort = new ResourceManager({}, 1); // 1 second idle timeout

      rmShort.register({
        id: "old", type: "browser_page" as const, name: "Old",
        createdAt: Date.now() - 5000,
        lastUsedAt: Date.now() - 5000,
        metadata: {}, cleanup: () => {},
      });

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 1100));

      const cleaned = await rmShort.cleanupIdle();
      expect(cleaned).toBe(1);
      expect(rmShort.get("old")).toBeNull();
    });

    it("should not cleanup recently used resources", async () => {
      rm.register({
        id: "recent", type: "browser_page" as const, name: "Recent",
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        metadata: {}, cleanup: () => {},
      });

      const cleaned = await rm.cleanupIdle();
      expect(cleaned).toBe(0);
    });
  });
});
