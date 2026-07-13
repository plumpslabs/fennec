/**
 * Command: persist — Make fennec survive reboots.
 *
 * Installs a boot unit (systemd user service on Linux, a launchd agent
 * on macOS, a startup script on Windows) that starts the fennec
 * supervisor at login. The supervisor then resurrects every app flagged
 * `autoRestart` (i.e. started with `--restart`), so the whole app fleet
 * comes back automatically after a reboot — like `startup` + `save`.
 *
 * Sub-commands:
 *   fennec persist enable    Install the boot unit for the current user
 *   fennec persist disable   Remove it
 *   fennec persist status    Show whether boot persistence is active
 *
 * The boot unit always targets the fennec data dir that was active when
 * `enable` ran (baked into the unit's environment), so it works whatever
 * `FENNEC_DATA_DIR` is set to later.
 */
import pc from 'picocolors';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { execFileSync } from 'node:child_process';
import { renderError, renderKV } from '../utils/format.js';
import { getFennecDir } from './tracker.js';

type Backend = 'systemd' | 'launchd' | 'windows' | 'unsupported';

function detectBackend(): Backend {
  const p = platform();
  if (p === 'linux' || p === 'freebsd') {
    // Only user services are safe/simple here.
    return 'systemd';
  }
  if (p === 'darwin') return 'launchd';
  if (p === 'win32') return 'windows';
  return 'unsupported';
}

function unitPaths(backend: Backend): { unit: string; extra?: string } {
  const fennecDir = getFennecDir();
  switch (backend) {
    case 'systemd':
      return {
        unit: resolve(homedir(), '.config', 'systemd', 'user', 'fennec-supervisor.service'),
      };
    case 'launchd':
      return { unit: resolve(homedir(), 'Library', 'LaunchAgents', 'io.fennec.supervisor.plist') };
    case 'windows':
      return {
        unit: resolve(
          homedir(),
          'AppData',
          'Roaming',
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs',
          'Startup',
          'fennec-supervisor.bat',
        ),
      };
    default:
      return { unit: resolve(fennecDir, 'persist.unit') };
  }
}

/**
 * Build the boot unit content. The unit runs `node <cli> supervisor start`,
 * which launches the detached supervisor (and resurrects auto-restart apps).
 * FENNEC_DATA_DIR is pinned so the supervised apps (and their logs) resolve
 * to the same fennec instance regardless of the boot environment.
 */
function buildUnit(backend: Backend, dataDir: string): string {
  const nodeBin = process.execPath;
  const cli = process.argv[1] ?? 'fennec';
  const envLine = `FENNEC_DATA_DIR=${dataDir}`;

  if (backend === 'systemd') {
    return `[Unit]
Description=Fennec process supervisor (auto-restarts managed apps)
After=network.target

[Service]
Type=simple
Environment=${envLine}
ExecStart=${nodeBin} ${cli} supervisor start
Restart=on-failure

[Install]
WantedBy=default.target
`;
  }

  if (backend === 'launchd') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.fennec.supervisor</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${cli}</string>
    <string>supervisor</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FENNEC_DATA_DIR</key>
    <string>${dataDir}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
`;
  }

  // windows .bat (runs at user login)
  return `@echo off
set FENNEC_DATA_DIR=${dataDir}
"${nodeBin}" "${cli}" supervisor start
`;
}

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
    return { ok: true, out };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    const out = (e.stdout ?? e.stderr ?? Buffer.from('')).toString().trim();
    return { ok: false, out };
  }
}

export function persistEnabled(backend = detectBackend()): boolean {
  const { unit } = unitPaths(backend);
  return existsSync(unit);
}

/**
 * Silently ensure boot persistence is installed. Called from `start --restart`
 * so the first `--restart` app also arms reboot survival without the user
 * having to run `fennec persist enable`. No-ops on unsupported platforms or
 * if persistence is already enabled. Returns true if it just installed it.
 */
export function ensurePersistEnabled(): boolean {
  const backend = detectBackend();
  if (backend === 'unsupported') return false;
  if (persistEnabled(backend)) return false;
  persistEnable(backend);
  return true;
}

export async function persistCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? 'status';
  const backend = detectBackend();

  if (backend === 'unsupported') {
    console.error(
      renderError(
        'Unsupported platform',
        `Boot persistence isn't available on ${platform()}. You can still run "fennec supervisor start" manually.`,
      ),
    );
    process.exit(1);
  }

  switch (sub) {
    case 'enable':
      return persistEnable(backend);
    case 'disable':
      return persistDisable(backend);
    case 'status':
      return persistStatus(backend);
    default:
      console.error(
        renderError('Unknown sub-command', `"${sub}" — use: enable | disable | status`),
      );
      process.exit(1);
  }
}

function persistEnable(backend: Backend): void {
  const dataDir = getFennecDir();
  const { unit } = unitPaths(backend);
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, buildUnit(backend, dataDir), 'utf-8');
  if (backend === 'windows') {
    // Nothing to register; the script runs at next login.
    console.error(
      `\n  ${pc.green('✓')} ${pc.bold('Boot script installed')} ${pc.dim(`(runs at next login)`)}`,
    );
    console.error(`  ${renderKV('Path', pc.cyan(unit))}`);
    console.error(`  ${pc.dim('Supervisor will start automatically when you log in.')}\n`);
    return;
  }

  if (backend === 'systemd') {
    const reg = run('systemctl', ['--user', 'enable', '--now', resolve(unit)]);
    if (!reg.ok) {
      // Fall back to plain enable (some systems can't --now without a running manager)
      run('systemctl', ['--user', 'enable', resolve(unit)]);
      // Try to start the daemon directly so it's alive now.
      run('systemctl', ['--user', 'start', 'fennec-supervisor.service']);
    }
    // Always enable lingering so the user service keeps running after logout —
    // otherwise closing the session kills the supervisor (and every app it
    // manages), defeating the whole point of "survive reboot".
    const linger = run('loginctl', ['enable-linger']);
    if (!linger.ok) {
      console.error(
        `  ${pc.yellow('⚠')} ${pc.dim('Could not enable user linger — the supervisor may stop when you log out.')}`,
      );
    }
    console.error(
      `\n  ${pc.green('✓')} ${pc.bold('Boot persistence enabled')} ${pc.dim('(systemd user service)')}`,
    );
    console.error(`  ${renderKV('Unit', pc.cyan('fennec-supervisor.service'))}`);
    console.error(`  ${renderKV('Data dir', pc.cyan(dataDir))}`);
    console.error(
      `  ${pc.dim('The supervisor (and all --restart apps) will start at login and keep running after logout.')}\n`,
    );
    return;
  }

  if (backend === 'launchd') {
    run('launchctl', ['load', resolve(unit)]);
    console.error(
      `\n  ${pc.green('✓')} ${pc.bold('Boot persistence enabled')} ${pc.dim('(launchd agent)')}`,
    );
    console.error(`  ${renderKV('Label', pc.cyan('io.fennec.supervisor'))}`);
    console.error(`  ${renderKV('Data dir', pc.cyan(dataDir))}`);
    console.error(`  ${pc.dim('The supervisor will start at login.')}\n`);
    return;
  }
}

function persistDisable(backend: Backend): void {
  const { unit } = unitPaths(backend);
  if (backend === 'systemd') {
    run('systemctl', ['--user', 'disable', '--now', 'fennec-supervisor.service']);
  } else if (backend === 'launchd') {
    run('launchctl', ['unload', resolve(unit)]);
  }
  try {
    if (existsSync(unit)) unlinkSync(unit);
  } catch {
    /* best-effort */
  }
  console.error(`\n  ${pc.green('✓')} ${pc.bold('Boot persistence disabled')}\n`);
}

function persistStatus(backend: Backend): void {
  const { unit } = unitPaths(backend);
  const installed = existsSync(unit);
  const label =
    backend === 'systemd'
      ? 'fennec-supervisor.service'
      : backend === 'launchd'
        ? 'io.fennec.supervisor'
        : 'fennec-supervisor.bat';

  console.error(`\n  ${pc.bold('Fennec Boot Persistence')} ${pc.dim(`(${backend})`)}`);
  if (!installed) {
    console.error(
      `  ${pc.red('○')} ${pc.dim('not installed — run ')}${pc.cyan('fennec persist enable')}${pc.dim(' to auto-start apps after reboot')}`,
    );
    console.error();
    return;
  }

  if (backend === 'systemd') {
    const en = run('systemctl', ['--user', 'is-enabled', 'fennec-supervisor.service']).out;
    const ac = run('systemctl', ['--user', 'is-active', 'fennec-supervisor.service']).out;
    console.error(`  ${pc.green('●')} ${pc.bold('installed')}`);
    console.error(`  ${renderKV('Enabled', en || '?')}`);
    console.error(`  ${renderKV('Active', ac || '?')}`);
  } else if (backend === 'launchd') {
    const loaded = run('launchctl', ['list', 'io.fennec.supervisor']).ok;
    console.error(`  ${pc.green('●')} ${pc.bold('installed')}`);
    console.error(`  ${renderKV('Loaded', loaded ? pc.green('yes') : pc.red('no'))}`);
  } else {
    console.error(`  ${pc.green('●')} ${pc.bold('installed')} ${pc.dim('(runs at login)')}`);
  }
  console.error(`  ${renderKV('Unit', pc.cyan(label))}`);
  console.error(`  ${renderKV('Path', pc.cyan(unit))}`);
  console.error();
}
