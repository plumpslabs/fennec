import { watch, type FSWatcher } from "node:fs";
import { readFileSync, existsSync, statSync } from "node:fs";
import { getLogger } from "../utils/logger.js";
import { detectLogLevel, type LogLevel } from "../utils/levelDetector.js";

export interface WatcherLogEntry {
  line: string;
  level: LogLevel;
  timestamp: string;
  source: string;
}

export class LogWatcher {
  private watchers: Map<string, { watcher: FSWatcher; name: string; buffer: WatcherLogEntry[]; filePath: string; fileSize: number }> = new Map();
  private maxLines: number;

  constructor(maxLines = 2000) {
    this.maxLines = maxLines;
  }

  watchFile(filePath: string, name?: string): string {
    const resolvedPath = filePath;
    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const watcherId = name ?? `watch_${Date.now()}`;

    const fileSize = statSync(resolvedPath).size;

    const watcher: FSWatcher = watch(resolvedPath, (eventType) => {
      if (eventType === "change") {
        try {
          const currentSize = statSync(resolvedPath).size;
          const entry = this.watchers.get(watcherId);
          if (!entry) return;

          if (currentSize > entry.fileSize) {
            const fd = readFileSync(resolvedPath, "utf-8");
            const newContent = fd.slice(entry.fileSize);
            const lines = newContent.split("\n").filter((l) => l.trim());

            for (const line of lines) {
              const level = detectLogLevel(line);
              entry.buffer.push({
                line,
                level,
                timestamp: new Date().toISOString(),
                source: resolvedPath,
              });
              if (entry.buffer.length > this.maxLines) {
                entry.buffer.shift();
              }
            }

            entry.fileSize = currentSize;
          }
        } catch {
          // File might be rotated or deleted
        }
      }
    });

    this.watchers.set(watcherId, {
      watcher,
      name: watcherId,
      buffer: [],
      filePath: resolvedPath,
      fileSize,
    });

    getLogger().info({ watcherId, filePath }, "Log watcher started");
    return watcherId;
  }

  getLogs(watcherId: string, options?: { lines?: number; level?: LogLevel; since?: string; keyword?: string }): WatcherLogEntry[] {
    const entry = this.watchers.get(watcherId);
    if (!entry) {
      throw new Error(`Watcher not found: ${watcherId}`);
    }

    let logs = entry.buffer;

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

  getErrors(watcherId: string, since?: string): WatcherLogEntry[] {
    return this.getLogs(watcherId, { level: "error", since });
  }

  stop(watcherId: string): boolean {
    const entry = this.watchers.get(watcherId);
    if (!entry) return false;

    entry.watcher.close();
    this.watchers.delete(watcherId);
    getLogger().info({ watcherId }, "Log watcher stopped");
    return true;
  }

  list(): Array<{ id: string; name: string; filePath: string; logCount: number }> {
    return Array.from(this.watchers.entries()).map(([id, entry]) => ({
      id,
      name: entry.name,
      filePath: entry.filePath,
      logCount: entry.buffer.length,
    }));
  }

  clearBuffer(watcherId: string): number {
    const entry = this.watchers.get(watcherId);
    if (!entry) return 0;
    const count = entry.buffer.length;
    entry.buffer = [];
    return count;
  }

  cleanup(): void {
    for (const [id] of this.watchers) {
      this.stop(id);
    }
  }
}
