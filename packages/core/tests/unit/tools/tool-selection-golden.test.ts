/**
 * Golden dataset for tool selection (#141).
 * Prompt → expected tool (+ params). Run on every schema change so
 * compaction / renames never silently break routing. If you rename a tool
 * or change its category, update this file in the same commit.
 *
 * Coverage target: ~10 composite/workflow tools cover 90% of flows —
 * golden cases prefer the composite first.
 */
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/tools/_registry.js';

// The production registry is wired in server.ts; here we assert the
// CONTRACT each golden case depends on: tool name + category exist.
const GOLDEN: Array<{
  prompt: string;
  expectTool: string;
  expectCategory: string;
}> = [
  { prompt: 'is the app healthy?', expectTool: 'observe', expectCategory: 'ai' },
  { prompt: 'why is login failing?', expectTool: 'ai_diagnose', expectCategory: 'ai' },
  { prompt: 'fill this 10-field form', expectTool: 'smart_fill_form', expectCategory: 'smart' },
  { prompt: 'is this button clickable?', expectTool: 'fennec_flow', expectCategory: 'smart' },
  { prompt: 'page health check', expectTool: 'fennec_flow', expectCategory: 'smart' },
  { prompt: 'verify my edit (typecheck+tests+lint)', expectTool: 'smart_verify', expectCategory: 'smart' },
  { prompt: 'is CI green on my PR?', expectTool: 'ci_watch', expectCategory: 'smart' },
  { prompt: 'tail the server logs', expectTool: 'process_get_logs', expectCategory: 'process' },
  { prompt: 'wait until the dev server is up', expectTool: 'process_wait_for_ready', expectCategory: 'process' },
  { prompt: 'what processes are running?', expectTool: 'process_get_tracked', expectCategory: 'process' },
  { prompt: 'restore my login session', expectTool: 'auth_load_session', expectCategory: 'auth' },
  { prompt: 'list saved logins', expectTool: 'auth_list_sessions', expectCategory: 'auth' },
  { prompt: 'what tools exist for networking?', expectTool: 'tools_help', expectCategory: 'ai' },
  { prompt: 'screenshot the page', expectTool: 'browser_screenshot_annotated', expectCategory: 'smart' },
  { prompt: 'which API calls failed?', expectTool: 'network_get_logs', expectCategory: 'devtools' },
];

describe('tool-selection golden set (#141)', () => {
  it('documents the routing contract (tool → category)', () => {
    // Self-contained: the mapping itself is the regression artifact.
    // (Same tool may serve multiple prompts — uniqueness is on prompts.)
    const prompts = GOLDEN.map((g) => g.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
    expect(GOLDEN.length).toBeGreaterThanOrEqual(10);
  });

  it('registry invariants for progressive discovery: unique names, category + use_case on every tool', async () => {
    const registry = new ToolRegistry();
    // Import all tool modules the way server.ts does (representative set —
    // full wiring is covered by server.test.ts).
    const smart = await import('../../../src/tools/smart/index.js');
    const ai = await import('../../../src/tools/ai/index.js');
    const proc = await import('../../../src/tools/process/index.js');
    const auth = await import('../../../src/tools/auth/index.js');
    const help = await import('../../../src/tools/help/index.js');
    const devtools = await import('../../../src/tools/devtools/network.js');
    for (const mod of [smart, ai, proc, auth, help, devtools]) {
      for (const v of Object.values(mod)) {
        if (v && typeof v === 'object' && 'name' in (v as object) && 'handler' in (v as object)) {
          registry.register(v as never);
        }
      }
    }
    const all = registry.getAll();
    const names = all.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of all) {
      expect(t.category, `${t.name} missing category`).toBeTruthy();
      expect(t.description, `${t.name} missing <use_case> block`).toMatch(/<use_case>.*<\/use_case>/);
    }
    // Golden tools must exist in the registry surface.
    for (const g of GOLDEN) {
      const tool = registry.get(g.expectTool);
      expect(tool, `golden tool missing: ${g.expectTool} ("${g.prompt}")`).toBeDefined();
      expect(tool?.category).toBe(g.expectCategory);
    }
  });
});
