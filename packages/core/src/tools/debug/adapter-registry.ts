/**
 * Adapter Registry — Auto-detects process runtime and creates the appropriate debug adapter.
 *
 * Detection strategy:
 * 1. Match process command against known runtime patterns (node, python, php, go, etc.)
 * 2. Verify debug tool availability (debugpy, xdebug, dlv, etc.)
 * 3. Create the matching adapter
 *
 * Cross-platform: detection uses regex on command strings + execSync checks.
 */
import { getLogger } from '../../utils/logger.js';
import type { DebugAdapter, RuntimeType, RuntimeDetector } from './adapter-types.js';
import { RUNTIME_DETECTORS } from './adapter-types.js';
import type { DAPAdapterConfig } from './dap-adapter.js';
import { ADAPTER_CONFIGS } from './dap-adapter.js';
import type { BrowserCDPSession } from '../../browser/types.js';
import { readTracked } from '../../process/tracking.js';

// ─── Adapter Registry ────────────────────────────────────────────

export class AdapterRegistry {
  private detectorCache = new Map<string, RuntimeType>();

  /**
   * Detect the runtime type for a given process name or command.
   * Uses the tracked process list or direct command pattern matching.
   */
  detectRuntime(processNameOrCmd: string): RuntimeType {
    // Check cache first
    const cached = this.detectorCache.get(processNameOrCmd);
    if (cached) return cached;

    // Try to find the process in tracked list
    const tracked = readTracked();
    const proc = tracked.find(
      (t) => t.name === processNameOrCmd || t.command?.includes(processNameOrCmd),
    );
    const command = proc?.command ?? processNameOrCmd;

    // Match against known patterns
    for (const detector of RUNTIME_DETECTORS) {
      if (detector.matchesCommand(command)) {
        // Don't cache 'unknown' results
        if (detector.runtime !== 'unknown') {
          this.detectorCache.set(processNameOrCmd, detector.runtime);
        }
        return detector.runtime;
      }
    }

    return 'unknown';
  }

  /**
   * Create a debug adapter for the given runtime.
   *
   * @param runtime Runtime type
   * @param cdp Optional CDP session (only used for node/V8)
   * @returns A DebugAdapter instance, or null if runtime is unsupported
   */
  async createAdapter(
    runtime: RuntimeType,
    cdp?: BrowserCDPSession,
  ): Promise<DebugAdapter | null> {
    switch (runtime) {
      case 'node':
        // Node.js uses V8 Inspector via CDP (existing V8DebuggerAdapter)
        if (cdp) {
          const { V8DebuggerAdapter } = await import('./v8-adapter.js');
          return new V8DebuggerAdapter(cdp);
        }
        getLogger().warn('Node.js debugging requires a CDP session (browser context)');
        return null;

      case 'python':
      case 'go':
      case 'dotnet':
      case 'ruby':
      case 'rust':
      case 'cpp':
      case 'swift':
      case 'zig':
      case 'dart': {
        // All DAP-based runtimes — lazy-loaded
        const { DAPAdapter } = await import('./dap-adapter.js');
        const cfg = this.getAdapterConfig(runtime);
        if (cfg) return new DAPAdapter(cfg);
        return null;
      }

      case 'php': {
        // PHP uses Xdebug via DBGp protocol — lazy-loaded
        const { DBGpAdapter } = await import('./dbgp-adapter.js');
        return new DBGpAdapter();
      }

      case 'java': {
        // JVM uses JDWP protocol — lazy-loaded
        const { JDWPAdapter } = await import('./jdwp-adapter.js');
        return new JDWPAdapter();
      }

      default:
        getLogger().warn({ runtime }, 'Unsupported runtime for debugging');
        return null;
    }
  }

  /**
   * Get adapter configuration for a runtime, verifying tool availability.
   */
  private getAdapterConfig(runtime: string): DAPAdapterConfig | null {
    const cfg = ADAPTER_CONFIGS[runtime];
    if (!cfg) return null;
    return { ...cfg }; // Return copy
  }

  /**
   * Check if a runtime is supported for debugging.
   */
  isRuntimeSupported(runtime: RuntimeType): boolean {
    switch (runtime) {
      case 'node':
      case 'python':
      case 'php':
      case 'go':
      case 'java':
      case 'dotnet':
      case 'ruby':
      case 'rust':
      case 'cpp':
      case 'swift':
      case 'zig':
      case 'dart':
        return true;
      default:
        return false;
    }
  }

  /**
   * Check if the debug tool for a given runtime is installed on the system.
   */
  async isDebugToolInstalled(runtime: RuntimeType): Promise<boolean> {
    const detector = RUNTIME_DETECTORS.find((d) => d.runtime === runtime);
    if (!detector) {
      // node is always supported (built-in V8 inspector)
      if (runtime === 'node') return true;
      return false;
    }
    return detector.isToolInstalled();
  }

  /**
   * Suggest which adapter config to use for debugging a process.
   * Returns the runtime, adapter info, and a start command if available.
   */
  async suggestDebugConfig(
    processNameOrCmd: string,
  ): Promise<{
    runtime: RuntimeType;
    supported: boolean;
    toolInstalled: boolean;
    startHint?: string;
  }> {
    const runtime = this.detectRuntime(processNameOrCmd);
    const supported = this.isRuntimeSupported(runtime);
    const toolInstalled = await this.isDebugToolInstalled(runtime);

    const startHints: Partial<Record<RuntimeType, string>> = {
      python:
        'pip install debugpy && python -m debugpy --listen 127.0.0.1:5678 your_script.py',
      php: 'Set xdebug.mode=debug in php.ini and ensure Xdebug extension is loaded',
      go: 'go install github.com/go-delve/delve/cmd/dlv@latest && dlv dap --listen=:2345',
      dotnet: 'dotnet tool install --global netcoredbg && netcoredbg --interpreter=vscode your.dll',
      ruby: 'gem install debug && rdbg --open --port 1234 your_script.rb',
      rust: 'Install LLDB (brew install lldb / apt install lldb) for lldb-dap',
      dart: 'dart debug is built-in — use dart run --observe',
    };

    return {
      runtime,
      supported,
      toolInstalled,
      startHint: toolInstalled ? undefined : startHints[runtime],
    };
  }
}

/** Singleton registry instance. */
let _registry: AdapterRegistry | null = null;

export function getAdapterRegistry(): AdapterRegistry {
  if (!_registry) {
    _registry = new AdapterRegistry();
  }
  return _registry;
}
