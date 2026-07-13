import { z } from 'zod';
import { createTool } from '../_registry.js';

export const tabNew = createTool({
  name: 'tab_new',
  category: 'tabs',
  description:
    '`<use_case>Tab management</use_case> ➕ Create a new browser tab. Optionally navigate to a URL immediately. Returns tabId (the URL of the new tab) and sessionId. Use when you need to open a page in a separate tab while keeping the current tab active. For just navigating the current tab, use browser_navigate instead.`',
  inputSchema: z.object({
    url: z.string().optional().describe('URL to navigate to in the new tab'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const newPage = await session.browser.contextNewPage();
      if (input.url) {
        await newPage.navigate(input.url, { waitUntil: 'networkidle' });
      }

      return responseBuilder.success(
        {
          tabId: newPage.url(),
          sessionId: session.id,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const tabClose = createTool({
  name: 'tab_close',
  category: 'tabs',
  description:
    "`<use_case>Tab management</use_case> ❌ Close a browser tab by its URL (tabId). Returns success. Use after you're done with a tab to free resources. Get tab URLs from tab_list. Note: You cannot close the last remaining tab via this tool.`",
  inputSchema: z.object({
    tabId: z.string().describe('Tab ID (URL) to close'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const pages = session.browser.contextPages();
      for (const page of pages) {
        if (page.url() === input.tabId) {
          await page.close();
          return responseBuilder.success({}, sessionManager.buildMeta(session));
        }
      }

      return responseBuilder.error(new Error(`Tab not found: ${input.tabId}`), {
        code: 'ELEMENT_NOT_FOUND',
      });
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const tabList = createTool({
  name: 'tab_list',
  category: 'tabs',
  description:
    "`<use_case>Tab management</use_case> 📋 List all open browser tabs with their URL, title, and whether they're the active tab. Returns tabs[] and activeTabId. Use to discover what tabs are open before switching (tab_switch) or closing (tab_close) a tab. Essential first step before any tab operation.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const pages = session.browser.contextPages();
      const tabs = await Promise.all(
        pages.map(async (p) => ({
          url: p.url(),
          title: await p.title().catch(() => ''),
          active: p === session.browser,
        })),
      );

      return responseBuilder.success(
        {
          tabs,
          activeTabId: session.browser.url(),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const tabSwitch = createTool({
  name: 'tab_switch',
  category: 'tabs',
  description:
    "`<use_case>Tab management</use_case> 🔄 Switch focus to a different browser tab by its URL (tabId). Returns the tab's URL and title. Use after tab_list to navigate between open tabs. All subsequent browser interactions (click, type, screenshot, etc.) will target the switched-to tab. Unlike tab_new, this doesn't create a new tab — it activates an existing one.`",
  inputSchema: z.object({
    tabId: z.string().describe('Tab URL to switch to'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const pages = session.browser.contextPages();
      for (const page of pages) {
        if (page.url() === input.tabId) {
          await page.bringToFront();
          return responseBuilder.success(
            {
              url: page.url(),
              title: await page.title().catch(() => ''),
            },
            sessionManager.buildMeta(session),
          );
        }
      }

      return responseBuilder.error(new Error(`Tab not found: ${input.tabId}`), {
        code: 'ELEMENT_NOT_FOUND',
      });
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const contextNew = createTool({
  name: 'context_new',
  category: 'tabs',
  description:
    '`<use_case>Session management</use_case> 🔒 Create a new isolated browser context with separate cookies, localStorage, and storage (like incognito mode). Returns contextId. Use when you need a completely separate browser session — e.g., testing multi-user scenarios, different auth states, or accessing the same site with different accounts simultaneously.`',
  inputSchema: z.object({
    options: z
      .object({
        userAgent: z.string().optional(),
        locale: z.string().optional(),
        viewport: z.object({ width: z.number(), height: z.number() }).optional(),
      })
      .optional()
      .describe('Browser context options'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const newSession = await sessionManager.createSession('new-context');
      return responseBuilder.success(
        {
          contextId: newSession.id,
        },
        sessionManager.buildMeta(newSession),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const tabGetCurrent = createTool({
  name: 'tab_get_current',
  category: 'tabs',
  description:
    "`<use_case>Tab management</use_case> ℹ️ Get current active tab info: URL, page title, and document readyState. Faster than tab_list (no need to scan all tabs). Use when you just need to check what page you're on, confirm navigation succeeded, or verify page load state. Similar to browser_get_current_url but also returns title and readyState.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const [url, title, readyState] = await Promise.all([
        session.browser.url(),
        session.browser.title().catch(() => ''),
        session.browser.evaluate(() => document.readyState).catch(() => 'unknown'),
      ]);

      return responseBuilder.success(
        {
          url,
          title,
          readyState,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const contextClose = createTool({
  name: 'context_close',
  category: 'tabs',
  description:
    "`<use_case>Session management</use_case> 🚪 Close an isolated browser context (created via context_new) by sessionId. The default session cannot be closed. Returns success. Use to clean up isolated contexts when you're done with them. Use tab_close for individual tabs within a context.`",
  inputSchema: z.object({
    sessionId: z.string().describe('Session (context) ID to close'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    try {
      const session = sessionManager.getSession(input.sessionId);
      if (!session) {
        return responseBuilder.error(new Error(`Session not found: ${input.sessionId}`), {
          code: 'SESSION_NOT_FOUND',
        });
      }

      await sessionManager.destroySession(input.sessionId);
      return responseBuilder.success(
        {},
        { elapsed: 0, sessionId: input.sessionId, timestamp: new Date().toISOString() },
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const sessionRecover = createTool({
  name: 'browser_session_recover',
  category: 'tabs',
  description:
    '`<use_case>Session recovery</use_case> 🔧 Recover a browser session whose page/CDP target died silently (e.g. after a cross-scheme https→http navigation that detached the CDP target — issue #4). Recreates the page inside the same context and re-attaches console/network collectors, so subsequent tool calls work again without restarting Fennec. Returns whether a recovery was performed. Defaults to the active session when sessionId is omitted.`',
  inputSchema: z.object({
    sessionId: z
      .string()
      .optional()
      .describe('Session to recover (defaults to the active session)'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    try {
      const before = (() => {
        try {
          return sessionManager.getOrDefault(input.sessionId).browser.isAlive();
        } catch {
          return false;
        }
      })();
      await sessionManager.ensureAlive(input.sessionId);
      const after = (() => {
        try {
          return sessionManager.getOrDefault(input.sessionId).browser.isAlive();
        } catch {
          return false;
        }
      })();
      return responseBuilder.success(
        { recovered: !before && after, aliveAfter: after, aliveBefore: before },
        { elapsed: 0, sessionId: input.sessionId ?? '', timestamp: new Date().toISOString() },
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const contextRotate = createTool({
  name: 'context_rotate',
  category: 'tabs',
  description:
    "`<use_case>Session management</use_case> ♻️ Recycle a session's underlying BrowserContext to free memory (DOM, listeners, workers, cache) accumulated by a long-lived context. Cookies and localStorage are preserved via storageState, and the current page URL is reloaded so your place is kept. Useful as proactive garbage-collection for sessions left open for a long time.`",
  inputSchema: z.object({
    sessionId: z.string().describe('Session (context) ID to rotate'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    try {
      await sessionManager.rotateSession(input.sessionId);
      return responseBuilder.success(
        { rotated: true },
        { elapsed: 0, sessionId: input.sessionId, timestamp: new Date().toISOString() },
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});
