/**
 * V8 Debugger Adapter — Wraps CDP Debugger domain commands for breakpoint debugging.
 *
 * Uses the existing BrowserCDPSession (from session.browser.cdp()) to communicate
 * with V8's Inspector protocol. This is the same protocol Chrome DevTools uses.
 *
 * Implements the DebugAdapter interface so BreakpointSessionManager can treat
 * V8/CDP debugging identically to DAP-based runtimes (Python, Go, .NET, etc.).
 *
 * Commands: Debugger.enable/disable, setBreakpointByUrl, removeBreakpoint,
 *           resume, stepOver/Into/Out, evaluateOnCallFrame, getScriptSource,
 *           setPauseOnExceptions, pause
 *
 * Events: Debugger.paused, Debugger.resumed, Debugger.scriptParsed
 */
import type { BrowserCDPSession } from '../../browser/types.js';
import { getLogger } from '../../utils/logger.js';
import type { DebugAdapter, RuntimeType, BreakpointResult, EvaluateResult, PropertiesResult } from './adapter-types.js';

// ─── Types ───────────────────────────────────────────────────────

export interface CDPCallFrame {
  callFrameId: string;
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  scopeChain: CDPScope[];
  this: CDPRemoteObject;
  returnValue?: CDPRemoteObject;
}

export interface CDPScope {
  type: string;
  object: CDPRemoteObject;
  name?: string;
}

export interface CDPRemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
  preview?: any;
}

export interface CDPPropertyDescriptor {
  name: string;
  value?: CDPRemoteObject;
  get?: CDPRemoteObject;
  set?: CDPRemoteObject;
  writable?: boolean;
  configurable?: boolean;
  enumerable?: boolean;
  isOwn?: boolean;
}

export interface PausedEvent {
  callFrames: CDPCallFrame[];
  reason: string;
  data?: any;
  hitBreakpoints?: string[];
  asyncStackTrace?: any;
}

export interface BreakpointLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber: number;
}

export interface SetBreakpointResult {
  breakpointId: string;
  locations: BreakpointLocation[];
}

// ─── V8 Debugger Adapter (implements DebugAdapter) ───────────────

export class V8DebuggerAdapter implements DebugAdapter {
  private cdp: BrowserCDPSession;
  private enabled = false;
  private _pausedHandler: ((event: PausedEvent) => void) | null = null;
  private _resumedHandler: (() => void) | null = null;
  private _scriptParsedHandler: ((script: CDPScript) => void) | null = null;

  /** Runtime identifier — always 'node' for V8 Inspector adapter. */
  readonly runtime: RuntimeType = 'node';

  constructor(cdp: BrowserCDPSession) {
    this.cdp = cdp;
  }

  /** Whether the Debugger domain is currently enabled. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable the Debugger domain. Must be called before any breakpoint operations.
   * Registers event listeners for Debugger.paused and Debugger.resumed.
   */
  async enable(): Promise<string> {
    if (this.enabled) return '';

    const result = await this.cdp.send<{ debuggerId: string }>('Debugger.enable');
    this.enabled = true;

    // Register event listeners
    this.cdp.on('Debugger.paused', (params: unknown) => {
      if (this._pausedHandler) {
        this._pausedHandler(params as PausedEvent);
      }
    });

    this.cdp.on('Debugger.resumed', () => {
      if (this._resumedHandler) {
        this._resumedHandler();
      }
    });

    this.cdp.on('Debugger.scriptParsed', (params: unknown) => {
      if (this._scriptParsedHandler) {
        this._scriptParsedHandler(params as CDPScript);
      }
    });

    getLogger().info({ debuggerId: result.debuggerId }, 'V8 Debugger enabled');
    return result.debuggerId;
  }

  /**
   * Disable the Debugger domain. Removes all breakpoints and event listeners.
   */
  async disable(): Promise<void> {
    if (!this.enabled) return;
    await this.cdp.send('Debugger.disable');
    this.enabled = false;
    this._pausedHandler = null;
    this._resumedHandler = null;
    this._scriptParsedHandler = null;
    getLogger().info('V8 Debugger disabled');
  }

  // ── Breakpoint Management ──────────────────────────────────────

  /**
   * Set a breakpoint by URL (source file path).
   * Returns the breakpoint ID and resolved locations.
   */
  async setBreakpointByUrl(
    file: string,
    line: number,
    options?: { column?: number; condition?: string },
  ): Promise<BreakpointResult> {
    if (!this.enabled) throw new Error('Debugger not enabled');

    const params: Record<string, unknown> = {
      lineNumber: line,
      url: file,
    };
    if (options?.column !== undefined) params.columnNumber = options.column;
    if (options?.condition) params.condition = options.condition;

    const result = await this.cdp.send<SetBreakpointResult>('Debugger.setBreakpointByUrl', params);
    return result;
  }

  /**
   * Remove a breakpoint by ID.
   */
  async removeBreakpoint(breakpointId: string): Promise<void> {
    if (!this.enabled) return;
    await this.cdp.send('Debugger.removeBreakpoint', { breakpointId });
  }

  // ── Execution Control ──────────────────────────────────────────

  /**
   * Resume execution after a breakpoint pause.
   */
  async resume(): Promise<void> {
    if (!this.enabled) throw new Error('Debugger not enabled');
    await this.cdp.send('Debugger.resume');
  }

  /**
   * Step over the next function call.
   */
  async stepOver(): Promise<void> {
    if (!this.enabled) throw new Error('Debugger not enabled');
    await this.cdp.send('Debugger.stepOver');
  }

  /**
   * Step into the next function call.
   */
  async stepInto(): Promise<void> {
    if (!this.enabled) throw new Error('Debugger not enabled');
    await this.cdp.send('Debugger.stepInto');
  }

  /**
   * Step out of the current function.
   */
  async stepOut(): Promise<void> {
    if (!this.enabled) throw new Error('Debugger not enabled');
    await this.cdp.send('Debugger.stepOut');
  }

  /**
   * Pause execution immediately (like a manual pause button).
   */
  async pause(): Promise<void> {
    if (!this.enabled) throw new Error('Debugger not enabled');
    await this.cdp.send('Debugger.pause');
  }

  /**
   * Set whether to pause on exceptions.
   */
  async setPauseOnExceptions(state: 'none' | 'uncaught' | 'all'): Promise<void> {
    if (!this.enabled) throw new Error('Debugger not enabled');
    await this.cdp.send('Debugger.setPauseOnExceptions', { state });
  }

  // ── Evaluation & Inspection ────────────────────────────────────

  /**
   * Evaluate a JavaScript expression in the context of a specific call frame.
   */
  async evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
    options?: { returnByValue?: boolean; generatePreview?: boolean },
  ): Promise<EvaluateResult> {
    if (!this.enabled) throw new Error('Debugger not enabled');

    const params: Record<string, unknown> = {
      callFrameId,
      expression,
      returnByValue: options?.returnByValue ?? false,
      generatePreview: options?.generatePreview ?? false,
    };

    return this.cdp.send<any>('Debugger.evaluateOnCallFrame', params);
  }

  /**
   * Get properties of a remote object (e.g., expand an object in a scope).
   */
  async getProperties(
    objectId: string,
    options?: { ownProperties?: boolean; generatePreview?: boolean },
  ): Promise<PropertiesResult> {
    const params: Record<string, unknown> = {
      objectId,
      ownProperties: options?.ownProperties ?? false,
      generatePreview: options?.generatePreview ?? false,
    };
    return this.cdp.send<any>('Runtime.getProperties', params);
  }

  /**
   * Get the source code of a script by its ID.
   */
  async getScriptSource(scriptId: string): Promise<{ scriptSource: string; bytecode?: string }> {
    if (!this.enabled) throw new Error('Debugger not enabled');
    return this.cdp.send<any>('Debugger.getScriptSource', { scriptId });
  }

  // ── Event Handlers ─────────────────────────────────────────────

  /**
   * Set handler for Debugger.paused events.
   */
  onPaused(handler: (event: PausedEvent) => void): void {
    this._pausedHandler = handler;
  }

  /**
   * Set handler for Debugger.resumed events.
   */
  onResumed(handler: () => void): void {
    this._resumedHandler = handler;
  }

  /**
   * Set handler for Debugger.scriptParsed events.
   */
  onScriptParsed(handler: (script: CDPScript) => void): void {
    this._scriptParsedHandler = handler;
  }
}

// ─── CDP Script Info ─────────────────────────────────────────────

export interface CDPScript {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  executionContextId: number;
  hash: string;
  executionContextAuxData?: any;
  sourceMapURL?: string;
  hasSourceURL?: boolean;
  isLiveEdit?: boolean;
  length?: number;
}
