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
              columnNumber?: number;
              stackTrace?: {
                callFrames: Array<{
                  functionName: string;
                  url: string;
                  lineNumber: number;
                  columnNumber: number;
                }>;
              };
              exception?: {
                type: string;
                subtype?: string;
                className?: string;
                description?: string;
                objectId?: string;
              };
            };
          },
        );
      });

      // Inject window.onerror to capture errors that CDP's Runtime.exceptionThrown
      // may miss (e.g. React production builds, cross-origin errors).
      await cdpSession.send('Runtime.evaluate', {
        expression: `
          try {
            window.__fennecOnerror = window.onerror;
            window.onerror = function(msg, url, line, col, error) {
              if (window.__fennecOnerror) window.__fennecOnerror(msg, url, line, col, error);
              var detail = error && error.stack ? error.stack : (String(msg) + ' at ' + url + ':' + line + ':' + col);
              console.error('[FENNEC]', detail);
              return true;
            };
          } catch(e) {}
        `,
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
      columnNumber?: number;
      stackTrace?: {
        callFrames: Array<{
          functionName: string;
          url: string;
          lineNumber: number;
          columnNumber: number;
        }>;
      };
      exception?: {
        type: string;
        subtype?: string;
        className?: string;
        description?: string;
        objectId?: string;
      };
    };
  }): void {
    // CDP's exceptionDetails.text is often just "Uncaught" — the actual
    // error message lives in exceptionDetails.exception.description.
    let message = msg.exceptionDetails.text ?? '';
    if (!message || message === 'Uncaught') {
      const ex = msg.exceptionDetails.exception;
      if (ex?.description) {
        message = ex.description;
      } else if (ex?.className) {
        message = `${ex.className}`;
      }
    }
    if (this.shouldIgnore(message)) return;

    const event: ConsoleEvent = {
      level: 'error',
      message,
      source: msg.exceptionDetails.url
        ? `${msg.exceptionDetails.url}:${msg.exceptionDetails.lineNumber ?? 0}:${msg.exceptionDetails.columnNumber ?? 0}`
        : 'unknown',
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
