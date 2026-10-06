import { z } from 'zod';
import { createTool } from '../_registry.js';
/**
 * tools_help — discoverability for the 80+ tool surface.
 * Returns a per-category summary (name + one-line purpose) so an agent
 * doesn't have to read dozens of schemas to learn what exists.
 */
export const toolsHelp = createTool({
  name: 'tools_help',
  category: 'ai',
  description:
    "`<use_case>Discoverability</use_case> 🔎 List available Fennec tools grouped by category, with a one-line purpose each — so you can find the right tool without reading 80+ schemas. Pass category to narrow (e.g. 'auth', 'navigation', 'devtools', 'network', 'process', 'dom', 'smart', 'ai', 'diagnostic'). Omit category to list everything by group. Pairs with the `_tokenTier` tags in tools/list to pick cheap tools first.`",
  inputSchema: z.object({
    category: z.string().optional().describe('Only show tools in this category'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { responseBuilder, toolRegistry }) => {
    if (!toolRegistry) {
      return responseBuilder.error(new Error('Tool registry is not available in this context'), {
        code: 'REGISTRY_UNAVAILABLE',
      });
    }

    const all = toolRegistry.getAll();
    const byCategory = new Map<string, Array<{ name: string; purpose: string }>>();
    for (const t of all) {
      const cat = t.category ?? 'uncategorized';
      if (input.category && cat !== input.category) continue;
      // Purpose = text inside the first backtick use_case block, else first sentence.
      const useCase = t.description.match(/`<use_case>([^<]+)<\/use_case>/)?.[1] ?? '';
      const purpose = t.description
        .replace(/`<use_case>[^<]+<\/use_case>`/, '')
        .replace(/\s+/g, ' ')
        .trim();
      byCategory.set(cat, [
        ...(byCategory.get(cat) ?? []),
        { name: t.name, purpose: (useCase ? `[${useCase}] ` : '') + purpose.slice(0, 160) },
      ]);
    }

    const categories = Array.from(byCategory.entries()).map(([name, tools]) => ({
      category: name,
      count: tools.length,
      tools,
    }));

    const total = categories.reduce((sum, c) => sum + c.count, 0);

    return responseBuilder.success({
      total,
      categories: input.category ? categories.slice(0, 1) : categories,
      count: categories.length,
      hint: 'Load only the categories you need via tools/list ?categories=[...] to save tokens.',
      // Selection audit trail (#141): content-free receipt so misroutes
      // are debuggable without dumping schemas.
      receipt: {
        candidates: total,
        categories: categories.length,
        selected: input.category ?? null,
        policy: 'progressive-discovery',
      },
    });
  },
});

/**
 * metrics_summary (#149) — which tools pay for themselves.
 * Reads the append-only PII-free log (tool + ms + ok) written by the
 * server dispatch. Bounded: last N lines only. Answers: call counts,
 * error rates, avg latency — the data source for #141 compaction.
 */
export const metricsSummary = createTool({
  name: 'metrics_summary',
  category: 'ai',
  description:
    '`<use_case>Discoverability</use_case> 📊 Usage metrics: which tools get called, error rates, avg latency (PII-free: name + ms + ok only). Use to find looping agents, failing tools, and compaction candidates.`',
  inputSchema: z.object({
    lines: z
      .number()
      .optional()
      .default(1000)
      .describe('Last N metric lines to aggregate (max 5000)'),
  }),
  handler: async (input, { responseBuilder }) => {
    try {
      const { existsSync, readFileSync } = await import('node:fs');
      const { getFennecDir } = await import('../../config/paths.js');
      const path = `${getFennecDir()}/metrics.jsonl`;
      if (!existsSync(path)) {
        return responseBuilder.success({ calls: 0, tools: [], summary: 'No metrics yet' });
      }
      const cap = Math.min(Math.max(1, input.lines ?? 1000), 5000);
      const raw = readFileSync(path, 'utf-8').split('\n').filter(Boolean).slice(-cap);
      const agg = new Map<string, { calls: number; errors: number; msTotal: number }>();
      for (const line of raw) {
        try {
          const e = JSON.parse(line) as { tool?: string; ms?: number; ok?: boolean };
          if (!e.tool) continue;
          const a = agg.get(e.tool) ?? { calls: 0, errors: 0, msTotal: 0 };
          a.calls += 1;
          if (e.ok === false) a.errors += 1;
          if (typeof e.ms === 'number') a.msTotal += e.ms;
          agg.set(e.tool, a);
        } catch {
          /* skip corrupt lines */
        }
      }
      const tools = Array.from(agg.entries())
        .map(([tool, a]) => ({
          tool,
          calls: a.calls,
          errorRate: a.calls > 0 ? Math.round((a.errors / a.calls) * 100) / 100 : 0,
          avgMs: a.calls > 0 ? Math.round(a.msTotal / a.calls) : 0,
        }))
        .sort((x, y) => y.calls - x.calls);
      const calls = tools.reduce((s, t) => s + t.calls, 0);
      const shown = tools.slice(0, 30);
      return responseBuilder.success({
        calls,
        tools: shown,
        truncated: tools.length > shown.length ? tools.length - shown.length : 0,
        summary: `${calls} calls across ${agg.size} tools (last ${raw.length} events)`,
      });
    } catch (error) {
      return responseBuilder.error(error, { code: 'METRICS_UNAVAILABLE' });
    }
  },
});
