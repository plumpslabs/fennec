/**
 * Breakpoint Session Manager — Manages the lifecycle of breakpoint debugging sessions.
 *
 * Features:
 * - Maps process names → debugging sessions (lazy, one per process)
 * - Tracks active breakpoints, paused state, and call frames
 * - Maintains a script registry (URL → scriptId mapping)
 * - Token-efficient: variable snapshots are bounded (max 20 vars, 3 levels deep)
 * - Thread-safe: each session is isolated
 */
import type { BrowserCDPSession } from '../../browser/types.js';
import type { PausedEvent, CDPCallFrame, CDPRemoteObject } from './v8-adapter.js';
import type { DebugAdapter, RuntimeType } from './adapter-types.js';
import { getAdapterRegistry } from './adapter-registry.js';
import { getLogger } from '../../utils/logger.js';
import { readTracked } from '../../process/tracking.js';

// ─── Types ───────────────────────────────────────────────────────

export interface Breakpoint {
  id: string;
  /** CDP breakpoint ID returned by Debugger.setBreakpointByUrl */
  cdpId: string;
  file: string;
  line: number;
  column?: number;
  condition?: string;
  logMessage?: string;
  active: boolean;
  scriptId?: string;
  createdAt: string;
}

export interface DebuggerPauseState {
  callFrames: CDPCallFrame[];
  reason: string;
  hitBreakpoints?: string[];
  timestamp: string;
}

export interface VariableSnapshot {
  name: string;
  value: string;
  type: string;
  isExpandable: boolean;
}

export interface ScopeSnapshot {
  type: string;
  name?: string;
  variables: VariableSnapshot[];
}

// ─── Debug Session ───────────────────────────────────────────────

interface DebugSession {
  adapter: DebugAdapter;
  /** The runtime type for this session (node, python, php, go, etc.) */
  runtime: RuntimeType;
  breakpoints: Map<string, Breakpoint>;
  /** Script registry: URL → scriptId */
  scripts: Map<string, string[]>;
  /** Current pause state (null if not paused) */
  pauseState: DebuggerPauseState | null;
  /** Whether a step operation is in progress */
  stepping: boolean;
  /** Timestamp of last activity */
  lastActivity: number;
}

// ─── BreakpointSessionManager ────────────────────────────────────

export class BreakpointSessionManager {
  /** Map of session ID → DebugSession */
  private sessions = new Map<string, DebugSession>();
  private breakpointCounter = 0;
  private idleTimeoutMs: number;

  constructor(idleTimeoutMs = 300000) {
    // 5 min idle timeout by default
    this.idleTimeoutMs = idleTimeoutMs;
  }

  /**
   * Get or create a debug session for a given CDP session.
   * This associates a Fennec session ID with a V8 debugging session.
   */
  async getOrCreateSession(sessionId: string, cdp: BrowserCDPSession): Promise<string> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      return sessionId;
    }

    const adapter = await this.createAdapter(sessionId, cdp);
    return this.finalizeSession(sessionId, adapter);
  }

  /**
   * Get or create a debug session for a tracked process by name.
   * Uses runtime detection to pick the right adapter (DAP, DBGp, JDWP, CDP).
   * No CDP session needed — works for non-browser runtimes.
   */
  async getOrCreateProcessSession(name: string): Promise<string> {
    const existing = this.sessions.get(name);
    if (existing) {
      existing.lastActivity = Date.now();
      return name;
    }

    const adapter = await this.createAdapter(name);
    return this.finalizeSession(name, adapter);
  }

  /**
   * Detect runtime and create the appropriate debug adapter.
   * Falls back to V8/CDP if no specific adapter is found.
   */
  private async createAdapter(sessionId: string, cdp?: BrowserCDPSession): Promise<DebugAdapter> {
    const tracked = readTracked();
    const proc = tracked.find((t) => t.name === sessionId);
    const command = proc?.command ?? '';
    const registry = getAdapterRegistry();
    const runtime = registry.detectRuntime(command);

    if (runtime === 'node' || (runtime === 'unknown' && cdp)) {
      const { V8DebuggerAdapter } = await import('./v8-adapter.js');
      if (!cdp) throw new Error(`Node.js debugging requires a browser session (CDP). Use a sessionId or run in a browser context.`);
      return new V8DebuggerAdapter(cdp);
    }

    const runtimeAdapter = await registry.createAdapter(runtime, cdp);
    if (runtimeAdapter) return runtimeAdapter;

    // Last resort fallback
    if (cdp) {
      const { V8DebuggerAdapter } = await import('./v8-adapter.js');
      return new V8DebuggerAdapter(cdp);
    }

    throw new Error(
      `No debug adapter available for runtime "${runtime}". ` +
      `Supported: Node.js (CDP), Python/Go/.NET/Ruby/Rust/Dart (DAP), PHP (DBGp), Java (JDWP). ` +
      `Ensure the debug tool is installed (e.g. debugpy for Python, dlv for Go).`,
    );
  }

  /**
   * Wire up event handlers and register the session.
   */
  private async finalizeSession(sessionId: string, adapter: DebugAdapter): Promise<string> {
    const tracked = readTracked();
    const proc = tracked.find((t) => t.name === sessionId);
    const registry = getAdapterRegistry();
    const runtime = registry.detectRuntime(proc?.command ?? sessionId);

    await adapter.enable();

    const debugSession: DebugSession = {
      adapter,
      runtime,
      breakpoints: new Map(),
      scripts: new Map(),
      pauseState: null,
      stepping: false,
      lastActivity: Date.now(),
    };

    // Wire up paused event handler
    adapter.onPaused((event: PausedEvent) => {
      debugSession.pauseState = {
        callFrames: event.callFrames ?? [],
        reason: event.reason,
        hitBreakpoints: event.hitBreakpoints,
        timestamp: new Date().toISOString(),
      };
      debugSession.stepping = false;
      debugSession.lastActivity = Date.now();
      getLogger().info(
        {
          sessionId,
          reason: event.reason,
          frames: event.callFrames?.length ?? 0,
        },
        'Debugger paused',
      );
    });

    // Wire up resumed event handler
    adapter.onResumed(() => {
      if (!debugSession.stepping) {
        // Only clear pause state if not in a step operation
        debugSession.pauseState = null;
      }
      debugSession.lastActivity = Date.now();
    });

    // Wire up script parsed handler
    adapter.onScriptParsed((script) => {
      if (script.url) {
        const existing = debugSession.scripts.get(script.url) ?? [];
        existing.push(script.scriptId);
        debugSession.scripts.set(script.url, existing);
      }
    });

    this.sessions.set(sessionId, debugSession);
    getLogger().info({ sessionId }, 'Debug session created');

    return sessionId;
  }

  /**
   * Get an existing debug session.
   */
  private getSession(sessionId: string): DebugSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(
        `No debug session found for "${sessionId}". Call debug_configure with mode "breakpoint" first.`,
      );
    }
    session.lastActivity = Date.now();
    return session;
  }

  /**
   * Get the debug adapter for a session.
   */
  getAdapter(sessionId: string): DebugAdapter {
    return this.getSession(sessionId).adapter;
  }

  // ── Breakpoint Management ──────────────────────────────────────

  /**
   * Set a breakpoint in a file at a given line.
   */
  async setBreakpoint(
    sessionId: string,
    file: string,
    line: number,
    options?: { column?: number; condition?: string; logMessage?: string },
  ): Promise<Breakpoint> {
    const session = this.getSession(sessionId);
    const adapter = session.adapter;

    const result = await adapter.setBreakpointByUrl(file, line, {
      column: options?.column,
      condition: options?.condition,
      logMessage: options?.logMessage,
    });

    const id = `bp_${++this.breakpointCounter}`;
    const bp: Breakpoint = {
      id,
      cdpId: result.breakpointId,
      file,
      line,
      column: options?.column,
      condition: options?.condition,
      logMessage: options?.logMessage,
      active: true,
      scriptId: result.locations?.[0]?.scriptId,
      createdAt: new Date().toISOString(),
    };

    session.breakpoints.set(id, bp);
    session.lastActivity = Date.now();

    getLogger().info({ breakpointId: id, file, line }, 'Breakpoint set');
    return bp;
  }

  /**
   * Remove a breakpoint. Calls CDP Debugger.removeBreakpoint and removes from local map.
   */
  async removeBreakpoint(sessionId: string, breakpointId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const bp = session.breakpoints.get(breakpointId);
    if (!bp) return false;

    try {
      // Remove via CDP first (V8 will stop pausing at this location)
      try {
        await session.adapter.removeBreakpoint(bp.cdpId);
      } catch {
        // CDP remove might fail if already removed — still clean up local state
      }

      // Then remove from local map
      session.breakpoints.delete(breakpointId);
      session.lastActivity = Date.now();
      getLogger().info({ breakpointId, file: bp.file, line: bp.line }, 'Breakpoint removed');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all active breakpoints for a session.
   */
  listBreakpoints(sessionId: string): Breakpoint[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.breakpoints.values());
  }

  // ── Execution Control ──────────────────────────────────────────

  /**
   * Resume execution. Returns true if was paused.
   */
  async resume(sessionId: string): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session.pauseState) return false;

    await session.adapter.resume();
    session.pauseState = null;
    session.stepping = false;
    return true;
  }

  /**
   * Step over next call. Returns true if was paused.
   */
  async stepOver(sessionId: string): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session.pauseState) return false;

    session.stepping = true;
    await session.adapter.stepOver();
    return true;
  }

  /**
   * Step into next call. Returns true if was paused.
   */
  async stepInto(sessionId: string): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session.pauseState) return false;

    session.stepping = true;
    await session.adapter.stepInto();
    return true;
  }

  /**
   * Step out of current function. Returns true if was paused.
   */
  async stepOut(sessionId: string): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session.pauseState) return false;

    session.stepping = true;
    await session.adapter.stepOut();
    return true;
  }

  // ── State Inspection ───────────────────────────────────────────

  /**
   * Get current pause state (null if not paused).
   */
  getPauseState(sessionId: string): DebuggerPauseState | null {
    const session = this.sessions.get(sessionId);
    return session?.pauseState ?? null;
  }

  /**
   * Get a token-efficient snapshot of variables in all scopes.
   * Bounded: max N variables per scope, truncated values, no circular refs.
   */
  async getVariables(
    sessionId: string,
    options?: { maxVariables?: number; maxDepth?: number },
  ): Promise<ScopeSnapshot[]> {
    const session = this.getSession(sessionId);
    if (!session.pauseState) return [];

    const maxVars = options?.maxVariables ?? 20;
    const scopes: ScopeSnapshot[] = [];

    for (const frame of session.pauseState.callFrames.slice(0, 3)) {
      // Only inspect top 3 frames (token efficiency)
      for (const scope of frame.scopeChain) {
        const vars = await this.extractScopeVariables(
          session,
          scope.object.objectId,
          maxVars,
          options?.maxDepth ?? 2,
          0,
        );
        scopes.push({
          type: scope.type,
          name: scope.name,
          variables: vars,
        });
      }
    }

    return scopes;
  }

  /**
   * Recursively extract variables from a scope/object, bounded by depth.
   */
  private async extractScopeVariables(
    session: DebugSession,
    objectId: string | undefined,
    maxVars: number,
    maxDepth: number,
    depth: number,
  ): Promise<VariableSnapshot[]> {
    if (!objectId || depth > maxDepth) return [];

    try {
      const props = await session.adapter.getProperties(objectId, {
        ownProperties: true,
        generatePreview: false,
      });

      const variables: VariableSnapshot[] = [];
      for (const prop of props.result.slice(0, maxVars)) {
        if (prop.name.startsWith('#')) continue; // Skip internal properties

        const value = prop.value;
        if (!value) continue;

        const isExpandable = value.objectId !== undefined && value.type === 'object';
        let displayValue: string;

        if (value.type === 'string') {
          displayValue = `"${String(value.value ?? '').slice(0, 80)}"`;
        } else if (value.type === 'undefined') {
          displayValue = 'undefined';
        } else if (value.type === 'object' && value.value === null) {
          displayValue = 'null';
        } else if (isExpandable) {
          displayValue = value.description ?? `{...}`;
          // For small arrays/objects, inline preview
          if (value.preview?.properties) {
            const previews = value.preview.properties
              .slice(0, 3)
              .map((p: any) => `${p.name}: ${p.value ?? p.description ?? '?'}`);
            displayValue = `{ ${previews.join(', ')}${value.preview.properties.length > 3 ? ', ...' : ''} }`;
          }
        } else {
          displayValue = String(value.value ?? value.description ?? '?');
        }

        variables.push({
          name: prop.name,
          value: displayValue,
          type: value.type,
          isExpandable,
        });
      }

      return variables;
    } catch {
      return [];
    }
  }

  /**
   * Evaluate a JavaScript expression in the current paused context.
   * Uses the first (topmost) call frame.
   */
  async evaluate(
    sessionId: string,
    expression: string,
  ): Promise<{ value: string; type: string; exception?: string }> {
    const session = this.getSession(sessionId);
    if (!session.pauseState) {
      return {
        value: '',
        type: 'undefined',
        exception: 'Not paused — no call frame to evaluate in',
      };
    }

    const topFrame = session.pauseState.callFrames[0];
    if (!topFrame) {
      return { value: '', type: 'undefined', exception: 'No call frames available' };
    }

    try {
      const result = await session.adapter.evaluateOnCallFrame(topFrame.callFrameId, expression, {
        returnByValue: true,
        generatePreview: false,
      });

      if (result.exceptionDetails) {
        return {
          value: result.exceptionDetails.text ?? 'Unknown exception',
          type: 'error',
          exception: result.exceptionDetails.text,
        };
      }

      const remote = result.result;
      let displayValue: string;
      if (remote.type === 'string') {
        displayValue = String(remote.value ?? '');
      } else if (remote.type === 'object' && remote.description) {
        displayValue = remote.description;
        // Include preview for small objects
        if (remote.preview?.properties) {
          const props = remote.preview.properties
            .slice(0, 5)
            .map((p: any) => `${p.name}: ${p.value ?? p.description ?? '?'}`);
          displayValue = `{ ${props.join(', ')}${remote.preview.properties.length > 5 ? ', ...' : ''} }`;
        }
      } else {
        displayValue = String(remote.value ?? remote.description ?? 'undefined');
      }

      return { value: displayValue, type: remote.type, exception: undefined };
    } catch (error) {
      return {
        value: '',
        type: 'error',
        exception: String(error),
      };
    }
  }

  /**
   * Get a human-readable summary of the current pause state for an AI agent.
   * Token-efficient: ~100-200 tokens.
   */
  getPauseSummary(sessionId: string, maxFrames = 5): string {
    const session = this.sessions.get(sessionId);
    if (!session?.pauseState) return 'Not paused';

    const { callFrames, reason } = session.pauseState;
    const parts: string[] = [];
    parts.push(`Paused: ${reason}`);
    parts.push('');

    for (let i = 0; i < Math.min(callFrames.length, maxFrames); i++) {
      const frame = callFrames[i]!;
      const file = frame.url.split('/').pop() ?? frame.url;
      parts.push(
        `  #${i} ${frame.functionName || '<anonymous>'} (${file}:${frame.lineNumber}:${frame.columnNumber})`,
      );
    }

    if (callFrames.length > maxFrames) {
      parts.push(`  ... (${callFrames.length - maxFrames} more frames)`);
    }

    return parts.join('\n');
  }

  // ── Cleanup ────────────────────────────────────────────────────

  /**
   * Close and cleanup a debug session.
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      await session.adapter.disable();
    } catch {
      // Best-effort
    }

    this.sessions.delete(sessionId);
    getLogger().info({ sessionId }, 'Debug session closed');
  }

  /**
   * Clean up idle sessions.
   */
  cleanupIdle(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.idleTimeoutMs) {
        this.closeSession(id).catch(() => {});
      }
    }
  }

  /**
   * Close all sessions.
   */
  async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }

  /** Number of active debug sessions. */
  get activeSessionCount(): number {
    return this.sessions.size;
  }
}

/** Singleton instance — lazy, created on first use. */
let _instance: BreakpointSessionManager | null = null;

export function getBreakpointManager(): BreakpointSessionManager {
  if (!_instance) {
    _instance = new BreakpointSessionManager();
  }
  return _instance;
}
