/**
 * Plugin System — Fennec plugin architecture.
 *
 * Supports registering external plugins that can contribute:
 * - Tools (via ToolRegistry)
 * - Lifecycle hooks (before/after tool calls, on error, etc.)
 * - Event pub/sub
 * - Config per plugin
 * - loadFromFile / loadFromDirectory for external plugins
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { getLogger } from '../utils/logger.js';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  license?: string;
  minFennecVersion?: string;
  requires?: string[];
  capabilities?: string[];
}

export type PluginHookType =
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'onError'
  | 'onSessionCreate'
  | 'onSessionDestroy'
  | 'onStartup'
  | 'onShutdown'
  | 'onWorkflowStep';

export type HookHandler = (
  context: Record<string, unknown>,
) => Promise<Record<string, unknown> | void>;

export interface PluginAPI {
  logger: ReturnType<typeof getLogger>;
  registerHook: (hookType: PluginHookType, handler: HookHandler) => string;
  unregisterHook: (hookId: string) => boolean;
  getConfig: (key: string) => unknown;
  setConfig: (key: string, value: unknown) => void;
  publishEvent: (eventType: string, data: Record<string, unknown>) => void;
  subscribeEvent: (
    eventType: string,
    handler: (data: Record<string, unknown>) => void,
  ) => () => void;
}

export interface PluginInstance {
  manifest: PluginManifest;
  instanceId: string;
  enabled: boolean;
  api: PluginAPI;
  hooks: Map<string, { type: PluginHookType; handler: HookHandler }>;
  config: Record<string, unknown>;
  /** Tools this plugin contributes */
  tools?: Array<{
    name: string;
    category: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  onInitialize?: (api: PluginAPI) => Promise<void>;
  onCleanup?: () => Promise<void>;
}

type PluginFactory = (api: PluginAPI) => Promise<PluginManifest>;

export class PluginSystem {
  private plugins: Map<string, PluginInstance> = new Map();
  private hookRegistry: Map<
    PluginHookType,
    Array<{ pluginId: string; hookId: string; handler: HookHandler; priority: number }>
  > = new Map();
  private eventBus: Map<string, Set<(data: Record<string, unknown>) => void>> = new Map();
  private globalConfig: Record<string, unknown> = {};
  private pluginDir: string;
  private eventLog: Array<{ pluginId: string; event: string; timestamp: number }> = [];

  constructor(pluginDir = './.fennec/plugins') {
    this.pluginDir = pluginDir;
    this.initHookRegistry();
  }

  private initHookRegistry(): void {
    const hookTypes: PluginHookType[] = [
      'beforeToolCall',
      'afterToolCall',
      'onError',
      'onSessionCreate',
      'onSessionDestroy',
      'onStartup',
      'onShutdown',
      'onWorkflowStep',
    ];
    for (const type of hookTypes) {
      this.hookRegistry.set(type, []);
    }
  }

  registerPlugin(
    instance: Omit<PluginInstance, 'instanceId' | 'api' | 'hooks' | 'enabled'>,
  ): PluginInstance {
    const instanceId = `plugin_${randomUUID().slice(0, 8)}`;
    const api = this.createPluginAPI(instanceId);

    const plugin: PluginInstance = {
      ...instance,
      instanceId,
      enabled: true,
      api,
      hooks: new Map(),
      config: {},
    };

    this.plugins.set(instanceId, plugin);
    getLogger().info({ plugin: instance.manifest.name, version: instance.manifest.version }, 'Plugin registered');
    return plugin;
  }

  async register(
    factory: PluginFactory,
    config: Record<string, unknown> = {},
  ): Promise<PluginInstance> {
    const instanceId = `plugin_${randomUUID().slice(0, 8)}`;
    const api = this.createPluginAPI(instanceId);
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
    getLogger().info({ plugin: manifest.name, version: manifest.version }, 'Plugin registered via factory');
    return instance;
  }

  async loadFromFile(
    pluginPath: string,
    config?: Record<string, unknown>,
  ): Promise<PluginInstance | null> {
    try {
      const resolved = resolve(pluginPath);
      const pluginModule = await import(resolved);
      if (typeof pluginModule.default === 'function') {
        return await this.register(pluginModule.default, config);
      }
      if (pluginModule.manifest) {
        return this.registerPlugin(pluginModule);
      }
      throw new Error(`Plugin at ${pluginPath} must export a default factory function or a PluginInstance`);
    } catch (error) {
      getLogger().error({ pluginPath, error: String(error) }, 'Failed to load plugin');
      return null;
    }
  }

  async loadFromDirectory(dirPath?: string): Promise<number> {
    const dir = dirPath ?? this.pluginDir;
    if (!existsSync(dir)) return 0;

    let loaded = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        const fullPath = resolve(dir, entry.name);
        const stat = statSync(fullPath);
        if (stat.size === 0) continue;
        const plugin = await this.loadFromFile(fullPath);
        if (plugin) loaded++;
      }
    }
    return loaded;
  }

  get(id: string): PluginInstance | undefined {
    return this.plugins.get(id);
  }

  getByName(name: string): PluginInstance | undefined {
    return Array.from(this.plugins.values()).find((p) => p.manifest.name === name);
  }

  getAll(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  findByCapability(capability: string): PluginInstance[] {
    return Array.from(this.plugins.values()).filter(
      (p) => p.enabled && p.manifest.capabilities?.includes(capability),
    );
  }

  setEnabled(instanceId: string, enabled: boolean): boolean {
    const plugin = this.plugins.get(instanceId);
    if (!plugin) return false;
    plugin.enabled = enabled;
    if (!enabled) this.removeAllHooks(instanceId);
    return true;
  }

  async unregister(instanceId: string): Promise<boolean> {
    const plugin = this.plugins.get(instanceId);
    if (!plugin) return false;
    this.removeAllHooks(instanceId);
    this.plugins.delete(instanceId);
    getLogger().info({ plugin: plugin.manifest.name }, 'Plugin unregistered');
    return true;
  }

  async initializeAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onInitialize) {
        try {
          await plugin.onInitialize(plugin.api);
        } catch (error) {
          getLogger().error(
            { plugin: plugin.manifest.name, error: String(error) },
            'Plugin initialization failed',
          );
        }
      }
    }
  }

  async cleanupAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onCleanup) {
        try {
          await plugin.onCleanup();
        } catch (error) {
          getLogger().error(
            { plugin: plugin.manifest.name, error: String(error) },
            'Plugin cleanup failed',
          );
        }
      }
    }
  }

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
        const result = await hook.handler(ctx);
        if (result && typeof result === 'object') {
          ctx = { ...ctx, ...result };
        }
      } catch (error) {
        getLogger().error(
          { plugin: hook.pluginId, hookType, error: String(error) },
          'Plugin hook execution failed',
        );
      }
    }

    return ctx;
  }

  private createPluginAPI(instanceId: string): PluginAPI {
    const system = this;
    const logger = getLogger();

    return {
      logger,
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
        if (plugin) plugin.config[key] = value;
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
        return () => {
          system.eventBus.get(eventType)?.delete(handler);
        };
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

  getEventLog(limit = 50): Array<{ pluginId: string; event: string; timestamp: number }> {
    return this.eventLog.slice(-limit);
  }
}
