import type { FennecSession } from "../session/types.js";
import { takeScreenshot } from "../utils/screenshot.js";

export interface EnrichedContext {
  currentUrl?: string;
  pageTitle?: string;
  readyState?: string;
  screenshot?: string;
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

    try {
      const screenshot = await takeScreenshot(session.browser);
      context.screenshot = screenshot.base64;
    } catch {
      // Screenshot might fail
    }

    // Include console errors
    const errors = session.consoleBuffer
      .filter((l) => l.level === "error")
      .slice(-5)
      .map((l) => `[${l.level}] ${l.message}`);

    if (errors.length > 0) {
      context.consoleLogs = errors;
    }

    if (extra?.serverLogs && extra.serverLogs.length > 0) {
      context.serverLogs = extra.serverLogs.slice(-5);
    }

    return context;
  }
}
