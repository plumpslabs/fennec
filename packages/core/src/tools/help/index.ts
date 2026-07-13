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
    });
  },
});
