/**
 * Command: workflow — List, show, and manage Fennec workflows.
 *
 *   fennec workflow                  overview (all workflows)
 *   fennec workflow list             list all workflows
 *   fennec workflow show <name|id>   show workflow detail + steps
 *   fennec workflow run  <name|id>   execute a workflow (via MCP server)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { renderError, renderKV, symbols, renderTable, type Column, type Row } from '../utils/format.js';

const STORE: string = process.env.FENNEC_HOME ?? process.env.FENNEC_DATA_DIR ?? resolve(homedir(), '.fennec');
const WORKFLOW_DIR = join(STORE, 'workflows');

interface WorkflowMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  stepCount: number;
}

function listWorkflows(): WorkflowMeta[] {
  if (!existsSync(WORKFLOW_DIR)) return [];
  const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.json'));
  const workflows: WorkflowMeta[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(WORKFLOW_DIR, file), 'utf-8');
      const wf = JSON.parse(content);
      workflows.push({
        id: wf.id,
        name: wf.name,
        description: wf.description ?? '',
        version: wf.version ?? '1.0',
        tags: wf.tags ?? [],
        createdAt: wf.createdAt,
        updatedAt: wf.updatedAt,
        stepCount: (wf.steps ?? []).length,
      });
    } catch {
      // skip corrupted
    }
  }

  return workflows.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function findWorkflow(nameOrId: string): WorkflowMeta | undefined {
  return listWorkflows().find((w) => w.name === nameOrId || w.id === nameOrId);
}

export async function workflowCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'list' || sub === 'ls') {
    const workflows = listWorkflows();

    if (workflows.length === 0) {
      console.error(`\n  ${pc.dim('No workflows found.')} ${pc.cyan('Workflows are created by the planner or scheduler when the MCP server is running.')}`);
      console.error(`  ${pc.dim(`Directory: ${WORKFLOW_DIR}`)}\n`);
      return;
    }

    const columns: Column[] = [
      { key: 'name', label: 'Name', format: (v) => pc.bold(String(v)) },
      { key: 'version', label: 'Ver' },
      { key: 'steps', label: 'Steps', align: 'right' },
      { key: 'tags', label: 'Tags', format: (v) => {
        const tags = v as string[];
        return tags.length ? tags.map((t) => pc.cyan(t)).join(', ') : pc.dim('-');
      }},
      { key: 'updated', label: 'Updated', format: (v) => pc.dim(String(v)) },
    ];

    const rows: Row[] = workflows.map((w) => ({
      name: w.name,
      version: w.version,
      steps: String(w.stepCount),
      tags: w.tags,
      updated: new Date(w.updatedAt).toLocaleDateString(),
    }));

    console.error(`\n  ${symbols.fox} ${pc.bold('Workflows')} ${pc.dim(`(${workflows.length})`)}\n`);
    console.error(renderTable(columns, rows));
    console.error(`  ${pc.dim(WORKFLOW_DIR)}\n`);
    return;
  }

  if (sub === 'show' || sub === 'detail') {
    const name = args[1];
    if (!name) {
      console.error(renderError('Missing name', 'Usage: fennec workflow show <name|id>'));
      process.exit(1);
    }

    const wf = findWorkflow(name);
    if (!wf) {
      console.error(renderError('Not found', `No workflow named or id "${name}".`));
      process.exit(1);
    }

    // Read full workflow for steps
    const filePath = join(WORKFLOW_DIR, `${wf.id}.json`);
    let steps: Array<{ type: string; description: string }> = [];
    if (existsSync(filePath)) {
      try {
        const content = JSON.parse(readFileSync(filePath, 'utf-8'));
        steps = content.steps ?? [];
      } catch {}
    }

    console.error(`\n  ${symbols.fox} ${pc.bold(`Workflow: ${wf.name}`)}\n`);
    console.error(`  ${pc.dim('ID:')}          ${wf.id}`);
    console.error(`  ${pc.dim('Version:')}     ${wf.version}`);
    console.error(`  ${pc.dim('Description:')} ${wf.description || pc.dim('-')}`);
    console.error(`  ${pc.dim('Tags:')}        ${wf.tags.length ? wf.tags.join(', ') : pc.dim('-')}`);
    console.error(`  ${pc.dim('Created:')}     ${new Date(wf.createdAt).toLocaleString()}`);
    console.error(`  ${pc.dim('Updated:')}     ${new Date(wf.updatedAt).toLocaleString()}`);
    console.error(`  ${pc.dim('Steps:')}       ${wf.stepCount}\n`);

    if (steps.length > 0) {
      console.error(`  ${pc.bold('Steps:')}\n`);
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!;
        console.error(`  ${pc.cyan(`${i + 1}.`)} ${pc.bold(s.type)} ${pc.dim(s.description)}`);
      }
      console.error();
    }
    return;
  }

  if (sub === 'run') {
    console.error(`\n  ${pc.yellow('⚠')} ${pc.bold('Run via MCP')} ${pc.dim('Use the planner or scheduler tools from your AI agent to execute workflows.')}`);
    console.error(`  ${pc.dim('  planner_execute_goal — describe a goal in natural language')}`);
    console.error(`  ${pc.dim('  scheduler_trigger_rule — trigger a scheduled rule')}\n`);
    return;
  }

  console.error(renderError('Unknown subcommand', 'Usage: fennec workflow [list|show <name>|run <name>]'));
  process.exit(1);
}
