/**
 * Assistant setup — wires Fennec into AI coding assistants.
 *
 * Called at the end of `fennec init`. Writes the assistant's project MCP
 * config file (merging when one already exists) plus a shared SKILL.md
 * that teaches the agent the Fennec workflow. All helpers take an explicit
 * `cwd` so they stay unit-testable without touching the real project.
 *
 * Config shapes researched per vendor docs (Oct 2026):
 * - Claude Code / Qoder share `.mcp.json` (`{mcpServers}` stdio shape).
 *   VS Code's Agent Host reads the same portable `.mcp.json` natively.
 * - Cursor: `.cursor/mcp.json` (`{mcpServers}`).
 * - VS Code / Copilot workspace: `.vscode/mcp.json` (`{servers}` — note
 *   the different root key; `type` omitted per Microsoft's own example).
 * - OpenCode: `opencode.json` (`{mcp.<name>.type: "local"}`).
 * - Antigravity: `.agents/mcp_config.json` (`{mcpServers}`).
 * - Antigravity: `.agents/mcp_config.json` (`{mcpServers}`). Gemini CLI was
 *   retired by Google on 2026-06-18 (replaced by Antigravity CLI) — removed.
 * - Windsurf is global-only (`~/.codeium/windsurf/mcp_config.json`, no
 *   per-project file) and Codex CLI is global TOML — both get printed
 *   instructions instead of a project file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import { renderCommand, renderSuccess, multiSelectPrompt } from '../utils/format.js';

export type AssistantId =
  'claude-code' | 'qoder' | 'cursor' | 'vscode' | 'opencode' | 'antigravity';

export const ASSISTANTS: { value: AssistantId; label: string; description: string }[] = [
  { value: 'claude-code', label: 'Claude Code', description: 'Project .mcp.json' },
  { value: 'qoder', label: 'Qoder', description: 'Project .mcp.json (shared format)' },
  { value: 'cursor', label: 'Cursor', description: '.cursor/mcp.json' },
  { value: 'vscode', label: 'VS Code / Copilot', description: '.vscode/mcp.json' },
  { value: 'opencode', label: 'OpenCode', description: 'opencode.json' },
  { value: 'antigravity', label: 'Antigravity', description: '.agents/mcp_config.json' },
];

/** MCP server entry for stdio-based assistants. */
export function stdioServerEntry(): { command: string; args: string[] } {
  return { command: 'fennec', args: ['start'] };
}

/** Relative path of the assistant's project MCP config file. */
export function assistantConfigPath(id: AssistantId): string {
  switch (id) {
    case 'claude-code':
    case 'qoder':
      return '.mcp.json';
    case 'cursor':
      return join('.cursor', 'mcp.json');
    case 'vscode':
      return join('.vscode', 'mcp.json');
    case 'opencode':
      return 'opencode.json';
    case 'antigravity':
      return join('.agents', 'mcp_config.json');
  }
}

/**
 * Root key holding server definitions in the assistant's config file.
 * VS Code uses `servers`; OpenCode nests under `mcp`; the rest use
 * the classic portable `mcpServers`.
 */
export function assistantServersKey(id: AssistantId): 'mcpServers' | 'servers' | 'mcp' {
  if (id === 'vscode') return 'servers';
  if (id === 'opencode') return 'mcp';
  return 'mcpServers';
}

/** Server definition object for the assistant's config shape. */
export function assistantServerEntry(id: AssistantId): Record<string, unknown> {
  if (id === 'opencode') {
    return { type: 'local', command: ['fennec', 'start'], enabled: true };
  }
  // VS Code native format requires an explicit transport type (docs:
  // code.visualstudio.com/docs/agents/reference/mcp-configuration).
  if (id === 'vscode') {
    return { type: 'stdio', command: 'fennec', args: ['start'] };
  }
  return stdioServerEntry();
}

/** Canonical shared skill location (picked up via .agents/ by Antigravity, OpenCode, and others). */
export function skillPath(): string {
  return join('.agents', 'skills', 'fennec', 'SKILL.md');
}

/**
 * Native skill path per assistant (verified against vendor docs):
 * - opencode reads `.opencode/skills/` natively (also `.agents/`, `.claude/`)
 * - claude-code reads `.claude/skills/`
 * - cursor reads `.cursor/skills/` (also `.agents/`, `.claude/`, `.codex/`)
 * - vscode reads `.github/skills/` (also `.agents/`, `.claude/`)
 * - qoder reads `.qoder/skills/` (project-level, per Qoder docs)
 * - antigravity reads `.agents/skills/`
 *
 * Written to exactly ONE location to avoid double-loading in assistants
 * that scan multiple roots.
 */
export function assistantSkillPath(id: AssistantId): string {
  switch (id) {
    case 'opencode':
      return join('.opencode', 'skills', 'fennec', 'SKILL.md');
    case 'claude-code':
      return join('.claude', 'skills', 'fennec', 'SKILL.md');
    case 'cursor':
      return join('.cursor', 'skills', 'fennec', 'SKILL.md');
    case 'vscode':
      return join('.github', 'skills', 'fennec', 'SKILL.md');
    case 'qoder':
      return join('.qoder', 'skills', 'fennec', 'SKILL.md');
    case 'antigravity':
      return skillPath();
  }
}

function readJsonFile(abs: string): Record<string, any> | null {
  try {
    if (!existsSync(abs)) return null;
    return JSON.parse(readFileSync(abs, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Merge the Fennec MCP server into an existing config object.
 * Returns the merged object, or null when the key is already present
 * (caller reports "already configured" instead of rewriting).
 *
 * OpenCode v2 nests servers under `mcp.servers.<name>` while v1 uses
 * `mcp.<name>` directly — detect the existing shape and follow it so a
 * re-run never creates a duplicate in the other location.
 */
export function mergeMcpConfig(
  id: AssistantId,
  existing: Record<string, any> | null,
): { merged: Record<string, any> | null; alreadyConfigured: boolean } {
  const base = existing ?? {};
  if (id === 'opencode') {
    const mcp = { ...(base.mcp ?? {}) };
    if (mcp.fennec || (mcp.servers as Record<string, unknown> | undefined)?.fennec) {
      return { merged: null, alreadyConfigured: true };
    }
    if (mcp.servers && typeof mcp.servers === 'object') {
      return {
        merged: {
          ...base,
          mcp: { ...mcp, servers: { ...mcp.servers, fennec: assistantServerEntry(id) } },
        },
        alreadyConfigured: false,
      };
    }
    return {
      merged: { ...base, mcp: { ...mcp, fennec: assistantServerEntry(id) } },
      alreadyConfigured: false,
    };
  }
  const key = assistantServersKey(id);
  const servers = { ...(base[key] ?? {}) };
  if (servers.fennec) return { merged: null, alreadyConfigured: true };
  servers.fennec = assistantServerEntry(id);
  return { merged: { ...base, [key]: servers }, alreadyConfigured: false };
}

/** Write `content` to `cwd/rel`, creating parent dirs. Returns the abs path. */
export function writeProjectFile(cwd: string, rel: string, content: string): string {
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

/** The shared Fennec skill: workflow + tool discipline for AI agents. */
export function skillTemplate(): string {
  return `---
name: fennec
description: Fennec MCP — browser observability, process supervision, and smart debugging for AI coding agents
license: MIT
compatibility: opencode
metadata:
  audience: maintainers
  workflow: github
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

Fennec exposes browser automation, app-process supervision, and debugging
as MCP tools. Use it instead of guessing: observe first, diagnose, then act.

<fennec_workflow>
1. **Observe first:** \`observe(detail="summary")\` — one call shows browser
   URL/title, console error counts, network failures, and tracked processes.
   Never dump raw logs when a summary answers the question.
2. **Diagnose before fixing:** \`diagnose_page()\` (browser-only) or
   \`diagnose_fullstack(processId)\` (browser + server correlated). Trust the
   root-cause hypothesis over hunches.
3. **Act with cheap tools:** \`browser_get_dom_snapshot\` over full HTML;
   \`summarize(source="console"|"network")\` over raw log dumps.
4. **Verify after edits:** reload + \`diagnose_page()\`, or
   \`smart_verify\` for async flows. Re-run the failing check, don't assume.
</fennec_workflow>

<fennec_processes>
- Run dev servers via \`process_spawn\` (adopt-by-port: never double-start),
  NOT bare \`bash\` — spawned apps are tracked, logged, and restartable.
- Read logs with \`process_get_logs\` / \`inspect --watch\`, never \`cat\`.
- Pause with \`process_stop_tracked\`, resume with
  \`process_spawn_tracked\`; only \`process_kill\` when removal is intended.
</fennec_processes>

<fennec_token_discipline>
- Prefer token-capped tools: \`observe\`, \`summarize\`, \`inspect(tail)\`.
- Use watch mode (\`sinceOffset\` watermarks) for streaming logs instead of
  re-reading full buffers.
- Set FENNEC_WORKFLOW_ONLY=1 in large sessions to slim tool schemas.
</fennec_token_discipline>

---
_Generated by \`fennec init\` — https://github.com/plumpslabs/fennec_
`;
}

export interface AssistantSetupResult {
  assistant: AssistantId;
  configPath: string;
  configWritten: boolean;
  alreadyConfigured: boolean;
  skillPath: string;
  agentsMdPath: string;
  agentsMdUpdated: boolean;
}

/**
 * Fennec section appended to the target project's AGENTS.md so every agent
 * (not just the one picked above) learns the observe → diagnose → verify
 * workflow. Idempotent: skipped when a `fennec` heading already exists.
 */
export function agentsMdSnippet(): string {
  return `## 🦊 Fennec — observe → diagnose → verify

- **Observe first:** \`observe(detail="summary")\` — browser URL/title,
  console error counts, network failures, tracked processes. Never dump raw
  logs when a summary answers the question.
- **Diagnose before fixing:** \`diagnose_page()\` (browser-only) or
  \`diagnose_fullstack(processId)\` (browser + server). Trust the root-cause
  hypothesis over hunches.
- **Processes:** run dev servers via \`process_spawn\` (adopt-by-port), read
  logs with \`process_get_logs\`/\`inspect --watch\` — never bare \`bash\`/\`cat\`.
- **Tokens:** prefer \`observe\`, \`summarize\`, \`inspect(tail)\`; watch mode
  (\`sinceOffset\`) over re-reading buffers; \`FENNEC_WORKFLOW_ONLY=1\` in
  large sessions.
- **Auth:** \`auth_fill_login_form\` (keep \`saveAfterLogin\` ON) or
  \`auth_save_session\` after manual login; restore via \`auth_load_session\`.
- **Verify after edits:** reload + \`diagnose_page()\`, or \`smart_verify\`
  for async flows. Re-run the failing check, don't assume.
`;
}

export function ensureAgentsSection(cwd: string): { path: string; updated: boolean } {
  const rel = 'AGENTS.md';
  const abs = join(cwd, rel);
  const snippet = agentsMdSnippet();
  try {
    if (existsSync(abs)) {
      const cur = readFileSync(abs, 'utf-8');
      if (/^#{1,3}\s.*fennec/im.test(cur)) return { path: abs, updated: false };
      writeFileSync(abs, (cur.endsWith('\n') ? cur : cur + '\n') + '\n' + snippet);
      return { path: abs, updated: true };
    }
  } catch {
    // fall through to create
  }
  writeProjectFile(cwd, rel, `# Agent Directives\n\n${snippet}`);
  return { path: abs, updated: true };
}

/** Write MCP config + shared skill for one assistant. Idempotent. */
export function setupAssistant(id: AssistantId, cwd: string): AssistantSetupResult {
  const rel = assistantConfigPath(id);
  const abs = join(cwd, rel);
  const { merged, alreadyConfigured } = mergeMcpConfig(id, readJsonFile(abs));
  let configWritten = false;
  if (merged) {
    writeProjectFile(cwd, rel, JSON.stringify(merged, null, 2) + '\n');
    configWritten = true;
  }
  const skillAbs = writeProjectFile(cwd, assistantSkillPath(id), skillTemplate());
  const agents = ensureAgentsSection(cwd);
  return {
    assistant: id,
    configPath: abs,
    configWritten,
    alreadyConfigured,
    skillPath: skillAbs,
    agentsMdPath: agents.path,
    agentsMdUpdated: agents.updated,
  };
}

const GLOBAL_ONLY_NOTE = `  ${pc.dim('Windsurf and Codex CLI use global-only MCP config (no per-project file):')}
  ${pc.dim('• Windsurf: add fennec to ~/.codeium/windsurf/mcp_config.json, then Refresh in Cascade')}
  ${pc.dim('• Codex CLI: add [mcp_servers.fennec] to ~/.codex/config.toml')}`;

/** Interactive step run at the end of `fennec init`. Multi-select allowed. */
export async function assistantSetupStep(cwd: string): Promise<void> {
  const choices = await multiSelectPrompt<AssistantId | 'skip'>('Set up AI assistants?', [
    ...ASSISTANTS,
    { value: 'skip', label: 'Skip', description: 'Config + skill only' },
  ]);
  if (!choices || choices.includes('skip')) {
    console.error(`  ${pc.dim('Assistant setup skipped.')}\n`);
    console.error(`${GLOBAL_ONLY_NOTE}\n`);
    return;
  }
  const ids = choices.filter((c): c is AssistantId => c !== 'skip');
  let agentsReported = false;
  for (const choice of ids) {
    const r = setupAssistant(choice, cwd);
    if (r.alreadyConfigured) {
      console.error(`  ${pc.yellow('→')} Fennec already configured in ${pc.bold(r.configPath)}\n`);
    } else {
      console.error(`  ${renderSuccess('MCP config written:')} ${pc.bold(r.configPath)}\n`);
    }
    console.error(`  ${renderSuccess('Skill written:')} ${pc.bold(r.skillPath)}\n`);
    if (!agentsReported) {
      console.error(
        r.agentsMdUpdated
          ? `  ${renderSuccess('AGENTS.md updated:')} ${pc.bold(r.agentsMdPath)}\n`
          : `  ${pc.dim('AGENTS.md already mentions Fennec — left untouched.')}\n`,
      );
      agentsReported = true;
    }
  }
  console.error(
    `  ${pc.dim('Restart the assistant(s) so they pick up the MCP server, then run')} ${renderCommand('fennec start')}\n`,
  );
  console.error(`${GLOBAL_ONLY_NOTE}\n`);
}
