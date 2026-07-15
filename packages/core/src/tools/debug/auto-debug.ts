/**
 * Auto-Debug Engine (Level 3) — Proactive error detection via EventBus events.
 *
 * Subscribes to EventBus events and generates structured auto-debug reports:
 * - process:exit (non-zero) → crash snapshot
 * - process:stderr (error pattern) → error snapshot
 * - browser:console (error level) → browser error snapshot
 * - browser:network (5xx status) → network error snapshot
 *
 * Snapshots are stored with TTL (10 min), max 50 entries, LRU eviction.
 * Dedup: same error within 30s increments counter instead of new snapshot.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { EventBus, BusEvent } from '../../correlation/EventBus.js';
import { readTracked, logPathFor } from '../../process/tracking.js';
import { getLogger } from '../../utils/logger.js';
import { getErrorDedup } from './error-dedup.js';

// ─── Types ───────────────────────────────────────────────────────

export type AutoDebugRuleId = 'crash' | 'error' | 'browser' | 'hang' | 'timeout';

export interface AutoDebugSnapshot {
  id: string;
  /** Which rule triggered this snapshot */
  ruleId: AutoDebugRuleId;
  /** Rule name */
  ruleName: string;
  /** ISO timestamp of the event */
  timestamp: string;
  /** ISO timestamp of last deduped occurrence (same as timestamp initially) */
  lastSeen: string;
  /** Source event type */
  eventType: string;
  /** Process or session name involved */
  sourceName: string;
  /** Error message (first 200 chars) */
  message: string;
  /** Error count (dedup: same error = increment) */
  count: number;
  /** Correlated error groups from ErrorDedup */
  errorGroups: Array<{ hash: string; message: string; count: number }>;
  /** Recent log lines from the process (last 10) */
  recentLogs: string[];
  /** Console errors from browser session (last 5) */
  consoleErrors: string[];
  /** Network failures from browser session (last 5) */
  networkFailures: string[];
  /** Suggested fix based on error type */
  suggestedFix?: string;
}

export interface AutoDebugRule {
  id: AutoDebugRuleId;
  name: string;
  description: string;
  enabled: boolean;
  /** Cooldown in ms between snapshots for same source */
  cooldownMs: number;
}

export interface AutoDebugConfig {
  rules: Record<AutoDebugRuleId, AutoDebugRule>;
  /** Max snapshots stored (default: 50) */
  maxSnapshots: number;
  /** Snapshot TTL in ms (default: 10 min) */
  snapshotTTLMs: number;
  /** Dedup window in ms (default: 30s) — same error = increment counter */
  dedupWindowMs: number;
}

/** Default auto-debug rules matching the debugger.md proposal. */
function createDefaultRules(): Record<AutoDebugRuleId, AutoDebugRule> {
  return {
    crash: {
      id: 'crash',
      name: 'Auto Debug on Process Crash',
      description: 'Snapshot on non-zero process exit',
      enabled: true,
      cooldownMs: 30000,
    },
    error: {
      id: 'error',
      name: 'Auto Debug on Stderr Error',
      description: 'Snapshot on error pattern in stderr',
      enabled: true,
      cooldownMs: 15000,
    },
    browser: {
      id: 'browser',
      name: 'Auto Debug on Browser Error',
      description: 'Snapshot on browser console error + network 5xx',
      enabled: true,
      cooldownMs: 10000,
    },
    hang: {
      id: 'hang',
      name: 'Auto Debug on Process Hang',
      description: 'Snapshot when port is down but process is alive',
      enabled: true,
      cooldownMs: 60000,
    },
    timeout: {
      id: 'timeout',
      name: 'Auto Debug on Request Timeout',
      description: 'Snapshot on request timeout',
      enabled: true,
      cooldownMs: 30000,
    },
  };
}

// ─── Snapshot Manager ────────────────────────────────────────────

export class SnapshotManager {
  private snapshots: AutoDebugSnapshot[] = [];
  private snapshotCounter = 0;
  private maxSnapshots: number;
  private snapshotTTLMs: number;
  private dedupWindowMs: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<AutoDebugConfig>) {
    this.maxSnapshots = config?.maxSnapshots ?? 50;
    this.snapshotTTLMs = config?.snapshotTTLMs ?? 600000; // 10 min
    this.dedupWindowMs = config?.dedupWindowMs ?? 30000; // 30s
    this.startPruning();
  }

  /**
   * Add a snapshot. Returns the snapshot (existing if deduped).
   */
  add(snapshot: Omit<AutoDebugSnapshot, 'id' | 'lastSeen'>): AutoDebugSnapshot {
    const now = Date.now();

    // Dedup: check if same source+rule within dedup window
    const existing = this.snapshots.find(
      (s) =>
        s.sourceName === snapshot.sourceName &&
        s.ruleId === snapshot.ruleId &&
        s.message === snapshot.message &&
        now - new Date(s.timestamp).getTime() < this.dedupWindowMs,
    );

    if (existing) {
      existing.count += snapshot.count;
      existing.lastSeen = snapshot.timestamp;
      return existing;
    }

    const id = `auto_${++this.snapshotCounter}`;
    const entry: AutoDebugSnapshot = {
      id,
      ...snapshot,
      lastSeen: snapshot.timestamp,
    };

    this.snapshots.push(entry);

    // LRU eviction
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    getLogger().info(
      { snapshotId: id, ruleId: snapshot.ruleId, source: snapshot.sourceName },
      'Auto-debug snapshot captured',
    );

    return entry;
  }

  /**
   * Get the latest snapshot(s), optionally filtered by source or rule.
   */
  getLatest(options?: { sourceName?: string; ruleId?: AutoDebugRuleId; limit?: number }): AutoDebugSnapshot[] {
    let filtered = [...this.snapshots].reverse(); // most recent first

    if (options?.sourceName) {
      filtered = filtered.filter((s) => s.sourceName === options.sourceName);
    }
    if (options?.ruleId) {
      filtered = filtered.filter((s) => s.ruleId === options.ruleId);
    }

    const limit = options?.limit ?? 1;
    return filtered.slice(0, limit);
  }

  /**
   * Get all snapshots (most recent first).
   */
  getAll(): AutoDebugSnapshot[] {
    return [...this.snapshots].reverse();
  }

  /**
   * Get snapshots since a given ISO timestamp.
   */
  getSince(since: string): AutoDebugSnapshot[] {
    const sinceMs = new Date(since).getTime();
    if (isNaN(sinceMs)) return [];
    return this.snapshots
      .filter((s) => new Date(s.timestamp).getTime() > sinceMs)
      .reverse();
  }

  /**
   * Clear all snapshots.
   */
  clear(): void {
    this.snapshots = [];
  }

  /**
   * Get total count.
   */
  get count(): number {
    return this.snapshots.length;
  }

  /**
   * Start periodic TTL pruning.
   */
  private startPruning(): void {
    this.pruneTimer = setInterval(() => {
      this.pruneExpired();
    }, 60000); // check every 60s

    if (this.pruneTimer && 'unref' in this.pruneTimer) {
      this.pruneTimer.unref();
    }
  }

  /**
   * Remove expired snapshots.
   */
  pruneExpired(): void {
    const cutoff = Date.now() - this.snapshotTTLMs;
    const before = this.snapshots.length;
    this.snapshots = this.snapshots.filter(
      (s) => new Date(s.timestamp).getTime() > cutoff,
    );
    const pruned = before - this.snapshots.length;
    if (pruned > 0) {
      getLogger().debug({ pruned }, 'Auto-debug: pruned expired snapshots');
    }
  }

  /**
   * Stop pruning timer.
   */
  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }
}

// ─── Auto-Debug Engine ───────────────────────────────────────────

export class AutoDebugEngine {
  private eventBus: EventBus;
  private snapshotManager: SnapshotManager;
  private rules: Record<AutoDebugRuleId, AutoDebugRule>;
  private unsubscribers: Array<() => void> = [];
  private cooldowns: Map<string, number> = new Map(); // "ruleId:source" → next allowed timestamp
  private started = false;

  constructor(
    eventBus: EventBus,
    config?: Partial<AutoDebugConfig>,
  ) {
    this.eventBus = eventBus;
    const fullConfig: AutoDebugConfig = {
      rules: config?.rules ?? createDefaultRules(),
      maxSnapshots: config?.maxSnapshots ?? 50,
      snapshotTTLMs: config?.snapshotTTLMs ?? 600000,
      dedupWindowMs: config?.dedupWindowMs ?? 30000,
    };
    this.rules = fullConfig.rules;
    this.snapshotManager = new SnapshotManager(fullConfig);
  }

  /** Access the snapshot manager for tool queries. */
  get snapshots(): SnapshotManager {
    return this.snapshotManager;
  }

  /**
   * Start listening for events.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const logger = getLogger();

    // Subscribe to process:exit (crash detection)
    this.unsubscribers.push(
      this.eventBus.subscribe('process:exit', (event: BusEvent) => {
        const code = event.data.code as number | undefined;
        if (code !== undefined && code !== 0 && this.rules.crash.enabled) {
          this.handleCrash(event, code);
        }
      }),
    );

    // Subscribe to process:stderr (error detection)
    this.unsubscribers.push(
      this.eventBus.subscribe('process:stderr', (event: BusEvent) => {
        const line = event.data.line as string | undefined;
        if (
          line &&
          /error|Error|ERROR|exception|Exception|FATAL|fatal/.test(line) &&
          this.rules.error.enabled
        ) {
          this.handleStderrError(event, line);
        }
      }),
    );

    // Subscribe to browser:console (browser error detection)
    this.unsubscribers.push(
      this.eventBus.subscribe('browser:console', (event: BusEvent) => {
        const level = event.data.level as string | undefined;
        if (level === 'error' && this.rules.browser.enabled) {
          this.handleBrowserError(event);
        }
      }),
    );

    // Subscribe to browser:network (network error detection)
    this.unsubscribers.push(
      this.eventBus.subscribe('browser:network', (event: BusEvent) => {
        const status = event.data.status as number | undefined;
        if (status !== undefined && status >= 500 && this.rules.browser.enabled) {
          this.handleNetworkError(event, status);
        }
      }),
    );

    logger.info(
      {
        rules: Object.values(this.rules)
          .filter((r) => r.enabled)
          .map((r) => r.id),
      },
      'Auto-debug engine started',
    );
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.snapshotManager.stop();
    this.started = false;
    getLogger().info('Auto-debug engine stopped');
  }

  /**
   * Check if a rule is in cooldown for a given source.
   */
  private isCooldown(ruleId: AutoDebugRuleId, source: string): boolean {
    const key = `${ruleId}:${source}`;
    const nextAllowed = this.cooldowns.get(key);
    return nextAllowed !== undefined && nextAllowed > Date.now();
  }

  /**
   * Set cooldown for a rule+source.
   */
  private setCooldown(ruleId: AutoDebugRuleId, source: string): void {
    const rule = this.rules[ruleId];
    if (rule) {
      this.cooldowns.set(`${ruleId}:${source}`, Date.now() + rule.cooldownMs);
    }
  }

  /**
   * Handle process crash event.
   */
  private handleCrash(event: BusEvent, code: number): void {
    const processId = event.data.processId as string || 'unknown';
    if (this.isCooldown('crash', processId)) return;
    this.setCooldown('crash', processId);

    const message = `Process exited with code ${code}`;
    this.snapshotManager.add({
      ruleId: 'crash',
      ruleName: this.rules.crash.name,
      timestamp: new Date(event.timestamp).toISOString(),
      eventType: event.type,
      sourceName: processId,
      message,
      count: 1,
      errorGroups: this.getErrorGroups(),
      recentLogs: this.getRecentLogs(processId, 10),
      consoleErrors: [],
      networkFailures: [],
      suggestedFix: code !== null
        ? `Process exited with code ${code}. Check the process logs for error details. Common causes: uncaught exception, missing module, port already in use.`
        : 'Process crashed. Check stderr logs for details.',
    });
  }

  /**
   * Handle stderr error event.
   */
  private handleStderrError(event: BusEvent, line: string): void {
    const processId = event.data.processId as string || event.data.watcherId as string || 'unknown';
    if (this.isCooldown('error', processId)) return;
    this.setCooldown('error', processId);

    const message = line.slice(0, 200);
    this.snapshotManager.add({
      ruleId: 'error',
      ruleName: this.rules.error.name,
      timestamp: new Date(event.timestamp).toISOString(),
      eventType: event.type,
      sourceName: processId,
      message,
      count: 1,
      errorGroups: this.getErrorGroups(),
      recentLogs: this.getRecentLogs(processId, 10),
      consoleErrors: [],
      networkFailures: [],
      suggestedFix: 'Review the error in the process logs. Check for missing dependencies, configuration issues, or runtime errors.',
    });
  }

  /**
   * Handle browser console error event.
   */
  private handleBrowserError(event: BusEvent): void {
    const message = (event.data.message as string) || 'Unknown browser error';
    const source = event.data.source as string || 'unknown';
    const sessionId = event.data.sessionId as string || 'browser';

    // Dedup: use source + first 100 chars of message as key
    const dedupKey = `${source}:${message.slice(0, 100)}`;
    if (this.isCooldown('browser', dedupKey)) return;
    this.setCooldown('browser', dedupKey);

    this.snapshotManager.add({
      ruleId: 'browser',
      ruleName: this.rules.browser.name,
      timestamp: new Date(event.timestamp).toISOString(),
      eventType: event.type,
      sourceName: sessionId,
      message: message.slice(0, 200),
      count: 1,
      errorGroups: this.getErrorGroups(),
      recentLogs: [],
      consoleErrors: [message.slice(0, 200)],
      networkFailures: [],
      suggestedFix: 'Check the browser console for JavaScript errors. Common causes: undefined variables, network failures, DOM exceptions.',
    });
  }

  /**
   * Handle network error event (5xx).
   */
  private handleNetworkError(event: BusEvent, status: number): void {
    const url = (event.data.url as string) || 'unknown';
    const method = (event.data.method as string) || 'GET';
    const sessionId = event.data.sessionId as string || 'browser';

    const dedupKey = `${sessionId}:${url}:${status}`;
    if (this.isCooldown('browser', dedupKey)) return;
    this.setCooldown('browser', dedupKey);

    const message = `${method} ${url} returned ${status}`;
    this.snapshotManager.add({
      ruleId: 'browser',
      ruleName: this.rules.browser.name,
      timestamp: new Date(event.timestamp).toISOString(),
      eventType: event.type,
      sourceName: sessionId,
      message,
      count: 1,
      errorGroups: this.getErrorGroups(),
      recentLogs: [],
      consoleErrors: [],
      networkFailures: [`${method} ${url} → ${status}`],
      suggestedFix: status === 500
        ? 'Server error. Check the backend process logs for stack traces.'
        : status === 502 || status === 503
          ? 'Gateway error. The upstream service may be down or restarting.'
          : `Network error ${status}. Check API endpoint and server status.`,
    });
  }

  /**
   * Get correlated error groups from the global ErrorDedup.
   */
  private getErrorGroups(): Array<{ hash: string; message: string; count: number }> {
    try {
      const dedup = getErrorDedup();
      return dedup.getGroups().slice(0, 5).map((g) => ({
        hash: g.hash,
        message: g.message.slice(0, 100),
        count: g.count,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get recent log lines for a process.
   */
  private getRecentLogs(processId: string, maxLines: number): string[] {
    try {
      const logPath = logPathFor(processId);
      if (!existsSync(logPath)) return [];
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      return lines.slice(-maxLines);
    } catch {
      return [];
    }
  }

  // ── Rule Management ────────────────────────────────────────────

  /**
   * Enable or disable a rule.
   */
  setRuleEnabled(ruleId: AutoDebugRuleId, enabled: boolean): boolean {
    const rule = this.rules[ruleId];
    if (!rule) return false;
    rule.enabled = enabled;
    getLogger().info({ ruleId, enabled }, 'Auto-debug rule toggled');
    return true;
  }

  /**
   * Check if a rule is enabled.
   */
  isRuleEnabled(ruleId: AutoDebugRuleId): boolean {
    return this.rules[ruleId]?.enabled ?? false;
  }

  /**
   * List all rules with their status.
   */
  listRules(): AutoDebugRule[] {
    return Object.values(this.rules);
  }

  /**
   * Get stats for auto-debug engine.
   */
  getStats(): { totalSnapshots: number; enabledRules: number; rules: AutoDebugRule[] } {
    const rules = this.listRules();
    return {
      totalSnapshots: this.snapshotManager.count,
      enabledRules: rules.filter((r) => r.enabled).length,
      rules,
    };
  }
}

/** Singleton instance — lazy, created on first use. */
let _instance: AutoDebugEngine | null = null;

/**
 * Get the auto-debug engine singleton.
 * Pass eventBus on first call to create and start the engine.
 * Returns null if the engine was never started.
 */
export function getAutoDebugEngine(eventBus?: EventBus): AutoDebugEngine | null {
  if (!_instance && eventBus) {
    _instance = new AutoDebugEngine(eventBus);
    _instance.start();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing purposes). Stops the engine if running.
 */
export function resetAutoDebugEngine(): void {
  if (_instance) {
    _instance.stop();
    _instance = null;
  }
}

/**
 * Get the snapshot manager from the engine.
 * Returns null if the engine was never started.
 */
export function getSnapshotManager(): SnapshotManager | null {
  return _instance?.snapshots ?? null;
}
