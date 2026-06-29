import { describe, it, expect, beforeEach } from "vitest";
import { PluginSystem } from "../../../src/plugin/PluginSystem.js";
import type { PluginManifest } from "../../../src/plugin/PluginSystem.js";

describe("PluginSystem", () => {
  let pluginSystem: PluginSystem;

  beforeEach(() => {
    pluginSystem = new PluginSystem();
  });

  const createDummyFactory = (name = "test-plugin", capabilities: string[] = []) => {
    return async () => {
      return {
        name,
        version: "1.0.0",
        description: "Test plugin",
        capabilities,
        hooks: [],
      } as PluginManifest;
    };
  };

  describe("register", () => {
    it("should register a plugin from a factory function", async () => {
      const instance = await pluginSystem.register(createDummyFactory("my-plugin"));
      expect(instance.manifest.name).toBe("my-plugin");
      expect(instance.instanceId).toContain("plugin_");
      expect(instance.enabled).toBe(true);
    });

    it("should assign a unique instanceId to each plugin", async () => {
      const a = await pluginSystem.register(createDummyFactory("a"));
      const b = await pluginSystem.register(createDummyFactory("b"));
      expect(a.instanceId).not.toBe(b.instanceId);
    });
  });

  describe("getPlugin", () => {
    it("should return a plugin by instanceId", async () => {
      const instance = await pluginSystem.register(createDummyFactory("find-me"));
      const found = pluginSystem.getPlugin(instance.instanceId);
      expect(found).toBeDefined();
      expect(found!.manifest.name).toBe("find-me");
    });

    it("should return undefined for unknown plugin", () => {
      expect(pluginSystem.getPlugin("nonexistent")).toBeUndefined();
    });
  });

  describe("listPlugins", () => {
    it("should list all registered plugins", async () => {
      await pluginSystem.register(createDummyFactory("a"));
      await pluginSystem.register(createDummyFactory("b"));
      const list = pluginSystem.listPlugins();
      expect(list).toHaveLength(2);
    });

    it("should return empty array when no plugins registered", () => {
      expect(pluginSystem.listPlugins()).toHaveLength(0);
    });
  });

  describe("findByCapability", () => {
    it("should find plugins by capability", async () => {
      const factory = async () => ({
        name: "diag", version: "1.0.0", description: "",
        capabilities: ["diagnostic", "monitoring"],
        hooks: [],
      }) as PluginManifest;

      const factoryOther = async () => ({
        name: "auth", version: "1.0.0", description: "",
        capabilities: ["authentication"],
        hooks: [],
      }) as PluginManifest;

      await pluginSystem.register(factory);
      await pluginSystem.register(factoryOther);

      const diag = pluginSystem.findByCapability("diagnostic");
      expect(diag).toHaveLength(1);
      expect(diag[0]!.manifest.name).toBe("diag");

      expect(pluginSystem.findByCapability("monitoring")).toHaveLength(1);
      expect(pluginSystem.findByCapability("authentication")).toHaveLength(1);
    });

    it("should exclude disabled plugins", async () => {
      const instance = await pluginSystem.register(createDummyFactory("p", ["feature-x"]));
      pluginSystem.setEnabled(instance.instanceId, false);

      expect(pluginSystem.findByCapability("feature-x")).toHaveLength(0);
    });
  });

  describe("setEnabled / unregister", () => {
    it("should toggle plugin enabled state", async () => {
      const instance = await pluginSystem.register(createDummyFactory("togglable"));
      expect(pluginSystem.getPlugin(instance.instanceId)!.enabled).toBe(true);

      pluginSystem.setEnabled(instance.instanceId, false);
      expect(pluginSystem.getPlugin(instance.instanceId)!.enabled).toBe(false);
    });

    it("should return false when enabling unknown plugin", () => {
      expect(pluginSystem.setEnabled("nope", false)).toBe(false);
    });

    it("should unregister a plugin", async () => {
      const instance = await pluginSystem.register(createDummyFactory("gone"));
      expect(pluginSystem.listPlugins()).toHaveLength(1);

      const result = await pluginSystem.unregister(instance.instanceId);
      expect(result).toBe(true);
      expect(pluginSystem.listPlugins()).toHaveLength(0);
    });

    it("should return false when unregistering unknown plugin", async () => {
      expect(await pluginSystem.unregister("nope")).toBe(false);
    });
  });

  describe("plugin API", () => {
    it("should provide logger, registerHook, and unregisterHook via plugin API", async () => {
      let capturedApi: any = null;

      const factory = async (api: any) => {
        capturedApi = api;
        return { name: "api-test", version: "1.0.0", description: "", capabilities: [], hooks: [] } as PluginManifest;
      };

      await pluginSystem.register(factory);
      expect(capturedApi).toBeDefined();
      expect(typeof capturedApi.logger).toBe("function");
      expect(typeof capturedApi.registerHook).toBe("function");
      expect(typeof capturedApi.unregisterHook).toBe("function");
      expect(typeof capturedApi.getConfig).toBe("function");
      expect(typeof capturedApi.setConfig).toBe("function");
      expect(typeof capturedApi.publishEvent).toBe("function");
      expect(typeof capturedApi.subscribeEvent).toBe("function");
    });

    it("should register and unregister hooks via plugin API", async () => {
      let registeredHookId = "";

      const factory = async (api: any) => {
        registeredHookId = api.registerHook("beforeTool", async () => {});
        return { name: "hook-test", version: "1.0.0", description: "", capabilities: [], hooks: ["beforeTool"] } as PluginManifest;
      };

      await pluginSystem.register(factory);
      expect(registeredHookId).toContain("hook_");

      // Unregister the hook
      const instance = pluginSystem.listPlugins()[0]!;
      const result = instance.api.unregisterHook(registeredHookId);
      expect(result).toBe(true);
    });

    it("should manage config via plugin API", async () => {
      let capturedApi: any = null;

      const factory = async (api: any) => {
        capturedApi = api;
        return { name: "config-test", version: "1.0.0", description: "", capabilities: [], hooks: [] } as PluginManifest;
      };

      await pluginSystem.register(factory, { initialKey: "initialValue" });

      expect(capturedApi.getConfig("initialKey")).toBe("initialValue");
      capturedApi.setConfig("newKey", "newValue");
      expect(capturedApi.getConfig("newKey")).toBe("newValue");
    });

    it("should support event publish/subscribe between plugins", async () => {
      const received: unknown[] = [];

      const publisherFactory = async (api: any) => {
        return { name: "publisher", version: "1.0.0", description: "", capabilities: [], hooks: [] } as PluginManifest;
      };

      const subscriberFactory = async (api: any) => {
        api.subscribeEvent("custom:event", (data: unknown) => { received.push(data); });
        return { name: "subscriber", version: "1.0.0", description: "", capabilities: [], hooks: [] } as PluginManifest;
      };

      const pub = await pluginSystem.register(publisherFactory);
      await pluginSystem.register(subscriberFactory);

      pub.api.publishEvent("custom:event", { message: "hello" });

      expect(received).toHaveLength(1);
      expect((received[0] as any).message).toBe("hello");
    });
  });

  describe("executeHooks", () => {
    it("should execute hooks in order and merge context", async () => {
      const factory = async (api: any) => {
        api.registerHook("beforeTool", async (ctx: any) => ({ step1: "done" }));
        api.registerHook("beforeTool", async (ctx: any) => ({ step2: "done" }));
        return { name: "hook-exec", version: "1.0.0", description: "", capabilities: [], hooks: ["beforeTool"] } as PluginManifest;
      };

      await pluginSystem.register(factory);

      const result = await pluginSystem.executeHooks("beforeTool", { initial: true });
      expect(result).toHaveProperty("initial", true);
      expect(result).toHaveProperty("step1", "done");
      expect(result).toHaveProperty("step2", "done");
    });

    it("should handle hook errors gracefully without breaking chain", async () => {
      const factory = async (api: any) => {
        api.registerHook("beforeTool", async () => { throw new Error("Hook failed"); });
        api.registerHook("beforeTool", async (ctx: any) => ({ afterError: "ok" }));
        return { name: "error-handler", version: "1.0.0", description: "", capabilities: [], hooks: ["beforeTool"] } as PluginManifest;
      };

      await pluginSystem.register(factory);

      const result = await pluginSystem.executeHooks("beforeTool", {});
      expect(result).toHaveProperty("afterError", "ok");
    });
  });

  describe("getEventLog", () => {
    it("should log events from publishEvent", async () => {
      const instance = await pluginSystem.register(createDummyFactory("logger"));
      instance.api.publishEvent("test:event", { foo: "bar" });
      instance.api.publishEvent("test:event", { baz: "qux" });

      const log = pluginSystem.getEventLog(10);
      expect(log).toHaveLength(2);
      expect(log[0]!.event).toBe("test:event");
    });

    it("should respect the limit parameter", async () => {
      const instance = await pluginSystem.register(createDummyFactory("limited"));
      for (let i = 0; i < 10; i++) {
        instance.api.publishEvent("evt", { i });
      }
      expect(pluginSystem.getEventLog(3)).toHaveLength(3);
    });
  });

  describe("loadFromFile", () => {
    it("should return null for non-existent plugin path", async () => {
      const result = await pluginSystem.loadFromFile("/nonexistent/plugin.js");
      expect(result).toBeNull();
    });
  });
});
