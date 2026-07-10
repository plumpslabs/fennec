import type { FennecSession } from "../session/types.js";

export interface EnrichedContext {
  currentUrl?: string;
  pageTitle?: string;
  readyState?: string;
  /** Text summary instead of base64 screenshot (screenshots are 5000-10000+ tokens) */
  visualSummary?: string;
  consoleLogs?: string[];
  serverLogs?: string[];
}

export class ErrorEnricher {
  async enrich(session: FennecSession | null, extra?: { serverLogs?: string[] }): Promise<EnrichedContext> {
    const context: EnrichedContext = {};

    if (!session) return context;

    try {
      context.currentUrl = session.browser.url();
      context.pageTitle = await session.browser.title();
      context.readyState = await session.browser.evaluate(() => document.readyState);
    } catch {
      // Page might be closed
    }

    // ⚡ NO SCREENSHOT — screenshots are 5000-10000+ tokens (too expensive per error)
    // Replaced with lightweight text summary:
    try {
      const pageText = await session.browser
        .evaluate(() => document.body?.innerText?.slice(0, 500) ?? "")
        .catch(() => "");
      if (pageText) {
        context.visualSummary = `Page text preview: ${pageText.slice(0, 200)}`;
      }
    } catch {
      // Best-effort
    }

    // Include console errors (summary only, not full dump)
    const errors = session.consoleBuffer
      .filter((l) => l.level === "error")
      .slice(-3)
      .map((l) => `[${l.level}] ${l.message.slice(0, 150)}`);

    if (errors.length > 0) {
      context.consoleLogs = errors;
    }

    if (extra?.serverLogs && extra.serverLogs.length > 0) {
      context.serverLogs = extra.serverLogs.slice(-3).map((l) => l.slice(0, 200));
    }

    return context;
  }
}
