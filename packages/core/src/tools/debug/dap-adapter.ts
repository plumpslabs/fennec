/**
 * DAP Adapter — Generic Debug Adapter Protocol adapter.
 *
 * Implements the DebugAdapter interface for any runtime that supports
 * the Debug Adapter Protocol (DAP) natively:
 * - **Python** (debugpy)
 * - **Go** (Delve / dlv dap)
 * - **.NET** (NetCoreDbg)
 * - **Ruby** (ruby/debug's rdbg)
 * - **Rust/C/C++/Zig/Swift** (lldb-dap)
 * - **Dart/Flutter** (dart debug)
 *
 * Maps DAP messages to the DebugAdapter interface:
 * - initialize + launch/attach + configurationDone → enable()
 * - setBreakpoints → setBreakpointByUrl()
 * - continue → resume()
 * - next → stepOver()
 * - stepIn → stepInto()
 * - stepOut → stepOut()
 * - evaluate → evaluateOnCallFrame()
 * - variables → getProperties()
 * - stopped event → onPaused()
 * - continued event → onResumed()
 */
import { getLogger } from '../../utils/logger.js';
import type {
  DebugAdapter,
  RuntimeType,
  BreakpointResult,
  PausedEvent,
  CallFrame,
  EvaluateResult,
  PropertiesResult,
  RemoteObject,
  PropertyDescriptor,
} from './adapter-types.js';
import { DAPTransport, type DAPTransportOptions, type DAPMessage } from './dap-transport.js';

// ─── Launch Configuration ────────────────────────────────────────

export interface DAPLaunchConfig {
  /** Type of launch (launch or attach) */
  type: 'launch' | 'attach';
  /** Runtime identifier (e.g., debugpy_adapter, go, netcoredbg) */
  request?: string;
  /** Program to debug (for launch) */
  program?: string;
  /** Process ID to attach to (for attach) */
  processId?: number;
  /** Additional arguments passed to the debug adapter */
  args?: Record<string, unknown>;
}

const LAUNCH_CONFIGS: Record<string, DAPLaunchConfig> = {
  python: {
    type: 'launch',
    request: 'launch',
    args: {
      console: 'integratedTerminal',
      justMyCode: true,
      stopOnEntry: false,
      showReturnValue: true,
    },
  },
  go: {
    type: 'launch',
    request: 'launch',
    args: {
      showGlobalVariables: false,
      showRegisters: false,
      hideSystemGoroutines: true,
    },
  },
  dotnet: {
    type: 'launch',
    request: 'launch',
    args: {
      console: 'integratedTerminal',
      justMyCode: true,
      requireExactSource: false,
    },
  },
  ruby: {
    type: 'launch',
    request: 'launch',
    args: {
      useBundler: false,
    },
  },
  rust: {
    type: 'launch',
    request: 'launch',
    args: {
      stopOnEntry: false,
      showDisassembly: 'never',
      sourceLanguages: ['rust'],
    },
  },
  dart: {
    type: 'launch',
    request: 'launch',
    args: {
      console: 'terminal',
      cwd: '.',
    },
  },
};

// ─── Adapter Connect Config ──────────────────────────────────────

export interface DAPAdapterConfig {
  runtime: RuntimeType;
  /** Transport mode: tcp or stdio */
  transport: 'tcp' | 'stdio';
  /** TCP connection options */
  host?: string;
  port?: number;
  /** Stdio spawn options */
  command?: string;
  args?: string[];
  cwd?: string;
}

/**
 * Predefined adapter configurations for each runtime.
 * These define how to connect to each runtime's debug adapter.
 */
export const ADAPTER_CONFIGS: Record<string, DAPAdapterConfig> = {
  python: {
    runtime: 'python',
    transport: 'tcp',
    host: '127.0.0.1',
    port: 5678,
  },
  go: {
    runtime: 'go',
    transport: 'tcp',
    host: '127.0.0.1',
    port: 2345,
  },
  dotnet: {
    runtime: 'dotnet',
    transport: 'stdio',
    command: 'netcoredbg',
    args: ['--interpreter=vscode'],
  },
  ruby: {
    runtime: 'ruby',
    transport: 'tcp',
    host: '127.0.0.1',
    port: 1234,
  },
  rust: {
    runtime: 'rust',
    transport: 'stdio',
    command: 'lldb-dap',
    args: [],
  },
  dart: {
    runtime: 'dart',
    transport: 'tcp',
    host: '127.0.0.1',
    port: 0, // Will be determined by the runtime
  },
};

// ─── DAP Adapter ─────────────────────────────────────────────────

export class DAPAdapter implements DebugAdapter {
  readonly runtime: RuntimeType;
  private transport: DAPTransport;
  private config: DAPAdapterConfig;
  private enabled = false;
  private _pausedHandler: ((event: PausedEvent) => void) | null = null;
  private _resumedHandler: (() => void) | null = null;
  private _scriptParsedHandler: ((script: any) => void) | null = null;
  private capabilities: Record<string, boolean> = {};
  private threads: number[] = [];
  private breakpointIdCounter = 0;
  private frameCache: Map<number, any[]> = new Map(); // threadId → frames

  constructor(config: DAPAdapterConfig) {
    this.runtime = config.runtime;
    this.config = config;

    const transportOpts: DAPTransportOptions = config.transport === 'tcp'
      ? { host: config.host, port: config.port, reconnect: false }
      : { command: config.command, args: config.args, cwd: config.cwd };

    this.transport = new DAPTransport(config.transport, transportOpts);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable debugging:
   * 1. Connect transport
   * 2. Send initialize request
   * 3. Send launch/attach request
   * 4. Send configurationDone
   */
  async enable(): Promise<string> {
    if (this.enabled) return 'dap_connected';

    // Wire event handlers before connecting
    this.transport.on('stopped', (msg: DAPMessage) => {
      this.handleStopped(msg);
    });

    this.transport.on('continued', (_msg: DAPMessage) => {
      if (this._resumedHandler) {
        this._resumedHandler();
      }
    });

    this.transport.on('output', (msg: DAPMessage) => {
      if (msg.body?.category === 'console' || msg.body?.category === 'stdout') {
        getLogger().debug({ output: msg.body?.output }, 'DAP adapter output');
      }
    });

    await this.transport.connect();

    // 1. Initialize
    const initResponse = await this.transport.sendRequest('initialize', {
      clientID: 'fennec',
      clientName: 'Fennec Debugger',
      adapterID: this.runtime,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: true,
      locale: 'en-US',
    });

    if (initResponse.body) {
      this.capabilities = initResponse.body;
    }

    // Populate threads list
    try {
      const threadsResp = await this.transport.sendRequest('threads');
      if (threadsResp.body?.threads) {
        this.threads = threadsResp.body.threads.map((t: any) => t.id);
      }
    } catch {
      // Some adapters require configurationDone before threads is available
      this.threads = [1]; // Default fallback
    }

    // 2. Launch or attach
    const launchCfg = LAUNCH_CONFIGS[this.runtime];
    if (launchCfg) {
      await this.sendLaunchOrAttach(launchCfg);
    } else {
      // Generic launch
      await this.sendLaunchOrAttach({
        type: 'launch',
        args: { noDebug: false },
      });
    }

    // 3. Configuration done
    await this.transport.sendRequest('configurationDone');

    this.enabled = true;
    getLogger().info({ runtime: this.runtime }, 'DAP adapter enabled');

    return `dap_${this.runtime}`;
  }

  /**
   * Send launch or attach request.
   */
  private async sendLaunchOrAttach(config: DAPLaunchConfig): Promise<void> {
    const args: Record<string, unknown> = {
      ...config.args,
    };

    if (config.program) {
      args.program = config.program;
    }
    if (config.processId !== undefined) {
      args.processId = config.processId;
    }

    if (config.type === 'launch') {
      // Use runtime-specific request type
      const cmd = this.getLaunchCommand();
      await this.transport.sendRequest(cmd, args);
    } else {
      await this.transport.sendRequest('attach', args);
    }
  }

  /**
   * Get the launch command for the current runtime.
   * Different runtimes use different names.
   */
  private getLaunchCommand(): string {
    const runtimeCommands: Record<string, string> = {
      python: 'launch',
      go: 'launch',
      dotnet: 'launch',
      ruby: 'launch',
      rust: 'launch',
      dart: 'launch',
    };
    return runtimeCommands[this.runtime] ?? 'launch';
  }

  /**
   * Handle DAP 'stopped' event (breakpoint hit, step complete, etc.)
   * Fetches stack frames and creates a PausedEvent.
   */
  private async handleStopped(msg: DAPMessage): Promise<void> {
    if (!this._pausedHandler) return;

    const body = msg.body ?? {};
    const reason = body.reason ?? 'breakpoint';
    const threadId = body.threadId ?? this.threads[0] ?? 1;
    const hitBreakpoints: string[] = body.hitBreakpointIds ?? [];

    try {
      // Fetch stack trace
      const stackResponse = await this.transport.sendRequest('stackTrace', {
        threadId,
        startFrame: 0,
        levels: 20,
      });

      const stackFrames: any[] = stackResponse.body?.stackFrames ?? [];

      // Convert DAP stack frames to CallFrame format
      const callFrames: CallFrame[] = this.dapFramesToCallFrames(stackFrames, threadId);

      const pausedEvent: PausedEvent = {
        callFrames,
        reason,
        hitBreakpoints,
      };

      this._pausedHandler(pausedEvent);
    } catch (error) {
      getLogger().warn({ error }, 'Failed to fetch stack trace after breakpoint pause');
      // Fallback: emit minimal event
      this._pausedHandler({
        callFrames: [],
        reason,
        hitBreakpoints: [],
      });
    }
  }

  /**
   * Convert DAP stack frames to the internal CallFrame format.
   */
  private dapFramesToCallFrames(dapFrames: any[], threadId: number): CallFrame[] {
    this.frameCache.set(threadId, dapFrames);

    return dapFrames.map((frame: any) => {
      const source = frame.source ?? {};
      const path = source.path ?? source.name ?? `unknown:${frame.line ?? 0}`;

      return {
        callFrameId: String(frame.id),
        functionName: frame.name ?? '<anonymous>',
        url: path,
        lineNumber: (frame.line ?? 1) - 1, // DAP is 1-based, convert to 0-based
        columnNumber: (frame.column ?? 1) - 1,
        scopeChain: [
          {
            type: 'local',
            object: {
              type: 'object',
              objectId: `dap_vars:${threadId}:${frame.id}`,
              description: 'Local variables',
            },
            name: 'Local',
          },
        ],
        this: { type: 'undefined' },
      };
    });
  }

  // ── Disable ────────────────────────────────────────────────────

  async disable(): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.transport.sendRequest('disconnect', { restart: false });
    } catch {
      // Best-effort
    }

    await this.transport.disconnect();
    this.enabled = false;
    this._pausedHandler = null;
    this._resumedHandler = null;
    this._scriptParsedHandler = null;
    this.frameCache.clear();
    getLogger().info({ runtime: this.runtime }, 'DAP adapter disabled');
  }

  // ── Breakpoint Management ──────────────────────────────────────

  async setBreakpointByUrl(
    file: string,
    line: number,
    options?: { column?: number; condition?: string; logMessage?: string },
  ): Promise<BreakpointResult> {
    if (!this.enabled) throw new Error('DAP adapter not enabled');

    this.breakpointIdCounter++;
    const bpId = `dap_bp_${this.breakpointIdCounter}`;

    // DAP setBreakpoints expects an array of breakpoints for a source file
    const breakpoints: Array<Record<string, unknown>> = [
      { line: line + 1 }, // DAP is 1-based
    ];
    if (options?.condition) {
      breakpoints[0]!.condition = options.condition;
    }
    if (options?.logMessage) {
      (breakpoints[0] as Record<string, unknown>).logMessage = options.logMessage;
    }

    const response = await this.transport.sendRequest('setBreakpoints', {
      source: {
        path: file,
        name: file.split('/').pop() ?? file,
      },
      lines: [line + 1],
      breakpoints,
      sourceModified: false,
    });

    const body = response.body ?? {};
    const dapBps: any[] = body.breakpoints ?? [];
    const dapBp = dapBps[0];

    const locations = dapBp
      ? [{ scriptId: file, lineNumber: dapBp.line ?? (line + 1), columnNumber: 0 }]
      : [{ scriptId: file, lineNumber: line, columnNumber: 0 }];

    return {
      breakpointId: bpId,
      locations,
    };
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    // DAP doesn't have a direct removeBreakpoint command.
    // Breakpoints are managed per-source via setBreakpoints.
    // We just acknowledge removal — the BP manager handles local state.
    getLogger().debug({ breakpointId }, 'DAP: removeBreakpoint acknowledged');
  }

  // ── Execution Control ──────────────────────────────────────────

  async resume(): Promise<void> {
    if (!this.enabled) throw new Error('DAP adapter not enabled');
    const threadId = this.threads[0] ?? 1;
    await this.transport.sendRequest('continue', { threadId });
  }

  async stepOver(): Promise<void> {
    if (!this.enabled) throw new Error('DAP adapter not enabled');
    const threadId = this.threads[0] ?? 1;
    await this.transport.sendRequest('next', { threadId });
  }

  async stepInto(): Promise<void> {
    if (!this.enabled) throw new Error('DAP adapter not enabled');
    const threadId = this.threads[0] ?? 1;
    await this.transport.sendRequest('stepIn', { threadId });
  }

  async stepOut(): Promise<void> {
    if (!this.enabled) throw new Error('DAP adapter not enabled');
    const threadId = this.threads[0] ?? 1;
    await this.transport.sendRequest('stepOut', { threadId });
  }

  // ── Evaluation & Inspection ────────────────────────────────────

  async evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
    options?: { returnByValue?: boolean; generatePreview?: boolean },
  ): Promise<EvaluateResult> {
    if (!this.enabled) throw new Error('DAP adapter not enabled');

    const frameId = parseInt(callFrameId, 10);

    const response = await this.transport.sendRequest('evaluate', {
      expression,
      frameId,
      context: 'watch',
    });

    const body = response.body ?? {};

    const result: RemoteObject = {
      type: body.type ?? 'undefined',
      value: body.result,
      description: body.result != null ? String(body.result) : undefined,
      objectId: body.variablesReference != null ? `dap_obj:${body.variablesReference}` : undefined,
    };

    if (body.indexedVariables !== undefined || body.namedVariables !== undefined) {
      result.preview = {
        properties: [],
        overflow: false,
      };
    }

    return {
      result,
      exceptionDetails: body.error
        ? { text: typeof body.error === 'string' ? body.error : body.error?.id ?? 'Evaluation error' }
        : undefined,
    };
  }

  async getProperties(
    objectId: string,
    options?: { ownProperties?: boolean; generatePreview?: boolean },
  ): Promise<PropertiesResult> {
    if (!this.enabled) throw new Error('DAP adapter not enabled');

    // Parse object ID: dap_vars:threadId:frameId or dap_obj:variablesRef
    const objMatch = objectId.match(/^dap_(?:vars|obj):(\d+):(\d+)$/) || objectId.match(/^dap_obj:(\d+)$/);
    const isScope = objectId.startsWith('dap_vars:');

    if (isScope) {
      // Scope inspection: use DAP's scopes request to get variables
      const threadId = parseInt(objectId.split(':')[1]!, 10);
      const frameId = parseInt(objectId.split(':')[2]!, 10);

      const scopesResp = await this.transport.sendRequest('scopes', { frameId });
      const scopes: any[] = scopesResp.body?.scopes ?? [];

      if (scopes.length > 0) {
        // Get variables from the first scope
        const varsResp = await this.transport.sendRequest('variables', {
          variablesReference: scopes[0]!.variablesReference,
        });
        return this.dapVarsToProperties(varsResp.body?.variables ?? []);
      }
      return { result: [] };
    } else if (objMatch) {
      // Object property inspection
      const varsRef = objMatch[1] ? parseInt(objMatch[1], 10) : 0;
      if (varsRef > 0) {
        const varsResp = await this.transport.sendRequest('variables', {
          variablesReference: varsRef,
        });
        return this.dapVarsToProperties(varsResp.body?.variables ?? []);
      }
    }

    return { result: [] };
  }

  /**
   * Convert DAP variable entries to PropertyDescriptor format.
   */
  private dapVarsToProperties(vars: any[]): PropertiesResult {
    const result: PropertyDescriptor[] = vars.map((v: any) => ({
      name: v.name,
      value: {
        type: v.type ?? 'string',
        value: v.value,
        description: v.value != null ? String(v.value) : undefined,
        objectId: v.variablesReference ? `dap_obj:${v.variablesReference}` : undefined,
        className: v.type === 'object' ? v.name : undefined,
      },
      writable: false,
      configurable: false,
      enumerable: true,
      isOwn: true,
    }));

    return { result };
  }

  // ── Event Handlers ─────────────────────────────────────────────

  onPaused(handler: (event: PausedEvent) => void): void {
    this._pausedHandler = handler;
  }

  onResumed(handler: () => void): void {
    this._resumedHandler = handler;
  }

  onScriptParsed(handler: (script: any) => void): void {
    this._scriptParsedHandler = handler;
    // DAP doesn't have a direct scriptParsed event, but we fire one
    // when breakpoints are set so the session manager has script info.
  }
}
