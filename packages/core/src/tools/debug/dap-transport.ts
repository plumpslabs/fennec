/**
 * DAP Transport — JSON-RPC message transport for the Debug Adapter Protocol.
 *
 * Supports two modes:
 * - **TCP**: connect to a remote debug adapter (debugpy, dlv dap, rdbg)
 * - **Stdio**: spawn a local process and communicate via stdin/stdout (netcoredbg, lldb-dap)
 *
 * DAP uses a JSON-RPC-like protocol where each message is a JSON object
 * separated by newlines (TCP) or Content-Length headers (stdio).
 *
 * Cross-platform: Node.js `net` and `child_process` work on Linux, macOS, Windows.
 */
import { getLogger } from '../../utils/logger.js';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { connect } from 'net';

// ─── Types ───────────────────────────────────────────────────────

export type DAPTransportMode = 'tcp' | 'stdio';

export interface DAPMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  body?: any;
  message?: string;
  /** Additional fields like 'arguments' for requests */
  [key: string]: unknown;
}

export interface DAPTransportOptions {
  /** TCP host (default: 127.0.0.1) */
  host?: string;
  /** TCP port (required for tcp mode) */
  port?: number;
  /** Stdio: command to spawn */
  command?: string;
  /** Stdio: args array */
  args?: string[];
  /** Stdio: working directory */
  cwd?: string;
  /** Whether to auto-reconnect on disconnect */
  reconnect?: boolean;
  /** Max reconnect attempts */
  maxReconnectAttempts?: number;
}

// ─── DAP Transport ───────────────────────────────────────────────

export class DAPTransport {
  private mode: DAPTransportMode;
  private options: DAPTransportOptions;
  private socket: any = null; // net.Socket | ChildProcess stdio
  private childProcess: ChildProcess | null = null;
  private seqCounter = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (msg: DAPMessage) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private eventHandlers = new Map<string, Array<(msg: DAPMessage) => void>>();
  private buffer = '';
  private connected = false;
  private reconnectAttempts = 0;
  private timeoutMs: number;

  constructor(mode: DAPTransportMode, options: DAPTransportOptions, timeoutMs = 10000) {
    this.mode = mode;
    this.options = options;
    this.timeoutMs = timeoutMs;
  }

  /** Whether the transport is currently connected. */
  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Connect to the debug adapter (TCP) or spawn the process (stdio).
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.mode === 'tcp') {
      await this.connectTCP();
    } else {
      await this.connectStdio();
    }

    this.connected = true;
    this.reconnectAttempts = 0;
    getLogger().info({ mode: this.mode }, 'DAP transport connected');
  }

  /**
   * Connect via TCP socket.
   */
  private connectTCP(): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = this.options.port;
      const host = this.options.host ?? '127.0.0.1';

      if (!port) {
        reject(new Error('TCP port is required'));
        return;
      }

      const socket = connect(port, host, () => {
        this.socket = socket;
        resolve();
      });

      socket.on('data', (data: Buffer) => {
        this.handleData(data.toString('utf-8'));
      });

      socket.on('error', (err: Error) => {
        getLogger().error({ error: err.message }, 'DAP TCP transport error');
        this.handleDisconnect();
        reject(err);
      });

      socket.on('close', () => {
        this.handleDisconnect();
      });

      socket.setTimeout(this.timeoutMs);
      socket.on('timeout', () => {
        getLogger().warn('DAP TCP transport timeout');
        socket.destroy();
        this.handleDisconnect();
      });
    });
  }

  /**
   * Connect via stdio (child process).
   */
  private connectStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { command, args, cwd } = this.options;
      if (!command) {
        reject(new Error('Stdio command is required'));
        return;
      }

      const child = spawn(command, args ?? [], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.childProcess = child;

      child.stdout!.on('data', (data: Buffer) => {
        // Parse Content-Length framed JSON messages from stdout
        this.handleData(data.toString('utf-8'));
      });

      child.stderr!.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        // Log stderr but don't treat as error (debuggers may emit diagnostic info)
        getLogger().debug({ stderr: text.slice(0, 200) }, 'DAP adapter stderr');
      });

      child.on('error', (err: Error) => {
        getLogger().error({ error: err.message }, 'DAP stdio process error');
        this.handleDisconnect();
        reject(err);
      });

      child.on('exit', (code) => {
        getLogger().info({ code }, 'DAP stdio process exited');
        this.handleDisconnect();
      });

      // Give the process a moment to start
      setImmediate(() => resolve());
    });
  }

  /**
   * Handle incoming data, parsing newline-delimited JSON (TCP) or
   * Content-Length framed JSON (stdio).
   */
  private handleData(data: string): void {
    this.buffer += data;

    if (this.mode === 'tcp') {
      // TCP mode: messages are newline-delimited JSON
      const lines = this.buffer.split('\n');
      // Keep the last partial line in buffer (unless it's empty)
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg: DAPMessage = JSON.parse(trimmed);
          this.handleMessage(msg);
        } catch {
          getLogger().debug({ line: trimmed.slice(0, 100) }, 'DAP: failed to parse JSON');
        }
      }
    } else {
      // Stdio mode: Content-Length framing
      this.processStdioBuffer();
    }
  }

  /**
   * Process Content-Length framed messages from stdio buffer.
   */
  private processStdioBuffer(): void {
    while (this.buffer.length > 0) {
      const headerMatch = this.buffer.match(/Content-Length:\s*(\d+)\r?\n\r?\n/i);
      if (!headerMatch) break;

      const contentLength = parseInt(headerMatch[1]!, 10);
      const headerEnd = headerMatch.index! + headerMatch[0].length;
      const messageStart = headerEnd;

      if (this.buffer.length < messageStart + contentLength) break; // Wait for more data

      const jsonStr = this.buffer.slice(messageStart, messageStart + contentLength);
      this.buffer = this.buffer.slice(messageStart + contentLength);

      try {
        const msg: DAPMessage = JSON.parse(jsonStr);
        this.handleMessage(msg);
      } catch {
        getLogger().debug('DAP: failed to parse Content-Length framed message');
      }
    }
  }

  /**
   * Route a parsed DAP message to its handler.
   */
  private handleMessage(msg: DAPMessage): void {
    if (msg.type === 'response' && msg.request_seq !== undefined) {
      // Fulfill pending request
      const pending = this.pendingRequests.get(msg.request_seq);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.request_seq);
        pending.resolve(msg);
      }
    } else if (msg.type === 'event' && msg.event) {
      // Emit event
      const handlers = this.eventHandlers.get(msg.event);
      if (handlers) {
        for (const handler of handlers) {
          handler(msg);
        }
      }
      // Also emit generic handler
      const allHandlers = this.eventHandlers.get('*');
      if (allHandlers) {
        for (const handler of allHandlers) {
          handler(msg);
        }
      }
    }
    // Ignore request types (DAP server sends requests to the client)
  }

  /**
   * Send a DAP request and wait for the response.
   */
  async sendRequest(command: string, args?: Record<string, unknown>): Promise<DAPMessage> {
    if (!this.connected) {
      throw new Error('DAP transport not connected');
    }

    this.seqCounter++;
    const seq = this.seqCounter;

    const request: DAPMessage = {
      seq,
      type: 'request',
      command,
      arguments: args,
    };

    const raw = JSON.stringify(request);

    return new Promise<DAPMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(seq);
        reject(new Error(`DAP request "${command}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(seq, { resolve, reject, timer });

      try {
        this.write(raw);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(seq);
        reject(err);
      }
    });
  }

  /**
   * Write raw data to the transport.
   */
  private write(data: string): void {
    if (this.mode === 'tcp' && this.socket) {
      this.socket.write(data + '\n');
    } else if (this.mode === 'stdio' && this.childProcess?.stdin) {
      // DAP stdio uses Content-Length framing
      const header = `Content-Length: ${Buffer.byteLength(data, 'utf-8')}\r\n\r\n`;
      this.childProcess.stdin.write(header + data);
    } else {
      throw new Error('DAP transport not connected');
    }
  }

  /**
   * Register an event handler.
   */
  on(event: string, handler: (msg: DAPMessage) => void): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  /**
   * Remove an event handler.
   */
  off(event: string, handler: (msg: DAPMessage) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  /**
   * Handle disconnection (clean up + optionally reconnect).
   */
  private handleDisconnect(): void {
    this.connected = false;

    // Reject all pending requests
    for (const [seq, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('DAP transport disconnected'));
    }
    this.pendingRequests.clear();

    // Auto-reconnect?
    if (
      this.options.reconnect &&
      this.reconnectAttempts < (this.options.maxReconnectAttempts ?? 3)
    ) {
      this.reconnectAttempts++;
      getLogger().info({ attempt: this.reconnectAttempts }, 'DAP transport reconnecting...');
      setTimeout(() => this.connect().catch(() => {}), 1000 * this.reconnectAttempts);
    }
  }

  /**
   * Disconnect and clean up.
   */
  async disconnect(): Promise<void> {
    if (this.mode === 'tcp' && this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }

    this.connected = false;

    for (const [seq, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('DAP transport disconnected'));
    }
    this.pendingRequests.clear();
    this.eventHandlers.clear();
    this.buffer = '';
  }
}
