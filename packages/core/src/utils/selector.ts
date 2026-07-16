import type { BrowserSession } from '../browser/types.js';

/**
 * Per-session selector cache.
 * Maps sessionId → (input → resolved SelectorResult).
 * Avoids re-exploring all strategies on repeated calls with the same selector.
 */
const selectorCache = new Map<string, Map<string, SelectorResult>>();

const STRATEGY_TIMEOUT = 2_000; // 2s per strategy, up to ~12s total worst case

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(resolve, ms)),
  ]);
}

export interface SelectorResult {
  selector: string;
  strategy: 'aria' | 'testid' | 'text' | 'css' | 'xpath';
  found: boolean;
}

export function clearSelectorCache(sessionId?: string): void {
  if (sessionId) {
    selectorCache.delete(sessionId);
  } else {
    selectorCache.clear();
  }
}

export async function findElement(session: BrowserSession, input: string): Promise<SelectorResult> {
  // ── Check per-session cache first ──
  const cached = selectorCache.get(session.id)?.get(input);
  if (cached) {
    return cached;
  }

  // Strategy 1: ARIA role + accessible name (fast — direct CSS query)
  try {
    const ariaSelector = `[role="${input}"]`;
    const el = await withTimeout(session.$(ariaSelector), STRATEGY_TIMEOUT);
    if (el) {
      return cacheResult(session.id, input, { selector: ariaSelector, strategy: 'aria', found: true });
    }
  } catch {
    // fall through
  }

  // Try role=button with name (fast — Playwright engine)
  try {
    const roleSelector = `role=${JSON.stringify(input)}`;
    const el = await withTimeout(
      session
        .locator(roleSelector)
        .first()
        .elementHandle()
        .catch(() => null),
      STRATEGY_TIMEOUT,
    );
    if (el) {
      return cacheResult(session.id, input, { selector: roleSelector, strategy: 'aria', found: true });
    }
  } catch {
    // fall through
  }

  // Strategy 2: data-testid
  try {
    const testIdSelectors = [
      `[data-testid="${input}"]`,
      `[data-test-id="${input}"]`,
      `[data-fennec-id="${input}"]`,
    ];
    for (const sel of testIdSelectors) {
      const el = await withTimeout(session.$(sel), STRATEGY_TIMEOUT);
      if (el) {
        return cacheResult(session.id, input, { selector: sel, strategy: 'testid', found: true });
      }
    }
  } catch {
    // fall through
  }

  // Strategy 3: Text content
  try {
    const textSelector = `text=${JSON.stringify(input)}`;
    const el = await withTimeout(
      session
        .locator(textSelector)
        .first()
        .elementHandle()
        .catch(() => null),
      STRATEGY_TIMEOUT,
    );
    if (el) {
      return cacheResult(session.id, input, { selector: textSelector, strategy: 'text', found: true });
    }
  } catch {
    // fall through
  }

  // Strategy 4: CSS selector
  try {
    const el = await withTimeout(session.$(input), STRATEGY_TIMEOUT);
    if (el) {
      return cacheResult(session.id, input, { selector: input, strategy: 'css', found: true });
    }
  } catch {
    // fall through
  }

  // Strategy 5: XPath (slowest — last resort)
  try {
    const xpathSelector = `xpath=${input}`;
    const el = await withTimeout(session.$(xpathSelector), STRATEGY_TIMEOUT);
    if (el) {
      return cacheResult(session.id, input, { selector: xpathSelector, strategy: 'xpath', found: true });
    }
  } catch {
    // fall through
  }

  const result: SelectorResult = { selector: input, strategy: 'css', found: false };
  cacheResult(session.id, input, result);
  return result;
}

function cacheResult(sessionId: string, input: string, result: SelectorResult): SelectorResult {
  let sessionCache = selectorCache.get(sessionId);
  if (!sessionCache) {
    sessionCache = new Map();
    selectorCache.set(sessionId, sessionCache);
  }
  sessionCache.set(input, result);
  return result;
}

export async function resolveSelector(
  session: BrowserSession,
  selector: string,
): Promise<SelectorResult> {
  // If it already looks like a structured selector, use it directly
  if (
    selector.startsWith('role=') ||
    selector.startsWith('text=') ||
    selector.startsWith('xpath=') ||
    selector.startsWith('css=')
  ) {
    const el = await withTimeout(session.$(selector).catch(() => null), STRATEGY_TIMEOUT);
    const result: SelectorResult = {
      selector,
      strategy: selector.startsWith('role=')
        ? 'aria'
        : selector.startsWith('text=')
          ? 'text'
          : selector.startsWith('xpath=')
            ? 'xpath'
            : 'css',
      found: el !== null,
    };
    return cacheResult(session.id, selector, result);
  }

  return findElement(session, selector);
}
