/**
 * Cassette Recorder — VCR-like record/replay/diff for MCP tool call sessions.
 *
 * Leverages Fennec's existing AuditLog middleware infrastructure to capture
 * all tool calls with input/output/duration, stored as "cassettes" (JSON files).
 *
 * Tools:
 * - debug_record_session  → mulai rekam, semua tool call dicapture
 * - debug_stop_recording  → stop + simpan cassette
 * - debug_replay_session  → replay cassette (compare output vs original)
 * - debug_diff_sessions   → diff dua cassette
 *
 * Data flow:
 *   AuditLog middleware → Cassette (JSON file) → Replay engine → Diff
 *
 * Cross-platform: filesystem + JSON — works on Linux/macOS/Windows.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { getLogger } from '../../utils/logger.js';
import type { MiddlewareFn } from '../../middleware/Pipeline.js';

// ─── Types ───────────────────────────────────────────────────────

export interface CassetteEntry {
  id: string;
  timestamp: string;
  toolName: string;
  category?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
  success: boolean;
}

export interface Cassette {
  id: string;
  name: string;
  description: string;
  startedAt: string;
  completedAt: string;
  sessionId: string | null;
  entries: CassetteEntry[];
  metadata: {
    fennecVersion: string;
    totalTools: number;
    totalDurationMs: number;
    successRate: number;
    tags: string[];
  };
}

export interface CassetteDiff {
  cassetteA: string;
  cassetteB: string;
  summary: {
    totalCallsA: number;
    totalCallsB: number;
    matching: number;
    different: number;
    onlyInA: number;
    onlyInB: number;
    regressions: number;
  };
  diffs: Array<{
    index: number;
    toolName: string;
    status: 'matched' | 'different' | 'regression' | 'only_in_a' | 'only_in_b';
    durationA?: number;
    durationB?: number;
    durationDiff?: number;
    outputA?: Record<string, unknown>;
    outputB?: Record<string, unknown>;
  }>;
}

// ─── Cassette Storage ────────────────────────────────────────────

const CASSETTE_DIR = resolve(
  process.env.FENNEC_HOME ?? process.env.FENNEC_DATA_DIR ?? homedir(),
  '.fennec',
  'cassettes',
);

function ensureDir(): void {
  if (!existsSync(CASSETTE_DIR)) {
    mkdirSync(CASSETTE_DIR, { recursive: true });
  }
}

function cassettePath(id: string): string {
  return resolve(CASSETTE_DIR, `${id}.json`);
}

// ─── Cassette Recorder ───────────────────────────────────────────

export class CassetteRecorder {
  private currentCassette: Cassette | null = null;
  private recording = false;
  private cassetteCounter = 0;

  /**
   * Create a recording middleware that captures all tool calls.
   * Use as: pipeline.use(cassetteRecorder.middleware())
   */
  middleware(): MiddlewareFn {
    return async (ctx, next) => {
      const result = await next();

      if (!this.recording || !this.currentCassette) return result;

      const resultObj = result as Record<string, unknown>;
      const isError = resultObj?.success === false;

      const entry: CassetteEntry = {
        id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        toolName: ctx.toolName,
        category: ctx.category,
        input: { ...ctx.input },
        output: isError ? null : (resultObj as Record<string, unknown>),
        error: isError
          ? String((resultObj.error as Record<string, unknown> | undefined)?.message ?? 'Unknown error')
          : null,
        durationMs: Date.now() - ctx.startTime,
        success: !isError,
      };

      this.currentCassette.entries.push(entry);
      this.currentCassette.metadata.totalDurationMs += entry.durationMs;

      return result;
    };
  }

  /**
   * Start recording a new session.
   */
  startRecording(name?: string, description?: string, sessionId?: string): string {
    this.cassetteCounter++;
    const id = `cassette_${Date.now()}_${this.cassetteCounter}`;

    this.currentCassette = {
      id,
      name: name ?? `Recording ${new Date().toLocaleString()}`,
      description: description ?? '',
      startedAt: new Date().toISOString(),
      completedAt: '',
      sessionId: sessionId ?? null,
      entries: [],
      metadata: {
        fennecVersion: '1.14.12',
        totalTools: 0,
        totalDurationMs: 0,
        successRate: 0,
        tags: [],
      },
    };

    this.recording = true;
    getLogger().info({ cassetteId: id, name }, 'Cassette: recording started');
    return id;
  }

  /**
   * Stop recording and save the cassette to disk.
   */
  stopRecording(): Cassette | null {
    if (!this.currentCassette) return null;

    this.recording = false;
    this.currentCassette.completedAt = new Date().toISOString();
    this.currentCassette.metadata.totalTools = this.currentCassette.entries.length;

    const total = this.currentCassette.entries.length;
    const success = this.currentCassette.entries.filter((e) => e.success).length;
    this.currentCassette.metadata.successRate = total > 0 ? Math.round((success / total) * 100) : 0;

    const cassette = { ...this.currentCassette };

    // Save to disk
    ensureDir();
    writeFileSync(cassettePath(cassette.id), JSON.stringify(cassette, null, 2), 'utf-8');

    this.currentCassette = null;
    getLogger().info(
      { cassetteId: cassette.id, entries: cassette.entries.length, path: cassettePath(cassette.id) },
      'Cassette: recording saved',
    );

    return cassette;
  }

  /**
   * Get current recording status.
   */
  getStatus(): { recording: boolean; currentId: string | null; entryCount: number } {
    return {
      recording: this.recording,
      currentId: this.currentCassette?.id ?? null,
      entryCount: this.currentCassette?.entries.length ?? 0,
    };
  }

  /**
   * List all saved cassettes.
   */
  listCassettes(): Cassette[] {
    ensureDir();
    const result: Cassette[] = [];
    try {
      const files = readdirSync(CASSETTE_DIR).filter((f) => f.endsWith('.json'));
      for (const file of files.slice(-50)) {
        try {
          const data = readFileSync(resolve(CASSETTE_DIR, file), 'utf-8');
          result.push(JSON.parse(data));
        } catch { /* skip corrupted */ }
      }
    } catch { /* dir not found */ }
    return result.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  /**
   * Get a cassette by ID.
   */
  getCassette(id: string): Cassette | null {
    // Check in-memory first
    if (this.currentCassette?.id === id) return { ...this.currentCassette };

    // Check disk
    const path = cassettePath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as Cassette;
    } catch {
      return null;
    }
  }

  /**
   * Replay a cassette: compare current execution against original.
   * Returns a CassetteDiff showing what changed.
   */
  async replayCassette(
    id: string,
    toolExecutor: (toolName: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ): Promise<CassetteDiff> {
    const original = this.getCassette(id);
    if (!original) throw new Error(`Cassette not found: ${id}`);      const replayed: CassetteEntry[] = [];
      for (const entry of original.entries) {
        const start = Date.now();
        try {
          const output = await toolExecutor(entry.toolName, entry.input);
          const resultObj = output as Record<string, unknown>;
          const isError = resultObj?.success === false;
          replayed.push({
            ...entry,
            output: isError ? null : resultObj,
            error: isError ? String(resultObj.error ?? 'Error') : null,
            success: !isError,
            durationMs: Date.now() - start,
          });
        } catch (err) {
          replayed.push({
            ...entry,
            output: null,
            error: String(err),
            success: false,
            durationMs: Date.now() - start,
          });
        }
      }

    return this.diff(id, original, replayed);
  }

  /**
   * Diff two versions of a cassette (or original vs replayed).
   */
  diff(originalId: string, original: Cassette, replayed: CassetteEntry[]): CassetteDiff {
    const maxLen = Math.max(original.entries.length, replayed.length);
    const diffs: CassetteDiff['diffs'] = [];
    let different = 0;
    let regressions = 0;
    let onlyInA = 0;
    let onlyInB = 0;

    for (let i = 0; i < maxLen; i++) {
      const entryA = original.entries[i];
      const entryB = replayed[i];

      if (!entryA && entryB) {
        onlyInB++;
        diffs.push({ index: i, toolName: entryB.toolName, status: 'only_in_b', outputB: entryB.output ?? undefined });
        continue;
      }
      if (entryA && !entryB) {
        onlyInA++;
        diffs.push({ index: i, toolName: entryA.toolName, status: 'only_in_a', outputA: entryA.output ?? undefined });
        continue;
      }

      const same = entryA!.success === entryB!.success;
      const wasSuccess = entryA!.success && !entryB!.success;

      if (!same) {
        different++;
        if (wasSuccess) regressions++;
        diffs.push({
          index: i,
          toolName: entryA!.toolName,
          status: wasSuccess ? 'regression' : 'different',
          durationA: entryA!.durationMs,
          durationB: entryB!.durationMs,
          durationDiff: entryB!.durationMs - entryA!.durationMs,
          outputA: entryA!.output ?? undefined,
          outputB: entryB!.output ?? undefined,
        });
      } else {
        diffs.push({
          index: i,
          toolName: entryA!.toolName,
          status: 'matched',
          durationA: entryA!.durationMs,
          durationB: entryB!.durationMs,
          durationDiff: entryB!.durationMs - entryA!.durationMs,
        });
      }
    }

    return {
      cassetteA: originalId,
      cassetteB: 'replay',
      summary: {
        totalCallsA: original.entries.length,
        totalCallsB: replayed.length,
        matching: maxLen - different - onlyInA - onlyInB,
        different,
        onlyInA,
        onlyInB,
        regressions,
      },
      diffs,
    };
  }
}

/** Singleton instance. */
let _cassetteInstance: CassetteRecorder | null = null;

export function getCassetteRecorder(): CassetteRecorder {
  if (!_cassetteInstance) {
    _cassetteInstance = new CassetteRecorder();
  }
  return _cassetteInstance;
}
