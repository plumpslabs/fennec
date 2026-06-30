import { getLogger } from "./logger.js";

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

export class PerformanceMetrics {
  private toolCalls: ToolCallMetric[] = [];
  private maxHistory = 1000;
  private startTime: number = Date.now();
  private memorySnapshotInterval: ReturnType<typeof setInterval> | null = null;

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
      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      getLogger().debug(
        { heapMB, rssMB, toolCalls: this.toolCalls.length },
        "PerformanceMetrics: self-monitoring snapshot",
      );
    }, intervalMs);
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
    const maxDurationMs = totalToolCalls > 0 ? Math.max(...this.toolCalls.map((t) => t.durationMs)) : 0;

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
    this.startTime = Date.now();
  }
}
