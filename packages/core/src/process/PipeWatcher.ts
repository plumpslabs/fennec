import { getLogger } from '../utils/logger.js';
import { detectLogLevel, type LogLevel } from '../utils/levelDetector.js';

export interface PipeEntry {
  line: string;
  level: LogLevel;
  timestamp: string;
}

export class PipeWatcher {
  private buffers: Map<string, PipeEntry[]> = new Map();
  private maxLines: number;

  constructor(maxLines = 2000) {
    this.maxLines = maxLines;
  }

  createPipe(name: string): { pipeId: string; write: (data: string) => void } {
    const pipeId = name;
    this.buffers.set(pipeId, []);

    const write = (data: string): void => {
      const buffer = this.buffers.get(pipeId);
      if (!buffer) return;

      const lines = data.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const level = detectLogLevel(line);
        buffer.push({ line, level, timestamp: new Date().toISOString() });
        if (buffer.length > this.maxLines) {
          buffer.shift();
        }
      }
    };

    return { pipeId, write };
  }

  getLogs(
    pipeId: string,
    options?: { lines?: number; level?: LogLevel; since?: string; keyword?: string },
  ): PipeEntry[] {
    const buffer = this.buffers.get(pipeId);
    if (!buffer) return [];

    let logs = buffer;

    if (options?.level) {
      logs = logs.filter((l) => l.level === options.level);
    }
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      logs = logs.filter((l) => new Date(l.timestamp).getTime() > sinceTime);
    }
    if (options?.keyword) {
      const kw = options.keyword.toLowerCase();
      logs = logs.filter((l) => l.line.toLowerCase().includes(kw));
    }
    if (options?.lines && options.lines > 0) {
      logs = logs.slice(-options.lines);
    }

    return logs;
  }

  list(): Array<{ pipeId: string; count: number }> {
    return Array.from(this.buffers.entries()).map(([pipeId, buffer]) => ({
      pipeId,
      count: buffer.length,
    }));
  }

  clear(pipeId: string): number {
    const buffer = this.buffers.get(pipeId);
    if (!buffer) return 0;
    const count = buffer.length;
    this.buffers.set(pipeId, []);
    return count;
  }

  cleanup(): void {
    this.buffers.clear();
  }
}
