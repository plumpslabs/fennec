import { randomUUID } from "node:crypto";
import { getLogger } from "../utils/logger.js";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  requires?: string[]; // Dependencies on other plugins
  capabilities: string[]; // What features this plugin provides
  hooks: PluginHookType[];
}

export type PluginHookType =
  | "beforeTool"
  | "afterTool"  
  | "onError"
  | "onSessionCreate"
  | "onSessionDestroy"
  | "onServerStart"
  | "onServerShutdown"
  | "onWorkflowStep"
  | "onRecordingAction";

export interface PluginAPI {
  logger: typeof getLogger;
  registerHook: (hookType: PluginHookType, handler: HookHandler) => string;
  unregisterHook: (hookId: string) => boolean;
  getConfig: (key: string) => unknown;
  setConfig: (key: string, value: unknown) => void;
  publishEvent: (eventType: string, data: Record<string, unknown>) => void;
  subscribeEvent: (eventType: string, handler: (data: Record<string, unknown>) => void) => () => void;
}

export type HookHandler = (
  context: Record<string, unknown>,
  api: PluginAPI,
) => Promise<Record<string, unknown> | void>;

export interface PluginInstance {
  manifest: PluginManifest;
  instanceId: string;
  enabled: boolean;
  api: PluginAPI;
  hooks: Map<string, { type: PluginHookType; handler: HookHandler }>;
  config: Record<string, unknown>;
}

type PluginFactory = (api: PluginAPI) => Promise<PluginManifest>;

export class PluginSystem {
  private plugins: Map<string, PluginInstance> = new Map();
  private hookRegistry: Map<PluginHookType, Array<{ pluginId: string; hookId: string; handler: HookHandler; priority: number }>> = new Map();
  private eventBus: Map<string, Set<(data: Record<string, unknown>) => void>> = new Map();
  private globalConfig: Record<string, unknown> = {};
  private pluginDir: string;
  private eventLog: Array<{ pluginId: string; event: string; timestamp: number }> = [];

  constructor(pluginDir = "./.fennec/plugins") {
    this.pluginDir = pluginDir;
    this.initHookRegistry();
  }

  private initHookRegistry(): void {
    const hookTypes: PluginHookType[] = [
      "beforeTool", "afterTool", "onError",
      "onSessionCreate", "onSessionDestroy",
      "onServerStart", "onServerShutdown",
      "onWorkflowStep", "onRecordingAction",
    ];
    for (const type of hookTypes) {
      this.hookRegistry.set(type, []);
    }
  }

  /**
   * Register a plugin from a factory function.
   */
  async register(factory: PluginFactory, config: Record<string, unknown> = {}): Promise<PluginInstance> {
    const logger = getLogger();
    const instanceId = `plugin_${randomUUID().slice(0, 8)}`;

    // Create plugin API
    const api = this.createPluginAPI(instanceId);

    // Initialize plugin
    const manifest = await factory(api);

    const instance: PluginInstance = {
      manifest,
      instanceId,
      enabled: true,
      api,
      hooks: new Map(),
      config,
    };

    this.plugins.set(instanceId, instance);

    logger.info({ plugin: manifest.name, version: manifest.version }, "Plugin registered");
    return instance;
  }

  /**
   * Load a plugin from disk by path.
   */
  async loadFromFile(pluginPath: string, config?: Record<string, unknown>): Promise<PluginInstance | null> {
    try {
      const pluginModule = await import(pluginPath);
      if (typeof pluginModule.default !== "function") {
        throw new Error(`Plugin at ${pluginPath} must export a default factory function`);
      }
      return await this.register(pluginModule.default, config);
    } catch (error) {
      getLogger().error({ pluginPath, error }, "Failed to load plugin");
      return null;
    }
  }

  /**
   * Get a plugin instance by ID.
   */
  getPlugin(id: string): PluginInstance | undefined {
    return this.plugins.get(id);
  }

  /**
   * Find plugins by capability.
   */
  findByCapability(capability: string): PluginInstance[] {
    return Array.from(this.plugins.values()).filter(
      (p) => p.enabled && p.manifest.capabilities.includes(capability),
    );
  }

  /**
   * List all registered plugins.
   */
  listPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Enable or disable a plugin.
   */
  setEnabled(instanceId: string, enabled: boolean): boolean {
    const plugin = this.plugins.get(instanceId);
    if (!plugin) return false;
    plugin.enabled = enabled;

    if (!enabled) {
      // Remove all hooks from this plugin
      this.removeAllHooks(instanceId);
    }

    return true;
  }

  /**
   * Unregister a plugin.
   */
  async unregister(instanceId: string): Promise<boolean> {
    const plugin = this.plugins.get(instanceId);
    if (!plugin) return false;

    this.removeAllHooks(instanceId);
    this.plugins.delete(instanceId);

    getLogger().info({ plugin: plugin.manifest.name }, "Plugin unregistered");
    return true;
  }

  /**
   * Execute all hooks of a given type.
   */
  async executeHooks(
    hookType: PluginHookType,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let ctx = { ...context };
    const hooks = this.hookRegistry.get(hookType) ?? [];

    for (const hook of hooks) {
      const plugin = this.plugins.get(hook.pluginId);
      if (!plugin || !plugin.enabled) continue;

      try {
        const result = await hook.handler(ctx, plugin.api);
        if (result && typeof result === "object") {
          ctx = { ...ctx, ...result };
        }
      } catch (error) {
        getLogger().error({
          plugin: hook.pluginId,
          hookType,
          error: String(error),
        }, "Plugin hook execution failed");
      }
    }

    return ctx;
  }

  /**
   * Create a plugin API for a specific plugin instance.
   */
  private createPluginAPI(instanceId: string): PluginAPI {
    const system = this;

    return {
      logger: getLogger,

      registerHook: (hookType, handler) => {
        const hookId = `hook_${randomUUID().slice(0, 8)}`;
        const hooks = system.hookRegistry.get(hookType) ?? [];
        hooks.push({ pluginId: instanceId, hookId, handler, priority: 0 });
        hooks.sort((a, b) => b.priority - a.priority);
        return hookId;
      },

      unregisterHook: (hookId) => {
        for (const [, hooks] of system.hookRegistry) {
          const idx = hooks.findIndex((h) => h.hookId === hookId);
          if (idx !== -1) {
            hooks.splice(idx, 1);
            return true;
          }
        }
        return false;
      },

      getConfig: (key) => {
        return system.globalConfig[key] ?? system.plugins.get(instanceId)?.config[key];
      },

      setConfig: (key, value) => {
        const plugin = system.plugins.get(instanceId);
        if (plugin) {
          plugin.config[key] = value;
        }
      },

      publishEvent: (eventType, data) => {
        system.eventLog.push({ pluginId: instanceId, event: eventType, timestamp: Date.now() });
        const handlers = system.eventBus.get(eventType);
        if (handlers) {
          for (const handler of handlers) {
            try { handler(data); } catch { /* ignore */ }
          }
        }
      },

      subscribeEvent: (eventType, handler) => {
        if (!system.eventBus.has(eventType)) {
          system.eventBus.set(eventType, new Set());
        }
        system.eventBus.get(eventType)!.add(handler);
        return () => { system.eventBus.get(eventType)?.delete(handler); };
      },
    };
  }

  private removeAllHooks(instanceId: string): void {
    for (const [, hooks] of this.hookRegistry) {
      const remaining = hooks.filter((h) => h.pluginId !== instanceId);
      hooks.length = 0;
      hooks.push(...remaining);
    }
  }

  /**
   * Get event log for debugging.
   */
  getEventLog(limit = 50): Array<{ pluginId: string; event: string; timestamp: number }> {
    return this.eventLog.slice(-limit);
  }
}
