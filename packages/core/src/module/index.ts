/**
 * Fennec Module System
 *
 * Provides a standard interface for all Fennec modules (browser, mobile, process, etc.)
 * so they can be registered, initialized, and cleaned up uniformly.
 *
 * ## Usage
 *
 * ```typescript
 * class BrowserModule implements FennecModule {
 *   name = "browser";
 *   tools = [browserNavigate, browserClick, ...];
 *   async initialize(ctx) { ... }
 * }
 *
 * const registry = new ModuleRegistry();
 * registry.register(new BrowserModule());
 * registry.registerAll(); // registers all tools from all modules
 * ```
 */

import type { ToolDefinition, ToolContext } from '../tools/_registry.js';
import type { ToolRegistry } from '../tools/_registry.js';
import type { FennecConfig } from '../config/defaults.js';
import { getLogger } from '../utils/logger.js';

/**
 * Context passed to modules during initialization.
 */
export interface ModuleContext {
  config: FennecConfig;
  toolRegistry: ToolRegistry;
  logger: Pick<Console, 'info' | 'warn' | 'error' | 'debug'>;
}

/**
 * Standard interface for all Fennec modules.
 * Each module encapsulates a domain (browser, mobile, process, etc.)
 * and provides its own tools, capabilities, and lifecycle.
 */
export interface FennecModule {
  /** Unique module name (e.g., "browser", "mobile", "process") */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Tools provided by this module */
  readonly tools: ToolDefinition[];

  /** Optional capabilities this module provides (e.g., "android-debug-bridge") */
  readonly capabilities?: string[];

  /** Optional Zod schema for module-specific configuration */
  readonly configSchema?: import('zod').ZodType<any>;

  /**
   * Initialize the module. Called once when the server starts.
   * Use this for checking dependencies, starting background processes, etc.
   */
  initialize?(context: ModuleContext): Promise<void>;

  /**
   * Clean up the module. Called on server shutdown.
   * Use this for releasing resources, killing processes, etc.
   */
  cleanup?(): Promise<void>;
}

/**
 * Registry for Fennec modules.
 * Handles registration, tool aggregation, initialization, and cleanup.
 */
export class ModuleRegistry {
  private modules: Map<string, FennecModule> = new Map();
  private initialized = false;

  /**
   * Register a module. Throws if a module with the same name already exists.
   */
  register(module: FennecModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module already registered: ${module.name}`);
    }
    this.modules.set(module.name, module);
  }

  /**
   * Get a registered module by name.
   */
  get(name: string): FennecModule | undefined {
    return this.modules.get(name);
  }

  /**
   * Get all registered modules.
   */
  getAll(): FennecModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Get all tools from all registered modules.
   */
  getAllTools(): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];
    for (const module of this.modules.values()) {
      allTools.push(...module.tools);
    }
    return allTools;
  }

  /**
   * Register all tools from all modules into the given ToolRegistry.
   */
  registerAllTools(toolRegistry: ToolRegistry): void {
    for (const tool of this.getAllTools()) {
      toolRegistry.register(tool);
    }
  }

  /**
   * Check if a module with the given name is registered.
   */
  has(name: string): boolean {
    return this.modules.has(name);
  }

  /**
   * Initialize all registered modules.
   */
  async initializeAll(context: ModuleContext): Promise<void> {
    for (const module of this.modules.values()) {
      if (module.initialize) {
        await module.initialize(context);
      }
    }
    this.initialized = true;
  }

  /**
   * Clean up all registered modules (reverse order).
   */
  async cleanupAll(): Promise<void> {
    const modules = Array.from(this.modules.values()).reverse();
    for (const module of modules) {
      if (module.cleanup) {
        try {
          await module.cleanup();
        } catch (error) {
          getLogger().error({ error }, `Error cleaning up module ${module.name}`);
        }
      }
    }
    this.initialized = false;
  }
}
