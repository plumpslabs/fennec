/**
 * PHP DBGp Adapter — Translator between Xdebug's DBGp protocol and DebugAdapter.
 *
 * Xdebug uses the DBGp protocol (XML over TCP):
 * - Connects on port 9003 (default for Xdebug 3)
 * - Commands: breakpoint_set, breakpoint_remove, run, step_over,
 *   step_into, step_out, stack_get, context_get, eval, property_get
 * - Responses are XML with `<response command="..." ...>`
 *
 * This adapter:
 * - Opens a TCP socket to Xdebug's DBGp listener
 * - Translates DBGp XML responses to the DebugAdapter interface
 * - Emits PausedEvent when Xdebug sends a breakpoint notification
 *
 * Cross-platform: TCP sockets work on Linux, macOS, Windows.
 */
import { getLogger } from '../../utils/logger.js';
import { connect } from 'net';
import type {
  DebugAdapter,
  RuntimeType,
  BreakpointResult,
  PausedEvent,
  CallFrame,
  EvaluateResult,
  PropertiesResult,
} from './adapter-types.js';

// ─── Types ───────────────────────────────────────────────────────

export interface DBGpConfig {
  /** Xdebug host (default: 127.0.0.1) */
  host?: string;
  /** Xdebug port (default: 9003 for Xdebug 3) */
  port?: number;
  /** IDE key (for multi-session) */
  ideKey?: string;
}

// ─── DBGp Adapter ────────────────────────────────────────────────

export class DBGpAdapter implements DebugAdapter {
  readonly runtime: RuntimeType = 'php';
  private host: string;
  private port: number;
  private socket: any = null;
  private buffer = '';
  private enabled = false;
  private transactionId = 0;
  private _pausedHandler: ((event: PausedEvent) => void) | null = null;
  private _resumedHandler: (() => void) | null = null;
  private _scriptParsedHandler: ((script: any) => void) | null = null;
  private pendingCommands = new Map<
    number,
    { resolve: (xml: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private loadedFiles: string[] = [];

  constructor(config: DBGpConfig = {}) {
    this.host = config.host ?? '127.0.0.1';
    this.port = config.port ?? 9003;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable: connect to Xdebug's DBGp socket.
   * Xdebug connects TO the IDE (Fennec), so we wait for incoming connection.
   * However, for simplicity, we connect to Xdebug's proxy mode.
   */
  async enable(): Promise<string> {
    if (this.enabled) return 'dbgp_connected';

    return new Promise((resolve, reject) => {
      const socket = connect(this.port, this.host, () => {
        this.socket = socket;
        this.enabled = true;

        // Xdebug sends an init packet on connect
        // We wait for it
      });

      socket.on('data', (data: Buffer) => {
        this.handleData(data.toString('utf-8'));
      });

      let initTimer: NodeJS.Timeout | null = null;

      socket.on('error', (err: Error) => {
        if (initTimer) clearTimeout(initTimer);
        getLogger().error({ error: err.message }, 'DBGp socket error');
        this.handleDisconnect();
        reject(err);
      });

      socket.on('close', () => {
        this.handleDisconnect();
      });

      // Set timeout for init packet
      initTimer = setTimeout(async () => {
        try {
          await this.sendCommand('status');
          this.enabled = true;
          getLogger().info('DBGp adapter enabled (PHP Xdebug)');
          resolve('dbgp_connected');
        } catch (err) {
          reject(err);
        }
      }, 500);
    });
  }

  /**
   * Handle incoming DBGp XML data.
   * Messages are null-byte (`\0`) terminated.
   */
  private handleData(data: string): void {
    this.buffer += data;

    // DBGp messages are null-byte terminated
    const nullPos = this.buffer.indexOf('\0');
    if (nullPos >= 0) {
      const xml = this.buffer.slice(0, nullPos);
      this.buffer = this.buffer.slice(nullPos + 1);
      this.handleMessage(xml);
    }
  }

  /**
   * Handle a parsed DBGp XML response.
   */
  private handleMessage(xml: string): void {
    const trimmed = xml.trim();
    if (!trimmed) return;

    // Parse basic XML to get command and attributes
    const commandMatch = trimmed.match(/<response\s+command="([^"]+)"/);

    if (!commandMatch) {
      getLogger().debug({ xml: trimmed.slice(0, 200) }, 'DBGp: unexpected message');
      return;
    }

    const command = commandMatch[1]!;

    // Check for transaction ID
    const txnMatch = trimmed.match(/transaction_id="(\d+)"/);
    const txnId = txnMatch ? parseInt(txnMatch[1]!, 10) : -1;

    // Check for breakpoint notification
    if (
      command === 'run' ||
      command === 'step_into' ||
      command === 'step_over' ||
      command === 'step_out'
    ) {
      // These are responses to execution commands
      // Xdebug also sends an async notification when breakpoint is hit
    }

    // Check if this is a breakpoint notification (Xdebug sends it as a separate message)
    if (command === 'breakpoint_resolved') {
      // Breakpoint was resolved — fire scriptParsed-like event
      const bpMatch = trimmed.match(/filename="([^"]+)"/);
      if (bpMatch && this._scriptParsedHandler) {
        this._scriptParsedHandler({
          url: bpMatch[1]!,
          scriptId: bpMatch[1]!,
        });
      }
    }

    // Fulfill pending command
    if (txnId >= 0) {
      const pending = this.pendingCommands.get(txnId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCommands.delete(txnId);
        pending.resolve(trimmed);
      }
    }

    // Check if execution stopped (breakpoint hit or step complete)
    if (command === 'status' && trimmed.includes('status="break"')) {
      this.emitPausedEvent(trimmed);
    }
  }

  /**
   * Emit a paused event when Xdebug hits a breakpoint.
   */
  private async emitPausedEvent(xml: string): Promise<void> {
    if (!this._pausedHandler) return;

    // Parse breakpoint info from XML
    const reason: string = xml.includes('interactive="true"') ? 'step' : 'breakpoint';
    const hitBreakpoints: string[] = [];

    // Parse reason from status XML
    const reasonMatch = xml.match(/reason="([^"]+)"/);
    const parsedReason = reasonMatch ? reasonMatch[1]! : reason;

    try {
      // Fetch stack trace
      const stackXml = await this.sendCommand('stack_get', '-d 0 -m 20');
      const frames = this.parseStackFrames(stackXml);

      const pausedEvent: PausedEvent = {
        callFrames: frames,
        reason: parsedReason,
        hitBreakpoints: hitBreakpoints.length > 0 ? hitBreakpoints : undefined,
      };

      this._pausedHandler(pausedEvent);
    } catch (error) {
      getLogger().warn({ error }, 'Failed to fetch PHP stack trace after breakpoint');
      this._pausedHandler({
        callFrames: [],
        reason: parsedReason,
      });
    }
  }

  /**
   * Parse DBGp stack_get response into CallFrame array.
   */
  private parseStackFrames(xml: string): CallFrame[] {
    const frames: CallFrame[] = [];
    const stackRegex = /<stack[^>]*?>/g;
    let match;

    while ((match = stackRegex.exec(xml)) !== null) {
      const frameXml = match[0];

      const levelMatch = frameXml.match(/level="(\d+)"/);
      const fileMatch = frameXml.match(/filename="([^"]+)"/);
      const lineMatch = frameXml.match(/lineno="(\d+)"/);
      const whereMatch = frameXml.match(/where="([^"]+)"/);

      const level = levelMatch ? parseInt(levelMatch[1]!, 10) : 0;
      const file = fileMatch ? fileMatch[1]! : 'unknown.php';
      const line = lineMatch ? parseInt(lineMatch[1]!, 10) - 1 : 0; // DBGp is 1-based
      const funcName = whereMatch ? whereMatch[1]! : '<global>';

      frames.push({
        callFrameId: `php_frame_${level}`,
        functionName: funcName,
        url: file,
        lineNumber: line,
        columnNumber: 0,
        scopeChain: [
          {
            type: 'local',
            object: {
              type: 'object',
              objectId: `php_vars:${level}`,
              description: `Local variables (level ${level})`,
            },
            name: 'Local',
          },
        ],
        this: { type: 'undefined' },
      });

      // Track loaded files
      if (file && !this.loadedFiles.includes(file)) {
        this.loadedFiles.push(file);
      }
    }

    return frames;
  }

  // ── Send DBGp Command ──────────────────────────────────────────

  /**
   * Send a DBGp command and wait for the XML response.
   */
  private sendCommand(command: string, args = ''): Promise<string> {
    return new Promise((resolve, reject) => {
      this.transactionId++;

      const cmd = `${command} -i ${this.transactionId}${args ? ` ${args}` : ''}\0`;
      const txnId = this.transactionId;

      const timer = setTimeout(() => {
        this.pendingCommands.delete(txnId);
        reject(new Error(`DBGp command "${command}" timed out`));
      }, 10000);

      this.pendingCommands.set(txnId, { resolve, reject, timer });

      if (this.socket) {
        this.socket.write(cmd);
      } else {
        clearTimeout(timer);
        this.pendingCommands.delete(txnId);
        reject(new Error('DBGp socket not connected'));
      }
    });
  }

  // ── Handle Disconnect ──────────────────────────────────────────

  private handleDisconnect(): void {
    this.enabled = false;

    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('DBGp connection lost'));
    }
    this.pendingCommands.clear();
  }

  // ── DebugAdapter Interface Implementation ──────────────────────

  async disable(): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.sendCommand('stop');
    } catch {
      // Best-effort
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.enabled = false;
    this._pausedHandler = null;
    this._resumedHandler = null;
    this._scriptParsedHandler = null;
    this.loadedFiles = [];
    getLogger().info('DBGp adapter disabled');
  }

  async setBreakpointByUrl(
    file: string,
    line: number,
    options?: { column?: number; condition?: string },
  ): Promise<BreakpointResult> {
    if (!this.enabled) throw new Error('DBGp adapter not enabled');

    let args = `-t line -f ${file} -n ${line + 1}`; // DBGp is 1-based
    if (options?.condition) {
      args += ` -- ${options.condition}`;
    }

    const xml = await this.sendCommand('breakpoint_set', args);

    // Parse response: <response command="breakpoint_set" transaction_id="1" id="12345"/>
    const idMatch = xml.match(/id="(\d+)"/);
    const bpId = idMatch ? idMatch[1]! : `php_bp_${Date.now()}`;

    return {
      breakpointId: `php_bp_${bpId}`,
      locations: [{ scriptId: file, lineNumber: line, columnNumber: 0 }],
    };
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    if (!this.enabled) return;

    const dbgId = breakpointId.replace('php_bp_', '');
    try {
      await this.sendCommand('breakpoint_remove', `-d ${dbgId}`);
    } catch {
      // Best-effort
    }
  }

  async resume(): Promise<void> {
    if (!this.enabled) throw new Error('DBGp adapter not enabled');
    await this.sendCommand('run');
  }

  async stepOver(): Promise<void> {
    if (!this.enabled) throw new Error('DBGp adapter not enabled');
    await this.sendCommand('step_over');
  }

  async stepInto(): Promise<void> {
    if (!this.enabled) throw new Error('DBGp adapter not enabled');
    await this.sendCommand('step_into');
  }

  async stepOut(): Promise<void> {
    if (!this.enabled) throw new Error('DBGp adapter not enabled');
    await this.sendCommand('step_out');
  }

  async evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
    _options?: { returnByValue?: boolean; generatePreview?: boolean },
  ): Promise<EvaluateResult> {
    if (!this.enabled) throw new Error('DBGp adapter not enabled');

    const level = callFrameId.replace('php_frame_', '');
    const xml = await this.sendCommand('eval', `-- ${Buffer.from(expression).toString('base64')}`);

    // Parse result: <response command="eval" ...><property ... value="..."/></response>
    const success = xml.includes('success="1"');
    const valueMatch = xml.match(/><property[^>]*>/);
    const errorMatch = xml.match(new RegExp('/?><error[^>]*>(.*?)</error>', 's'));

    if (!success || errorMatch) {
      return {
        result: { type: 'undefined' },
        exceptionDetails: {
          text: errorMatch?.[1]?.replace(/<[^>]+>/g, '') ?? 'Evaluation failed',
        },
      };
    }

    // Parse the property value
    let displayValue = '';
    const valueAttr =
      xml.match(/encoding="base64".*?>([^<]+)/) || xml.match(new RegExp('>([^<]+)</property>'));
    if (valueAttr) {
      try {
        displayValue = Buffer.from(valueAttr[1]!, 'base64').toString('utf-8');
      } catch {
        displayValue = valueAttr[1]!;
      }
    }

    return {
      result: {
        type: 'string',
        value: displayValue,
        description: displayValue,
      },
    };
  }

  async getProperties(
    objectId: string,
    _options?: { ownProperties?: boolean; generatePreview?: boolean },
  ): Promise<PropertiesResult> {
    if (!this.enabled) return { result: [] };

    const levelMatch = objectId.match(/^php_vars:(\d+)$/);
    if (!levelMatch) return { result: [] };

    const level = levelMatch[1]!;
    const xml = await this.sendCommand('context_get', `-d ${level}`);

    // Parse properties from XML
    const props: Array<{ name: string; value: string; type: string }> = [];
    const propRegex = new RegExp(
      '<property[^>]*fullname="([^"]*)"[^>]*type="([^"]*)"[^>]*(?:>(?:([^<]*)|<!\[CDATA\[(.*?)\]\]>)?)</property>',
      'gs',
    );
    let match;

    while ((match = propRegex.exec(xml)) !== null) {
      const name = match[1]!;
      const type = match[2]!;
      let value = match[3] ?? match[4] ?? '';

      // Try base64 decoding for complex values
      if (!value && xml.includes('encoding="base64"')) {
        const b64Match = xml.match(
          new RegExp(`fullname="${name}"[^>]*encoding="base64"[^>]*>([^<]+)`),
        );
        if (b64Match) {
          try {
            value = Buffer.from(b64Match[1]!, 'base64').toString('utf-8');
          } catch {
            value = b64Match[1]!;
          }
        }
      }

      props.push({ name, value, type });
    }

    return {
      result: props.map((p) => ({
        name: p.name,
        value: {
          type: p.type,
          value: p.value,
          description: p.value || `(${p.type})`,
        },
        writable: false,
        configurable: false,
        enumerable: true,
        isOwn: true,
      })),
    };
  }

  // ── Event Handlers ─────────────────────────────────────────────

  onPaused(handler: (event: PausedEvent) => void): void {
    this._pausedHandler = handler;
  }

  onResumed(handler: () => void): void {
    this._resumedHandler = handler;
  }

  onScriptParsed(handler: (script: any) => void): void {
    this._scriptParsedHandler = handler;
  }
}
