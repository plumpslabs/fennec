/**
 * Progress Reporter — allows long-running tools to report progress
 * back to the MCP client via progress notifications.
 *
 * Used by tools like:
 * - process_wait_for_ready
 * - mobile_screenshot
 * - network_wait_for_request
 * - browser_screenshot
 *
 * The MCP client sends a `progressToken` in the `_meta` field of a tool call.
 * Tools that receive a progress token can report progress via this reporter.
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface ProgressReporterOptions {
  /** MCP server instance for sending notifications */
  server?: Server;
  /** Progress token from client's _meta */
  progressToken?: string | number;
  /** Tool name being executed */
  toolName: string;
}

export interface ProgressReport {
  progress: number;
  total?: number;
  message?: string;
}

/**
 * Progress Reporter — lightweight utility for sending progress notifications.
 * If no server/progressToken is available, reports are silently dropped.
 */
export class ProgressReporter {
  private server?: Server;
  private progressToken?: string | number;
  private toolName: string;

  constructor(options: ProgressReporterOptions) {
    this.server = options.server;
    this.progressToken = options.progressToken;
    this.toolName = options.toolName;
  }

  /** Returns true if progress reporting is active */
  get isActive(): boolean {
    return !!this.server && !!this.progressToken;
  }

  /**
   * Report progress to the MCP client.
   * Silently no-ops if no progressToken was provided.
   */
  async report(report: ProgressReport): Promise<void> {
    if (!this.server || !this.progressToken) return;

    try {
      await this.server.notification({
        method: "notifications/progress",
        params: {
          progressToken: this.progressToken,
          progress: report.progress,
          total: report.total,
          message: report.message ?? `${this.toolName}: ${report.progress}${report.total ? `/${report.total}` : ""}`,
        },
      });
    } catch {
      // Progress notification is best-effort
    }
  }

  /**
   * Report incremental progress for iterable operations.
   * Convenience wrapper that auto-increments.
   */
  async reportStep(current: number, total: number, stepLabel?: string): Promise<void> {
    await this.report({
      progress: current,
      total,
      message: stepLabel
        ? `${this.toolName}: ${stepLabel} (${current}/${total})`
        : `${this.toolName}: step ${current}/${total}`,
    });
  }

  /**
   * Report completion (progress === total).
   */
  async complete(total: number, message?: string): Promise<void> {
    await this.report({
      progress: total,
      total,
      message: message ?? `${this.toolName}: complete`,
    });
  }
}
