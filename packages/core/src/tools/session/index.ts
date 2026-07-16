import { z } from 'zod';
import { createTool } from '../_registry.js';
import type { ToolContext } from '../_registry.js';

export const sessionList = createTool({
  name: 'session_list',
  category: 'session',
  description:
    'List all active browser sessions with their IDs, creation time, URL, title, and buffer sizes. Use to discover which sessions are open and their auth state before calling other session-aware tools.',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (_input, { sessionManager, responseBuilder }) => {
    const entries = sessionManager.listSessions();
    const defaultId = sessionManager.getDefaultSessionId();
    const sessions = entries.map((s) => {
      let url = 'unknown';
      try {
        url = s.browser?.url ? s.browser.url() : 'unknown';
      } catch {
        /* best-effort */
      }
      return {
        id: s.id,
        name: s.name ?? null,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        isDefault: s.id === defaultId,
        url,
        consoleErrors: s.consoleBuffer.filter((l) => l.level === 'error').length,
        networkRequests: s.networkBuffer.length,
        metadata: s.metadata,
      };
    });

    return responseBuilder.success({
      sessions,
      count: sessions.length,
    });
  },
});
