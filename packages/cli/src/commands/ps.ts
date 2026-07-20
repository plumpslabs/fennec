/**
 * Command: ps, status — List tracked processes and system overview.
 */
import { readFileSync } from 'node:fs';
import pc from 'picocolors';
import { printBanner } from '../utils/banner.js';
import {
  symbols,
  renderTable,
  renderError,
  renderCommand,
  createSpinner,
  timestamp,
  type Column,
  type Row,
} from '../utils/format.js';
import {
  getSystemProcesses,
  formatProcessState,
  getProcessMemRss,
  getProcessTreeMemRss,
} from '../utils/system-process.js';
import { readTracked, formatUptime, isTrackedRunning, extractFlagValue } from './tracker.js';

export async function psCommand(args: string[]): Promise<void> {
  const watchFlag = args.includes('-w') || args.includes('--watch');
  const systemFlag = args.includes('--system') || args.includes('-a') || args.includes('--all');
  const jsonFlag = args.includes('--json');
  const nameFilter = args.includes('--name') ? args[args.indexOf('--name') + 1] : undefined;
  const groupFilter = extractFlagValue(args, '--group', '-g');
  const sortBy = args.includes('--sort')
    ? (args[args.indexOf('--sort') + 1] as 'cpu' | 'mem' | 'pid' | 'name')
    : 'name';

  if (jsonFlag) {
    await psJson();
    return;
  }

  if (watchFlag && systemFlag) {
    await watchSystemProcesses(sortBy, 15);
    return;
  }

  if (systemFlag) {
    const spinner = createSpinner('Scanning system processes...');
    try {
      const processes = getSystemProcesses({ name: nameFilter, userOnly: true, sortBy, limit: 30 });
      spinner.stop();
      process.stdout.write('\r\x1b[K');
      if (processes.length === 0) {
        console.error(`\n  ${pc.dim('No system processes found.')}\n`);
        return;
      }
      const columns: Column[] = [
        { key: 'pid', label: 'PID', align: 'right', format: (v) => pc.dim(String(v).padStart(6)) },
        { key: 'name', label: 'Name', format: (v) => pc.bold(String(v)) },
        {
          key: 'cpu',
          label: 'CPU%',
          align: 'right',
          format: (v) => {
            const n = v as number;
            return n > 10 ? pc.red(String(n)) : n > 5 ? pc.yellow(String(n)) : pc.dim(String(n));
          },
        },
        {
          key: 'mem',
          label: 'MEM%',
          align: 'right',
          format: (v) => {
            const n = v as number;
            return n > 10 ? pc.red(String(n)) : n > 5 ? pc.yellow(String(n)) : pc.dim(String(n));
          },
        },
        {
          key: 'state',
          label: 'State',
          format: (v) => {
            const s = String(v);
            if (s === 'R' || s === 'Running') return pc.green(s);
            if (s === 'Z' || s === 'Zombie') return pc.red(s);
            if (s === 'S' || s === 'Sleeping') return pc.cyan(s);
            return pc.dim(s);
          },
        },
      ];
      const rows: Row[] = processes.map((p) => ({
        pid: p.pid,
        name: p.name,
        cpu: p.cpuPercent,
        mem: p.memPercent,
        state: formatProcessState(p.state),
      }));
      console.error(
        `\n  ${symbols.fox} ${pc.bold('System Processes')} ${pc.dim(`(top ${processes.length} by ${sortBy})`)}\n`,
      );
      console.error(renderTable(columns, rows));
      console.error();
    } catch (error) {
      spinner.fail('Failed to scan processes');
      console.error(renderError('Process scan failed', String(error)));
    }
    return;
  }

  const trackedAll = readTracked();
  const tracked = groupFilter ? trackedAll.filter((t) => t.group === groupFilter) : trackedAll;
  if (tracked.length === 0) {
    console.error(
      `\n  ${pc.dim(groupFilter ? `No tracked processes in group "${groupFilter}".` : 'No tracked processes.')}`,
    );
    console.error(
      `  ${pc.dim('Start an app with:')} ${pc.cyan('fennec start <command> --name <name>')}\n`,
    );
    return;
  }

  const columns: Column[] = [
    { key: 'name', label: 'App', format: (v) => pc.bold(String(v)) },
    { key: 'pid', label: 'PID', align: 'right' },
    {
      key: 'debug',
      label: 'D',
      align: 'center',
      format: (v) => {
        const d = v as string;
        return d === 'log'
          ? pc.green('L')
          : d === 'breakpoint'
            ? pc.yellow('B')
            : d === 'auto'
              ? pc.magenta('A')
              : pc.dim('-');
      },
    },
    {
      key: 'status',
      label: 'Status',
      format: (v) => {
        const s = v as string;
        return s === 'running' ? pc.green('● running') : pc.red('○ stopped');
      },
    },
    {
      key: 'group',
      label: 'Group',
      format: (v) => {
        const g = String(v);
        return g === '-' ? pc.dim('-') : pc.cyan(g);
      },
    },
    {
      key: 'port',
      label: 'Port',
      format: (v) => {
        const p = v as number | null;
        return p ? pc.yellow(`:${p}`) : pc.dim('-');
      },
    },
    {
      key: 'mem',
      label: 'MEM(total)',
      align: 'right',
      format: (v) => {
        const kb = v as number | null;
        return kb && kb > 0 ? pc.dim(`${(kb / 1024).toFixed(0)}MB`) : pc.dim('-');
      },
    },
    {
      key: 'command',
      label: 'Command',
      format: (v) => {
        const c = String(v);
        return c.length > 50 ? c.slice(0, 50) + '…' : c;
      },
    },
    { key: 'uptime', label: 'Uptime', format: (v) => pc.dim(String(v)) },
  ];

  const rows: Row[] = tracked.map((t) => {
    const running = isTrackedRunning(t);
    const uptime = running
      ? formatUptime(Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000))
      : '-';
    const memKb = running ? (getProcessTreeMemRss(t.pid) ?? null) : null;
    return {
      name: t.name,
      pid: running ? String(t.pid) : pc.dim(String(t.pid)),
      debug: t.debugMode ?? '-',
      status: running ? 'running' : 'stopped',
      group: t.group ?? '-',
      port: t.port ?? null,
      mem: memKb,
      command: t.command,
      uptime,
    };
  });

  const runningCount = tracked.filter((t) => isTrackedRunning(t)).length;
  const scope = groupFilter ? ` in group ${pc.cyan(groupFilter)}` : '';
  console.error(
    `\n  ${symbols.fox} ${pc.bold('Fennec Apps')} ${pc.dim(`(${runningCount}/${tracked.length} running${scope})`)}\n`,
  );
  console.error(renderTable(columns, rows));
  console.error(
    `  ${pc.dim('Use')} ${pc.cyan('fennec start <command> --name <name> --port <port>')} ${pc.dim('to add more apps.')}`,
  );
  console.error(`  ${pc.dim('Use')} ${pc.cyan('fennec log <name>')} ${pc.dim('to view logs.')}`);
  console.error(
    `  ${pc.dim('Use')} ${pc.cyan('fennec stop <name>')} ${pc.dim('to pause an app.')}`,
  );
  console.error(
    `  ${pc.dim('Use')} ${pc.cyan('fennec spawn <name>')} ${pc.dim('to resume a paused app.')}`,
  );
  console.error(
    `  ${pc.dim('Use')} ${pc.cyan('fennec kill <name>')} ${pc.dim('to permanently remove an app.')}`,
  );
  console.error(`  ${pc.dim('Filter by group with:')} ${pc.cyan('fennec ps --group <group>')}`);
  console.error();
}

/**
 * JSON output of tracked processes.
 */
async function psJson(): Promise<void> {
  const tracked = readTracked();
  const data = tracked.map((t) => {
    const running = isTrackedRunning(t);
    return {
      name: t.name,
      pid: t.pid,
      status: running ? 'running' : 'stopped',
      port: t.port ?? null,
      command: t.command,
      cwd: t.cwd ?? null,
      group: t.group ?? null,
      memMB: running
        ? (() => {
            const kb = getProcessMemRss(t.pid);
            return kb ? Math.round(kb / 1024) : null;
          })()
        : null,
      startedAt: t.startedAt,
      uptime: running ? Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000) : null,
    };
  });
  console.log(JSON.stringify(data, null, 2));
}

export async function statusCommand(_args: string[]): Promise<void> {
  const watchFlag = _args.includes('-w') || _args.includes('--watch');
  const tracked = readTracked();

  console.error(`\n  ${symbols.fox} ${pc.bold('Fennec Status')}\n`);

  if (tracked.length > 0) {
    const runningCount = tracked.filter((t) => isTrackedRunning(t)).length;
    console.error(
      `  ${pc.bold('Managed Apps')} ${pc.dim(`(${runningCount}/${tracked.length} running)`)}\n`,
    );
    for (const t of tracked) {
      const running = isTrackedRunning(t);
      const statusIcon = running ? pc.green('●') : pc.red('○');
      const portStr = t.port ? ` ${pc.yellow(`:${t.port}`)}` : '';
      const uptime = running
        ? pc.dim(formatUptime(Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000)))
        : pc.red('stopped');
      console.error(
        `  ${statusIcon} ${pc.bold(t.name)}${portStr} ${pc.dim(`(PID ${t.pid})`)} — ${uptime}`,
      );
    }
    console.error();
  } else {
    console.error(
      `  ${pc.dim('No managed apps.')} ${pc.cyan('fennec start <command> --name <name>')}\n`,
    );
  }

  // Version update check (non-blocking, cached 24h)
  if (!process.env.NO_UPDATE_NOTIFIER) {
    checkVersion().catch(() => {});
  }

  // Docs & resources footer
  console.error(`  ${pc.dim('📖')} ${pc.cyan('https://plumpslabs.github.io/fennec/')}`);
  console.error(
    `  ${pc.dim('💬')} ${pc.dim('Report issues:')} ${pc.cyan('https://github.com/plumpslabs/fennec/issues')}`,
  );

  if (watchFlag) await watchSystemProcesses('cpu', 15);
  console.error();
}

// ─── Version Update Check ────────────────────────────────────────

const UPDATE_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastUpdateCheck = 0;

async function checkVersion(): Promise<void> {
  const now = Date.now();
  if (now - lastUpdateCheck < UPDATE_CACHE_MS) return;
  lastUpdateCheck = now;

  try {
    const response = await fetch('https://registry.npmjs.org/@plumpslabs/fennec/latest', {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    const latest = data?.version;
    if (!latest) return;

    const { version: currentVersion } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    );
    if (latest !== currentVersion) {
      console.error(
        `  ${symbols.info} ${pc.yellow(`Update available: ${pc.bold('v' + currentVersion)} → ${pc.bold('v' + latest)}`)}`,
      );
      console.error(`    ${pc.dim('Run:')} ${pc.cyan('npm install -g @plumpslabs/fennec@latest')}`);
      console.error();
    }
  } catch {
    // Silently fail — never block the CLI
  }
}

async function watchSystemProcesses(sortBy: string, limit: number): Promise<void> {
  console.error(
    `\n  ${pc.bold('Watching system processes')} ${pc.dim('(Ctrl+C to stop, refreshes every 3s)')}\n`,
  );

  const render = () => {
    const processes = getSystemProcesses({
      userOnly: true,
      sortBy: sortBy as 'cpu' | 'mem' | 'pid' | 'name',
      limit,
    });
    const columns: Column[] = [
      { key: 'pid', label: 'PID', align: 'right', format: (v) => pc.dim(String(v).padStart(6)) },
      { key: 'name', label: 'Name', format: (v) => pc.bold(String(v)) },
      {
        key: 'cpu',
        label: 'CPU%',
        align: 'right',
        format: (v) => {
          const n = v as number;
          return n > 10 ? pc.red(String(n)) : n > 5 ? pc.yellow(String(n)) : pc.dim(String(n));
        },
      },
      {
        key: 'mem',
        label: 'MEM%',
        align: 'right',
        format: (v) => {
          const n = v as number;
          return n > 10 ? pc.red(String(n)) : n > 5 ? pc.yellow(String(n)) : pc.dim(String(n));
        },
      },
      { key: 'state', label: 'S', align: 'center' },
    ];
    const rows: Row[] = processes.map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: p.cpuPercent,
      mem: p.memPercent,
      state: p.state,
    }));
    return `  ${timestamp()} ${pc.dim(`${processes.length} processes`)}\n${renderTable(columns, rows, { compact: true })}`;
  };

  console.error(render());
  const interval = setInterval(() => {
    process.stdout.write('\x1B[J');
    console.error(render());
  }, 3000);
  // Keep alive until SIGINT — resolves cleanly (no process.exit)
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      clearInterval(interval);
      process.stdout.write('\x1B[J');
      resolve();
    });
  });
}
