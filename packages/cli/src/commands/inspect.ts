/**
 * Command: inspect — Compact, AI-friendly snapshot of one app.
 *
 * Returns a single bounded, machine-readable (JSON) view combining liveness,
 * port health, recent log lines, and a quick error scan. Designed so an AI
 * assistant can "observe" a real running app (BE, FE, worker, console, ...)
 * cheaply and predictably: output is capped (token budget), secrets are
 * redacted, and the shape is stable. Use `--plain` for a short human summary.
 *
 *   fennec inspect <name|pid> [--plain] [--tail N] [--since 10m]
 */
import { existsSync, readFileSync } from 'node:fs';
import pc from 'picocolors';
import { symbols, renderAppName } from '../utils/format.js';
import { readTracked, isTrackedRunning, formatUptime } from './tracker.js';
import { checkPort } from '../utils/system-process.js';
import { logFilePathFor } from './tracker.js';
import {
  readLogLines,
  redactLine,
  stripAnsi,
  parseDuration,
  redactionCount,
  classifyLevel,
} from '../utils/redact.js';

const DEFAULT_TAIL = 40;
const MAX_TAIL = 200;

interface ProcMetrics {
  rssMb?: number;
  cpuPct?: number;
}

/** Best-effort RSS/CPU read from /proc. Returns undefined fields if unavailable. */
function readMetrics(pid: number): ProcMetrics {
  const m: ProcMetrics = {};
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
    const rssLine = status.split('\n').find((l) => l.startsWith('VmRSS:'));
    if (rssLine) {
      const kb = parseInt(rssLine.replace(/[^\d]/g, ''), 10);
      if (!isNaN(kb)) m.rssMb = Math.round((kb / 1024) * 10) / 10;
    }
  } catch {
    /* best-effort */
  }
  return m;
}

export async function inspectCommand(args: string[]): Promise<void> {
  const target = args[0];
  if (!target || target.startsWith('--')) {
    console.error(pc.dim(`Usage: fennec inspect <name|pid> [--plain] [--tail N] [--since 10m]`));
    process.exit(1);
  }
  const plain = args.includes('--plain');
  const tailIndex = args.indexOf('--tail');
  const tail =
    tailIndex !== -1
      ? Math.min(parseInt(args[tailIndex + 1]!, 10) || DEFAULT_TAIL, MAX_TAIL)
      : DEFAULT_TAIL;
  const sinceIndex = args.indexOf('--since');
  const sinceMs = sinceIndex !== -1 ? parseDuration(args[sinceIndex + 1]!) : undefined;
  if (sinceIndex !== -1 && sinceMs === undefined) {
    console.error(pc.red(`Invalid --since. Use e.g. 10m, 1h, 30s.`));
    process.exit(1);
  }

  const tracked = readTracked();
  const proc = tracked.find(
    (t) => t.name === target || (parseInt(target, 10) === t.pid && !isNaN(parseInt(target, 10))),
  );
  if (!proc) {
    console.error(pc.red(`No tracked app named "${target}".`));
    process.exit(1);
  }

  const running = isTrackedRunning(proc);
  const logPath = logFilePathFor(proc.name);
  const lines = readLogLines(logPath, {
    tail: Math.max(tail, sinceMs ? MAX_TAIL : 0),
    sinceMs: sinceMs ?? undefined,
    redact: true,
    parseTimestamp: true,
  });
  const recent = lines.slice(-tail);
  const errorLines = lines.filter((l) => classifyLevel(l) === 'error').slice(-15);
  const redactedLines = recent.reduce(
    (acc, l) => acc + (redactionCount(stripAnsi(l)) > 0 ? 1 : 0),
    0,
  );
  const metrics = running ? readMetrics(proc.pid) : {};

  let portHealthy: boolean | null = null;
  if (proc.port) {
    try {
      portHealthy = await checkPort(proc.port);
    } catch {
      portHealthy = false;
    }
  }

  const startedAt = Date.parse(proc.startedAt);
  const uptimeSec = running && !isNaN(startedAt) ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  if (plain) {
    const dot = running ? pc.green('●') : pc.red('○');
    const portStr = proc.port
      ? ` :${proc.port}${portHealthy === false ? pc.red(' (port down!)') : portHealthy ? pc.green(' (up)') : ''}`
      : '';
    console.error(
      `\n  ${symbols.fox} ${renderAppName(proc.name)}${portStr} ${dot} ${running ? pc.green(`running PID ${proc.pid}`) : pc.red('stopped')}`,
    );
    console.error(
      `  ${pc.dim('uptime')} ${pc.cyan(uptimeSec ? formatUptime(uptimeSec) : '—')}  ${pc.dim('rss')} ${pc.cyan(metrics.rssMb ? `${metrics.rssMb}MB` : '—')}  ${pc.dim('errors(last)')} ${pc.cyan(String(errorLines.length))}  ${pc.dim('redacted')} ${pc.cyan(String(redactedLines))}`,
    );
    if (errorLines.length) {
      console.error(`\n  ${pc.bold(pc.red('Recent errors:'))}`);
      for (const l of errorLines.slice(-8))
        console.error(`  ${pc.red(stripAnsi(l).slice(0, 300))}`);
    }
    console.error();
    return;
  }

  const payload = {
    name: proc.name,
    running,
    pid: running ? (proc.pid ?? null) : null,
    port: proc.port ?? null,
    portHealthy,
    autoRestart: proc.autoRestart ?? false,
    uptimeSec,
    metrics,
    logTail: recent,
    errorCount: errorLines.length,
    errors: errorLines,
    redacted: true,
    redactedLines,
    note: 'Secrets redacted by default. Bounded snapshot for AI observation.',
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}
