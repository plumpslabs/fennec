/**
 * Process / Terminal Module
 *
 * Provides tools for process management (spawn, kill, attach, restart)
 * and terminal monitoring (file watchers, pipe watchers, log filtering).
 */

import type { FennecModule, ModuleContext } from '../../module/index.js';
import type { ToolDefinition } from '../../tools/_registry.js';

import {
  processSpawn,
  processRunAndWait,
  processList,
  processGetLogs,
  processGetStatus,
  processSendInput,
  processKill,
  processWaitForReady,
  processAttachPid,
  processAttachPort,
  processRestart,
  processGetTracked,
  processStopTracked,
  processSpawnTracked,
  processSetGroup,
  processRenameTracked,
  processCleanupTracked,
  processClearLogs,
  processExportTracked,
  processImportTracked,
  processAdopt,
} from '../../tools/process/index.js';
import {
  terminalWatchFile,
  terminalGetLogs,
  terminalGetErrors,
  terminalListWatchers,
  terminalStopWatcher,
  terminalWatchPipe,
  terminalClearBuffer,
} from '../../tools/terminal/index.js';
import { diagnoseFullstack } from '../../tools/diagnostic/index.js';

export const processModule: FennecModule = {
  name: 'process',
  description:
    'Process management and terminal monitoring — spawn, kill, attach, pipe watching, log filtering',

  tools: [
    processSpawn,
    processRunAndWait,
    processList,
    processGetLogs,
    processGetStatus,
    processSendInput,
    processKill,
    processWaitForReady,
    processAttachPid,
    processAttachPort,
    processRestart,
    processGetTracked,
    processStopTracked,
    processSpawnTracked,
    processSetGroup,
    processRenameTracked,
    processCleanupTracked,
    processClearLogs,
    processExportTracked,
    processImportTracked,
    processAdopt,
    terminalWatchFile,
    terminalGetLogs,
    terminalGetErrors,
    terminalListWatchers,
    terminalStopWatcher,
    terminalWatchPipe,
    terminalClearBuffer,
    diagnoseFullstack,
  ] as ToolDefinition[],

  capabilities: ['process-management', 'terminal-monitoring'],

  initialize: async (context: ModuleContext) => {
    context.logger.info('Process module initialized');
  },
};
