/**
 * Tests for JDWP Transport — binary packet encoding/decoding.
 */
import { describe, it, expect } from 'vitest';

describe('JDWP Transport', () => {
  let JDWPReader: any;
  let JDWPWriter: any;
  let JDWPTransport: any;
  let JDWP_CMDSET: any;
  let JDWP_VM: any;
  let JDWP_TAG: any;
  let JDWP_EVENT_KIND: any;
  let JDWP_SUSPEND_POLICY: any;

  beforeEach(async () => {
    const mod = await import('../../../../src/tools/debug/jdwp-transport.js');
    JDWPReader = mod.JDWPReader;
    JDWPWriter = mod.JDWPWriter;
    JDWPTransport = mod.JDWPTransport;
    JDWP_CMDSET = mod.JDWP_CMDSET;
    JDWP_VM = mod.JDWP_VM;
    JDWP_TAG = mod.JDWP_TAG;
    JDWP_EVENT_KIND = mod.JDWP_EVENT_KIND;
    JDWP_SUSPEND_POLICY = mod.JDWP_SUSPEND_POLICY;
  });

  describe('JDWP Constants', () => {
    it('should have correct command set IDs', () => {
      expect(JDWP_CMDSET.VIRTUAL_MACHINE).toBe(1);
      expect(JDWP_CMDSET.REFERENCE_TYPE).toBe(2);
      expect(JDWP_CMDSET.THREAD_REFERENCE).toBe(11);
      expect(JDWP_CMDSET.EVENT_REQUEST).toBe(15);
      expect(JDWP_CMDSET.STACK_FRAME).toBe(16);
      expect(JDWP_CMDSET.EVENT).toBe(64);
    });

    it('should have correct VM command IDs', () => {
      expect(JDWP_VM.VERSION).toBe(1);
      expect(JDWP_VM.ID_SIZES).toBe(7);
      expect(JDWP_VM.ALL_CLASSES_WITH_GENERIC).toBe(20);
      expect(JDWP_VM.RESUME).toBe(9);
    });

    it('should have correct event kinds', () => {
      expect(JDWP_EVENT_KIND.BREAKPOINT).toBe(2);
      expect(JDWP_EVENT_KIND.SINGLE_STEP).toBe(1);
      expect(JDWP_EVENT_KIND.CLASS_PREPARE).toBe(7);
    });

    it('should have correct suspend policies', () => {
      expect(JDWP_SUSPEND_POLICY.NONE).toBe(0);
      expect(JDWP_SUSPEND_POLICY.EVENT_THREAD).toBe(1);
      expect(JDWP_SUSPEND_POLICY.ALL).toBe(2);
    });

    it('should have correct value tags', () => {
      expect(JDWP_TAG.BOOLEAN).toBe('Z'.charCodeAt(0));
      expect(JDWP_TAG.INT).toBe('I'.charCodeAt(0));
      expect(JDWP_TAG.OBJECT).toBe('L'.charCodeAt(0));
      expect(JDWP_TAG.STRING).toBe('s'.charCodeAt(0));
      expect(JDWP_TAG.VOID).toBe('V'.charCodeAt(0));
    });
  });

  describe('JDWPReader', () => {
    it('should read single byte', () => {
      const buf = Buffer.from([0x42]);
      const r = new JDWPReader(buf);
      expect(r.readByte()).toBe(0x42);
    });

    it('should read short (2 bytes, big-endian)', () => {
      const buf = Buffer.from([0x01, 0x02]);
      const r = new JDWPReader(buf);
      expect(r.readShort()).toBe(258); // 0x0102 = 258
    });

    it('should read int (4 bytes, big-endian)', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x2a]);
      const r = new JDWPReader(buf);
      expect(r.readInt()).toBe(42);
    });

    it('should read long (8 bytes, big-endian)', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a]);
      const r = new JDWPReader(buf);
      expect(r.readLong()).toBe(BigInt(42));
    });

    it('should read boolean', () => {
      const buf = Buffer.from([0x01]);
      const r = new JDWPReader(buf);
      expect(r.readBoolean()).toBe(true);
      const buf2 = Buffer.from([0x00]);
      const r2 = new JDWPReader(buf2);
      expect(r2.readBoolean()).toBe(false);
    });

    it('should read string (length-prefixed UTF-8)', () => {
      const str = 'Hello JDWP';
      const strBuf = Buffer.from(str, 'utf-8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(strBuf.length, 0);
      const buf = Buffer.concat([lenBuf, strBuf]);
      const r = new JDWPReader(buf);
      expect(r.readString()).toBe('Hello JDWP');
    });

    it('should read objectID with 4-byte size', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x2a]);
      const r = new JDWPReader(buf);
      expect(r.readObjectID(4)).toBe(BigInt(42));
    });

    it('should read objectID with 8-byte size', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a]);
      const r = new JDWPReader(buf);
      expect(r.readObjectID(8)).toBe(BigInt(42));
    });

    it('should track remaining bytes', () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const r = new JDWPReader(buf);
      expect(r.remaining).toBe(4);
      r.readByte();
      expect(r.remaining).toBe(3);
      r.readShort();
      expect(r.remaining).toBe(1);
    });
  });

  describe('JDWPWriter', () => {
    it('should write single byte', () => {
      const w = new JDWPWriter();
      w.writeByte(0x42);
      const buf = w.toBuffer();
      expect(buf.length).toBe(1);
      expect(buf[0]).toBe(0x42);
    });

    it('should write short in big-endian', () => {
      const w = new JDWPWriter();
      w.writeShort(258);
      const buf = w.toBuffer();
      expect(buf.length).toBe(2);
      expect(buf[0]).toBe(0x01);
      expect(buf[1]).toBe(0x02);
    });

    it('should write int in big-endian', () => {
      const w = new JDWPWriter();
      w.writeInt(42);
      const buf = w.toBuffer();
      expect(buf.readInt32BE(0)).toBe(42);
    });

    it('should write long in big-endian', () => {
      const w = new JDWPWriter();
      w.writeLong(BigInt(42));
      const buf = w.toBuffer();
      expect(buf.readBigInt64BE(0)).toBe(BigInt(42));
    });

    it('should write string with length prefix', () => {
      const w = new JDWPWriter();
      w.writeString('Hello');
      const buf = w.toBuffer();
      const len = buf.readInt32BE(0);
      expect(len).toBe(5);
      expect(buf.slice(4).toString('utf-8')).toBe('Hello');
    });

    it('should compute correct length', () => {
      const w = new JDWPWriter();
      w.writeByte(1);
      w.writeInt(42);
      w.writeString('test');
      expect(w.length).toBeGreaterThan(0);
      expect(w.toBuffer().length).toBe(w.length);
    });
  });

  describe('JDWP Packet Structure', () => {
    it('should build correct command packet header', () => {
      // Command packet: length(4) + id(4) + flags(1) + cmdSet(1) + cmd(1)
      const id = 1;
      const cmdSet = JDWP_CMDSET.VIRTUAL_MACHINE;
      const cmd = JDWP_VM.VERSION;
      const data = Buffer.alloc(0);
      const headerLen = 11;
      const packetLen = headerLen + data.length;

      const packet = Buffer.alloc(packetLen);
      packet.writeInt32BE(packetLen, 0);
      packet.writeInt32BE(id, 4);
      packet.writeUInt8(0x00, 8); // flags: command
      packet.writeUInt8(cmdSet, 9);
      packet.writeUInt8(cmd, 10);

      expect(packet.length).toBe(11);
      expect(packet.readInt32BE(0)).toBe(11);
      expect(packet.readInt32BE(4)).toBe(1);
      expect(packet.readUInt8(8)).toBe(0x00);
      expect(packet.readUInt8(9)).toBe(JDWP_CMDSET.VIRTUAL_MACHINE);
      expect(packet.readUInt8(10)).toBe(JDWP_VM.VERSION);
    });

    it('should build correct reply packet header', () => {
      // Reply packet: length(4) + id(4) + flags(0x80) + errorCode(2)
      const id = 1;
      const errorCode = 0; // success
      const data = Buffer.alloc(0);
      const headerLen = 11;
      const packetLen = headerLen + data.length;

      const packet = Buffer.alloc(packetLen);
      packet.writeInt32BE(packetLen, 0);
      packet.writeInt32BE(id, 4);
      packet.writeUInt8(0x80, 8); // flags: reply
      packet.writeInt16BE(errorCode, 9);

      expect(packet.readUInt8(8)).toBe(0x80);
      expect(packet.readInt16BE(9)).toBe(0);
    });

    it('should handle handshake string', () => {
      const handshake = Buffer.from('JDWP-Handshake', 'utf-8');
      expect(handshake.length).toBe(14);
      expect(handshake.toString('utf-8')).toBe('JDWP-Handshake');
    });
  });

  describe('Transport construction', () => {
    it('should create transport with default config', () => {
      const transport = new JDWPTransport();
      expect(transport.isConnected).toBe(false);
    });

    it('should create transport with custom host and port', () => {
      const transport = new JDWPTransport('127.0.0.1', 5006);
      expect(transport.isConnected).toBe(false);
    });

    it('should throw when sending command before connect', async () => {
      const transport = new JDWPTransport();
      await expect(transport.sendCommand(1, 1)).rejects.toThrow('not connected');
    });
  });
});
