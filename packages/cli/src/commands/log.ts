/**
 * Command: log — Show logs for a tracked/managed process.
 * Supports --clear to delete log file, --level to filter by level, and -f for follow mode.
 */
import {
  existsSync,
  readFileSync,
  unlinkSync,
  statSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import pc from 'picocolors';
import { symbols, renderError, renderAppName, createSpinner } from '../utils/format.js';
import { readTracked, isTrackedRunning, logFilePathFor } from './tracker.js';
import {
  redactLine,
  stripAnsi,
  readLogLines,
  parseDuration,
  redactionCount,
} from '../utils/redact.js';

/** Hard cap on lines emitted (token budget) so AI/json inspection stays bounded. */
const MAX_LOG_LINES = 500;

/** Known log-level prefixes to color/highlight */
const LEVEL_PATTERNS: { level: string; pattern: RegExp }[] = [
  { level: 'error', pattern: /\b(ERROR?|FATAL?|CRITICAL?|EXCEPTION)\b/i },
  { level: 'warn', pattern: /\b(WARN(ING)?)\b/i },
  { level: 'info', pattern: /\b(INFO)\b/i },
  { level: 'debug', pattern: /\b(DEBUG)\b/i },
];

export async function logCommand(args: string[]): Promise<void> {
  const target = args[0];
  if (!target || target.startsWith('--')) {
    // No app specified: show available apps so the user knows what to log.
    listAvailableApps();
    return;
  }

  const clearFlag = args.includes('--clear');
  const jsonFlag = args.includes('--json');
  const noRedact = args.includes('--no-redact');
  const linesIndex = args.indexOf('--lines');
  const lineCount =
    linesIndex !== -1 ? Math.min(parseInt(args[linesIndex + 1]!, 10), MAX_LOG_LINES) : 30;
  const followFlag = args.includes('-f') || args.includes('--follow');
  const levelFilter = args.includes('--level')
    ? args[args.indexOf('--level') + 1]?.toLowerCase()
    : undefined;
  const sinceIndex = args.indexOf('--since');
  const sinceMs = sinceIndex !== -1 ? parseDuration(args[sinceIndex + 1]!) : undefined;

  if (sinceIndex !== -1 && sinceMs === undefined) {
    console.error(renderError('Invalid --since', `Use a duration like 10m, 1h, 30s, 2d`));
    process.exit(1);
  }

  // Validate level filter
  if (levelFilter && !['error', 'warn', 'info', 'debug'].includes(levelFilter)) {
    console.error(
      renderError(
        'Invalid level',
        `"${levelFilter}" is not a valid level. Use: error, warn, info, debug`,
      ),
    );
    process.exit(1);
  }

  // Secrets are redacted by default (AI-safe). --no-redact opts out.
  const redact = !noRedact;

  let logFilePath: string | null = null;
  let displayName = target;
  const tracked = readTracked();
  const trackedMatch = tracked.find(
    (t) => t.name === target || (parseInt(target, 10) === t.pid && !isNaN(parseInt(target, 10))),
  );

  if (trackedMatch) {
    displayName = trackedMatch.name;
    logFilePath = logFilePathFor(trackedMatch.name);
  } else {
    const pid = parseInt(target, 10);
    if (!isNaN(pid) && String(pid) === target) {
      const procPath = `/proc/${pid}/fd/1`;
      if (existsSync(procPath)) logFilePath = procPath;
    }
  }

  // --clear flag: delete the log file
  if (clearFlag) {
    if (!logFilePath || !existsSync(logFilePath)) {
      console.error(
        `\n  ${pc.yellow('⚠')} ${pc.dim('No log file found for')} ${pc.bold(displayName)}\n`,
      );
      process.exit(0);
    }
    try {
      unlinkSync(logFilePath);
      console.error(
        `\n  ${pc.green('✓')} ${pc.bold('Log cleared')} ${pc.dim(`— ${logFilePath}`)}\n`,
      );
    } catch (err) {
      console.error(renderError('Failed to clear log', String(err)));
      process.exit(1);
    }
    return;
  }

  // ── JSON mode (AI): emit machine-readable, redacted, bounded output.
  //    Must run BEFORE any human header so stdout stays valid JSON.
  if (jsonFlag) {
    let logLines: string[] = [];
    if (logFilePath && existsSync(logFilePath)) {
      logLines = readLogLines(logFilePath, {
        tail: Math.max(lineCount, sinceMs ? MAX_LOG_LINES : 0),
        sinceMs: sinceMs ?? undefined,
        redact,
        parseTimestamp: true,
      });
    } else {
      const pid = trackedMatch?.pid ?? parseInt(target, 10);
      if (!isNaN(pid)) {
        try {
          const output = execSync(
            `journalctl --no-pager -n ${Math.max(lineCount, 500)} _PID=${pid} 2>/dev/null || echo ""`,
            { encoding: 'utf-8', timeout: 3000 },
          );
          logLines = output
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => (redact ? redactLine(stripAnsi(l)) : stripAnsi(l)));
        } catch {
          logLines = ['(no logs available)'];
        }
      } else {
        logLines = ['(no logs available)'];
      }
    }
    if (levelFilter) {
      const levelRegex = new RegExp(`\\b(${levelFilter.toUpperCase()})\\b`, 'i');
      logLines = logLines.filter((line) => levelRegex.test(line));
    }
    const running = trackedMatch ? isTrackedRunning(trackedMatch) : false;
    const sliced = logLines.slice(-lineCount);
    const redactedHits = sliced.reduce(
      (acc, l) => acc + (redactionCount(stripAnsi(l)) > 0 ? 1 : 0),
      0,
    );
    const payload = {
      app: displayName,
      running,
      pid: trackedMatch?.pid != null ? trackedMatch.pid : null,
      port: trackedMatch?.port != null ? trackedMatch.port : null,
      lines: sliced,
      count: sliced.length,
      redacted: redact,
      redactedLines: redactedHits,
      note: 'Secrets are redacted by default; use --no-redact to disable.',
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  // Status header: tell the user whether the app is actually alive.
  if (trackedMatch) {
    const running = isTrackedRunning(trackedMatch);
    const statusStr = running
      ? pc.green(`● running (PID ${trackedMatch.pid})`)
      : pc.red('○ stopped');
    const portStr = trackedMatch.port ? ` ${pc.yellow(`:${trackedMatch.port}`)}` : '';
    console.error(`\n  ${symbols.fox} ${renderAppName(displayName)}${portStr} — ${statusStr}`);
    if (!running) {
      console.error(
        `  ${pc.dim('This app is not running. Showing last captured logs.')} ${pc.cyan(`fennec spawn ${displayName}`)} ${pc.dim('to restart.')}`,
      );
    }
  }

  const spinner = createSpinner(`Reading logs for ${displayName}...`);
  try {
    let logLines: string[] = [];
    if (logFilePath && existsSync(logFilePath)) {
      logLines = readLogLines(logFilePath, {
        tail: Math.max(lineCount, sinceMs ? MAX_LOG_LINES : 0),
        sinceMs: sinceMs ?? undefined,
        redact,
        parseTimestamp: true,
      });
    } else {
      const pid = trackedMatch?.pid ?? parseInt(target, 10);
      if (!isNaN(pid)) {
        try {
          const output = execSync(
            `journalctl --no-pager -n ${Math.max(lineCount, 500)} _PID=${pid} 2>/dev/null || echo ""`,
            { encoding: 'utf-8', timeout: 3000 },
          );
          logLines = output
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => (redact ? redactLine(stripAnsi(l)) : stripAnsi(l)));
        } catch {
          logLines = ['(no logs available)'];
        }
      } else {
        logLines = ['(no logs available)'];
      }
    }

    // Apply level filter
    if (levelFilter) {
      const levelRegex = new RegExp(`\\b(${levelFilter.toUpperCase()})\\b`, 'i');
      logLines = logLines.filter((line) => levelRegex.test(line));
    }

    spinner.stop();
    process.stdout.write('\r\x1b[K');
    console.error(
      `\n  ${symbols.fox} ${pc.bold('Logs')} ${renderAppName(displayName)} ${pc.dim(`(last ${logLines.length} line${logLines.length !== 1 ? 's' : ''})${redact ? pc.dim(' · secrets redacted') : ''})`)}`,
    );

    const sliced = logLines.slice(-lineCount);
    for (const line of sliced) {
      const display = line.length > 300 ? line.slice(0, 300) + '…' : line;

      // Color by level
      if (
        line.toLowerCase().includes('error') ||
        line.toLowerCase().includes('fail') ||
        line.toLowerCase().includes('fatal')
      ) {
        console.error(`  ${pc.red(display)}`);
      } else if (line.toLowerCase().includes('warn')) {
        console.error(`  ${pc.yellow(display)}`);
      } else if (line.toLowerCase().includes('info') || line.includes('[')) {
        console.error(`  ${pc.cyan(display)}`);
      } else {
        console.error(`  ${display}`);
      }
    }

    if (followFlag && logFilePath) {
      await followLog(logFilePath, { redact, levelFilter, json: jsonFlag });
    }
    console.error();
  } catch (error) {
    spinner.fail(`Failed to read logs for ${displayName}`);
    console.error(renderError('Log read failed', String(error)));
  }
}

/**
 * Portable `tail -f` replacement: prints the initial lines (done by the
 * caller), then polls the file for appended bytes and streams new lines to
 * stderr. Handles log rotation (file shrinks → reset offset). Cross-platform
 * (no `tail` binary dependency). Ctrl+C stops it.
 */
async function followLog(
  logFilePath: string,
  opts: { redact: boolean; levelFilter?: string; json: boolean },
): Promise<void> {
  let lastSize = 0;
  try {
    lastSize = statSync(logFilePath).size;
  } catch {
    /* file may not exist yet */
  }

  console.error(`\n  ${pc.dim('Following... (Ctrl+C to stop)')}\n`);
  const levelRe = opts.levelFilter
    ? new RegExp(`\\b(${opts.levelFilter.toUpperCase()})\\b`, 'i')
    : null;

  const emit = (raw: string): void => {
    const line = opts.redact ? redactLine(raw) : raw;
    if (levelRe && !levelRe.test(line)) return;
    if (opts.json) {
      try {
        process.stdout.write(JSON.stringify(JSON.parse(line)) + '\n');
        return;
      } catch {
        /* not valid JSON — fall through to plain print */
      }
    }
    const display = line.length > 300 ? line.slice(0, 300) + '…' : line;
    if (
      line.toLowerCase().includes('error') ||
      line.toLowerCase().includes('fail') ||
      line.toLowerCase().includes('fatal')
    ) {
      console.error(`  ${pc.red(display)}`);
    } else if (line.toLowerCase().includes('warn')) {
      console.error(`  ${pc.yellow(display)}`);
    } else if (line.toLowerCase().includes('info') || line.includes('[')) {
      console.error(`  ${pc.cyan(display)}`);
    } else {
      console.error(`  ${display}`);
    }
  };

  const timer = setInterval(() => {
    let fd: number;
    try {
      fd = openSync(logFilePath, 'r');
    } catch {
      return; // not created yet
    }
    try {
      const size = fstatSync(fd).size;
      if (size < lastSize) lastSize = 0; // rotated
      if (size > lastSize) {
        const buf = Buffer.alloc(size - lastSize);
        readSync(fd, buf, 0, buf.length, lastSize);
        lastSize = size;
        for (const l of buf.toString('utf8').split('\n')) {
          if (l.length) emit(l);
        }
      }
    } finally {
      closeSync(fd);
    }
  }, 400);

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      clearInterval(timer);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

/**
 * When `fennec log` / `fennec logs` is run without an app name, list the
 * tracked apps (with live status) so the user can pick one instead of
 * hitting an error.
 */
function listAvailableApps(): void {
  const tracked = readTracked();

  if (tracked.length === 0) {
    console.error(`\n  ${symbols.fox} ${pc.bold('No tracked apps to show logs for.')}`);
    console.error(
      `  ${pc.dim('Start one with:')} ${pc.cyan('fennec start <command> --name <name>')}\n`,
    );
    return;
  }

  console.error(`\n  ${symbols.fox} ${pc.bold('Logs')} ${pc.dim('— pick an app:')}\n`);
  for (const t of tracked) {
    const running = isTrackedRunning(t);
    const dot = running ? pc.green('●') : pc.red('○');
    const state = running ? pc.green(`running (PID ${t.pid})`) : pc.red('stopped');
    const portStr = t.port ? ` ${pc.yellow(`:${t.port}`)}` : '';
    console.error(`  ${dot} ${pc.bold(t.name)}${portStr} ${pc.dim('—')} ${state}`);
    console.error(
      `      ${pc.cyan(`fennec log ${t.name}`)} ${pc.dim('·')} ${pc.cyan(`fennec log ${t.name} -f`)}`,
    );
  }
  console.error(
    `\n  ${pc.dim('Flags:')} ${pc.cyan('-f')} ${pc.dim('follow')} ${pc.dim('·')} ${pc.cyan('--lines N')} ${pc.dim('·')} ${pc.cyan('--since 10m|1h')} ${pc.dim('·')} ${pc.cyan('--level error|warn|info|debug')} ${pc.dim('·')} ${pc.cyan('--json')} ${pc.dim('(AI)')} ${pc.dim('·')} ${pc.cyan('--no-redact')} ${pc.dim('·')} ${pc.cyan('--clear')}`,
  );
  console.error(
    `  ${pc.dim('AI mode:')} ${pc.cyan('fennec log <app> --json --since 10m')} ${pc.dim('— bounded, redacted, machine-readable. Secrets are redacted by default.')}\n`,
  );
}
