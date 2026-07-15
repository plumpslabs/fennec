import { getLogger } from './logger.js';

export interface ToolCallMetric {
  toolName: string;
  category: string | undefined;
  durationMs: number;
  success: boolean;
  errorCode?: string;
  timestamp: number;
  sessionId?: string;
}

export interface InternalMetrics {
  totalToolCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgDurationMs: number;
  maxDurationMs: number;
  uptimeMs: number;
  memoryUsageMB: number;
  slowestTools: Array<{ toolName: string; avgDurationMs: number; callCount: number }>;
  errorRate: number;
}

/** A point-in-time snapshot for the time-series ring buffer. */
interface SnapshotPoint {
  timestamp: number;
  avgDurationMs: number;
  memoryUsageMB: number;
  errorRate: number;
  totalCalls: number;
}

export class PerformanceMetrics {
  private toolCalls: ToolCallMetric[] = [];
  private maxHistory = 1000;
  /** Server start timestamp. Public so diagnostic tools can report uptime. */
  readonly startTime: number = Date.now();
  private memorySnapshotInterval: ReturnType<typeof setInterval> | null = null;

  // ── Time-series ring buffer (for trend analysis) ─────────────
  /** Ring buffer of periodic snapshots (up to 120 = ~1 hour at 30s intervals). */
  private snapshotRing: SnapshotPoint[] = [];
  private maxSnapshots = 120;

  /**
   * Record a tool call metric.
   */
  recordToolCall(metric: ToolCallMetric): void {
    this.toolCalls.push(metric);
    if (this.toolCalls.length > this.maxHistory) {
      this.toolCalls = this.toolCalls.slice(-this.maxHistory);
    }
  }

  /**
   * Start periodic memory snapshots (for self-monitoring).
   */
  startMemoryMonitoring(intervalMs = 30000): void {
    if (this.memorySnapshotInterval) return;
    this.memorySnapshotInterval = setInterval(() => {
      this.recordSnapshot();
      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      getLogger().debug(
        { heapMB, rssMB, toolCalls: this.toolCalls.length },
        'PerformanceMetrics: self-monitoring snapshot',
      );
    }, intervalMs);
  }

  /**
   * Record a snapshot point into the ring buffer.
   */
  private recordSnapshot(): void {
    const metrics = this.getMetrics();
    this.snapshotRing.push({
      timestamp: Date.now(),
      avgDurationMs: metrics.avgDurationMs,
      memoryUsageMB: metrics.memoryUsageMB,
      errorRate: metrics.errorRate,
      totalCalls: metrics.totalToolCalls,
    });
    if (this.snapshotRing.length > this.maxSnapshots) {
      this.snapshotRing = this.snapshotRing.slice(-this.maxSnapshots);
    }
  }

  /**
   * Trend analysis: compare recent vs older snapshots.
   * Uses the last 10 snapshots (5 min at 30s intervals) vs the 10 before that.
   */
  analyzeTrend(): {
    direction: 'improving' | 'stable' | 'degrading' | 'insufficient_data';
    summary: string;
    durationMsTrend: number;
    memoryTrend: number;
    errorRateTrend: number;
  } {
    if (this.snapshotRing.length < 5) {
      return {
        direction: 'insufficient_data',
        summary: 'Not enough data points. Monitoring is active, collecting...',
        durationMsTrend: 0,
        memoryTrend: 0,
        errorRateTrend: 0,
      };
    }

    const recent = this.snapshotRing.slice(-10); // last ~5 min
    const older = this.snapshotRing.slice(-20, -10); // 5-10 min ago

    if (older.length === 0) {
      return {
        direction: 'insufficient_data',
        summary: 'Collecting baseline data...',
        durationMsTrend: 0,
        memoryTrend: 0,
        errorRateTrend: 0,
      };
    }

    const avgRecent = recent.reduce((s, p) => s + p.avgDurationMs, 0) / recent.length;
    const avgOlder = older.reduce((s, p) => s + p.avgDurationMs, 0) / older.length;
    const memRecent = recent.reduce((s, p) => s + p.memoryUsageMB, 0) / recent.length;
    const memOlder = older.reduce((s, p) => s + p.memoryUsageMB, 0) / older.length;
    const errRecent = recent.reduce((s, p) => s + p.errorRate, 0) / recent.length;
    const errOlder = older.reduce((s, p) => s + p.errorRate, 0) / older.length;

    const durationDelta = avgRecent - avgOlder;
    const memoryDelta = memRecent - memOlder;
    const errorDelta = errRecent - errOlder;

    // Determine direction: positive delta = worsening (more time, memory, errors)
    const worsening =
      (durationDelta > 10 ? 1 : 0) + (memoryDelta > 5 ? 1 : 0) + (errorDelta > 1 ? 1 : 0);
    const improving =
      (durationDelta < -10 ? 1 : 0) + (memoryDelta < -5 ? 1 : 0) + (errorDelta < -1 ? 1 : 0);

    let direction: 'improving' | 'stable' | 'degrading';
    if (worsening >= 2) direction = 'degrading';
    else if (improving >= 2) direction = 'improving';
    else direction = 'stable';

    const parts: string[] = [];
    if (Math.abs(durationDelta) > 5) parts.push(`avg duration ${durationDelta > 0 ? '+' : ''}${Math.round(durationDelta)}ms`);
    if (Math.abs(memoryDelta) > 2) parts.push(`heap ${memoryDelta > 0 ? '+' : ''}${Math.round(memoryDelta)}MB`);
    if (Math.abs(errorDelta) > 0.5) parts.push(`error rate ${errorDelta > 0 ? '+' : ''}${errorDelta.toFixed(1)}%`);

    return {
      direction,
      summary: parts.length > 0
        ? `${direction}: ${parts.join(', ')}`
        : `${direction}: no significant change`,
      durationMsTrend: Math.round(durationDelta * 10) / 10,
      memoryTrend: Math.round(memoryDelta * 10) / 10,
      errorRateTrend: Math.round(errorDelta * 10) / 10,
    };
  }

  /**
   * Get the raw time-series ring buffer (for diagnostic tools).
   */
  getTimeSeries(): SnapshotPoint[] {
    return [...this.snapshotRing];
  }

  /**
   * Stop memory monitoring.
   */
  stopMemoryMonitoring(): void {
    if (this.memorySnapshotInterval) {
      clearInterval(this.memorySnapshotInterval);
      this.memorySnapshotInterval = null;
    }
  }

  /**
   * Get aggregated internal metrics.
   */
  getMetrics(): InternalMetrics {
    const totalToolCalls = this.toolCalls.length;
    const successfulCalls = this.toolCalls.filter((t) => t.success).length;
    const failedCalls = totalToolCalls - successfulCalls;
    const totalDuration = this.toolCalls.reduce((sum, t) => sum + t.durationMs, 0);
    const avgDurationMs = totalToolCalls > 0 ? Math.round(totalDuration / totalToolCalls) : 0;
    const maxDurationMs =
      totalToolCalls > 0 ? Math.max(...this.toolCalls.map((t) => t.durationMs)) : 0;

    // Calculate per-tool averages for slowest tools
    const toolStats = new Map<string, { totalDuration: number; count: number }>();
    for (const call of this.toolCalls) {
      const existing = toolStats.get(call.toolName) ?? { totalDuration: 0, count: 0 };
      existing.totalDuration += call.durationMs;
      existing.count++;
      toolStats.set(call.toolName, existing);
    }

    const slowestTools = Array.from(toolStats.entries())
      .map(([toolName, stats]) => ({
        toolName,
        avgDurationMs: Math.round(stats.totalDuration / stats.count),
        callCount: stats.count,
      }))
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, 10);

    const mem = process.memoryUsage();
    const memoryUsageMB = Math.round(mem.heapUsed / 1024 / 1024);

    return {
      totalToolCalls,
      successfulCalls,
      failedCalls,
      avgDurationMs,
      maxDurationMs,
      uptimeMs: Date.now() - this.startTime,
      memoryUsageMB,
      slowestTools,
      errorRate: totalToolCalls > 0 ? Math.round((failedCalls / totalToolCalls) * 100) : 0,
    };
  }

  /**
   * Get recent tool calls for debugging.
   */
  getRecentCalls(limit = 20): ToolCallMetric[] {
    return this.toolCalls.slice(-limit);
  }

  /**
   * Clear all metrics (reset).
   */
  clear(): void {
    this.toolCalls = [];
    this.snapshotRing = [];
  }
}
