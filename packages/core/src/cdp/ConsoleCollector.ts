import type { BrowserCDPSession } from '../browser/types.js';
import type { ConsoleEvent } from '../session/types.js';
import { getLogger } from '../utils/logger.js';

type ConsoleCallback = (event: ConsoleEvent) => void;

export class ConsoleCollector {
  private listeners: Map<string, ConsoleCallback> = new Map();
  private enabled = false;
  private ignorePatterns: RegExp[] = [];

  async enable(
    cdpSession: BrowserCDPSession,
    options?: { ignorePatterns?: string[] },
  ): Promise<void> {
    if (options?.ignorePatterns?.length) {
      this.ignorePatterns = options.ignorePatterns.map((p) => {
        // Support /regex/ syntax, otherwise case-insensitive substring match.
        const m = p.match(/^\/(.*)\/([a-z]*)$/);
        if (m) return new RegExp(m[1]!, m[2] || 'i');
        return new RegExp(p, 'i');
      });
    }
    if (this.enabled) return;

    try {
      await cdpSession.send('Console.enable');
      await cdpSession.send('Runtime.enable');

      cdpSession.on('Console.messageAdded', (msg: unknown) => {
        this.handleConsoleEvent(
          msg as {
            message: {
              level: string;
              text: string;
              source: string;
              url?: string;
              line?: number;
              stackTrace?: {
                callFrames: Array<{
                  functionName: string;
                  url: string;
                  lineNumber: number;
                  columnNumber: number;
                }>;
              };
            };
          },
        );
      });

      cdpSession.on('Runtime.exceptionThrown', (msg: unknown) => {
        this.handleExceptionEvent(
          msg as {
            exceptionDetails: {
              text: string;
              url?: string;
              lineNumber?: number;
              stackTrace?: {
                callFrames: Array<{
                  functionName: string;
                  url: string;
                  lineNumber: number;
                  columnNumber: number;
                }>;
              };
            };
          },
        );
      });

      this.enabled = true;
    } catch (error) {
      getLogger().error({ error }, 'Failed to enable console collector');
    }
  }

  private handleConsoleEvent(msg: {
    message: {
      level: string;
      text: string;
      source: string;
      url?: string;
      line?: number;
      stackTrace?: {
        callFrames: Array<{
          functionName: string;
          url: string;
          lineNumber: number;
          columnNumber: number;
        }>;
      };
    };
  }): void {
    if (this.shouldIgnore(msg.message.text)) return;
    const event: ConsoleEvent = {
      level: msg.message.level as ConsoleEvent['level'],
      message: msg.message.text,
      source: msg.message.url ? `${msg.message.url}:${msg.message.line ?? 0}` : msg.message.source,
      timestamp: new Date().toISOString(),
    };

    if (msg.message.stackTrace?.callFrames) {
      event.stackTrace = msg.message.stackTrace.callFrames.map(
        (f) => `at ${f.functionName} (${f.url}:${f.lineNumber}:${f.columnNumber})`,
      );
    }

    this.emit(event);
  }

  private handleExceptionEvent(msg: {
    exceptionDetails: {
      text: string;
      url?: string;
      lineNumber?: number;
      stackTrace?: {
        callFrames: Array<{
          functionName: string;
          url: string;
          lineNumber: number;
          columnNumber: number;
        }>;
      };
    };
  }): void {
    if (this.shouldIgnore(msg.exceptionDetails.text)) return;
    const event: ConsoleEvent = {
      level: 'error',
      message: msg.exceptionDetails.text,
      source: msg.exceptionDetails.url ?? 'unknown',
      timestamp: new Date().toISOString(),
    };

    if (msg.exceptionDetails.stackTrace?.callFrames) {
      event.stackTrace = msg.exceptionDetails.stackTrace.callFrames.map(
        (f) => `at ${f.functionName} (${f.url}:${f.lineNumber}:${f.columnNumber})`,
      );
    }

    this.emit(event);
  }

  on(id: string, callback: ConsoleCallback): void {
    this.listeners.set(id, callback);
  }

  off(id: string): void {
    this.listeners.delete(id);
  }

  private shouldIgnore(message?: string): boolean {
    if (!message || this.ignorePatterns.length === 0) return false;
    return this.ignorePatterns.some((re) => re.test(message));
  }

  private emit(event: ConsoleEvent): void {
    for (const [, callback] of this.listeners) {
      try {
        callback(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
