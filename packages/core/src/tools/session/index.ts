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

export const sessionGetActive = createTool({
  name: 'session_get_active',
  category: 'session',
  description:
    '`<use_case>Session management</use_case> 🎯 Get the CURRENT active session — the one used when a tool is called without an explicit sessionId. Returns id, name, url, title, isDefault, and how many sessions are open total. Use this to discover the active session ID before calling session-aware tools, or to confirm which tab is "current" after opening new tabs. Pair with session_list to see all sessions.',
  inputSchema: z.object({}),
  handler: async (_input, { sessionManager, responseBuilder }) => {
    const defaultId = sessionManager.getDefaultSessionId();
    if (!defaultId) {
      return responseBuilder.error(new Error('No active session — none has been created yet'), {
        code: 'NO_ACTIVE_SESSION',
        suggestions: [
          'Navigate to a page first (browser_navigate) to create the default session',
          'Use session_list to see any open sessions',
        ],
      });
    }

    const session = sessionManager.getSession(defaultId);
    let url = 'unknown';
    let title = 'unknown';
    try {
      url = session.browser?.url ? session.browser.url() : 'unknown';
      title = await session.browser.title().catch(() => 'unknown');
    } catch {
      /* best-effort */
    }

    return responseBuilder.success({
      id: session.id,
      name: session.name ?? null,
      url,
      title,
      isDefault: true,
      totalSessions: sessionManager.listSessions().length,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
    });
  },
});
