import pc from 'picocolors';
import { hexColor } from './banner.js';

const fennecOrange = hexColor('#FF6432');

// ─── Command Registry ────────────────────────────────────────────
// Single source of truth for CLI documentation. Powers both the full
// `fennec help` listing and per-command `fennec <cmd> --help` output.

export interface CommandDoc {
  /** Canonical command name */
  name: string;
  /** Full usage string (without the leading `fennec `) */
  usage: string;
  /** Concise signature for the grouped list (defaults to `usage`) */
  short?: string;
  /** One-line summary shown in the grouped list */
  summary: string;
  /** Longer description shown in per-command help (optional) */
  description?: string;
  /** Alternate names */
  aliases?: string[];
  /** [flag, description] pairs */
  options?: [string, string][];
  /** Example invocations (without the leading `fennec `) */
  examples?: string[];
}

export const COMMANDS: Record<string, CommandDoc> = {
  'start-server': {
    name: 'start',
    usage: 'start [options]',
    summary: 'Start the Fennec MCP server (default when no app command is given)',
    description:
      'Boots the Fennec MCP server so AI agents can connect. Also auto-resurrects tracked apps that died since the last session.',
    options: [
      ['--config <path>', 'Path to a fennec.config.yaml file'],
      ['--sse', 'Use SSE (HTTP) transport instead of stdio'],
    ],
    examples: ['start', 'start --sse', 'start --config ./fennec.config.yaml'],
  },
  start: {
    name: 'start',
    usage: 'start <command> --name <name> [options]',
    short: 'start <command>',
    summary: 'Start an app as a background daemon (like)',
    description:
      'Launches <command> as a detached daemon. Its output is written directly to ~/.fennec/logs/<name>.log, so Fennec confirms the app is really running and then exits — no Ctrl+C needed.',
    aliases: ['run'],
    options: [
      ['--name <name>', 'App name used for tracking (recommended)'],
      ['--port <port>', 'Port the app listens on — Fennec waits until it accepts connections'],
      ['--cwd <dir>', 'Working directory to run the command in'],
      [
        '--restart',
        'Auto-restart if it crashes or its port stops listening (detached supervisor, survives terminal close)',
      ],
      ['--group <group>', 'Logical group/namespace for bulk ops (kill/spawn/stop --group <group>)'],
      ['--debug <mode>', 'Start with debug mode: log | breakpoint | auto'],
    ],
    examples: [
      'start "npm run dev" --name web --port 3000',
      'start node server.js --name api --cwd ./backend --restart --group backend',
    ],
  },
  run: {
    name: 'run',
    usage: 'run <command> --name <name> [options]',
    short: 'run <command>',
    summary: 'Alias of `start <command>` — run an app under Fennec',
    aliases: ['start'],
    options: [
      ['--name <name>', 'App name used for tracking (recommended)'],
      ['--port <port>', 'Port the app listens on'],
      ['--cwd <dir>', 'Working directory'],
      ['--restart', 'Auto-restart if it crashes or its port stops listening'],
      ['--group <group>', 'Logical group for bulk ops'],
      ['--debug <mode>', 'Start with debug mode: log | breakpoint | auto'],
    ],
    examples: ['run npm start --name web --port 8080 --group frontend'],
  },
  ps: {
    name: 'ps',
    usage: 'ps [options]',
    summary: 'List Fennec-tracked apps with live status',
    description:
      'Shows tracked apps and whether they are genuinely running (PID + command identity are verified to avoid false positives from PID reuse). Includes a cross-platform MEM column (resident RSS) so you can spot leaks from long-lived apps.',
    options: [
      ['--system, -a, --all', 'Show all system processes instead of tracked apps'],
      ['--name <name>', 'Filter system processes by name'],
      ['--group <g>, -g <g>', 'Show only tracked apps in group <g>'],
      ['--sort <field>', 'Sort by cpu | mem | pid | name (default: name)'],
      ['--json', 'Output tracked apps as JSON'],
      ['-w, --watch', 'Watch mode — refresh every 3s (with --system)'],
    ],
    examples: ['ps', 'ps --json', 'ps --system --sort cpu -w'],
  },
  status: {
    name: 'status',
    usage: 'status [name] [options]',
    summary: 'Show system overview & top processes',
    options: [['-w, --watch', 'Watch mode — refresh every 3s']],
    examples: ['status', 'status -w'],
  },
  log: {
    name: 'log',
    usage: 'log <name|pid> [options]',
    summary: 'Show (and follow) logs for a tracked app',
    description:
      "Prints the app's status (running/stopped) then its recent logs. Run without an app name to list all tracked apps to choose from. Secrets (API keys, tokens, connection strings, private keys) are redacted by default — safe to pipe to an AI assistant. Use --json for a bounded, machine-readable view (AI mode).",
    aliases: ['logs'],
    options: [
      ['--lines <n>', 'Number of lines to show (default: 30, capped at 500)'],
      ['-f, --follow', 'Follow mode — stream new log lines live (Ctrl+C to stop)'],
      ['--level <level>', 'Filter by level: error | warn | info | debug'],
      ['--since <dur>', 'Only show lines from the last duration (e.g. 10m, 1h, 30s)'],
      ['--json', 'Machine-readable JSON (AI mode) — bounded, redacted, no ANSI'],
      ['--no-redact', 'Disable secret redaction (use with care)'],
      ['--clear', 'Delete the log file for this app'],
    ],
    examples: ['logs', 'log web', 'log web -f', 'log api --level error --lines 100'],
  },
  spawn: {
    name: 'spawn',
    usage: 'spawn [name] [name...] [--all] [--group <g>]',
    summary: 'Re-spawn a stopped tracked app from its saved config',
    description:
      'Revives a previously stopped app using its saved command/args/cwd. With no name, shows an interactive list of stopped apps.',
    options: [
      ['--all, -a', 'Re-spawn all stopped apps that have a saved command'],
      ['--group <g>, -g <g>', 'Re-spawn only stopped apps in group <g>'],
      ['--debug <mode>', 'Re-spawn with debug mode: log | breakpoint | auto'],
    ],
    examples: ['spawn', 'spawn web', 'spawn be-crm fe-crm', 'spawn --all', 'spawn --group backend', 'spawn be-crm --debug breakpoint'],
  },
  stop: {
    name: 'stop',
    usage: 'stop <name|--all> [name...] [--group <g>]',
    summary: 'Stop (pause) a tracked app but keep it in the registry',
    description:
      'Sends SIGTERM but keeps the entry in tracked.json so it can be revived later with `fennec spawn`. Stops the ENTIRE process tree so no orphaned children are left. Accepts multiple names at once (e.g. `stop be-crm fe-crm`).',
    options: [
      ['--all, -a', 'Stop all running tracked apps'],
      ['--group <g>, -g <g>', 'Stop only running apps in group <g>'],
    ],
    examples: ['stop web', 'stop be-crm fe-crm -y', 'stop --all', 'stop --group backend'],
  },
  restart: {
    name: 'restart',
    usage: 'restart <name|pid> [name...] [--group <g>]',
    summary: 'Stop and re-spawn a tracked app from its saved config',
    options: [['--group <g>, -g <g>', 'Restart all apps in group <g>']],
    examples: ['restart web', 'restart be-crm fe-crm -y', 'restart --group backend'],
  },
  kill: {
    name: 'kill',
    usage: 'kill <pid|name|all> [name...] [--group <g>]',
    summary: 'Kill a process and remove it from the registry',
    description:
      'Permanently removes a tracked app (unlike `stop`, which keeps it). By NAME it only matches Fennec-tracked apps — use an explicit PID to kill a system process. Prompts before killing. Kills the ENTIRE process tree (e.g. npm → vite → esbuild) so no orphaned children are left behind. Accepts multiple names at once (e.g. `kill be-crm fe-crm`).',
    options: [
      ['--signal <sig>', 'Signal to send (default: SIGTERM). e.g. SIGKILL, SIGINT'],
      ['--all, -a', 'Kill ALL tracked apps (asks for confirmation)'],
      ['--group <g>, -g <g>', 'Kill only apps in group <g> (other groups untouched)'],
      ['-y, --yes', 'Skip the confirmation prompt'],
    ],
    examples: [
      'kill web',
      'kill 12345 --signal SIGKILL',
      'kill be-crm fe-crm -y',
      'kill all -y',
      'kill --group backend -y',
    ],
  },
  supervisor: {
    name: 'supervisor',
    usage: 'supervisor <start|stop|status|restart>',
    short: 'supervisor <action>',
    summary: 'Manage the background daemon that keeps --restart apps alive',
    description:
      "The supervisor is a detached daemon that auto-restarts apps started with --restart, even after you close the terminal. It polls every few seconds, health-checks each app's port (restarting ones that are alive but not listening) and has crash-loop backoff. `fennec start --restart` starts it automatically.",
    options: [
      ['start', 'Start the supervisor daemon'],
      ['stop', 'Stop the supervisor daemon'],
      ['status', 'Show supervisor status and managed apps'],
      ['restart', 'Restart the supervisor daemon'],
    ],
    examples: ['supervisor status', 'supervisor start', 'supervisor stop'],
  },
  persist: {
    name: 'persist',
    usage: 'persist <enable|disable|status>',
    short: 'persist <action>',
    summary: 'Make fennec survive reboots (auto-start apps after login)',
    description:
      'Installs a boot unit (systemd user service on Linux, launchd agent on macOS, a startup script on Windows) that starts the supervisor at login. The supervisor then resurrects every app started with --restart, so your whole fleet comes back after a reboot — like `startup` + `save`. `fennec start --restart` enables this automatically.',
    options: [
      ['enable', 'Install the boot unit for the current user'],
      ['disable', 'Remove the boot unit'],
      ['status', 'Show whether boot persistence is active'],
    ],
    examples: ['persist enable', 'persist status', 'persist disable'],
  },
  inspect: {
    name: 'inspect',
    usage: 'inspect <name|pid> [--plain] [--tail N] [--since 10m]',
    short: 'inspect <name|pid>',
    summary: 'Compact, AI-safe snapshot of an app (status + logs + errors)',
    description:
      'Returns a single bounded, machine-readable (JSON) view of one app: liveness, port health, uptime, memory, recent log lines and an error scan. Output is capped (token budget), secrets are redacted by default, and the shape is stable — so an AI assistant can observe a real running app (BE, FE, worker, console, ...) cheaply and predictably. Add --plain for a short human summary.',
    options: [
      ['--plain', 'Short human-readable summary instead of JSON'],
      ['--tail N', 'Max recent log lines (default 40, cap 200)'],
      ['--since 10m|1h', 'Only consider log lines from the last duration'],
    ],
    examples: ['inspect web --plain', 'inspect web --since 10m', 'inspect api --tail 20'],
  },
  dev: {
    name: 'dev',
    usage: 'dev <up|down|status> [--config fennec.config.yaml]',
    short: 'dev <action>',
    summary: 'Orchestrate a whole dev stack from fennec.config.yaml',
    description:
      "Declarative dev-environment orchestration. `fennec dev up` reads fennec.config.yaml, starts every app (BE/FE/DB/worker) like `fennec start --restart`, respects dependencies (waits for a dependent's port), and brings the whole stack up as one unit. Apps are supervised (auto-restart + port health-check) and boot-persistent. `fennec dev down` stops them (disabling auto-restart). `fennec dev status` shows the stack. This is the AI-friendly way to boot an entire project and then observe it with `fennec observe` / `inspect`.",
    options: [
      ['up', 'Start the whole stack from fennec.config.yaml'],
      ['down', 'Stop the whole stack (auto-restart disabled)'],
      ['status', 'Show stack status (running/stopped, last restart cause)'],
      ['--config <path>', 'Path to the config file (default: ./fennec.config.yaml)'],
    ],
    examples: ['dev up', 'dev up --config ./stack.yaml', 'dev down', 'dev status'],
  },
  info: {
    name: 'info',
    usage: 'info <name>',
    summary: 'Show detailed info for a tracked app',
    examples: ['info web'],
  },
  rename: {
    name: 'rename',
    usage: 'rename <old-name> <new-name>',
    summary: 'Rename a tracked app',
    examples: ['rename web frontend'],
  },
  group: {
    name: 'group',
    usage: 'group [name] [group]',
    summary: 'Assign a logical group to tracked apps (for scoped bulk ops)',
    description:
      "Groups let bulk commands (kill/spawn/stop/ps) target a subset instead of everything. Assign a group to an existing tracked app, clear it with --unset, or run with no args to list every app's group. New apps can also be tagged at start time with `fennec start <cmd> --name <n> --group <g>`. Then `fennec kill --group <g>` / `fennec spawn --group <g>` / `fennec stop --group <g>` / `fennec ps --group <g>` only touch that group.",
    options: [
      ['<name> <group>', 'Assign <group> to the tracked app <name>'],
      ['<name> --unset', 'Remove the group from <name>'],
      ['(no args)', 'List all tracked apps with their group'],
    ],
    examples: ['group web backend', 'group web --unset', 'group', 'kill --group backend'],
  },
  attach: {
    name: 'attach',
    usage: 'attach <port> --name <name>',
    short: 'attach <port>',
    summary: 'Observe a running process by the port it listens on',
    options: [['--name <name>', 'Name to track the observed process under']],
    examples: ['attach 3000 --name web'],
  },
  'attach-pid': {
    name: 'attach-pid',
    usage: 'attach-pid <pid>',
    summary: 'Attach to and observe a process by its PID',
    examples: ['attach-pid 12345'],
  },
  'attach-port': {
    name: 'attach-port',
    usage: 'attach-port <port>',
    summary: 'Attach to and observe a process by its port',
    examples: ['attach-port 8080'],
  },
  pipe: {
    name: 'pipe',
    usage: 'pipe --name <name>',
    summary: 'Pipe stdin into a Fennec log watcher',
    options: [['--name <name>', 'Watcher name (required)']],
    examples: ['npm run dev | fennec pipe --name web'],
  },
  watch: {
    name: 'watch',
    usage: 'watch --file <path> [--name <name>]',
    short: 'watch --file <path>',
    summary: 'Watch an existing log file',
    options: [
      ['--file <path>', 'Path to the log file (required)'],
      ['--name <name>', 'Watcher name'],
    ],
    examples: ['watch --file ./app.log --name web'],
  },
  export: {
    name: 'export',
    usage: 'export --file <path>',
    summary: 'Export tracked apps to a file',
    options: [['--file <path>', 'Destination file path (required)']],
    examples: ['export --file ./fennec-apps.json'],
  },
  import: {
    name: 'import',
    usage: 'import <file>',
    summary: 'Import tracked apps from a file',
    examples: ['import ./fennec-apps.json'],
  },
  cleanup: {
    name: 'cleanup',
    usage: 'cleanup',
    summary: 'Remove dead/stale entries from the tracked registry',
    examples: ['cleanup'],
  },
  init: {
    name: 'init',
    usage: 'init',
    summary: 'Generate a fennec.config.yaml in the current directory',
    examples: ['init'],
  },
  setup: {
    name: 'setup',
    usage: 'setup',
    summary: 'Interactively configure your MCP client for Fennec',
    examples: ['setup'],
  },
  debug: {
    name: 'debug',
    usage: 'debug <attach|detach|status> <name|--group <g>> [--mode log|breakpoint|auto]',
    short: 'debug <action> <name|--group>',
    summary: 'Attach/detach debug mode to tracked apps',
    description:
      'Controls debug mode for tracked apps. Debug mode is a flag consumed by MCP debug tools (debug_get_errors, debug_set_breakpoint, debug_auto_report, etc.) to know which level of debugging to apply.\n\n' +
      'Three levels:\n' +
      '  log (L)        — smart log debugging: error dedup, source maps, grouped summaries (default)\n' +
      '  breakpoint (B) — active breakpoint debugging: V8/CDP, Python DAP, PHP DBGp, Java JDWP\n' +
      '  auto (A)       — auto-debug: EventBus-driven snapshots on crash/stderr/5xx',
    options: [
      ['attach <name> [--mode]', 'Enable debug mode on a tracked app (default: log)'],
      ['detach <name>', 'Disable debug mode on a tracked app'],
      ['status [name]', 'Show debug status for all or one app'],
      ['--mode log|breakpoint|auto', 'Debug level to attach (default: log)'],
      ['--group <g>, -g <g>', 'Bulk attach/detach debug for all apps in group <g>'],
    ],
    examples: [
      'debug attach be-crm',
      'debug attach be-crm --mode breakpoint',
      'debug attach --group crm',
      'debug detach be-crm',
      'debug detach --group crm',
      'debug status',
    ],
  },
  'install-browsers': {
    name: 'install-browsers',
    usage: 'install-browsers',
    summary: 'Install Playwright browser engines',
    examples: ['install-browsers'],
  },
  sessions: {
    name: 'sessions',
    usage: 'sessions',
    summary: 'List saved browser auth sessions',
    examples: ['sessions'],
  },
  health: {
    name: 'health',
    usage: 'health',
    summary: 'Run a health check of the Fennec environment',
    examples: ['health'],
  },
  help: {
    name: 'help',
    usage: 'help [command]',
    summary: 'Show this help, or detailed help for a command',
    examples: ['help', 'help start', 'start --help'],
  },
  version: {
    name: 'version',
    usage: 'version',
    summary: 'Show the installed Fennec version',
    examples: ['version'],
  },
};

// Map any alias/lookup key to a canonical registry key.
const LOOKUP: Record<string, string> = {
  logs: 'log',
  '-v': 'version',
  '--version': 'version',
  '-h': 'help',
  '--help': 'help',
};

/** Resolve a user-typed command to a CommandDoc (handles aliases). */
export function findCommandDoc(cmd: string): CommandDoc | undefined {
  if (COMMANDS[cmd]) return COMMANDS[cmd];
  const alias = LOOKUP[cmd];
  return alias ? COMMANDS[alias] : undefined;
}

// ─── Renderers ───────────────────────────────────────────────────

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Server', keys: ['start-server'] },
  {
    title: 'Apps & Processes',
    keys: [
      'start',
      'run',
      'ps',
      'status',
      'log',
      'spawn',
      'stop',
      'restart',
      'kill',
      'group',
      'debug',
      'supervisor',
      'persist',
      'dev',
      'inspect',
      'info',
      'rename',
    ],
  },
  { title: 'Observation', keys: ['attach', 'attach-pid', 'attach-port', 'pipe', 'watch'] },
  { title: 'Data', keys: ['export', 'import', 'cleanup'] },
  { title: 'Configuration', keys: ['init', 'setup', 'install-browsers', 'sessions'] },
  { title: 'Other', keys: ['health', 'help', 'version'] },
];

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** Full grouped help listing. */
export function showHelp(): void {
  const sep = fennecOrange('─'.repeat(56));
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${pc.bold('Usage:')} fennec ${pc.dim('<command>')} ${pc.dim('[options]')}`);
  lines.push(
    `  ${pc.dim('Run')} ${pc.cyan('fennec <command> --help')} ${pc.dim('for details on any command.')}`,
  );

  for (const group of GROUPS) {
    lines.push('');
    lines.push(`  ${sep}`);
    lines.push(`  ${pc.bold(group.title)}`);
    lines.push(`  ${sep}`);
    lines.push('');
    for (const key of group.keys) {
      const doc = COMMANDS[key];
      if (!doc) continue;
      const usageLabel = key === 'start-server' ? 'start' : (doc.short ?? doc.usage);
      lines.push(`    ${pc.cyan(pad(usageLabel, 24))}  ${pc.dim(doc.summary)}`);
    }
  }

  lines.push('');
  lines.push(`  ${pc.dim('─'.repeat(56))}`);
  lines.push(`  ${pc.dim('Learn more:')} ${pc.cyan('https://github.com/plumpslabs/fennec')}`);
  lines.push('');

  console.error(lines.join('\n'));
}

/** Detailed help for a single command. */
export function showCommandHelp(cmd: string): void {
  const doc = findCommandDoc(cmd);
  if (!doc) {
    console.error(`\n  ${pc.yellow('⚠')} Unknown command: ${pc.bold(cmd)}`);
    console.error(
      `  ${pc.dim('Run')} ${pc.cyan('fennec help')} ${pc.dim('to see all commands.')}\n`,
    );
    return;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${pc.bold(fennecOrange(doc.name))} ${pc.dim('—')} ${doc.summary}`);
  lines.push('');
  lines.push(`  ${pc.bold('Usage:')} ${pc.cyan(`fennec ${doc.usage}`)}`);
  if (doc.aliases?.length) {
    lines.push(`  ${pc.bold('Aliases:')} ${doc.aliases.map((a) => pc.cyan(a)).join(', ')}`);
  }
  if (doc.description) {
    lines.push('');
    lines.push(`  ${doc.description}`);
  }
  if (doc.options?.length) {
    lines.push('');
    lines.push(`  ${pc.bold('Options:')}`);
    const width = Math.max(...doc.options.map(([f]) => f.length));
    for (const [flag, desc] of doc.options) {
      lines.push(`    ${pc.cyan(pad(flag, width))}  ${pc.dim(desc)}`);
    }
  }
  if (doc.examples?.length) {
    lines.push('');
    lines.push(`  ${pc.bold('Examples:')}`);
    for (const ex of doc.examples) {
      lines.push(`    ${pc.dim('$')} ${fennecOrange(`fennec ${ex}`)}`);
    }
  }
  lines.push('');
  console.error(lines.join('\n'));
}
