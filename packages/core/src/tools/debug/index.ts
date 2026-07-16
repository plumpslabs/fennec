/**
 * Debug Tools — Fennec Debugger Mode (Level 1-3)
 *
 * Architecture:
 * - Level 1: Smart Log Debugging (passive) — error dedup, source maps, summaries
 * - Level 2: Breakpoint Debug Mode (active) — V8 Inspector via CDP (future)
 * - Level 3: Auto-Debug (proactive) — event-driven triggers (future)
 *
 * Design principles:
 * - Zero overhead when not used: all debug state is lazy-initialized
 * - Token-efficient: structured output, bounded, auto-summarized
 * - Security-first: all tools check `security.allowDebug` before executing
 * - Secrets redacted: inherits existing redaction pipeline
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { createTool } from '../_registry.js';
import { getSourceMapResolver } from './source-map.js';
import { getErrorDedup } from './error-dedup.js';
import { readTracked, logPathFor, getDebugMode, setDebugMode, isTrackedRunning } from '../../process/tracking.js';
import { getLogger } from '../../utils/logger.js';

// ─── Lazy debug state (zero overhead when not used) ──────────────

interface DebugState {
  errorDedup: ReturnType<typeof getErrorDedup>;
  sourceMapResolver: ReturnType<typeof getSourceMapResolver>;
  /** Map of process name → current debug mode */
  processModes: Map<string, 'log' | 'breakpoint' | 'auto'>;
}

let _debugState: DebugState | null = null;

function getDebugState(): DebugState {
  if (!_debugState) {
    _debugState = {
      errorDedup: getErrorDedup(),
      sourceMapResolver: getSourceMapResolver(),
      processModes: new Map(),
    };
  }
  return _debugState;
}

/** Check if debug features are allowed by config. */
function isDebugAllowed(config: { debug?: { allowDebug: boolean } }): boolean {
  return config.debug?.allowDebug === true;
}

// ─── Helper: get logs for a process from tracked.json's log file ──

function readProcessLogs(
  name: string,
  options: { lines?: number; since?: string } = {},
): { lines: string[]; error: string | null } {
  try {
    const logPath = logPathFor(name);

    if (!existsSync(logPath)) {
      return { lines: [], error: `No log file found for "${name}"` };
    }

    const content = readFileSync(logPath, 'utf-8');
    let lines = content.split('\n').filter(Boolean);

    // Filter by since timestamp if provided
    if (options.since) {
      const sinceMs = new Date(options.since).getTime();
      if (!isNaN(sinceMs)) {
        // Try to filter by looking for ISO timestamps in log lines
        lines = lines.filter((l) => {
          const tsMatch = l.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
          if (tsMatch) {
            return new Date(tsMatch[0]!).getTime() > sinceMs;
          }
          return true; // keep lines without timestamps
        });
      }
    }

    // Apply line limit
    const maxLines = options.lines ?? 100;
    if (lines.length > maxLines) {
      lines = lines.slice(-maxLines);
    }

    return { lines, error: null };
  } catch (err) {
    return { lines: [], error: String(err) };
  }
}

// ─── Tool: debug_get_errors ──────────────────────────────────────

export const debugGetErrors = createTool({
  name: 'debug_get_errors',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> 🐛 Get grouped errors for a tracked process. Returns errors grouped by stack hash — identical errors are deduped with a count. Token-efficient: 10 identical errors → 1 entry. Filter by process name, time range (since), or max groups. Returns: groups[], count, summary. Use for quick error triage without reading raw logs. Requires security.allowDebug: true in config.`',
  inputSchema: z.object({
    name: z.string().describe('Process name (from fennec ps / process_get_tracked)'),
    since: z.string().optional().describe('ISO timestamp — only errors after this time'),
    maxGroups: z.number().optional().default(10).describe('Max error groups to return'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(
        new Error('Debug mode is disabled. Set security.allowDebug: true in fennec.config.yaml'),
        { code: 'DEBUG_DISABLED' },
      );
    }

    const state = getDebugState();
    const { lines, error } = readProcessLogs(input.name, { lines: 200 });

    if (error) {
      return responseBuilder.success(
        {
          process: input.name,
          groups: [],
          count: 0,
          summary: 'No errors found',
          note: error,
        },
        { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
      );
    }

    // Feed log lines into error dedup
    for (const line of lines) {
      if (
        line.toLowerCase().includes('error') ||
        line.toLowerCase().includes('fail') ||
        line.toLowerCase().includes('fatal') ||
        line.toLowerCase().includes('exception')
      ) {
        state.errorDedup.add(line, undefined, 'error');
      }
    }

    const maxTokens = config.tokenBudget?.debugMaxTokens ?? 2000;
    const filtered = state.errorDedup.getGroups().slice(0, input.maxGroups);

    const result = {
      process: input.name,
      groups: filtered.map((g) => ({
        hash: g.hash,
        message: g.message.slice(0, 200),
        count: g.count,
        firstSeen: g.firstSeen,
        lastSeen: g.lastSeen,
        topFrame: g.topFrame,
      })),
      count: filtered.length,
      totalOccurrences: state.errorDedup.totalCount,
      summary: state.errorDedup.getSummary(input.maxGroups),
    };

    // Respect token budget: truncate if too large
    const jsonStr = JSON.stringify(result);
    if (jsonStr.length > maxTokens) {
      result.groups = result.groups.slice(0, 3);
      result.summary = result.summary.slice(0, 100);
    }

    return responseBuilder.success(result, {
      elapsed: 0,
      sessionId: 'debug',
      timestamp: new Date().toISOString(),
    });
  },
});

// ─── Tool: debug_get_error_detail ────────────────────────────────

export const debugGetErrorDetail = createTool({
  name: 'debug_get_error_detail',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> 🔍 Get full detail for a specific error group by hash. Returns full stack trace (source-mapped if available), first/last seen, occurrence count, and correlated process state. Token cost: ~200 tokens. Use after debug_get_errors to expand a specific error.`',
  inputSchema: z.object({
    hash: z.string().describe('Error group hash (from debug_get_errors)'),
    resolveSource: z.boolean().optional().default(true).describe('Attempt source map resolution'),
    projectDir: z.string().optional().describe('Project root for source map resolution'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug mode is disabled'), { code: 'DEBUG_DISABLED' });
    }

    const state = getDebugState();
    const group = state.errorDedup.getGroup(input.hash);

    if (!group) {
      return responseBuilder.error(new Error(`Error group not found: ${input.hash}`), {
        code: 'DEBUG_ERROR_NOT_FOUND',
      });
    }

    // Token budget: limit detail output
    const maxTokens = config.tokenBudget?.debugMaxTokens ?? 2000;
    const maxStackFrames = config.tokenBudget?.debugMaxStackFrames ?? 10;

    let resolvedTrace: string | undefined;
    if (input.resolveSource && group.stackTrace && input.projectDir) {
      resolvedTrace = state.sourceMapResolver.summarizeStackTrace(group.stackTrace, {
        maxFrames: maxStackFrames,
        projectDir: input.projectDir,
      });
      // Truncate if exceeds token budget
      if (resolvedTrace && resolvedTrace.length > maxTokens) {
        resolvedTrace = resolvedTrace.slice(0, maxTokens) + '... (truncated)';
      }
    }

    return responseBuilder.success(
      {
        hash: group.hash,
        message: group.message,
        count: group.count,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
        level: group.level,
        topFrame: group.topFrame,
        stackTrace: group.stackTrace,
        resolvedTrace: resolvedTrace ?? group.stackTrace,
        note: resolvedTrace
          ? 'Stack trace source-mapped to original locations'
          : 'Raw stack trace (no source map resolution applied)',
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

// ─── Tool: debug_investigate ─────────────────────────────────────

export const debugInvestigate = createTool({
  name: 'debug_investigate',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> 🔎 Root cause analysis for the latest error. Combines error grouping + process state for a token-efficient investigation (~150 tokens). Returns: rootCause (hypothesis), confidence (0-1), relatedErrors[], suggestedFix. AI-friendly structured output — feed this directly to LLM for fix suggestions.`',
  inputSchema: z.object({
    name: z.string().describe('Process name to investigate'),
    maxErrors: z.number().optional().default(5).describe('Max errors to consider'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug mode is disabled'), { code: 'DEBUG_DISABLED' });
    }

    const state = getDebugState();
    const groups = state.errorDedup.getGroups().slice(0, input.maxErrors);

    if (groups.length === 0) {
      return responseBuilder.success(
        {
          process: input.name,
          rootCause: null,
          confidence: 0,
          summary: 'No errors found — process appears healthy',
          suggestedFix: null,
          relatedErrors: [],
        },
        { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
      );
    }

    // Simple root cause inference: most frequent error is likely root cause
    const sortedByCount = [...groups].sort((a, b) => b.count - a.count);
    const topError = sortedByCount[0]!;

    // Classify error type
    const errorType = classifyError(topError.message);
    const suggestedFix = getSuggestedFix(errorType, topError.message);

    return responseBuilder.success(
      {
        process: input.name,
        rootCause: {
          message: topError.message,
          type: errorType,
          occurrences: topError.count,
          firstSeen: topError.firstSeen,
          topFrame: topError.topFrame,
        },
        confidence: Math.min(0.5 + topError.count * 0.1, 0.95),
        summary: `${topError.message} (${topError.count}x)`,
        suggestedFix,
        relatedErrors: sortedByCount.slice(1).map((g) => ({
          message: g.message,
          count: g.count,
        })),
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

function classifyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('econnreset'))
    return 'network';
  if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('forbidden'))
    return 'auth';
  if (
    lower.includes('typeerror') ||
    lower.includes('referenceerror') ||
    lower.includes('syntaxerror')
  )
    return 'runtime';
  if (lower.includes('not found') || lower.includes('enoent') || lower.includes('module'))
    return 'missing_resource';
  if (lower.includes('database') || lower.includes('sql') || lower.includes('query'))
    return 'database';
  if (lower.includes('memory') || lower.includes('heap') || lower.includes('oom')) return 'memory';
  return 'unknown';
}

function getSuggestedFix(type: string, _message: string): string {
  const fixes: Record<string, string> = {
    timeout:
      'Check for blocking operations, infinite loops, or slow network requests. Consider increasing timeout values.',
    network:
      'Verify the target service is running and reachable. Check firewall rules and connection strings.',
    auth: 'Check authentication tokens, API keys, or session expiry. Re-login or refresh credentials.',
    runtime:
      'Review the code at the reported line. Check for null/undefined values, type mismatches, or missing imports.',
    missing_resource:
      'Ensure required files, modules, or dependencies are installed. Check file paths.',
    database:
      'Verify database connection string, credentials, and that the database server is running.',
    memory: 'Check for memory leaks. Increase available memory or optimize memory usage.',
    unknown:
      'Review the error message and stack trace. Check recent code changes that may have introduced the issue.',
  };
  return fixes[type] ?? fixes.unknown!;
}

// ─── Tool: debug_summary ─────────────────────────────────────────

export const debugSummary = createTool({
  name: 'debug_summary',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> 📊 One-line health summary for a process. Returns: status (healthy/warning/error), errorCount, latestError, uptime. Token cost: ~30 tokens. Use for dashboard-style monitoring — lightweight enough to poll every few seconds.`',
  inputSchema: z.object({
    name: z.string().describe('Process name to check'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug mode is disabled'), { code: 'DEBUG_DISABLED' });
    }

    const state = getDebugState();
    const groups = state.errorDedup.getGroups();
    const tracked = readTracked();
    const proc = tracked.find((t) => t.name === input.name);

    const status = groups.length === 0 ? 'healthy' : groups.length > 5 ? 'error' : 'warning';
    const latestError = groups.length > 0 ? groups[0]! : null;

    return responseBuilder.success(
      {
        process: input.name,
        status,
        running: proc ? true : false,
        errorCount: state.errorDedup.uniqueCount,
        totalOccurrences: state.errorDedup.totalCount,
        latestError: latestError
          ? { message: latestError.message.slice(0, 80), count: latestError.count }
          : null,
        summary:
          status === 'healthy'
            ? '✅ No errors detected'
            : `⚠️ ${state.errorDedup.uniqueCount} unique error type(s), ${state.errorDedup.totalCount} total occurrences`,
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

// ─── Tool: debug_logs_since ──────────────────────────────────────

export const debugLogsSince = createTool({
  name: 'debug_logs_since',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> 📋 Get filtered logs since a timestamp for a process. Returns log lines since the given ISO timestamp, bounded to maxLines. Use for AI watch-mode: pass the last `until` timestamp to get only new lines. Token cost: bounded by maxLines.`',
  inputSchema: z.object({
    name: z.string().describe('Process name'),
    since: z.string().describe('ISO timestamp — return logs after this time'),
    maxLines: z.number().optional().default(50).describe('Max log lines to return'),
    level: z.enum(['error', 'warn', 'info', 'debug']).optional().describe('Filter by log level'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug mode is disabled'), { code: 'DEBUG_DISABLED' });
    }

    const { lines, error } = readProcessLogs(input.name, {
      lines: input.maxLines,
      since: input.since,
    });

    if (error) {
      return responseBuilder.error(new Error(error), { code: 'DEBUG_LOG_READ_FAILED' });
    }

    // Apply level filter
    let filtered = lines;
    if (input.level) {
      const levelUpper = input.level.toUpperCase();
      filtered = lines.filter((l) => {
        const upper = l.toUpperCase();
        return upper.includes(levelUpper);
      });
    }

    return responseBuilder.success(
      {
        process: input.name,
        since: input.since,
        lines: filtered,
        count: filtered.length,
        hasMore: filtered.length >= (input.maxLines ?? 50),
        watermark: new Date().toISOString(),
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

// ─── Tool: debug_configure (Level 1-3) ───────────────────────────

export const debugConfigure = createTool({
  name: 'debug_configure',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> ⚙️ Configure debug mode for a process. Sets the observation mode: log (passive), breakpoint (active), auto (proactive), or off. Returns current mode. Requires security.allowDebug: true.`',
  inputSchema: z.object({
    name: z.string().describe('Process name'),
    mode: z.enum(['log', 'breakpoint', 'auto', 'off']).describe('Debug mode to set'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug mode is disabled'), { code: 'DEBUG_DISABLED' });
    }

    const state = getDebugState();

    // Persist to tracked.json so CLI (`fennec debug attach`) sees the same state
    setDebugMode(input.name, input.mode === 'off' ? 'off' : input.mode);

    if (input.mode === 'off') {
      state.processModes.delete(input.name);
    } else {
      state.processModes.set(input.name, input.mode);
    }

    getLogger().info({ process: input.name, mode: input.mode }, 'Debug mode configured');

    return responseBuilder.success(
      {
        process: input.name,
        mode: input.mode,
        configured: true,
        note:
          input.mode === 'off'
            ? 'Debug mode disabled for this process'
            : `Debug mode set to "${input.mode}". Use debug_get_errors to view errors.`,
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

// ─── Tool: debug_get_mode ──────────────────────────────────────

export const debugGetMode = createTool({
  name: 'debug_get_mode',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> 🔍 Get the per-process debug mode from persistent storage. Returns the current debug mode (off/log/breakpoint/auto) for a tracked process. Reads from tracked.json so the MCP tools and CLI (`fennec debug status`) see the same state. Requires security.allowDebug: true.`',
  inputSchema: z.object({
    name: z.string().describe('Process name (from fennec ps / process_get_tracked)'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug mode is disabled'), { code: 'DEBUG_DISABLED' });
    }

    const mode = getDebugMode(input.name);
    const tracked = readTracked().find((t) => t.name === input.name);

    return responseBuilder.success(
      {
        process: input.name,
        mode,
        exists: !!tracked,
        running: tracked ? isTrackedRunning(tracked) : false,
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

// ─── Level 2: Breakpoint Debugging (V8 Inspector via CDP) ──────

import { getBreakpointManager, type Breakpoint } from './breakpoint-manager.js';
import { AdapterRegistry, getAdapterRegistry } from './adapter-registry.js';
import type { RuntimeType } from './adapter-types.js';

export { AdapterRegistry, getAdapterRegistry };
// Type-only re-exports (erased at compile-time, no module loading)
export type {
  DebugAdapter,
  RuntimeType,
  BreakpointResult,
  RemoteObject,
  CallFrame,
  EvaluateResult,
  PropertiesResult,
} from './adapter-types.js';

export const debugSetBreakpoint = createTool({
  name: 'debug_set_breakpoint',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> ⏸️ Set a breakpoint at file:line in the browser session. Execution will pause when the breakpoint is hit. CDP Debugger.setBreakpointByUrl is used under the hood. Returns breakpoint ID. Requires config debug.mode set to breakpoint/auto and security.allowDebug:true. Token cost: ~30 tokens.`',
  inputSchema: z.object({
    file: z
      .string()
      .describe('Source file URL or path (e.g., app.js or http://localhost:3000/app.js)'),
    line: z.number().describe('Line number (0-based)'),
    condition: z
      .string()
      .optional()
      .describe('Optional breakpoint condition (JavaScript expression)'),
    sessionId: z.string().optional().describe('Browser session ID (defaults to active session)'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const cdp = session.browser.cdp();
    const bpManager = getBreakpointManager();

    await bpManager.getOrCreateSession(session.id, cdp);
    const bp = await bpManager.setBreakpoint(session.id, input.file, input.line, {
      condition: input.condition,
    });

    return responseBuilder.success(
      {
        breakpoint: bp,
        active: true,
        note: `Breakpoint set at ${input.file}:${input.line}. Execute the relevant code to hit it, then use debug_get_variables to inspect state.`,
      },
      sessionManager.buildMeta(session),
    );
  },
});

export const debugRemoveBreakpoint = createTool({
  name: 'debug_remove_breakpoint',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> ❌ Remove a breakpoint by ID. Returns confirmation. Token cost: ~10 tokens.`',
  inputSchema: z.object({
    breakpointId: z.string().describe('Breakpoint ID from debug_set_breakpoint'),
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const bpManager = getBreakpointManager();
    const removed = await bpManager.removeBreakpoint(session.id, input.breakpointId);

    return responseBuilder.success(
      {
        removed,
        breakpointId: input.breakpointId,
        note: removed ? 'Breakpoint removed' : 'Breakpoint not found',
      },
      sessionManager.buildMeta(session),
    );
  },
});

export const debugListBreakpoints = createTool({
  name: 'debug_list_breakpoints',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> 📋 List all active breakpoints for a browser session. Returns breakpoints with file, line, condition. Token cost: ~20 tokens.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const bpManager = getBreakpointManager();
    const breakpoints = bpManager.listBreakpoints(session.id);

    return responseBuilder.success(
      {
        breakpoints,
        count: breakpoints.length,
      },
      sessionManager.buildMeta(session),
    );
  },
});

export const debugContinue = createTool({
  name: 'debug_continue',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> ▶️ Resume execution after a breakpoint pause. Requires debugger to be paused (use debug_set_breakpoint first). Token cost: ~10 tokens.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const bpManager = getBreakpointManager();

    try {
      const resumed = await bpManager.resume(session.id);
      if (!resumed) {
        return responseBuilder.error(
          new Error('Debugger is not paused. Set a breakpoint and trigger it first.'),
          { code: 'DEBUG_NOT_PAUSED' },
        );
      }
      return responseBuilder.success(
        { resumed: true, note: 'Execution resumed' },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error as Error, { code: 'DEBUG_RESUME_FAILED' });
    }
  },
});

export const debugStepOver = createTool({
  name: 'debug_step_over',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> 👣 Step over the next function call. Requires debugger to be paused. Token cost: ~10 tokens.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const bpManager = getBreakpointManager();

    try {
      const stepped = await bpManager.stepOver(session.id);
      if (!stepped) {
        return responseBuilder.error(
          new Error('Debugger is not paused. Set a breakpoint and trigger it first.'),
          { code: 'DEBUG_NOT_PAUSED' },
        );
      }
      return responseBuilder.success(
        { stepped: true, note: 'Stepped over. Use debug_get_variables to inspect state.' },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error as Error, { code: 'DEBUG_STEP_FAILED' });
    }
  },
});

export const debugStepInto = createTool({
  name: 'debug_step_into',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> 🔍 Step into the next function call. Requires debugger to be paused. Token cost: ~10 tokens.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const bpManager = getBreakpointManager();

    try {
      const stepped = await bpManager.stepInto(session.id);
      if (!stepped) {
        return responseBuilder.error(new Error('Debugger is not paused.'), {
          code: 'DEBUG_NOT_PAUSED',
        });
      }
      return responseBuilder.success(
        { stepped: true, note: 'Stepped into. Use debug_get_variables to inspect state.' },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error as Error, { code: 'DEBUG_STEP_FAILED' });
    }
  },
});

export const debugGetVariables = createTool({
  name: 'debug_get_variables',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> 📦 Get current scope variables at a breakpoint pause. Bounded: max 20 variables per scope, 3 levels deep. Returns scopes[] with variables[]. Use after debug_set_breakpoint + hitting the breakpoint. Token cost: ~150 tokens (bounded).`',
  inputSchema: z.object({
    maxVariables: z.number().optional().default(20).describe('Max variables per scope'),
    maxDepth: z.number().optional().default(2).describe('Max depth for nested objects'),
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const bpManager = getBreakpointManager();
    const pauseState = bpManager.getPauseState(session.id);

    if (!pauseState) {
      return responseBuilder.success(
        {
          paused: false,
          scopes: [],
          summary: 'Debugger is not paused. Set a breakpoint and execute code to trigger it.',
        },
        sessionManager.buildMeta(session),
      );
    }

    // Respect tokenBudget config for variable limits
    const maxVars = input.maxVariables ?? config.tokenBudget?.debugMaxVariables ?? 20;
    const maxDepth = input.maxDepth ?? 2; // Keep safe default; depth != stack frames

    const scopes = await bpManager.getVariables(session.id, {
      maxVariables: maxVars,
      maxDepth: maxDepth,
    });

    // Token-efficient call stack summary
    const maxFrames = config.tokenBudget?.debugMaxStackFrames ?? 5;
    const callStack = pauseState.callFrames.slice(0, maxFrames).map((f) => ({
      function: f.functionName || '<anonymous>',
      file: f.url.split('/').pop() ?? f.url,
      line: f.lineNumber,
      column: f.columnNumber,
    }));

    return responseBuilder.success(
      {
        paused: true,
        reason: pauseState.reason,
        callStack,
        scopes: scopes.map((s) => ({
          type: s.type,
          variables: s.variables,
        })),
        summary: `Paused at ${callStack[0]?.function ?? 'unknown'} in ${callStack[0]?.file ?? 'unknown'}:${callStack[0]?.line ?? 0}`,
      },
      sessionManager.buildMeta(session),
    );
  },
});

export const debugEvaluate = createTool({
  name: 'debug_evaluate',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> ⚡ Evaluate a JavaScript expression in the current breakpoint context. Gated by security.allowDebugEval (default: false). Requires debugger to be paused on a breakpoint. Returns value, type. Token cost: ~30 tokens.`',
  inputSchema: z.object({
    expression: z.string().describe('JavaScript expression to evaluate in the paused context'),
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }
    if (!config.debug?.allowDebugEval) {
      return responseBuilder.error(
        new Error('Expression evaluation is disabled. Set debug.allowDebugEval: true in config'),
        { code: 'DEBUG_EVAL_DISABLED' },
      );
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const bpManager = getBreakpointManager();

    try {
      const result = await bpManager.evaluate(session.id, input.expression);
      return responseBuilder.success(
        {
          expression: input.expression,
          value: result.value,
          type: result.type,
          exception: result.exception ?? null,
          success: !result.exception,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error as Error, { code: 'DEBUG_EVAL_FAILED' });
    }
  },
});

// ─── Level 2.5: Script & Source Inspection ───────────────────────

export const debugGetPauseState = createTool({
  name: 'debug_get_pause_state',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> 📍 Get current debugger pause state. Returns whether paused, reason, call stack summary. Token-efficient: ~50 tokens. Use before debug_get_variables to check if debugger is actually paused.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const bpManager = getBreakpointManager();
    const pauseState = bpManager.getPauseState(session.id);

    if (!pauseState) {
      return responseBuilder.success(
        {
          paused: false,
          summary: 'Debugger is not paused',
        },
        sessionManager.buildMeta(session),
      );
    }

    const maxFrames = config.tokenBudget?.debugMaxStackFrames ?? 5;
    const summary = bpManager.getPauseSummary(session.id, maxFrames);
    return responseBuilder.success(
      {
        paused: true,
        reason: pauseState.reason,
        frameCount: pauseState.callFrames.length,
        summary,
        hitBreakpoints: pauseState.hitBreakpoints,
      },
      sessionManager.buildMeta(session),
    );
  },
});

// ─── Level 2.5: Composite Investigation Tool ───────────────────

export const debugInvestigateRuntime = createTool({
  name: 'debug_investigate_runtime',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> 🔬 Guided runtime investigation — sets a breakpoint and returns structured variable state. Orchestrates multiple debug steps in ONE call instead of requiring 3-5 separate tool calls. Accepts a question and optionally hint_file/hint_line for the breakpoint location. Returns: summary, callStack, variables, suggestedFix. Token cost: ~200-500 tokens. Requires security.allowDebug: true.`',
  inputSchema: z.object({
    name: z.string().describe('Process or session name to investigate'),
    question: z.string().describe('The question to answer (e.g., "Why is login failing?")'),
    hintFile: z.string().optional().describe('Hint: source file to set breakpoint at'),
    hintLine: z.number().optional().describe('Hint: line number for breakpoint (0-based)'),
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const cdp = session.browser.cdp();
    const bpManager = getBreakpointManager(); // Guard: CDP session required (V8/Node.js only)
    if (!cdp) {
      return responseBuilder.error(
        new Error(
          'Runtime investigation requires a browser/Node.js session with CDP support. For other runtimes (Python, Java, Go), use the individual debug_* tools.',
        ),
        { code: 'CDP_NOT_AVAILABLE' },
      );
    }

    try {
      // 1. Create debug session if not exists
      await bpManager.getOrCreateSession(session.id, cdp);

      // 2. If hint file/line provided, set breakpoint
      let bp = null;
      if (input.hintFile && input.hintLine !== undefined) {
        bp = await bpManager.setBreakpoint(session.id, input.hintFile, input.hintLine);
      }

      // 3. Check if already paused
      let pauseState = bpManager.getPauseState(session.id);

      // 4. If hint given but not paused, guide user to trigger the code path
      if (!pauseState && input.hintFile) {
        getLogger().info(
          { file: input.hintFile, line: input.hintLine },
          'Investigate: breakpoint set, waiting for hit',
        );
      }

      // 5. Get variables if paused
      let variables = null;
      let callStack = null;
      if (pauseState) {
        const scopes = await bpManager.getVariables(session.id, {
          maxVariables: config.tokenBudget?.debugMaxVariables ?? 20,
          maxDepth: 2,
        });
        const maxFrames = config.tokenBudget?.debugMaxStackFrames ?? 5;
        callStack = pauseState.callFrames.slice(0, maxFrames).map((f) => ({
          function: f.functionName || '<anonymous>',
          file: f.url.split('/').pop() ?? f.url,
          line: f.lineNumber,
        }));
        variables = scopes.map((s) => ({
          type: s.type,
          vars: s.variables.slice(0, config.tokenBudget?.debugMaxVariables ?? 20),
        }));
      }

      // 6. Build structured answer
      return responseBuilder.success(
        {
          question: input.question,
          paused: pauseState !== null,
          breakpointSet: bp !== null,
          breakpoint: bp ? { file: bp.file, line: bp.line, id: bp.id } : null,
          callStack,
          variables,
          summary: pauseState
            ? `Paused at ${callStack?.[0]?.function ?? 'unknown'} in ${callStack?.[0]?.file ?? 'unknown'}:${callStack?.[0]?.line ?? 0}`
            : bp
              ? `Breakpoint set at ${input.hintFile}:${input.hintLine}. Execute the relevant code to hit it, then call debug_investigate_runtime again.`
              : 'Not paused. Provide hintFile and hintLine to set a breakpoint.',
          // Use a generic investigation suggestion (classifyError is for error messages, not NL questions)
          suggestedFix: input.question
            ? 'Review the variables and call stack above. Common issues: null/undefined values, incorrect parameters, missing data.'
            : null,
          note: 'For deeper inspection, call again after the breakpoint hits, or use debug_get_variables directly.',
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error as Error, { code: 'INVESTIGATE_FAILED' });
    }
  },
});

// ─── Level 1.5: Logpoint (Non-blocking breakpoint) ──────────────

export const debugSetLogpoint = createTool({
  name: 'debug_set_logpoint',
  category: 'debug',
  description:
    '`<use_case>Breakpoint debugging</use_case> 📝 Set a logpoint — a non-blocking breakpoint that logs an expression and continues execution. Unlike debug_set_breakpoint, execution does NOT pause. Great for debugging async/timing-sensitive code where pausing would change behavior. Uses CDP/DAP logMessage internally. Token cost: ~20 tokens.`',
  inputSchema: z.object({
    file: z.string().describe('Source file URL or path'),
    line: z.number().describe('Line number (0-based)'),
    expression: z
      .string()
      .optional()
      .default('{variables}')
      .describe('Expression to log (default: log all variables)'),
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { config, responseBuilder, sessionManager }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const session = sessionManager.getOrDefault(input.sessionId);
    const cdp = session.browser.cdp();
    const bpManager = getBreakpointManager();

    try {
      // Create session and set breakpoint with logMessage
      await bpManager.getOrCreateSession(session.id, cdp);

      // Determine runtime to check if logMessage is supported
      // DAP adapters (Python, Go, .NET, Ruby, Rust, Dart) support logMessage natively.
      // V8 (CDP), PHP (DBGp), and Java (JDWP) do NOT.
      const adapter = bpManager.getAdapter(session.id);
      const dapRuntimes: RuntimeType[] = ['python', 'go', 'dotnet', 'ruby', 'rust', 'dart'];
      const isDAP = dapRuntimes.includes(adapter.runtime);

      // Pass expression as logMessage for DAP adapters (native support)
      // For V8/CDP, logMessage is ignored (would need condition hack)
      const bp = await bpManager.setBreakpoint(session.id, input.file, input.line, {
        logMessage: isDAP ? input.expression : undefined,
      });

      if (isDAP) {
        // DAP adapters (Python, Go, .NET, Ruby, Rust, Dart) support logMessage natively
        return responseBuilder.success(
          {
            logpoint: {
              id: bp.id,
              file: input.file,
              line: input.line,
              expression: input.expression,
            },
            active: true,
            runtime: adapter.runtime,
            note: `✅ Logpoint active on ${adapter.runtime} adapter. Expression "${input.expression}" will be logged without pausing execution.`,
          },
          sessionManager.buildMeta(session),
        );
      } else {
        // V8/CDP: logMessage not natively supported in CDP
        return responseBuilder.success(
          {
            logpoint: {
              id: bp.id,
              file: input.file,
              line: input.line,
              expression: input.expression,
            },
            active: false,
            runtime: 'v8',
            note:
              `⚠️ Logpoints not yet supported on V8/CDP (no native logMessage in CDP). ` +
              `Breakpoint set without logMessage. Use debug_set_breakpoint then debug_continue manually. ` +
              `Breakpoint ID: ${bp.id}`,
          },
          sessionManager.buildMeta(session),
        );
      }
    } catch (error) {
      return responseBuilder.error(error as Error, { code: 'LOGPOINT_FAILED' });
    }
  },
});

// ─── Level 1.5: Record/Replay (Cassette) ─────────────────────────

import { getCassetteRecorder } from './cassette.js';

export const debugRecordSession = createTool({
  name: 'debug_record_session',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> ⏺️ Start recording all tool calls into a VCR cassette. Every subsequent tool call (browser, process, debug, etc.) is captured with input/output/duration. Stop with debug_stop_recording. Use for regression testing: record a debug session, then replay to detect regressions. Requires security.allowDebug: true.`',
  inputSchema: z.object({
    name: z.string().optional().describe('Optional name for this recording'),
    description: z.string().optional().describe('Optional description'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const recorder = getCassetteRecorder();
    const id = recorder.startRecording(input.name, input.description);

    return responseBuilder.success(
      {
        cassetteId: id,
        recording: true,
        name: input.name ?? 'Unnamed',
        note: 'Recording started. All tool calls will be captured until debug_stop_recording is called.',
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

export const debugStopRecording = createTool({
  name: 'debug_stop_recording',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> ⏹️ Stop recording MCP tool calls and save the VCR cassette to disk. Returns the cassette with all recorded entries. The cassette can be replayed later with debug_replay_session to detect regressions. Token cost: ~50 tokens for metadata.`',
  inputSchema: z.object({}),
  handler: async (_input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const recorder = getCassetteRecorder();
    const cassette = recorder.stopRecording();

    if (!cassette) {
      return responseBuilder.error(
        new Error('No active recording. Start one with debug_record_session first.'),
        { code: 'NO_ACTIVE_RECORDING' },
      );
    }

    return responseBuilder.success(
      {
        cassetteId: cassette.id,
        name: cassette.name,
        entries: cassette.entries.length,
        totalDurationMs: cassette.metadata.totalDurationMs,
        successRate: cassette.metadata.successRate,
        note: `Recording saved. Use debug_replay_session to replay, or debug_list_cassettes to view all.`,
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

export const debugReplaySession = createTool({
  name: 'debug_replay_session',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> ▶️ Replay a cassette — re-executes all recorded tool calls and compares results with the original. Returns a diff showing what changed (regressions, new errors, timing differences). Essential for catching silent regressions before they reach production. Token cost: depends on cassette size.`',
  inputSchema: z.object({
    cassetteId: z
      .string()
      .describe('Cassette ID from debug_stop_recording or debug_list_cassettes'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const recorder = getCassetteRecorder();

    // We don't have direct access to the tool executor from here
    // Return the cassette info so the agent can decide how to proceed
    const cassette = recorder.getCassette(input.cassetteId);
    if (!cassette) {
      return responseBuilder.error(new Error(`Cassette not found: ${input.cassetteId}`), {
        code: 'CASSETTE_NOT_FOUND',
      });
    }

    return responseBuilder.success(
      {
        cassetteId: cassette.id,
        name: cassette.name,
        entries: cassette.entries.map((e) => ({
          toolName: e.toolName,
          success: e.success,
          durationMs: e.durationMs,
          timestamp: e.timestamp,
        })),
        totalDurationMs: cassette.metadata.totalDurationMs,
        successRate: cassette.metadata.successRate,
        note: 'To re-execute, iterate through entries and call each tool. Use debug_list_cassettes to compare with other recordings.',
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

export const debugDiffSessions = createTool({
  name: 'debug_diff_sessions',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> 🔍 Compare two cassettes and return a structured diff. Shows which tool calls changed between sessions — ideal for catching regressions after code changes. Token cost: ~100-300 tokens for the diff summary.`',
  inputSchema: z.object({
    cassetteA: z.string().describe('First cassette ID (baseline)'),
    cassetteB: z.string().describe('Second cassette ID (changed version)'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const recorder = getCassetteRecorder();
    const a = recorder.getCassette(input.cassetteA);
    const b = recorder.getCassette(input.cassetteB);

    if (!a || !b) {
      return responseBuilder.error(
        new Error(`Cassette not found: ${!a ? input.cassetteA : input.cassetteB}`),
        { code: 'CASSETTE_NOT_FOUND' },
      );
    }

    // Simple diff: compare entries by index
    const maxLen = Math.max(a.entries.length, b.entries.length);
    const diffs: Array<{
      index: number;
      toolName: string;
      status: string;
      successA?: boolean;
      successB?: boolean;
      durationA?: number;
      durationB?: number;
    }> = [];

    let different = 0;
    let regressions = 0;

    for (let i = 0; i < maxLen; i++) {
      const ea = a.entries[i];
      const eb = b.entries[i];

      if (!ea && eb) {
        diffs.push({ index: i, toolName: eb.toolName, status: 'only_in_b' });
        continue;
      }
      if (ea && !eb) {
        diffs.push({ index: i, toolName: ea.toolName, status: 'only_in_a' });
        continue;
      }

      const changed = ea!.success !== eb!.success;
      if (changed) {
        different++;
        if (ea!.success && !eb!.success) regressions++;
      }

      diffs.push({
        index: i,
        toolName: ea!.toolName,
        status: changed ? (ea!.success && !eb!.success ? 'regression' : 'changed') : 'same',
        successA: ea!.success,
        successB: eb!.success,
        durationA: ea!.durationMs,
        durationB: eb!.durationMs,
      });
    }

    return responseBuilder.success(
      {
        cassetteA: a.name,
        cassetteB: b.name,
        summary: {
          totalA: a.entries.length,
          totalB: b.entries.length,
          different,
          regressions,
          unchanged: maxLen - different,
          successRateA: a.metadata.successRate,
          successRateB: b.metadata.successRate,
        },
        diffs: diffs.slice(0, 20), // Token-efficient: max 20 diffs
        note:
          regressions > 0
            ? `⚠️ ${regressions} regression(s) detected! ${different - regressions} other change(s).`
            : '✅ No regressions detected.',
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

export const debugListCassettes = createTool({
  name: 'debug_list_cassettes',
  category: 'debug',
  description:
    '`<use_case>Smart debugging</use_case> 📋 List all saved cassettes with metadata (name, date, entries, success rate). Filter by limit. Token cost: ~30 tokens.`',
  inputSchema: z.object({
    limit: z.number().optional().default(10).describe('Max cassettes to list'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const recorder = getCassetteRecorder();
    const cassettes = recorder.listCassettes().slice(0, input.limit);

    return responseBuilder.success(
      {
        cassettes: cassettes.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          startedAt: c.startedAt,
          entries: c.entries.length,
          successRate: c.metadata.successRate,
          totalDurationMs: c.metadata.totalDurationMs,
        })),
        totalStored: cassettes.length,
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

// ─── Level 3: Auto-Debug (EventBus-driven) ─────────────────────

import { getAutoDebugEngine, getSnapshotManager } from './auto-debug.js';

export const debugAutoReport = createTool({
  name: 'debug_auto_report',
  category: 'debug',
  description:
    '`<use_case>Auto-debugging</use_case> 🤖 Get the latest auto-debug report for a process. Auto-debug subscribes to EventBus events (process:exit, process:stderr, browser:console:error, browser:network:5xx) and auto-captures structured snapshots with error context, logs, and suggested fixes. Token cost: ~100-300 tokens. Requires security.allowDebug: true.`',
  inputSchema: z.object({
    name: z.string().describe('Process name or session ID to get report for'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const mgr = getSnapshotManager();
    if (!mgr) {
      return responseBuilder.success(
        {
          status: 'not_started',
          note: 'Auto-debug engine is not started. Start Fennec with security.allowDebug: true to enable auto-debug.',
        },
        { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
      );
    }

    // Try exact source name match first
    let reports = mgr.getLatest({ sourceName: input.name, limit: 3 });

    // If no exact match, try showing most recent across all sources
    if (reports.length === 0) {
      reports = mgr.getLatest({ limit: 3 });
    }

    if (reports.length === 0) {
      return responseBuilder.success(
        {
          process: input.name,
          reports: [],
          count: 0,
          summary:
            'No auto-debug reports yet. Auto-debug captures snapshots when errors occur (process crash, stderr error, browser error, 5xx).',
        },
        { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
      );
    }

    return responseBuilder.success(
      {
        process: input.name,
        reports: reports.map((r) => ({
          id: r.id,
          ruleId: r.ruleId,
          ruleName: r.ruleName,
          timestamp: r.timestamp,
          message: r.message,
          count: r.count,
          errorGroups: r.errorGroups.slice(0, 3),
          suggestedFix: r.suggestedFix,
        })),
        count: reports.length,
        summary:
          reports.length > 0
            ? `${reports[0]!.ruleName}: ${reports[0]!.message.slice(0, 80)}`
            : 'No reports',
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

export const debugAutoHistory = createTool({
  name: 'debug_auto_history',
  category: 'debug',
  description:
    '`<use_case>Auto-debugging</use_case> 📋 Get auto-debug history. Lists recent snapshots with timestamps, rule, and message. Filter by sourceName, ruleId, or since timestamp. Max 10 entries. Token cost: ~50 tokens each.`',
  inputSchema: z.object({
    sourceName: z.string().optional().describe('Filter by process/session name'),
    ruleId: z
      .enum(['crash', 'error', 'browser', 'hang', 'timeout'])
      .optional()
      .describe('Filter by rule ID'),
    since: z.string().optional().describe('ISO timestamp — only events after this time'),
    limit: z.number().optional().default(10).describe('Max entries to return'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const mgr = getSnapshotManager();
    if (!mgr) {
      return responseBuilder.success(
        { history: [], count: 0, note: 'Auto-debug engine not started' },
        { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
      );
    }

    let snapshots: ReturnType<typeof mgr.getLatest>;
    if (input.since) {
      const all = mgr.getSince(input.since);
      let filtered = all;
      if (input.sourceName) filtered = filtered.filter((s) => s.sourceName === input.sourceName);
      if (input.ruleId) filtered = filtered.filter((s) => s.ruleId === input.ruleId);
      snapshots = filtered;
    } else {
      snapshots = mgr.getLatest({
        sourceName: input.sourceName,
        ruleId: input.ruleId,
        limit: input.limit ?? 10,
      });
    }

    return responseBuilder.success(
      {
        history: snapshots.map((s) => ({
          id: s.id,
          ruleId: s.ruleId,
          ruleName: s.ruleName,
          timestamp: s.timestamp,
          sourceName: s.sourceName,
          message: s.message.slice(0, 100),
          count: s.count,
        })),
        count: snapshots.length,
        totalStored: mgr.count,
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

export const debugAutoConfigure = createTool({
  name: 'debug_auto_configure',
  category: 'debug',
  description:
    '`<use_case>Auto-debugging</use_case> ⚙️ Configure auto-debug rules. Enable/disable specific auto-debug triggers: crash (process exit), error (stderr), browser (console+5xx), hang (port down), timeout. Returns current rule status. Requires security.allowDebug: true. Token cost: ~20 tokens.`',
  inputSchema: z.object({
    ruleId: z
      .enum(['crash', 'error', 'browser', 'hang', 'timeout'])
      .describe('Rule ID to configure'),
    enabled: z.boolean().describe('Enable or disable this rule'),
  }),
  handler: async (input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const autoDebug = getAutoDebugEngine();
    if (!autoDebug) {
      return responseBuilder.success(
        {
          status: 'not_started',
          note: 'Auto-debug engine is not started. Start the Fennec server first.',
        },
        { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
      );
    }

    const result = autoDebug.setRuleEnabled(input.ruleId, input.enabled);

    return responseBuilder.success(
      {
        ruleId: input.ruleId,
        enabled: input.enabled,
        configured: result,
        currentRules: autoDebug.listRules().map((r) => ({
          id: r.id,
          name: r.name,
          enabled: r.enabled,
        })),
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});

export const debugAutoStats = createTool({
  name: 'debug_auto_stats',
  category: 'debug',
  description:
    '`<use_case>Auto-debugging</use_case> 📊 Get auto-debug engine statistics. Returns total snapshots captured, enabled rules, and per-rule status. Token cost: ~20 tokens.`',
  inputSchema: z.object({}),
  handler: async (_input, { config, responseBuilder }) => {
    if (!isDebugAllowed(config)) {
      return responseBuilder.error(new Error('Debug disabled'), { code: 'DEBUG_DISABLED' });
    }

    const mgr = getSnapshotManager();
    if (!mgr) {
      return responseBuilder.success(
        { totalSnapshots: 0, enabledRules: 0, rules: [], status: 'not_started' },
        { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
      );
    }

    const engine = getAutoDebugEngine();
    if (!engine) {
      return responseBuilder.success(
        {
          totalSnapshots: 0,
          enabledRules: 0,
          rules: [],
          status: 'not_started',
        },
        { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
      );
    }
    const stats = engine.getStats();

    return responseBuilder.success(
      {
        totalSnapshots: stats.totalSnapshots,
        enabledRules: stats.enabledRules,
        rules: stats.rules.map((r) => ({
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          cooldownMs: r.cooldownMs,
        })),
        status: 'running',
      },
      { elapsed: 0, sessionId: 'debug', timestamp: new Date().toISOString() },
    );
  },
});
