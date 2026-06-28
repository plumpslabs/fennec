import { z } from "zod";
import { createTool } from "../_registry.js";

export const tabNew = createTool({
  name: "tab_new",
  description: "`<use_case>Tab management</use_case> Create a new browser tab. Optionally navigate to a URL. tabId (url), sessionId.`",
  inputSchema: z.object({
    url: z.string().optional().describe("URL to navigate to in the new tab"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const newPage = await session.context.newPage();
      if (input.url) {
        await newPage.goto(input.url, { waitUntil: "networkidle" });
      }

      // Update session page reference
      const currentSession = sessionManager.getSession(session.id);
      currentSession.page = newPage;

      return responseBuilder.success({
        tabId: newPage.url(),
        sessionId: session.id,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const tabClose = createTool({
  name: "tab_close",
  description: "`<use_case>Tab management</use_case> Close a tab by its URL (tabId). success.`",
  inputSchema: z.object({
    tabId: z.string().describe("Tab ID (URL) to close"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const pages = session.context.pages();
      for (const page of pages) {
        if (page.url() === input.tabId) {
          await page.close();
          return responseBuilder.success({}, sessionManager.buildMeta(session));
        }
      }

      return responseBuilder.error(
        new Error(`Tab not found: ${input.tabId}`),
        { code: "ELEMENT_NOT_FOUND" },
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const tabList = createTool({
  name: "tab_list",
  description: "`<use_case>Tab management</use_case> List all open tabs with URL, title, and active status. tabs[], activeTabId.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const pages = session.context.pages();
      const tabs = await Promise.all(
        pages.map(async (p) => ({
          url: p.url(),
          title: await p.title().catch(() => ""),
          active: p === session.page,
        })),
      );

      return responseBuilder.success({
        tabs,
        activeTabId: session.page.url(),
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const tabSwitch = createTool({
  name: "tab_switch",
  description: "`<use_case>Tab management</use_case> Switch to a tab by its URL (tabId). url, title.`",
  inputSchema: z.object({
    tabId: z.string().describe("Tab URL to switch to"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const pages = session.context.pages();
      for (const page of pages) {
        if (page.url() === input.tabId) {
          const currentSession = sessionManager.getSession(session.id);
          currentSession.page = page;
          await page.bringToFront();
          return responseBuilder.success({
            url: page.url(),
            title: await page.title().catch(() => ""),
          }, sessionManager.buildMeta(session));
        }
      }

      return responseBuilder.error(
        new Error(`Tab not found: ${input.tabId}`),
        { code: "ELEMENT_NOT_FOUND" },
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const contextNew = createTool({
  name: "context_new",
  description: "`<use_case>Session management</use_case> Create a new isolated browser context (separate cookies/storage, incognito-like). contextId (session ID).`",
  inputSchema: z.object({
    options: z
      .object({
        userAgent: z.string().optional(),
        locale: z.string().optional(),
        viewport: z.object({ width: z.number(), height: z.number() }).optional(),
      })
      .optional()
      .describe("Browser context options"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const newSession = await sessionManager.createSession("new-context");
      return responseBuilder.success({
        contextId: newSession.id,
      }, sessionManager.buildMeta(newSession));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const contextClose = createTool({
  name: "context_close",
  description: "`<use_case>Session management</use_case> Close a browser context by sessionId. The default session cannot be closed. success.`",
  inputSchema: z.object({
    sessionId: z.string().describe("Session (context) ID to close"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    try {
      const session = sessionManager.getSession(input.sessionId);
      if (!session) {
        return responseBuilder.error(
          new Error(`Session not found: ${input.sessionId}`),
          { code: "SESSION_NOT_FOUND" },
        );
      }

      await sessionManager.destroySession(input.sessionId);
      return responseBuilder.success({}, { elapsed: 0, sessionId: input.sessionId, timestamp: new Date().toISOString() });
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});
