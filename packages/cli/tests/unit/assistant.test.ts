import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  type AssistantId,
  assistantConfigPath,
  assistantServersKey,
  assistantServerEntry,
  assistantSkillPath,
  ensureAgentsSection,
  mergeMcpConfig,
  setupAssistant,
  skillPath,
  skillTemplate,
  stdioServerEntry,
} from '../../src/commands/assistant.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'fennec-assistant-'));
}

describe('assistant setup', () => {
  it('stdio entry launches fennec start', () => {
    expect(stdioServerEntry()).toEqual({ command: 'fennec', args: ['start'] });
  });

  it('config paths are assistant-specific', () => {
    expect(assistantConfigPath('claude-code')).toBe('.mcp.json');
    expect(assistantConfigPath('qoder')).toBe('.mcp.json');
    expect(assistantConfigPath('cursor')).toBe(join('.cursor', 'mcp.json'));
    expect(assistantConfigPath('vscode')).toBe(join('.vscode', 'mcp.json'));
    expect(assistantConfigPath('opencode')).toBe('opencode.json');
    expect(assistantConfigPath('antigravity')).toBe(join('.agents', 'mcp_config.json'));
  });

  it('server root keys match vendor formats', () => {
    expect(assistantServersKey('vscode')).toBe('servers');
    expect(assistantServersKey('opencode')).toBe('mcp');
    const stdio: AssistantId[] = ['claude-code', 'qoder', 'cursor', 'antigravity'];
    for (const id of stdio) expect(assistantServersKey(id)).toBe('mcpServers');
  });

  it('uses opencode local-command shape', () => {
    expect(assistantServerEntry('opencode')).toEqual({
      type: 'local',
      command: ['fennec', 'start'],
      enabled: true,
    });
  });

  it('merges into empty config for stdio assistants', () => {
    const { merged, alreadyConfigured } = mergeMcpConfig('cursor', null);
    expect(alreadyConfigured).toBe(false);
    expect(merged?.mcpServers?.fennec).toEqual({ command: 'fennec', args: ['start'] });
  });

  it('uses the servers key for VS Code', () => {
    const { merged } = mergeMcpConfig('vscode', null);
    expect(merged?.servers?.fennec).toEqual({ type: 'stdio', command: 'fennec', args: ['start'] });
    expect(merged?.mcpServers).toBeUndefined();
  });

  it('follows opencode v2 mcp.servers nesting when present', () => {
    const v1 = mergeMcpConfig('opencode', null);
    expect(v1.merged?.mcp?.fennec?.type).toBe('local');
    const v2 = mergeMcpConfig('opencode', { mcp: { servers: { other: {} } } });
    expect(v2.merged?.mcp?.servers?.fennec?.type).toBe('local');
    expect(v2.merged?.mcp?.fennec).toBeUndefined();
    expect(mergeMcpConfig('opencode', { mcp: { servers: { fennec: {} } } }).alreadyConfigured).toBe(
      true,
    );
  });

  it('preserves existing keys and detects duplicates', () => {
    const { merged } = mergeMcpConfig('claude-code', { mcpServers: { other: { command: 'x' } } });
    expect(merged?.mcpServers?.other).toEqual({ command: 'x' });
    expect(merged?.mcpServers?.fennec).toBeDefined();

    const dup = mergeMcpConfig('claude-code', { mcpServers: { fennec: { command: 'fennec' } } });
    expect(dup.alreadyConfigured).toBe(true);
    expect(dup.merged).toBeNull();
  });

  it('skill paths use each assistant’s native skill root', () => {
    expect(assistantSkillPath('opencode')).toBe(join('.opencode', 'skills', 'fennec', 'SKILL.md'));
    expect(assistantSkillPath('claude-code')).toBe(join('.claude', 'skills', 'fennec', 'SKILL.md'));
    expect(assistantSkillPath('cursor')).toBe(join('.cursor', 'skills', 'fennec', 'SKILL.md'));
    expect(assistantSkillPath('vscode')).toBe(join('.github', 'skills', 'fennec', 'SKILL.md'));
    expect(assistantSkillPath('qoder')).toBe(join('.qoder', 'skills', 'fennec', 'SKILL.md'));
    for (const id of ['antigravity'] as const) {
      expect(assistantSkillPath(id)).toBe(skillPath());
    }
  });

  it('writes the opencode skill into .opencode/skills', () => {
    const dir = freshDir();
    const r = setupAssistant('opencode', dir);
    expect(r.skillPath).toBe(join(dir, '.opencode', 'skills', 'fennec', 'SKILL.md'));
    expect(existsSync(r.skillPath)).toBe(true);
    // No duplicate under .agents/ — opencode scans both roots.
    expect(existsSync(join(dir, skillPath()))).toBe(false);
  });

  it('writes config + skill files, idempotent on re-run', () => {
    const dir = freshDir();
    const first = setupAssistant('cursor', dir);
    expect(first.configWritten).toBe(true);
    expect(existsSync(join(dir, '.cursor', 'mcp.json'))).toBe(true);
    expect(first.skillPath).toBe(join(dir, '.cursor', 'skills', 'fennec', 'SKILL.md'));
    expect(existsSync(first.skillPath)).toBe(true);

    const cfg = JSON.parse(readFileSync(join(dir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(cfg.mcpServers.fennec.command).toBe('fennec');

    const second = setupAssistant('cursor', dir);
    expect(second.alreadyConfigured).toBe(true);
    expect(second.configWritten).toBe(false);
  });

  it('claude-code and qoder share .mcp.json safely', () => {
    const dir = freshDir();
    setupAssistant('claude-code', dir);
    const r = setupAssistant('qoder', dir);
    expect(r.alreadyConfigured).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(cfg.mcpServers.fennec.command).toBe('fennec');
  });

  it('merges into a pre-existing opencode.json without clobbering', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'opencode.json'), JSON.stringify({ theme: 'dark' }));
    const r = setupAssistant('opencode', dir);
    expect(r.configWritten).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf-8'));
    expect(cfg.theme).toBe('dark');
    expect(cfg.mcp.fennec.type).toBe('local');
  });

  it('writes antigravity workspace config', () => {
    const dir = freshDir();
    setupAssistant('antigravity', dir);
    const cfg = JSON.parse(readFileSync(join(dir, '.agents', 'mcp_config.json'), 'utf-8'));
    expect(cfg.mcpServers.fennec.args).toEqual(['start']);
    expect(existsSync(join(dir, skillPath()))).toBe(true);
  });

  it('skill template teaches the observe-first workflow', () => {
    const s = skillTemplate();
    expect(s).toContain('observe(');
    expect(s).toContain('diagnose_page');
    expect(s).toContain('process_spawn');
    expect(s).toContain('FENNEC_WORKFLOW_ONLY');
  });

  it('creates AGENTS.md with the fennec section when missing', () => {
    const dir = freshDir();
    const r = setupAssistant('cursor', dir);
    expect(r.agentsMdUpdated).toBe(true);
    const md = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
    expect(md).toContain('observe(');
    expect(md).toContain('diagnose_page');
  });

  it('appends to existing AGENTS.md without duplicating', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'AGENTS.md'), '# My project\n');
    const first = ensureAgentsSection(dir);
    expect(first.updated).toBe(true);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toContain('# My project');
    const second = ensureAgentsSection(dir);
    expect(second.updated).toBe(false);
  });

  it('matrix: all 6 assistants write valid config + skill + AGENTS.md, idempotent', () => {
    const ids: AssistantId[] = [
      'claude-code',
      'qoder',
      'cursor',
      'vscode',
      'opencode',
      'antigravity',
    ];
    for (const id of ids) {
      const dir = freshDir();
      // Seed a pre-existing config to prove merge never clobbers.
      const cfgRel = assistantConfigPath(id);
      const cfgAbs = join(dir, cfgRel);
      mkdirSync(dirname(cfgAbs), { recursive: true });
      writeFileSync(cfgAbs, JSON.stringify({ keepMe: true }));
      const first = setupAssistant(id, dir);
      expect(first.configWritten).toBe(true);
      expect(first.agentsMdUpdated).toBe(true);
      const cfg = JSON.parse(readFileSync(cfgAbs, 'utf-8'));
      expect(cfg.keepMe).toBe(true);
      expect(existsSync(first.skillPath)).toBe(true);
      expect(readFileSync(first.skillPath, 'utf-8')).toContain('name: fennec');
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toContain('observe(');
      // Re-run: fully idempotent, no duplicates.
      const skillBefore = readFileSync(first.skillPath, 'utf-8');
      const agentsBefore = readFileSync(join(dir, 'AGENTS.md'), 'utf-8');
      const second = setupAssistant(id, dir);
      expect(second.alreadyConfigured).toBe(true);
      expect(second.configWritten).toBe(false);
      expect(second.agentsMdUpdated).toBe(false);
      expect(readFileSync(second.skillPath, 'utf-8')).toBe(skillBefore);
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe(agentsBefore);
    }
  });
});
