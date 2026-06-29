import { randomUUID } from "node:crypto";

export interface RecordedAction {
  id: string;
  type: "navigate" | "click" | "type" | "select" | "scroll" | "screenshot" | "wait" | "evaluate" | "custom";
  description: string;
  params: Record<string, unknown>;
  timestamp: number;
  url: string;
  duration: number;
  screenshotBefore?: string;
  screenshotAfter?: string;
  consoleSnapshot?: string[];
  networkSnapshot?: string[];
  result?: unknown;
  error?: string;
}

export interface Recording {
  id: string;
  name: string;
  startedAt: string;
  completedAt?: string;
  actions: RecordedAction[];
  metadata: {
    url?: string;
    viewport?: { width: number; height: number };
    userAgent?: string;
    tags: string[];
  };
}

export interface ReplayResult {
  recordingId: string;
  startedAt: string;
  completedAt: string;
  totalActions: number;
  succeeded: number;
  failed: number;
  skipped: number;
  actions: Array<{
    actionId: string;
    status: "success" | "failed" | "skipped";
    duration: number;
    error?: string;
    difference?: number; // similarity score 0-1 for screenshot comparison
  }>;
  successRate: number;
}

type ActionExecutor = (action: RecordedAction) => Promise<unknown>;

export class Recorder {
  private recordings: Map<string, Recording> = new Map();
  private currentRecording: Recording | null = null;
  private recordingHistory: RecordedAction[] = [];
  private maxHistory = 1000;

  /**
   * Start a new recording session.
   */
  startRecording(name = ""): string {
    const id = `rec_${randomUUID().slice(0, 8)}`;
    this.currentRecording = {
      id,
      name: name || `Recording ${new Date().toLocaleTimeString()}`,
      startedAt: new Date().toISOString(),
      actions: [],
      metadata: { tags: [] },
    };
    this.recordingHistory = [];
    return id;
  }

  /**
   * Stop the current recording.
   */
  stopRecording(): Recording | null {
    if (!this.currentRecording) return null;

    this.currentRecording.completedAt = new Date().toISOString();
    this.currentRecording.actions = [...this.recordingHistory];
    this.recordings.set(this.currentRecording.id, this.currentRecording);

    const recording = this.currentRecording;
    this.currentRecording = null;
    this.recordingHistory = [];

    return recording;
  }

  /**
   * Record an action.
   */
  recordAction(
    type: RecordedAction["type"],
    description: string,
    params: Record<string, unknown>,
    context: {
      url: string;
      duration: number;
      consoleLogs?: string[];
      networkLogs?: string[];
    },
  ): RecordedAction {
    const action: RecordedAction = {
      id: `act_${randomUUID().slice(0, 8)}`,
      type,
      description,
      params,
      timestamp: Date.now(),
      url: context.url,
      duration: context.duration,
      consoleSnapshot: context.consoleLogs?.slice(-10),
      networkSnapshot: context.networkLogs?.slice(-10),
    };

    this.recordingHistory.push(action);

    // Also update current recording's actions for live access
    if (this.currentRecording) {
      this.currentRecording.actions.push(action);
      if (this.currentRecording.actions.length > this.maxHistory) {
        this.currentRecording.actions = this.currentRecording.actions.slice(-this.maxHistory);
      }
    }

    // Trim history
    if (this.recordingHistory.length > this.maxHistory) {
      this.recordingHistory = this.recordingHistory.slice(-this.maxHistory);
    }

    return action;
  }

  /**
   * Update the last recorded action with result info.
   */
  updateLastAction(result?: unknown, error?: string): void {
    const lastAction = this.recordingHistory[this.recordingHistory.length - 1];
    if (lastAction) {
      lastAction.result = result;
      lastAction.error = error;
    }
  }

  /**
   * Get the current recording state.
   */
  getCurrentRecording(): Recording | null {
    return this.currentRecording;
  }

  /**
   * Get a recording by ID.
   */
  getRecording(id: string): Recording | undefined {
    return this.recordings.get(id);
  }

  /**
   * List all recordings.
   */
  listRecordings(): Recording[] {
    return Array.from(this.recordings.values());
  }

  /**
   * Delete a recording.
   */
  deleteRecording(id: string): boolean {
    return this.recordings.delete(id);
  }

  /**
   * Replay a recorded session.
   */
  async replay(
    recordingId: string,
    executor: ActionExecutor,
    options?: {
      speed?: number; // 1 = normal speed, 2 = 2x, etc.
      pauseOnError?: boolean;
      skipActions?: string[]; // IDs of actions to skip
    },
  ): Promise<ReplayResult> {
    const recording = this.recordings.get(recordingId);
    if (!recording) throw new Error(`Recording not found: ${recordingId}`);

    const result: ReplayResult = {
      recordingId,
      startedAt: new Date().toISOString(),
      completedAt: "",
      totalActions: recording.actions.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      actions: [],
      successRate: 0,
    };

    for (const action of recording.actions) {
      // Check if action should be skipped
      if (options?.skipActions?.includes(action.id)) {
        result.skipped++;
        result.actions.push({
          actionId: action.id,
          status: "skipped",
          duration: 0,
        });
        continue;
      }

      const actionStart = Date.now();

      try {
        const actionResult = await executor(action);
        const duration = Date.now() - actionStart;

        // Apply speed multiplier: wait for the remaining time
        const originalDuration = action.duration;
        if (options?.speed && options.speed > 1 && duration < originalDuration) {
          const waitTime = (originalDuration - duration) / options.speed;
          if (waitTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }

        result.succeeded++;
        result.actions.push({
          actionId: action.id,
          status: "success",
          duration: Date.now() - actionStart,
        });
      } catch (error) {
        const duration = Date.now() - actionStart;
        result.failed++;
        result.actions.push({
          actionId: action.id,
          status: "failed",
          duration,
          error: String(error),
        });

        if (options?.pauseOnError) {
          break;
        }
      }
    }

    result.completedAt = new Date().toISOString();
    result.successRate =
      result.totalActions > 0
        ? Math.round((result.succeeded / result.totalActions) * 100)
        : 0;

    return result;
  }

  /**
   * Export a recording as JSON.
   */
  exportRecording(id: string): string | null {
    const recording = this.recordings.get(id);
    if (!recording) return null;
    return JSON.stringify(recording, null, 2);
  }

  /**
   * Import a recording from JSON.
   */
  importRecording(json: string): Recording {
    const recording = JSON.parse(json) as Recording;
    this.recordings.set(recording.id, recording);
    return recording;
  }
}
