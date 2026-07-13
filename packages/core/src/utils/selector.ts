import type { BrowserSession } from '../browser/types.js';

/**
 * Selector strategy: ARIA-first with auto-fallback.
 * 1. ARIA role + accessible name
 * 2. data-testid / data-fennec-id
 * 3. Text content match
 * 4. CSS selector
 * 5. XPath (last resort)
 */

export interface SelectorResult {
  selector: string;
  strategy: 'aria' | 'testid' | 'text' | 'css' | 'xpath';
  found: boolean;
}

export async function findElement(session: BrowserSession, input: string): Promise<SelectorResult> {
  // Strategy 1: ARIA role + accessible name
  try {
    const ariaSelector = `[role="${input}"]`;
    const el = await session.$(ariaSelector);
    if (el) {
      return { selector: ariaSelector, strategy: 'aria', found: true };
    }
  } catch {
    // fall through
  }

  // Try role=button with name
  try {
    const roleSelector = `role=${JSON.stringify(input)}`;
    const el = await session
      .locator(roleSelector)
      .first()
      .elementHandle()
      .catch(() => null);
    if (el) {
      return { selector: roleSelector, strategy: 'aria', found: true };
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
      const el = await session.$(sel);
      if (el) {
        return { selector: sel, strategy: 'testid', found: true };
      }
    }
  } catch {
    // fall through
  }

  // Strategy 3: Text content
  try {
    const textSelector = `text=${JSON.stringify(input)}`;
    const el = await session
      .locator(textSelector)
      .first()
      .elementHandle()
      .catch(() => null);
    if (el) {
      return { selector: textSelector, strategy: 'text', found: true };
    }
  } catch {
    // fall through
  }

  // Strategy 4: CSS selector
  try {
    const el = await session.$(input);
    if (el) {
      return { selector: input, strategy: 'css', found: true };
    }
  } catch {
    // fall through
  }

  // Strategy 5: XPath
  try {
    const xpathSelector = `xpath=${input}`;
    const el = await session.$(xpathSelector);
    if (el) {
      return { selector: xpathSelector, strategy: 'xpath', found: true };
    }
  } catch {
    // fall through
  }

  return { selector: input, strategy: 'css', found: false };
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
    const el = await session.$(selector).catch(() => null);
    return {
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
  }

  return findElement(session, selector);
}
