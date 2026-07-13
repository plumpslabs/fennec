/**
 * Plugin System — Fennec plugin architecture.
 *
 * Supports registering external plugins that can contribute:
 * - Tools (via ToolRegistry)
 * - Middleware (injected into Pipeline)
 * - Lifecycle hooks (initialize/cleanup)
 */

// ─── Type Exports ─────────────────────────────────────────────
// These types are imported by core/src/index.ts and must be exported.

/** Plugin manifest metadata — describes a plugin */
export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  license?: string;
  /** Minimum Fennec version required */
  minFennecVersion?: string;
}

/** A loaded plugin instance with its manifest and API access */
export interface PluginInstance {
  manifest: PluginManifest;
  /** Tools this plugin contributes */
  tools?: Array<{
    name: string;
    category: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  /** Middleware to inject into the pipeline */
  middleware?: Array<{
    position: 'before' | 'after';
    target: string;
  }>;
  /** Lifecycle hooks */
  onInitialize?: (api: PluginAPI) => Promise<void>;
  onCleanup?: () => Promise<void>;
}

/** API object passed to plugins on initialization */
export interface PluginAPI {
  /** Register a tool dynamically */
  registerTool: (tool: {
    name: string;
    category: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }) => void;
  /** Access the event bus for pub/sub */
  eventBus: import('../correlation/EventBus.js').EventBus;
  /** Logger instance */
  logger: import('../utils/logger.js').FennecLogger;
  /** Config access (read-only) */
  config: Record<string, unknown>;
}

/** Supported hook types for plugins */
export type PluginHookType =
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'onError'
  | 'onSessionCreate'
  | 'onSessionDestroy'
  | 'onStartup'
  | 'onShutdown';

/** Handler function signature for plugin hooks */
export type HookHandler = (context: Record<string, unknown>) => Promise<void>;

// ─── Legacy type (backward compat) ───────────────────────────

export interface FennecPlugin {
  name: string;
  version: string;
  description: string;
  tools?: Array<{
    name: string;
    category: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  middleware?: Array<{
    position: 'before' | 'after';
    target: string;
    fn: (ctx: any, next: () => Promise<any>) => Promise<any>;
  }>;
  onInitialize?: () => Promise<void>;
  onCleanup?: () => Promise<void>;
}

// ─── Plugin System ───────────────────────────────────────────

export class PluginSystem {
  private plugins: Map<string, PluginInstance> = new Map();

  register(plugin: PluginInstance): void {
    if (this.plugins.has(plugin.manifest.name)) {
      throw new Error(`Plugin '${plugin.manifest.name}' is already registered`);
    }
    this.plugins.set(plugin.manifest.name, plugin);
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  get(name: string): PluginInstance | undefined {
    return this.plugins.get(name);
  }

  getAll(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  async initializeAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onInitialize) {
        await plugin.onInitialize({
          registerTool: () => {},
          eventBus: null as any,
          logger: null as any,
          config: {},
        });
      }
    }
  }

  async cleanupAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onCleanup) {
        await plugin.onCleanup();
      }
    }
  }
}
