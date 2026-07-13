/**
 * MCP tools that mirror the CLI's resilience/observability features so an
 * AI agent can manage and observe apps as wisely as the CLI user:
 *
 *  - inspect            Bounded, redacted snapshot (status + logs + errors).
 *  - supervisor_control Start/stop/status/restart the detached supervisor
 *                       daemon that keeps --restart apps alive (survives the
 *                       MCP server exiting) and health-checks their ports.
 *  - persist_control    Make fennec survive reboots (install a boot unit).
 *
 * The supervisor/persist tools drive the CLI binary so behavior stays in
 * lockstep with `fennec supervisor` / `fennec persist`.
 */
import { z } from 'zod';
import { createTool } from '../_registry.js';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { readTracked } from '../../process/tracking.js';
import { isProcessRunning } from '../../utils/system-process.js';
import {
  readLogLines,
  readLogLinesFromOffset,
  redactionCount,
  clampLineCount,
  HARD_LOG_CAP,
} from '../../process/redact.js';

/** Resolve the fennec CLI binary. Prefers the sibling CLI package, else npx. */
function cliPath(): string {
  try {
    // CLI is a sibling package in the same monorepo build.
    const candidates = [
      resolve(__dirname, '..', '..', '..', 'cli', 'dist', 'index.js'),
      resolve(__dirname, '..', '..', '..', '..', 'cli', 'dist', 'index.js'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } catch {
    /* fall through */
  }
  return 'fennec'; // rely on PATH / npx
}

/** Is the resolved CLI path a node script (vs a bare command)? */
function cliIsScript(): boolean {
  return cliPath().endsWith('.js');
}

function runCli(args: string[]): { ok: boolean; out: string } {
  const bin = cliPath();
  const fullArgs = cliIsScript() ? [bin, ...args] : args;
  const cmd = cliIsScript() ? process.execPath : bin;
  const env = { ...process.env };
  try {
    const out = execFileSync(cmd, fullArgs, { encoding: 'utf-8', timeout: 15000, env })
      .toString()
      .trim();
    return { ok: true, out };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    const out = (e.stdout ?? e.stderr ?? Buffer.from('')).toString().trim();
    return { ok: false, out };
  }
}

function logPathFor(name: string): string {
  const dir = process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), '.fennec');
  return resolve(dir, 'logs', `${name}.log`);
}

function supervisorPidPath(): string {
  const dir = process.env.FENNEC_DATA_DIR
    ? resolve(process.env.FENNEC_DATA_DIR)
    : resolve(homedir(), '.fennec');
  return resolve(dir, 'supervisor.pid');
}

function getSupervisorPid(): number | null {
  const p = supervisorPidPath();
  if (!existsSync(p)) return null;
  const pid = parseInt(readFileSync(p, 'utf-8').trim(), 10);
  if (isNaN(pid)) return null;
  return isProcessRunning(pid) ? pid : null;
}

// ─── inspect ────────────────────────────────────────────────────────
export const inspect = createTool({
  name: 'inspect',
  category: 'process',
  description:
    '`<use_case>OBSERVING an app for AI</use_case> Compact, BOUNDED, SECRET-REDACTED snapshot of one tracked app (CLI or MCP started). Output is HARD-CAPPED (≤200 lines; tightened further by the AI token budget) so it never fills the context window. Returns running, pid, port + portHealthy, uptimeSec, rssMb, recent redacted log lines, error scan, and a watermark. For continuous monitoring use watch:true with sinceOffset (watermark) — returns ONLY new lines, no duplicates, no full re-read. Prefer watch mode over large snapshots. Options: tail (default 40, cap 200), since (e.g. 10m).`',
  inputSchema: z.object({
    name: z.string().describe('App name (from process_get_tracked / fennec ps)'),
    tail: z.number().optional().default(40).describe('Max recent log lines (cap 200)'),
    since: z
      .string()
      .optional()
      .describe('Only consider lines from the last duration, e.g. 10m, 1h, 30s'),
    watch: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'AI real-time mode: return only lines after `sinceOffset` plus a new watermark. Poll with the returned watermark to get new lines without re-downloading the file (token-efficient).',
      ),
    sinceOffset: z
      .number()
      .optional()
      .describe(
        'Byte offset (watermark from a previous watch call). Only lines written after this offset are returned.',
      ),
  }),
  handler: async (input, { responseBuilder, tokenBudget }) => {
    try {
      const tracked = readTracked();
      const proc = tracked.find((t) => t.name === input.name);
      if (!proc) {
        return responseBuilder.error(new Error(`No tracked app named "${input.name}"`), {
          code: 'PROCESS_NOT_FOUND',
        });
      }
      const running = isProcessRunning(proc.pid);
      // Hard-bounded line count (token-safe). Tightens further if the AI
      // context has a token budget. Never returns more than this.
      const cap = clampLineCount(input.tail, 40, 200, tokenBudget);
      const sinceMs = input.since ? parseDuration(input.since) : undefined;
      const logPath = logPathFor(proc.name);

      // ── Watch mode: only NEW lines since the watermark (no overlap/dupes) ──
      if (input.watch) {
        const { lines: raw, watermark } = readLogLinesFromOffset(logPath, input.sinceOffset, cap);
        // Clamp to cap so a long silence-then-burst can't overflow context.
        const lines = raw.slice(-cap);
        const redactedLines = lines.reduce((acc, l) => acc + (redactionCount(l) > 0 ? 1 : 0), 0);
        return responseBuilder.success({
          name: proc.name,
          running,
          watch: true,
          watermark,
          newLines: lines,
          count: lines.length,
          capped: raw.length > lines.length,
          redacted: true,
          redactedLines,
          note: 'Poll with watermark to stream only new lines (no duplicates, no full re-read). Secrets redacted.',
        });
      }

      const lines = readLogLines(logPath, {
        tail: Math.max(cap, sinceMs ? HARD_LOG_CAP : 0),
        sinceMs: sinceMs ?? undefined,
        parseTimestamp: true,
      });
      const recent = lines.slice(-cap);
      const errors = lines
        .filter((l) => /\b(error|fail|failed|fatal|exception|denied|unhandled)\b/i.test(l))
        .slice(-15);
      const redactedLines = recent.reduce((acc, l) => acc + (redactionCount(l) > 0 ? 1 : 0), 0);
      const watermark = existsSync(logPath) ? statSync(logPath).size : 0;

      let portHealthy: boolean | null = null;
      if (proc.port) {
        portHealthy = await checkPort(proc.port);
      }

      let rssMb: number | undefined;
      try {
        const status = readFileSync(`/proc/${proc.pid}/status`, 'utf-8');
        const rss = status.split('\n').find((l) => l.startsWith('VmRSS:'));
        if (rss) rssMb = Math.round((parseInt(rss.replace(/[^\d]/g, ''), 10) / 1024) * 10) / 10;
      } catch {
        /* best-effort */
      }

      const startedAt = Date.parse(proc.startedAt);
      const uptimeSec =
        running && !isNaN(startedAt) ? Math.floor((Date.now() - startedAt) / 1000) : 0;

      return responseBuilder.success({
        name: proc.name,
        running,
        pid: running ? (proc.pid ?? null) : null,
        port: proc.port ?? null,
        portHealthy,
        autoRestart: proc.autoRestart ?? false,
        uptimeSec,
        rssMb,
        logTail: recent,
        watermark,
        errorCount: errors.length,
        errors,
        redacted: true,
        redactedLines,
        note: 'Secrets redacted by default. Bounded snapshot for AI observation.',
      });
    } catch (error) {
      return responseBuilder.error(error, { code: 'INSPECT_FAILED' });
    }
  },
});

// ─── supervisor_control ─────────────────────────────────────────────
export const supervisorControl = createTool({
  name: 'supervisor_control',
  category: 'process',
  description:
    '`<use_case>MANAGING app resilience</use_case> Control the detached supervisor daemon that keeps --restart apps alive (survives the MCP server exiting) and health-checks their ports (restarts apps that are alive but not listening). Actions: start | stop | status | restart. Status returns running (bool), pid, and the managed apps. Starting is automatic when you start an app with autoRestart; this lets you inspect/control it directly.`',
  inputSchema: z.object({
    action: z.enum(['start', 'stop', 'status', 'restart']).describe('Supervisor action'),
  }),
  handler: async (input, { responseBuilder }) => {
    try {
      if (input.action === 'status') {
        const pid = getSupervisorPid();
        const tracked = readTracked();
        const managed = tracked.filter((t) => t.autoRestart);
        return responseBuilder.success({
          running: pid !== null,
          pid,
          managedApps: managed.map((m) => ({
            name: m.name,
            running: isProcessRunning(m.pid),
            pid: m.pid,
          })),
        });
      }
      const res = runCli(['supervisor', input.action]);
      const pid = getSupervisorPid();
      return responseBuilder.success({
        action: input.action,
        ok: input.action === 'stop' ? res.ok || pid === null : res.ok || pid !== null,
        supervisorPid: pid,
        output: res.out.split('\n').filter(Boolean).slice(-4),
      });
    } catch (error) {
      return responseBuilder.error(error, { code: 'SUPERVISOR_FAILED' });
    }
  },
});

// ─── persist_control ────────────────────────────────────────────────
export const persistControl = createTool({
  name: 'persist_control',
  category: 'process',
  description:
    '`<use_case>SURVIVING reboots</use_case> Manage boot persistence: install a boot unit (systemd user service / launchd / Windows startup) that starts the supervisor at login, which then resurrects all --restart apps. Actions: enable | disable | status. Equivalent to `fennec persist`. Enable is also automatic when an app is started with autoRestart.`',
  inputSchema: z.object({
    action: z.enum(['enable', 'disable', 'status']).describe('Persistence action'),
  }),
  handler: async (input, { responseBuilder }) => {
    try {
      if (input.action === 'status') {
        const res = runCli(['persist', 'status']);
        return responseBuilder.success({
          action: 'status',
          ok: true,
          output: res.out.split('\n').filter(Boolean).slice(-6),
        });
      }
      const res = runCli(['persist', input.action]);
      return responseBuilder.success({
        action: input.action,
        ok: res.ok,
        output: res.out.split('\n').filter(Boolean).slice(-4),
      });
    } catch (error) {
      return responseBuilder.error(error, { code: 'PERSIST_FAILED' });
    }
  },
});

// ─── helpers ────────────────────────────────────────────────────────
function parseDuration(input: string): number | null {
  const m = input.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  const mul =
    m[2]!.toLowerCase() === 's'
      ? 1000
      : m[2]!.toLowerCase() === 'm'
        ? 60_000
        : m[2]!.toLowerCase() === 'h'
          ? 3_600_000
          : 86_400_000;
  return n * mul;
}

async function checkPort(port: number): Promise<boolean> {
  // Minimal TCP probe (avoids importing the CLI's checkPort). Tries both
  // IPv4 and IPv6 loopback so apps bound to localhost (::1) aren't falsely
  // reported as not listening.
  const { connect } = await import('node:net');
  const tryHost = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = connect(port, host);
      const done = (r: boolean) => {
        try {
          socket.destroy();
        } catch {
          /* noop */
        }
        resolve(r);
      };
      socket.setTimeout(1000);
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.once('timeout', () => done(false));
    });
  return (await tryHost('127.0.0.1')) || (await tryHost('::1'));
}
