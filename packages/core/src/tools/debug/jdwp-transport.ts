/**
 * JDWP Transport — Binary packet encoding/decoding for the Java Debug Wire Protocol.
 *
 * JDWP is a binary protocol over TCP. Packets have a fixed 11-byte header
 * (or 11+2 for replies) followed by variable-length data.
 *
 * Handshake: "JDWP-Handshake" (14 bytes) sent by the debugger.
 *
 * Packet format:
 *   length:  int32 (4 bytes, big-endian) — total packet size including header
 *   id:      int32 (4 bytes, big-endian) — unique request identifier
 *   flags:   byte  (1 byte) — 0x00=command, 0x80=reply
 *   [cmdSet]: byte  (1 byte) — command set ID (only for commands)
 *   [cmd]:    byte  (1 byte) — command ID (only for commands)
 *   [errCode]: int16 (2 bytes) — error code (only for replies, 0=success)
 *   data:    variable — depends on command
 *
 * Command Sets:
 *   1  = VirtualMachine
 *   2  = ReferenceType
 *   3  = ClassType
 *   4  = ArrayType
 *   5  = InterfaceType
 *   6  = Method (actually this is part of ReferenceType)
 *   9  = ObjectReference
 *   10 = StringReference
 *   11 = ThreadReference
 *   12 = ThreadGroupReference
 *   13 = ArrayReference
 *   14 = ClassLoaderReference
 *   15 = EventRequest
 *   16 = StackFrame
 *   17 = ClassObjectReference
 *   64 = Event (VM → Debugger, composite events)
 *
 * Cross-platform: Node.js `net` module works on Linux, macOS, Windows.
 */
import { getLogger } from '../../utils/logger.js';
import { connect } from 'net';

// ─── Handshake ───────────────────────────────────────────────────

const JDWP_HANDSHAKE = Buffer.from('JDWP-Handshake', 'utf-8');

// ─── Command Set & Command IDs ───────────────────────────────────

export const JDWP_CMDSET = {
  VIRTUAL_MACHINE: 1,
  REFERENCE_TYPE: 2,
  CLASS_TYPE: 3,
  ARRAY_TYPE: 4,
  OBJECT_REFERENCE: 9,
  STRING_REFERENCE: 10,
  THREAD_REFERENCE: 11,
  EVENT_REQUEST: 15,
  STACK_FRAME: 16,
  EVENT: 64, // Composite events (VM → Debugger)
} as const;

export const JDWP_VM = {
  VERSION: 1,
  CLASSES_BY_SIGNATURE: 2,
  ALL_CLASSES: 3,
  ALL_THREADS: 4,
  ID_SIZES: 7,
  SUSPEND: 8,
  RESUME: 9,
  EXIT: 10,
  CREATE_STRING: 11,
  ALL_CLASSES_WITH_GENERIC: 20,
} as const;

export const JDWP_REF = {
  SIGNATURE: 1,
  CLASS_LOADER: 2,
  MODIFIERS: 3,
  FIELDS: 4,
  METHODS: 5,
  GET_VALUES: 6,
  SOURCE_FILE: 7,
  NESTED_TYPES: 8,
  STATUS: 9,
  INTERFACES: 10,
  CLASS_OBJECT: 11,
  SOURCE_DEBUG_EXTENSION: 12,
  SIGNATURE_WITH_GENERIC: 13,
  FIELDS_WITH_GENERIC: 14,
  METHODS_WITH_GENERIC: 15,
  INSTANCES: 16,
  CLASS_FILE_VERSION: 17,
  CONSTANT_POOL: 18,
} as const;

export const JDWP_REF_TYPE_CMD = {
  // ReferenceType.Methods is 5
  METHODS: 5,
  SOURCE_FILE: 6,
};

export const JDWP_METHOD = {
  LINE_TABLE: 1,
  VARIABLE_TABLE: 2,
  VARIABLE_TABLE_WITH_GENERIC: 3,
  // Actually this is ReferenceType command, not a separate command set
};

export const JDWP_THREAD = {
  NAME: 1,
  SUSPEND: 2,
  RESUME: 3,
  STATUS: 4,
  THREAD_GROUP: 5,
  FRAMES: 6,
  FRAME_COUNT: 7,
  OWNED_MONITORS: 8,
  CURRENT_CONTENDED_MONITOR: 9,
  STOP: 10,
  INTERRUPT: 11,
  SUSPEND_COUNT: 12,
} as const;

export const JDWP_STACK_FRAME = {
  GET_VALUES: 1,
  SET_VALUES: 2,
  THIS_OBJECT: 3,
} as const;

export const JDWP_EVENT_REQUEST = {
  SET: 1,
  CLEAR: 2,
  CLEAR_ALL_BREAKPOINTS: 3,
} as const;

export const JDWP_EVENT_KIND = {
  SINGLE_STEP: 1,
  BREAKPOINT: 2,
  FRAME_POP: 3,
  EXCEPTION: 4,
  THREAD_START: 5,
  THREAD_DEATH: 6,
  CLASS_PREPARE: 7,
  CLASS_UNLOAD: 8,
  CLASS_LOAD: 9,
  FIELD_ACCESS: 10,
  FIELD_MODIFICATION: 11,
  EXCEPTION_CATCH: 12,
  METHOD_ENTRY: 13,
  METHOD_EXIT: 14,
  MONITOR_CONTENDED_ENTER: 15,
  MONITOR_CONTENDED_ENTERED: 16,
  MONITOR_WAIT: 17,
  MONITOR_WAITED: 18,
  STEP: 19,
  TERMINATE: 20,
} as const;

export const JDWP_SUSPEND_POLICY = {
  NONE: 0,
  EVENT_THREAD: 1,
  ALL: 2,
} as const;

export const JDWP_TAG = {
  OBJECT: 'L'.charCodeAt(0),    // 0x4C
  ARRAY: '['.charCodeAt(0),      // 0x5B
  STRING: 's'.charCodeAt(0),     // 0x73 (short string)
  THREAD: 't'.charCodeAt(0),     // 0x74
  THREAD_GROUP: 'g'.charCodeAt(0), // 0x67
  CLASS_LOADER: 'l'.charCodeAt(0), // 0x6C
  CLASS_OBJECT: 'c'.charCodeAt(0), // 0x63
  BOOLEAN: 'Z'.charCodeAt(0),    // 0x5A
  BYTE: 'B'.charCodeAt(0),       // 0x42
  CHAR: 'C'.charCodeAt(0),       // 0x43
  DOUBLE: 'D'.charCodeAt(0),     // 0x44
  FLOAT: 'F'.charCodeAt(0),      // 0x46
  INT: 'I'.charCodeAt(0),        // 0x49
  LONG: 'J'.charCodeAt(0),       // 0x4A
  SHORT: 'S'.charCodeAt(0),      // 0x53
  VOID: 'V'.charCodeAt(0),       // 0x56
};

// ─── ID Sizes ────────────────────────────────────────────────────

export interface JDWPIDSizes {
  fieldIDSize: number;
  methodIDSize: number;
  objectIDSize: number;
  referenceTypeIDSize: number;
  frameIDSize: number;
}

// ─── JDWP Binary Reader ──────────────────────────────────────────

export class JDWPReader {
  private data: Buffer;
  private offset: number;

  constructor(data: Buffer) {
    this.data = data;
    this.offset = 0;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  readByte(): number {
    const val = this.data.readUInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readShort(): number {
    const val = this.data.readInt16BE(this.offset);
    this.offset += 2;
    return val;
  }

  readInt(): number {
    const val = this.data.readInt32BE(this.offset);
    this.offset += 4;
    return val;
  }

  readLong(): bigint {
    const val = this.data.readBigInt64BE(this.offset);
    this.offset += 8;
    return val;
  }

  readBoolean(): boolean {
    return this.readByte() !== 0;
  }

  readString(): string {
    const len = this.readInt();
    const str = this.data.toString('utf-8', this.offset, this.offset + len);
    this.offset += len;
    return str;
  }

  readObjectID(size: number): bigint {
    if (size <= 4) {
      return BigInt(this.readInt());
    }
    return this.readLong();
  }

  /**
   * Read a tagged value from the data stream.
   */
  readValue(idSize: number): { type: string; value: unknown; objectId?: string } {
    const tag = this.readByte();
    return this.readTaggedValue(tag, idSize);
  }

  /**
   * Read a value with a known tag.
   */
  readTaggedValue(tag: number, idSize: number): { type: string; value: unknown; objectId?: string } {
    switch (tag) {
      case JDWP_TAG.BOOLEAN:
        return { type: 'boolean', value: this.readBoolean() };
      case JDWP_TAG.BYTE:
        return { type: 'byte', value: this.readByte() };
      case JDWP_TAG.CHAR: {
        const c = this.readShort();
        return { type: 'char', value: String.fromCharCode(c) };
      }
      case JDWP_TAG.DOUBLE:
        return { type: 'double', value: this.readDouble() };
      case JDWP_TAG.FLOAT:
        return { type: 'float', value: this.readFloat() };
      case JDWP_TAG.INT:
        return { type: 'int', value: this.readInt() };
      case JDWP_TAG.LONG:
        return { type: 'long', value: Number(this.readLong()) };
      case JDWP_TAG.SHORT:
        return { type: 'short', value: this.readShort() };
      case JDWP_TAG.VOID:
        return { type: 'void', value: undefined };
      case JDWP_TAG.STRING: {
        const strId = this.readObjectID(idSize);
        return { type: 'string', value: `<string#${strId}>`, objectId: `jdwp_obj:${strId}` };
      }
      case JDWP_TAG.OBJECT:
      case JDWP_TAG.ARRAY: {
        const objId = this.readObjectID(idSize);
        return {
          type: 'object',
          value: objId === BigInt(0) ? null : `<object#${objId}>`,
          objectId: objId !== BigInt(0) ? `jdwp_obj:${objId}` : undefined,
        };
      }
      case JDWP_TAG.THREAD: {
        const threadId = this.readObjectID(idSize);
        return { type: 'thread', value: `<thread#${threadId}>`, objectId: `jdwp_thread:${threadId}` };
      }
      case JDWP_TAG.CLASS_LOADER:
      case JDWP_TAG.CLASS_OBJECT: {
        const clsId = this.readObjectID(idSize);
        return { type: 'class', value: `<class#${clsId}>`, objectId: `jdwp_class:${clsId}` };
      }
      case JDWP_TAG.THREAD_GROUP: {
        const tgId = this.readObjectID(idSize);
        return { type: 'threadGroup', value: `<threadGroup#${tgId}>` };
      }
      default:
        throw new Error(`Unknown JDWP value tag: 0x${tag.toString(16)}`);
    }
  }

  readDouble(): number {
    const val = this.data.readDoubleBE(this.offset);
    this.offset += 8;
    return val;
  }

  readFloat(): number {
    const val = this.data.readFloatBE(this.offset);
    this.offset += 4;
    return val;
  }

  /**
   * Skip N bytes.
   */
  skip(bytes: number): void {
    this.offset += bytes;
  }
}

// ─── JDWP Binary Writer ──────────────────────────────────────────

export class JDWPWriter {
  private chunks: Buffer[] = [];

  writeByte(v: number): void {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(v & 0xFF, 0);
    this.chunks.push(buf);
  }

  writeShort(v: number): void {
    const buf = Buffer.alloc(2);
    buf.writeInt16BE(v & 0xFFFF, 0);
    this.chunks.push(buf);
  }

  writeInt(v: number): void {
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(v, 0);
    this.chunks.push(buf);
  }

  writeLong(v: bigint): void {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(v, 0);
    this.chunks.push(buf);
  }

  writeBoolean(v: boolean): void {
    this.writeByte(v ? 1 : 0);
  }

  writeString(s: string): void {
    const buf = Buffer.from(s, 'utf-8');
    this.writeInt(buf.length);
    this.chunks.push(buf);
  }

  writeObjectID(id: bigint, size: number): void {
    if (size <= 4) {
      this.writeInt(Number(id));
    } else {
      this.writeLong(id);
    }
  }

  /**
   * Write a Value with a tag byte prefix.
   */
  writeValue(tag: number, value: unknown, idSize: number): void {
    this.writeByte(tag);
    switch (tag) {
      case JDWP_TAG.BOOLEAN:
        this.writeBoolean(value as boolean);
        break;
      case JDWP_TAG.BYTE:
        this.writeByte(value as number);
        break;
      case JDWP_TAG.CHAR:
        this.writeShort((value as string).charCodeAt(0));
        break;
      case JDWP_TAG.DOUBLE: {
        const buf = Buffer.alloc(8);
        buf.writeDoubleBE(value as number, 0);
        this.chunks.push(buf);
        break;
      }
      case JDWP_TAG.FLOAT: {
        const buf = Buffer.alloc(4);
        buf.writeFloatBE(value as number, 0);
        this.chunks.push(buf);
        break;
      }
      case JDWP_TAG.INT:
        this.writeInt(value as number);
        break;
      case JDWP_TAG.LONG:
        this.writeLong(BigInt(value as number));
        break;
      case JDWP_TAG.SHORT:
        this.writeShort(value as number);
        break;
      case JDWP_TAG.OBJECT:
      case JDWP_TAG.ARRAY:
      case JDWP_TAG.STRING:
        this.writeObjectID(BigInt(String(value)), idSize);
        break;
      case JDWP_TAG.VOID:
        break;
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  get length(): number {
    let total = 0;
    for (const chunk of this.chunks) {
      total += chunk.length;
    }
    return total;
  }
}

// ─── JDWP Transport ──────────────────────────────────────────────

export class JDWPTransport {
  private host: string;
  private port: number;
  private socket: any = null;
  private packetId = 0;
  private pending = new Map<
    number,
    { resolve: (data: Buffer) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = Buffer.alloc(0);
  private eventHandler: ((cmdSet: number, cmd: number, data: Buffer) => void) | null = null;
  private connected = false;
  private idSizes!: JDWPIDSizes;

  constructor(host = '127.0.0.1', port = 5005) {
    this.host = host;
    this.port = port;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get ids(): JDWPIDSizes {
    return this.idSizes;
  }

  /**
   * Connect to the JVM JDWP port and perform handshake.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      const socket = connect(this.port, this.host, () => {
        this.socket = socket;
        // Send handshake
        socket.write(JDWP_HANDSHAKE);
      });

      let handshakeDone = false;

      socket.on('data', (data: Buffer) => {
        if (!handshakeDone) {
          // Expect "JDWP-Handshake" back
          const reply = data.toString('utf-8').trim();
          if (reply === 'JDWP-Handshake' || data.length >= 14) {
            handshakeDone = true;
            this.connected = true;
            // Get ID sizes
            this.getIDSizes().then(() => {
              getLogger().info(
                { port: this.port, ids: this.idSizes },
                'JDWP transport connected',
              );
              resolve();
            }).catch(reject);
          } else {
            reject(new Error(`Invalid JDWP handshake reply: ${reply.slice(0, 20)}`));
          }
          return;
        }

        // Process incoming data
        this.processData(data);
      });

      socket.on('error', (err: Error) => {
        getLogger().error({ error: err.message }, 'JDWP socket error');
        this.handleDisconnect();
        reject(err);
      });

      socket.on('close', () => {
        this.handleDisconnect();
      });

      // Timeout for handshake
      setTimeout(() => {
        if (!handshakeDone) {
          reject(new Error('JDWP handshake timed out'));
        }
      }, 10000);
    });
  }

  /**
   * Process incoming JDWP packets from the data stream.
   */
  private processData(newData: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, newData]);

    // Process complete packets
    while (this.buffer.length >= 11) {
      const length = this.buffer.readInt32BE(0);
      if (this.buffer.length < length) break; // Wait for more data

      const packet = Buffer.alloc(length);
      this.buffer.copy(packet, 0, 0, length);
      this.buffer = this.buffer.slice(length);

      this.parsePacket(packet);
    }
  }

  /**
   * Parse a single JDWP packet.
   */
  private parsePacket(packet: Buffer): void {
    const id = packet.readInt32BE(4);
    const flags = packet.readUInt8(8);

    if (flags === 0x80) {
      // Reply packet — resolve pending request
      const errorCode = packet.readInt16BE(9);
      const data = packet.slice(11);

      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);

        if (errorCode !== 0) {
          pending.reject(new Error(`JDWP error ${errorCode} for request ${id}`));
        } else {
          pending.resolve(data);
        }
      }
    } else {
      // Command packet — these are events from the VM (Composite events)
      const commandSet = packet.readUInt8(9);
      const command = packet.readUInt8(10);
      const data = packet.slice(11);

      if (this.eventHandler) {
        this.eventHandler(commandSet, command, data);
      }
    }
  }

  /**
   * Get ID sizes from the VM.
   */
  private async getIDSizes(): Promise<void> {
    const data = await this.sendCommand(JDWP_CMDSET.VIRTUAL_MACHINE, JDWP_VM.ID_SIZES);
    const reader = new JDWPReader(data);
    this.idSizes = {
      fieldIDSize: reader.readInt(),
      methodIDSize: reader.readInt(),
      objectIDSize: reader.readInt(),
      referenceTypeIDSize: reader.readInt(),
      frameIDSize: reader.readInt(),
    };
  }

  /**
   * Send a JDWP command and wait for the reply.
   */
  async sendCommand(
    commandSet: number,
    command: number,
    payload?: Buffer,
  ): Promise<Buffer> {
    if (!this.connected) throw new Error('JDWP not connected');

    this.packetId++;
    const id = this.packetId;

    const dataLen = payload?.length ?? 0;
    const headerLen = 11; // length(4) + id(4) + flags(1) + cmdSet(1) + cmd(1)
    const packetLen = headerLen + dataLen;

    const packet = Buffer.alloc(packetLen);
    packet.writeInt32BE(packetLen, 0); // length
    packet.writeInt32BE(id, 4); // id
    packet.writeUInt8(0x00, 8); // flags (command)
    packet.writeUInt8(commandSet, 9); // command set
    packet.writeUInt8(command, 10); // command

    if (payload) {
      payload.copy(packet, 11);
    }

    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JDWP command (${commandSet},${command}) timed out`));
      }, 30000);

      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(packet);
    });
  }

  /**
   * Send a command with a writer callback to build payload.
   */
  async sendWithWriter(
    commandSet: number,
    command: number,
    buildFn: (w: JDWPWriter) => void,
  ): Promise<Buffer> {
    const writer = new JDWPWriter();
    buildFn(writer);
    return this.sendCommand(commandSet, command, writer.toBuffer());
  }

  /**
   * Register event handler for VM → debugger commands (composite events).
   */
  onEvent(handler: (commandSet: number, command: number, data: Buffer) => void): void {
    this.eventHandler = handler;
  }

  /**
   * Handle disconnect.
   */
  private handleDisconnect(): void {
    this.connected = false;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('JDWP connection lost'));
    }
    this.pending.clear();
  }

  /**
   * Disconnect and clean up.
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.buffer = Buffer.alloc(0);
    this.handleDisconnect();
  }
}
