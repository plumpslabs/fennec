/**
 * JDWP Adapter — Java Debug Wire Protocol to DebugAdapter bridge.
 *
 * Translates JDWP (binary protocol over TCP) to the DebugAdapter interface
 * for Java, Kotlin, and Scala debugging.
 *
 * JVM launch args:
 *   -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=*:5005
 *
 * Cross-platform: Node.js `net` module works on Linux, macOS, Windows.
 */
import { getLogger } from '../../utils/logger.js';
import type {
  DebugAdapter,
  RuntimeType,
  BreakpointResult,
  PausedEvent,
  CallFrame,
  EvaluateResult,
  PropertiesResult,
  PropertyDescriptor,
} from './adapter-types.js';
import {
  JDWPTransport,
  JDWPReader,
  JDWPWriter,
  JDWP_CMDSET,
  JDWP_VM,
  JDWP_THREAD,
  JDWP_STACK_FRAME,
  JDWP_EVENT_REQUEST,
  JDWP_EVENT_KIND,
  JDWP_SUSPEND_POLICY,
} from './jdwp-transport.js';

// ─── Constants ───────────────────────────────────────────────────

/** ReferenceType commands */
const REF_TYPE = { SOURCE_FILE: 7 } as const;

/** MethodsWithGeneric (ReferenceType, cmd 15) — returns declared + generic counts */
const METHODS_WITH_GENERIC = 15;

const STEP_DEPTH = { INTO: 0, OVER: 1, OUT: 2 } as const;
const STEP_SIZE = { LINE: 1 } as const;

// ─── Internal Types ──────────────────────────────────────────────

interface JDWPRefType {
  refTypeTag: number;
  typeID: bigint;
  signature: string;
  status: number;
}

interface JDWPMethod {
  id: bigint;
  name: string;
  signature: string;
}

/** Stores both the frameID (for JDWP calls) and converted CallFrame */
interface FrameEntry {
  frameId: bigint;
  callFrame: CallFrame;
}

// ─── Adapter Config ──────────────────────────────────────────────

export interface JDWPConfig {
  host?: string;
  port?: number;
}

// ─── JDWP Adapter ────────────────────────────────────────────────

export class JDWPAdapter implements DebugAdapter {
  readonly runtime: RuntimeType = 'java';
  private transport: JDWPTransport;
  private host: string;
  private port: number;
  private enabled = false;

  private _pausedHandler: ((event: PausedEvent) => void) | null = null;
  private _resumedHandler: (() => void) | null = null;
  private _scriptParsedHandler: ((script: any) => void) | null = null;

  // Cached JVM info
  private classes: JDWPRefType[] = [];
  private methodsByClass = new Map<string, JDWPMethod[]>();
  private sourceFiles = new Map<string, string>();
  private cachedSourceFiles = false;

  // Breakpoint tracking
  private bpCounter = 0;
  private bpIdToJDWP = new Map<string, number>();
  private jdwpBPToBpId = new Map<number, string>();

  // State
  private stepRequestId: number | null = null;
  private suspendedThreadId: bigint | null = null;

  /** Cache of fetched frames: threadId → FrameEntry[] */
  private frameCache = new Map<string, FrameEntry[]>();

  constructor(config: JDWPConfig = {}) {
    this.host = config.host ?? '127.0.0.1';
    this.port = config.port ?? 5005;
    this.transport = new JDWPTransport(this.host, this.port);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  // ── Enable / Disable ───────────────────────────────────────────

  async enable(): Promise<string> {
    if (this.enabled) return 'jdwp_connected';

    this.transport.onEvent((cmdSet, _cmd, data) => {
      if (cmdSet === JDWP_CMDSET.EVENT) this.handleCompositeEvent(data);
    });

    await this.transport.connect();

    // JVM starts suspended (suspend=y) — resume it so it can run
    try {
      await this.transport.sendCommand(JDWP_CMDSET.VIRTUAL_MACHINE, JDWP_VM.RESUME);
    } catch { /* ok */ }

    await this.cacheClasses();
    // Source files and methods cached lazily on demand

    this.enabled = true;
    getLogger().info(
      { host: this.host, port: this.port, classes: this.classes.length },
      'JDWP adapter enabled',
    );
    return `jdwp_${this.host}:${this.port}`;
  }

  async disable(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.transport.sendCommand(JDWP_CMDSET.EVENT_REQUEST, 3); // ClearAllBreakpoints
    } catch { /* best-effort */ }
    await this.transport.disconnect();

    this.enabled = false;
    this._pausedHandler = null;
    this._resumedHandler = null;
    this.classes = [];
    this.methodsByClass.clear();
    this.sourceFiles.clear();
    this.cachedSourceFiles = false;
    this.bpIdToJDWP.clear();
    this.jdwpBPToBpId.clear();
    this.suspendedThreadId = null;
    this.frameCache.clear();
    getLogger().info('JDWP adapter disabled');
  }

  // ─── Lazy JVM Info ─────────────────────────────────────────────

  private async cacheClasses(): Promise<void> {
    try {
      const data = await this.transport.sendCommand(JDWP_CMDSET.VIRTUAL_MACHINE, JDWP_VM.ALL_CLASSES_WITH_GENERIC);
      const r = new JDWPReader(data);
      const count = r.readInt();
      for (let i = 0; i < count; i++) {
        const refTypeTag = r.readByte();
        const typeID = r.readObjectID(this.idSize('ref'));
        const sig = r.readString();
        r.readString(); // generic signature
        const status = r.readInt();
        this.classes.push({ refTypeTag, typeID, signature: sig, status });
      }
    } catch (err) {
      getLogger().warn({ err }, 'Failed to cache JDWP classes');
    }
  }

  /** Lazy-load source files only when needed (e.g., setting a breakpoint). */
  private async ensureSourceFiles(): Promise<void> {
    if (this.cachedSourceFiles) return;
    this.cachedSourceFiles = true;

    for (const cls of this.classes) {
      try {
        const data = await this.transport.sendWithWriter(JDWP_CMDSET.REFERENCE_TYPE, REF_TYPE.SOURCE_FILE, (w) => {
          w.writeObjectID(cls.typeID, this.idSize('ref'));
        });
        const r = new JDWPReader(data);
        this.sourceFiles.set(cls.signature, r.readString());
      } catch { /* skip classes without source */ }
    }
  }

  /** Lazy-load methods for a specific class. */
  private async ensureMethods(clsSig: string): Promise<JDWPMethod[]> {
    const existing = this.methodsByClass.get(clsSig);
    if (existing) return existing;

    const cls = this.classes.find(c => c.signature === clsSig);
    if (!cls) return [];

    // Use MethodsWithGeneric (cmd 15) which returns declared+generic counts
    try {
      const data = await this.transport.sendWithWriter(JDWP_CMDSET.REFERENCE_TYPE, METHODS_WITH_GENERIC, (w) => {
        w.writeObjectID(cls.typeID, this.idSize('ref'));
      });

      const r = new JDWPReader(data);
      const declared = r.readInt();
      const generic = r.readInt();
      const total = declared + generic;
      const methods: JDWPMethod[] = [];

      for (let i = 0; i < total; i++) {
        const id = r.readObjectID(this.idSize('method'));
        const name = r.readString();
        const sig = r.readString();
        const modBits = r.readInt();
        if (generic > 0 && i >= declared) r.readString(); // generic signature
        // modBits: 0x0001 = PUBLIC, 0x0010 = STATIC, 0x0040 = NATIVE etc.
        methods.push({ id, name, signature: sig });
      }

      this.methodsByClass.set(clsSig, methods);
      return methods;
    } catch {
      return [];
    }
  }

  private async classForSourceFile(filename: string): Promise<JDWPRefType | null> {
    await this.ensureSourceFiles();

    const target = filename.replace(/\.java$/, '').split(/[/\\]/).pop() ?? filename;
    for (const cls of this.classes) {
      const sf = this.sourceFiles.get(cls.signature);
      if (sf) {
        const sfn = sf.replace(/\.java$/, '').split(/[/\\]/).pop();
        if (sfn === target || sf === filename) return cls;
      }
      const simple = cls.signature.replace(/^L/, '').replace(/;$/, '').split('/').pop();
      if (simple === target) return cls;
    }
    return null;
  }

  private async methodForLine(clsSig: string, _line: number): Promise<{ method: JDWPMethod; codeIndex: bigint } | null> {
    const methods = await this.ensureMethods(clsSig);
    if (methods.length === 0) return null;

    // Note: Full codeIndex-to-line mapping requires VariableTable/LineTable
    // which isn't available via JDWP directly. Breakpoints fire at method entry.
    // This is a known limitation that could be improved later.
    const firstMethod = methods.find(m => !m.name.startsWith('<'));
    return firstMethod
      ? { method: firstMethod, codeIndex: BigInt(0) }
      : { method: methods[0]!, codeIndex: BigInt(0) };
  }

  // ─── Thread Control ────────────────────────────────────────────

  private async resumeThread(threadId: bigint): Promise<void> {
    await this.transport.sendWithWriter(JDWP_CMDSET.THREAD_REFERENCE, JDWP_THREAD.RESUME, (w) => {
      w.writeObjectID(threadId, this.idSize('obj'));
    });
  }

  private idSize(kind: 'obj' | 'ref' | 'method' | 'field' | 'frame'): number {
    const ids = this.transport.ids;
    switch (kind) {
      case 'obj': return ids.objectIDSize;
      case 'ref': return ids.referenceTypeIDSize;
      case 'method': return ids.methodIDSize;
      case 'field': return ids.fieldIDSize;
      case 'frame': return ids.frameIDSize;
    }
  }

  // ─── Event Handling ────────────────────────────────────────────

  private handleCompositeEvent(data: Buffer): void {
    const r = new JDWPReader(data);
    r.readByte(); // suspendPolicy
    const events = r.readInt();

    for (let i = 0; i < events; i++) {
      const eventKind = r.readByte();
      const requestID = r.readInt();

      if (eventKind === JDWP_EVENT_KIND.BREAKPOINT) {
        this.handleBreakpointEvent(r, requestID);
      } else if (eventKind === JDWP_EVENT_KIND.SINGLE_STEP) {
        this.handleStepEvent(r, requestID);
      }
    }
  }

  private async handleBreakpointEvent(r: JDWPReader, requestID: number): Promise<void> {
    const threadID = r.readObjectID(this.idSize('obj'));
    r.readByte(); // typeTag
    r.readObjectID(this.idSize('ref')); // classID
    r.readObjectID(this.idSize('method')); // methodID
    r.readLong(); // codeIndex

    if (!this._pausedHandler) return;

    this.suspendedThreadId = threadID;
    const frames = await this.fetchFrames(threadID);
    const bpId = this.jdwpBPToBpId.get(requestID);

    this._pausedHandler({
      callFrames: frames,
      reason: 'breakpoint',
      hitBreakpoints: bpId ? [bpId] : undefined,
    });
  }

  private async handleStepEvent(r: JDWPReader, _requestID: number): Promise<void> {
    const threadID = r.readObjectID(this.idSize('obj'));

    if (!this._pausedHandler) return;

    this.suspendedThreadId = threadID;
    const frames = await this.fetchFrames(threadID);

    this._pausedHandler({
      callFrames: frames,
      reason: 'step',
    });
  }

  /** Fetch stack frames and cache frameIDs for later variable inspection. */
  private async fetchFrames(threadId: bigint): Promise<CallFrame[]> {
    try {
      const data = await this.transport.sendWithWriter(JDWP_CMDSET.THREAD_REFERENCE, JDWP_THREAD.FRAMES, (w) => {
        w.writeObjectID(threadId, this.idSize('obj'));
        w.writeInt(0); // startFrame
        w.writeInt(10); // maxFrames
      });

      const r = new JDWPReader(data);
      const count = r.readInt();
      const frameEntries: FrameEntry[] = [];
      const key = String(threadId);

      for (let i = 0; i < count; i++) {
        const frameID = r.readObjectID(this.idSize('frame'));
        r.readByte(); // typeTag
        const classID = r.readObjectID(this.idSize('ref'));
        const methodID = r.readObjectID(this.idSize('method'));
        r.readLong(); // codeIndex

        // Resolve method name and source file from cache
        const cls = this.classes.find(c => c.typeID === classID);
        const methods = cls ? this.methodsByClass.get(cls.signature) : undefined;
        const method = methods?.find(m => m.id === methodID);
        const funcName = method?.name ?? `<method#${methodID}>`;
        const sourceFile = cls ? (this.sourceFiles.get(cls.signature) ?? cls.signature) : 'unknown.java';

        const callFrame: CallFrame = {
          callFrameId: `java_frame_${i}`,
          functionName: funcName,
          url: sourceFile,
          lineNumber: 0, // No line-to-codeIndex mapping available
          columnNumber: 0,
          scopeChain: [
            {
              type: 'local',
              object: {
                type: 'object',
                objectId: `java_scope:${threadId}:${i}`,
                description: `Local variables (frame ${i})`,
              },
              name: 'Local',
            },
          ],
          this: { type: 'undefined' },
        };

        frameEntries.push({ frameId: frameID, callFrame });
      }

      this.frameCache.set(key, frameEntries);
      return frameEntries.map(e => e.callFrame);
    } catch {
      return [];
    }
  }

  // ─── Breakpoints ───────────────────────────────────────────────

  async setBreakpointByUrl(
    file: string,
    line: number,
    _options?: { column?: number; condition?: string },
  ): Promise<BreakpointResult> {
    if (!this.enabled) throw new Error('JDWP adapter not enabled');

    const cls = await this.classForSourceFile(file);
    if (!cls) throw new Error(`No Java class found for source file: ${file}`);

    const methodInfo = await this.methodForLine(cls.signature, line);
    if (!methodInfo) throw new Error(`No method found for line ${line} in ${file}`);

    this.bpCounter++;
    const bpId = `java_bp_${this.bpCounter}`;

    const data = await this.transport.sendWithWriter(JDWP_CMDSET.EVENT_REQUEST, 1, (w) => {
      w.writeByte(JDWP_EVENT_KIND.BREAKPOINT);
      w.writeByte(JDWP_SUSPEND_POLICY.EVENT_THREAD);
      w.writeInt(1); // 1 modifier: LocationOnly
      w.writeByte(7); // LocationOnly (modifier ID)
      w.writeByte(cls.refTypeTag);
      w.writeObjectID(cls.typeID, this.idSize('ref'));
      w.writeObjectID(methodInfo.method.id, this.idSize('method'));
      w.writeLong(methodInfo.codeIndex);
    });

    const r = new JDWPReader(data);
    const requestID = r.readInt();
    this.bpIdToJDWP.set(bpId, requestID);
    this.jdwpBPToBpId.set(requestID, bpId);

    getLogger().info({ bpId, file, line, requestID }, 'JDWP breakpoint set');
    return {
      breakpointId: bpId,
      locations: [{ scriptId: cls.signature, lineNumber: line, columnNumber: 0 }],
    };
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    const jdwpId = this.bpIdToJDWP.get(breakpointId);
    if (jdwpId === undefined) return;

    try {
      await this.transport.sendWithWriter(JDWP_CMDSET.EVENT_REQUEST, 2, (w) => {
        w.writeByte(JDWP_EVENT_KIND.BREAKPOINT);
        w.writeInt(jdwpId);
      });
    } catch { /* best-effort */ }

    this.bpIdToJDWP.delete(breakpointId);
    this.jdwpBPToBpId.delete(jdwpId);
  }

  // ─── Execution Control ─────────────────────────────────────────

  async resume(): Promise<void> {
    if (!this.enabled) throw new Error('JDWP adapter not enabled');
    if (this.suspendedThreadId !== null) {
      await this.resumeThread(this.suspendedThreadId);
      this.suspendedThreadId = null;
    }
    this.frameCache.clear();
    if (this._resumedHandler) this._resumedHandler();
  }

  async stepOver(): Promise<void> {
    if (!this.enabled) throw new Error('JDWP adapter not enabled');
    await this.doStep(STEP_DEPTH.OVER);
  }

  async stepInto(): Promise<void> {
    if (!this.enabled) throw new Error('JDWP adapter not enabled');
    await this.doStep(STEP_DEPTH.INTO);
  }

  async stepOut(): Promise<void> {
    if (!this.enabled) throw new Error('JDWP adapter not enabled');
    await this.doStep(STEP_DEPTH.OUT);
  }

  private async doStep(depth: number): Promise<void> {
    if (this.suspendedThreadId === null) throw new Error('Not paused');

    const threadId = this.suspendedThreadId;
    const prevStepId = this.stepRequestId;

    // Clear previous step request if any
    if (prevStepId !== null) {
      try {
        await this.transport.sendWithWriter(JDWP_CMDSET.EVENT_REQUEST, 2, (w) => {
          w.writeByte(JDWP_EVENT_KIND.SINGLE_STEP);
          w.writeInt(prevStepId);
        });
      } catch { /* best-effort */ }
      this.stepRequestId = null;
    }

    // Set new step event: SINGLE_STEP with StepOnly + ThreadOnly
    const data = await this.transport.sendWithWriter(JDWP_CMDSET.EVENT_REQUEST, 1, (w) => {
      w.writeByte(JDWP_EVENT_KIND.SINGLE_STEP);
      w.writeByte(JDWP_SUSPEND_POLICY.EVENT_THREAD);
      w.writeInt(2); // 2 modifiers: StepOnly + ThreadOnly

      // StepOnly (modifier 10): thread + size + depth
      w.writeByte(10);
      w.writeObjectID(threadId, this.idSize('obj'));
      w.writeInt(STEP_SIZE.LINE);
      w.writeInt(depth);

      // ThreadOnly (modifier 3): thread
      w.writeByte(3);
      w.writeObjectID(threadId, this.idSize('obj'));
    });

    const r = new JDWPReader(data);
    this.stepRequestId = r.readInt();

    // Resume just this thread to start stepping
    await this.resumeThread(threadId);
    this.suspendedThreadId = null;
    this.frameCache.clear();
  }

  // ─── Inspection ────────────────────────────────────────────────

  async evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
    _options?: { returnByValue?: boolean; generatePreview?: boolean },
  ): Promise<EvaluateResult> {
    if (!this.enabled) throw new Error('JDWP adapter not enabled');

    // Extract frame index and threadId
    const idx = parseInt(callFrameId.replace('java_frame_', ''), 10);
    const tid = this.suspendedThreadId;
    if (isNaN(idx) || tid === null) {
      return { result: { type: 'string', value: expression }, exceptionDetails: { text: 'Not paused or invalid frame' } };
    }

    // Look up the actual frameID from cache
    const frames = this.frameCache.get(String(tid));
    const frameEntry = frames?.[idx];
    if (!frameEntry) {
      return { result: { type: 'string', value: expression }, exceptionDetails: { text: 'Frame not available' } };
    }

    // Try to evaluate expression as a variable lookup by scanning slots
    try {
      const MAX_SLOTS = 50;
      const slots: number[] = [];
      for (let i = 0; i < MAX_SLOTS; i++) slots.push(i);

      const data = await this.transport.sendWithWriter(JDWP_CMDSET.STACK_FRAME, 1, (w) => {
        w.writeObjectID(tid, this.idSize('obj'));
        w.writeObjectID(frameEntry.frameId, this.idSize('frame'));
        w.writeInt(slots.length);
        for (let i = 0; i < slots.length; i++) {
          w.writeInt(slots[i]!);
          w.writeByte(0);
        }
      });

      const r = new JDWPReader(data);
      const valuesCount = r.readInt();

      // Check if expression is 'this' or slot_0 (usually 'this' object)
      if (expression === 'this' || expression === 'this.') {
        if (valuesCount > 0) {
          const tag = r.readByte();
          const val = r.readTaggedValue(tag, this.idSize('obj'));
          return { result: { type: val.type, value: val.value, description: String(val.value ?? val.type), objectId: val.objectId } };
        }
      }

      // For full expression evaluation (e.g. `myVar.field`), we'd need
      // ObjectReference.InvokeMethod which is complex. For now, return null
      // and rely on getProperties for variable inspection.
      return { 
        result: { type: 'string', value: expression },
        exceptionDetails: { text: 'Expression evaluation not fully supported in JDWP. Use getProperties to inspect variables.' }
      };
    } catch (err) {
      return { result: { type: 'string', value: expression }, exceptionDetails: { text: String(err) } };
    }
  }

  async getProperties(
    objectId: string,
    _options?: { ownProperties?: boolean; generatePreview?: boolean },
  ): Promise<PropertiesResult> {
    if (!this.enabled) return { result: [] };

    // Parse objectId format: java_scope:threadId:frameIdx or jdwp_obj:objectId
    let threadId: bigint | null = null;
    let frameEntry: FrameEntry | null = null;
    let objectRefId: bigint | null = null;

    const scopeMatch = objectId.match(/^java_scope:(\d+):(\d+)$/);
    const objMatch = objectId.match(/^jdwp_obj:(\d+)$/);

    if (scopeMatch) {
      // Scope inspection: read local variables from a stack frame
      threadId = BigInt(scopeMatch[1]!);
      const frameIdx = parseInt(scopeMatch[2]!, 10);
      const frames = this.frameCache.get(String(threadId));
      frameEntry = frames?.[frameIdx] ?? null;
      if (!frameEntry) return { result: [] };
    } else if (objMatch) {
      // Object inspection: read fields from an object
      objectRefId = BigInt(objMatch[1]!);
    } else {
      return { result: [] };
    }

    try {
      if (frameEntry && threadId !== null) {
        // ── Read local variables from stack frame ──────────────
        // Try slots 0-50 to find all local variables
        const MAX_SLOTS = 50;
        const slots: number[] = [];
        const sigBytes: number[] = [];

        // Build slot list: try all slots 0..MAX_SLOTS-1
        // We use sigByte=0 telling JDWP to return values with their actual type tags.
        // If a slot is invalid/out of range, JDWP returns an error which we handle.
        for (let i = 0; i < MAX_SLOTS; i++) {
          slots.push(i);
          sigBytes.push(0); // 0 = JDWP will use actual type
        }

        const data = await this.transport.sendWithWriter(JDWP_CMDSET.STACK_FRAME, 1, (w) => {
          w.writeObjectID(threadId!, this.idSize('obj'));
          w.writeObjectID(frameEntry.frameId, this.idSize('frame'));
          w.writeInt(slots.length);
          for (let i = 0; i < slots.length; i++) {
            w.writeInt(slots[i]!);
            w.writeByte(sigBytes[i]!);
          }
        });

        const r = new JDWPReader(data);
        const valuesCount = r.readInt();
        const result: PropertyDescriptor[] = [];

        for (let i = 0; i < valuesCount && i < MAX_SLOTS; i++) {
          const tag = r.readByte();
          const value = r.readTaggedValue(tag, this.idSize('obj'));

          // Build display value from the typed result
          let displayValue: string;
          if (value.value === null || value.value === undefined) {
            displayValue = value.type === 'void' ? 'void' : 'null';
          } else if (value.type === 'string') {
            displayValue = String(value.value);
          } else if (value.type === 'object' && value.objectId) {
            // Only inline small values; reference objects can be expanded
            displayValue = `{@${value.objectId.slice(9)}${value.value ? ': ' + String(value.value).slice(0, 40) : ''}}`;
          } else {
            displayValue = String(value.value);
          }

          result.push({
            name: i === 0 ? 'this_ref' : `slot_${i}`, // slot 0: 'this_ref' for instance, param_0 for static
            value: {
              type: value.type,
              value: value.value ?? null,
              description: displayValue,
              objectId: value.objectId,
            },
            writable: false,
            configurable: false,
            enumerable: true,
            isOwn: true,
          });
        }

        return { result };
      } else if (objectRefId !== null) {
        // ── Read object fields via ObjectReference ─────────────
        // Use ReferenceType to get available fields, then ObjectReference.GetValues
        // For now, return empty — object field inspection requires field resolution.
        return { result: [] };
      }

      return { result: [] };
    } catch (err) {
      getLogger().debug({ err }, 'JDWP getProperties failed');
      return { result: [] };
    }
  }

  // ─── Event Handlers ────────────────────────────────────────────

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
