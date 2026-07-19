#!/usr/bin/env node

import { renderError } from './utils/format.js';
import { printBanner } from './utils/banner.js';
import { showHelp, showCommandHelp, findCommandDoc } from './utils/help.js';
import { pipeCommand } from './commands/pipe.js';
import { attachPidCommand } from './commands/attach-pid.js';
import { attachPortCommand } from './commands/attach-port.js';
import { watchCommand } from './commands/watch.js';
import { startServer, startCommand, runCommand } from './commands/start.js';
import { psCommand, statusCommand } from './commands/ps.js';
import { killCommand } from './commands/kill.js';
import { stopCommand } from './commands/stop.js';
import { spawnCommand } from './commands/spawn.js';
import { restartCommand } from './commands/restart.js';
import { adoptCommand } from './commands/adopt.js';
import { supervisorCommand, runSupervisor } from './commands/supervisor.js';
import { persistCommand } from './commands/persist.js';
import { inspectCommand } from './commands/inspect.js';
import { devCommand } from './commands/dev.js';
import { logCommand } from './commands/log.js';
import { attachCommand } from './commands/attach.js';
import { storeCommand } from './commands/store.js';
import { doctorCommand } from './commands/doctor.js';
import { setupCommand } from './commands/setup.js';
import { installBrowsersCommand, initCommand } from './commands/management.js';
import { healthCommand } from './commands/health.js';
import { cleanupCommand } from './commands/cleanup.js';
import { infoCommand } from './commands/info.js';
import { renameCommand } from './commands/rename.js';
import { exportCommand, importCommand } from './commands/export-import.js';
import { groupCommand } from './commands/group.js';
import { debugCommand } from './commands/debug.js';
import { workflowCommand } from './commands/workflow.js';
import { dbCommand } from './commands/db.js';

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  // Per-command help: `fennec <command> --help` / `-h` (but not bare `start`,
  // which is the server, and not the help command itself).
  // Also handles subcommand paths: `fennec store session --help`, `fennec sessions rm --help`
  if (
    command &&
    command !== 'help' &&
    command !== '--help' &&
    command !== '-h' &&
    (args.includes('--help') || args.includes('-h'))
  ) {
    printBanner();
    // Build the subcommand path: `store session`, `sessions rm`, etc.
    const helpArgs = args.filter((a) => a !== '--help' && a !== '-h' && !a.startsWith('-'));
    const helpKey = helpArgs.length > 0 ? `${command}-${helpArgs[0]}` : command;
    const doc = findCommandDoc(helpKey);
    if (doc) {
      showCommandHelp(helpKey);
    } else {
      showCommandHelp(command);
    }
    return;
  }

  if (!command || command === 'start') {
    if (args.length === 0 || args[0]?.startsWith('--')) {
      await startServer(args);
    } else {
      await startCommand(args);
    }
  } else if (command === 'run') {
    await runCommand(args);
  } else if (command === 'ps') {
    printBanner();
    await psCommand(args);
  } else if (command === 'status') {
    printBanner();
    await statusCommand(args);
  } else if (command === 'log' || command === 'logs') {
    await logCommand(args);
  } else if (command === 'spawn') {
    await spawnCommand(args);
  } else if (command === 'stop') {
    await stopCommand(args);
  } else if (command === 'kill') {
    await killCommand(args);
  } else if (command === 'restart') {
    await restartCommand(args);
  } else if (command === 'adopt') {
    await adoptCommand(args);
  } else if (command === 'supervisor') {
    printBanner();
    await supervisorCommand(args);
  } else if (command === '__supervisor') {
    await runSupervisor();
  } else if (command === 'persist') {
    printBanner();
    await persistCommand(args);
  } else if (command === 'inspect') {
    await inspectCommand(args);
  } else if (command === 'dev') {
    printBanner();
    await devCommand(args);
  } else if (command === 'info') {
    printBanner();
    await infoCommand(args);
  } else if (command === 'cleanup') {
    printBanner();
    await cleanupCommand();
  } else if (command === 'rename') {
    await renameCommand(args);
  } else if (command === 'group') {
    await groupCommand(args);
  } else if (command === 'debug') {
    await debugCommand(args);
  } else if (command === 'db') {
    printBanner();
    await dbCommand(args);
  } else if (command === 'workflow' || command === 'wf') {
    printBanner();
    await workflowCommand(args);
  } else if (command === 'export') {
    await exportCommand(args);
  } else if (command === 'import') {
    await importCommand(args);
  } else if (command === 'attach') {
    await attachCommand(args);
  } else if (command === 'pipe') {
    await pipeCommand(args);
  } else if (command === 'attach-pid') {
    await attachPidCommand(args);
  } else if (command === 'attach-port') {
    await attachPortCommand(args);
  } else if (command === 'watch') {
    await watchCommand(args);
  } else if (command === 'store') {
    printBanner();
    await storeCommand(args);
  } else if (command === 'doctor') {
    printBanner();
    await doctorCommand(args);
  } else if (command === 'sessions') {
    await storeCommand(['session', ...args]);
  } else if (command === 'setup') {
    await setupCommand();
  } else if (command === 'install-browsers') {
    printBanner();
    await installBrowsersCommand();
  } else if (command === 'health' || command === '--health') {
    await healthCommand();
  } else if (command === 'init') {
    printBanner();
    await initCommand();
  } else if (command === 'version' || command === '--version' || command === '-v') {
    printBanner();
  } else if (command === 'help' || command === '--help' || command === '-h') {
    printBanner();
    if (args[0] && !args[0].startsWith('-')) {
      showCommandHelp(args[0]);
    } else {
      showHelp();
    }
  } else {
    console.error(
      renderError(`Unknown command: ${command}`, "Run 'fennec help' for usage information"),
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(renderError('Fatal error', String(error)));
  process.exit(1);
});
