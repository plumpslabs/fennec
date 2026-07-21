import type { MiddlewareFn, MiddlewareContext, ToolResult } from './Pipeline.js';
import type { BrowserSession } from '../browser/types.js';
import { getLogger } from '../utils/logger.js';
import { sanitize } from '../response/ResponseBuilder.js';
import { isExpectedNetworkFailure } from '../utils/network.js';

/**
 * Generate alternative selectors for auto-recovery.
 * Each entry tries a different strategy to locate the element on the page.
 */
function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

interface FallbackSelector {
  selector: string;
  strategy: string;
}

function generateFallbackSelectors(input: string): FallbackSelector[] {
  // Don't generate fallbacks for structured selectors (they already are specific)
  if (input.startsWith('role=') || input.startsWith('xpath=') || input.startsWith('css=')) {
    return [];
  }

  const trimmed = input.trim();
  const jsonStr = JSON.stringify(trimmed);
  const escaped = escapeAttr(trimmed);

  const strategies: FallbackSelector[] = [];

  // 1. Playwright text selector (most reliable for visible text)
  strategies.push({ selector: `text=${jsonStr}`, strategy: 'text' });

  // 2. Button with matching text
  strategies.push({ selector: `button:has-text(${jsonStr})`, strategy: 'button-text' });

  // 3. Link/ anchor with matching text
  strategies.push({ selector: `a:has-text(${jsonStr})`, strategy: 'link-text' });

  // 4. Any element with matching aria-label
  strategies.push({ selector: `[aria-label="${escaped}"]`, strategy: 'aria-label' });

  // 5. data-testid / data-test-id / data-fennec-id
  strategies.push({ selector: `[data-testid="${escaped}"]`, strategy: 'testid' });
  strategies.push({ selector: `[data-test-id="${escaped}"]`, strategy: 'testid' });

  // 6. name attribute (common for form fields)
  strategies.push({ selector: `[name="${escaped}"]`, strategy: 'name' });

  // 7. placeholder attribute (common for form fields)
  strategies.push({ selector: `[placeholder="${escaped}"]`, strategy: 'placeholder' });

  // 8. title attribute
  strategies.push({ selector: `[title="${escaped}"]`, strategy: 'title' });

  // 9. Any element containing the text (broad match)
  strategies.push({ selector: `:has-text(${jsonStr})`, strategy: 'text-contains' });

  // 10. Try as a CSS selector (if it looks like one)
  if (/^[#.[\]:a-zA-Z-]/.test(trimmed)) {
    strategies.push({ selector: trimmed, strategy: 'css' });
  }

  // 11. Try as an id selector
  strategies.push({ selector: `#${escaped}`, strategy: 'id' });

  return strategies;
}

/**
 * Try to perform the original tool action using a fallback selector.
 * Returns the data payload if recovery succeeds, or null if it fails.
 */
/** Recover action input — tool-specific fields used during auto-recovery. */
interface RecoverActionInput {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  text?: string;
  clear?: boolean;
  delay?: number;
  value?: string;
  state?: string;
  timeout?: number;
  [key: string]: unknown;
}

async function tryRecoverAction(
  ctx: MiddlewareContext,
  browser: BrowserSession,
  fallback: string,
): Promise<Record<string, unknown> | null> {
  const input = ctx.input as RecoverActionInput;
  const loc = browser.locator(fallback);

  try {
    switch (ctx.toolName) {
      // ─── Click ───────────────────────────────────────────────
      case 'browser_click': {
        const box = await loc.boundingBox();
        await loc.click({
          button: (input.button as 'left' | 'right' | 'middle') ?? 'left',
          clickCount: (input.clickCount as number) ?? 1,
        });
        return {
          elementFound: true,
          coordinates: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
        };
      }

      // ─── Type ────────────────────────────────────────────────
      case 'browser_type': {
        if (input.clear) {
          await loc.fill('');
        }
        await loc.pressSequentially(input.text as string, {
          delay: (input.delay as number) ?? 0,
        });
        const valueAfter = await loc.inputValue().catch(() => null);
        return { elementFound: true, valueAfter };
      }

      // ─── Hover ───────────────────────────────────────────────
      case 'browser_hover': {
        const box = await loc.boundingBox();
        await loc.hover();
        return {
          coordinates: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
        };
      }

      // ─── Focus ───────────────────────────────────────────────
      case 'browser_focus': {
        await loc.focus();
        return {};
      }

      // ─── Clear ───────────────────────────────────────────────
      case 'browser_clear': {
        const previousValue = await loc.inputValue().catch(() => null);
        await loc.fill('');
        return { previousValue };
      }

      // ─── Select (dropdown) ───────────────────────────────────
      case 'browser_select': {
        await loc.selectOption(input.value as string);
        const allOptions = await browser
          .locator(`${fallback} option`)
          .allTextContents()
          .catch(() => []);
        return { selectedValue: input.value, allOptions };
      }

      // ─── Wait for element ────────────────────────────────────
      case 'browser_wait_for_element': {
        const state = (input.state as string) ?? 'visible';
        const timeout = (input.timeout as number) ?? 10000;
        await browser.waitForSelector(fallback, {
          state: state as 'attached' | 'detached' | 'visible' | 'hidden',
          timeout,
        });
        return { found: true, selector: fallback };
      }

      // ─── Get element info ────────────────────────────────────
      case 'browser_get_element_info': {
        const [visible, enabled, box] = await Promise.all([
          loc.isVisible().catch(() => false),
          loc.isEnabled().catch(() => false),
          loc.boundingBox().catch(() => null),
        ]);
        const tagName = await loc
          .evaluate((el: Element) => el.tagName.toLowerCase())
          .catch(() => '');
        const text = await loc
          .evaluate((el: Element) => (el.textContent ?? '').trim())
          .catch(() => '');
        return {
          exists: true,
          tagName,
          text: text.slice(0, 500),
          visible,
          enabled,
          boundingBox: box,
        };
      }

      // ─── DOM snapshot (scoped to selector) ───────────────────
      case 'browser_get_dom_snapshot': {
        // Inject a data attribute on the found element so evaluate can access it
        const uniqueId = `fennec-recovered-${Date.now()}`;
        await loc.evaluate((el: Element, id: string) => {
          el.setAttribute('data-fennec-scope', id);
        }, uniqueId);

        const snapshot = await browser
          .evaluate(
            ({ scopeId }: { scopeId: string }) => {
              const root =
                document.querySelector(`[data-fennec-scope="${scopeId}"]`) ??
                document.documentElement;

              // Clean up the marker
              root.removeAttribute('data-fennec-scope');

              const elements: Array<{
                tag: string;
                id: string;
                text: string;
                class: string;
                role: string;
              }> = [];
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
              let node: Node | null;
              let count = 0;
              while ((node = walker.nextNode()) && count < 100) {
                const el = node as Element;
                const tag = el.tagName.toLowerCase();
                const text = (el.textContent ?? '').trim().slice(0, 120);
                if (text || el.id) {
                  elements.push({
                    tag,
                    id: el.id,
                    text,
                    class: String(el.className).slice(0, 100),
                    role: el.getAttribute('role') ?? '',
                  });
                }
                count++;
              }
              return elements;
            },
            { scopeId: uniqueId },
          )
          .catch(() => []);

        return { elementCount: snapshot.length, elements: snapshot.slice(0, 50) };
      }

      // ─── Get page text (scoped) ──────────────────────────────
      case 'browser_get_page_text': {
        const text = await loc
          .evaluate((el: Element) => (el.textContent ?? '').trim())
          .catch(() => '');
        return { text: text.slice(0, 5000), selector: fallback };
      }

      // ─── Scroll element into view ────────────────────────────
      case 'browser_scroll': {
        await loc
          .evaluate((el: Element) => {
            (el as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'center' });
          })
          .catch(() => {});
        const scrollPos = await browser
          .evaluate(() => ({
            x: window.scrollX,
            y: window.scrollY,
          }))
          .catch(() => ({ x: 0, y: 0 }));
        return { scrollPosition: scrollPos };
      }

      default:
        // For unknown tools, just report that we found the element
        const exists = await loc.count().catch(() => 0);
        if (exists > 0) {
          return { elementFound: true, selector: fallback };
        }
        return null;
    }
  } catch (error) {
    getLogger().warn(
      { tool: ctx.toolName, error, fallbackSelector: fallback },
      'SmartHook: recovery action failed',
    );
    return null;
  }
}

// ─── Main SmartHook middleware ─────────────────────────────────

export function createSmartHook(): MiddlewareFn {
  const logger = getLogger();

  return async (ctx, next) => {
    const result = await next();

    const resultObj = result as ToolResult;

    if (resultObj.success !== false) {
      return result;
    }

    const errorObj = resultObj.error;
    const errorCode = errorObj?.code ?? 'UNKNOWN';

    logger.info({ tool: ctx.toolName, errorCode }, 'SmartHook: error detected, collecting context');

    // === StateManager Context ===
    // Inject current session context info so AI knows which session/context it's in
    let contextSwitchInfo: Record<string, unknown> | null = null;

    if (ctx.stateManager) {
      const activeInfo = ctx.stateManager.getActiveSessionInfo();
      if (activeInfo) {
        contextSwitchInfo = {
          activeSessionId: activeInfo.sessionId,
          activeSessionUrl: activeInfo.url ?? null,
          activeSessionTitle: activeInfo.title ?? null,
        };
      }

      // Get all session states to show AI what's available
      const allStates = ctx.stateManager.getAllStates();
      if (allStates.length > 0) {
        if (!contextSwitchInfo) contextSwitchInfo = {};
        contextSwitchInfo.availableSessions = allStates.map((s) => ({
          sessionId: s.sessionId,
          state: s.state,
          idleSec: Math.round(s.idleMs / 1000),
        }));
      }
    }
    // === End StateManager Context ===

    // If session available, auto-collect debug evidence
    let enrichedContext: Record<string, unknown> = {};

    if (ctx.session) {
      const browser = ctx.session.browser;
      if (browser) {
        try {
          // Collect only essential context — NO SCREENSHOT (too expensive token-wise)
          const [url] = await Promise.allSettled([browser.url()]);

          if (url.status === 'fulfilled') {
            enrichedContext.currentUrl = url.value;
          }

          // Get page title
          try {
            enrichedContext.pageTitle = await browser.title();
          } catch {
            /* ignore */
          }

          // Summarize console errors (just count + unique messages, not full logs)
          const errors = ctx.session.consoleBuffer.filter((l) => l.level === 'error').slice(-3);

          if (errors.length > 0) {
            const uniqueErrors = [
              ...new Set(errors.map((e) => e.message.replace(/\d+/g, 'N').slice(0, 80))),
            ];
            enrichedContext.consoleSummary = `${errors.length} error(s): ${uniqueErrors.slice(0, 3).join('; ')}`;
          }

          // Summarize network failures (just count + endpoints)
          const networkFailures = ctx.session.networkBuffer
            .filter((r) => r.status >= 400 && !isExpectedNetworkFailure(r.status, r.url))
            .slice(-3);

          if (networkFailures.length > 0) {
            enrichedContext.networkSummary = `${networkFailures.length} failed request(s): ${networkFailures.map((r) => `${r.method} ${new URL(r.url).pathname}`).join(', ')}`;
          }
        } catch {
          // Enrichment is best-effort
        }
      }

      // ─── Auto‑recovery: ELEMENT_NOT_INTERACTABLE ────────────
      // When click fails on an <option> element, suggest/use browser_select instead.
      // <option> elements are not clickable directly — they need selectOption().
      if (
        errorCode === 'ELEMENT_NOT_INTERACTABLE' &&
        ctx.toolName === 'browser_click' &&
        browser &&
        ctx.input?.selector
      ) {
        const originalSelector = String(ctx.input.selector);

        try {
          // Use locator().evaluate() to check the element type and extract option info.
          // ElementHandle does NOT have evaluate(), but Locator does.
          const loc = browser.locator(originalSelector);
          const elementInfo = await loc
            .evaluate((node: Element) => {
              const tag = node.tagName.toLowerCase();
              if (tag === 'option') {
                const opt = node as HTMLOptionElement;
                const parent = opt.closest('select');
                return {
                  tagName: tag,
                  optionValue: opt.value,
                  optionText: opt.text,
                  selectName: parent?.getAttribute('name') ?? '',
                  selectId: parent?.id ?? '',
                  allOptions: parent
                    ? Array.from(parent.options).map((o) => ({
                        value: o.value,
                        text: o.text,
                      }))
                    : [],
                };
              }
              return {
                tagName: tag,
                optionValue: null,
                optionText: null,
                selectName: null,
                selectId: null,
                allOptions: [],
              };
            })
            .catch(() => null);

          if (elementInfo && elementInfo.tagName === 'option' && elementInfo.optionValue) {
            // Build a selector for the parent <select>
            const selectSelector = elementInfo.selectId
              ? `#${elementInfo.selectId}`
              : elementInfo.selectName
                ? `select[name="${elementInfo.selectName}"]`
                : undefined;

            // Try auto-recovery: use browser_select on the parent <select>
            if (selectSelector) {
              const selectLoc = browser.locator(selectSelector);
              const selectExists = await selectLoc.count().catch(() => 0);

              if (selectExists > 0) {
                try {
                  await selectLoc.selectOption(elementInfo.optionValue);

                  logger.info(
                    {
                      tool: ctx.toolName,
                      originalSelector,
                      selectSelector,
                      optionValue: elementInfo.optionValue,
                    },
                    'SmartHook: auto-recovered ELEMENT_NOT_INTERACTABLE via browser_select',
                  );

                  return {
                    success: true,
                    data: {
                      recovered: true,
                      originalSelector,
                      actionSuggested: 'browser_select',
                      selectSelector,
                      selectedValue: elementInfo.optionValue,
                      allOptions: elementInfo.allOptions,
                      recoveryStrategy: 'auto_select',
                      message: `Element was an <option> inside a <select>. Auto-recovered using browser_select with value="${elementInfo.optionValue}".`,
                    },
                    meta: resultObj.meta ?? {},
                  };
                } catch {
                  // Auto-recovery failed, fall through to enriched context
                }
              }
            }

            // If auto-recovery failed or no parent selector, inject enriched context
            enrichedContext.recovery = {
              attempted: true,
              status: 'option_detected',
              originalSelector,
              elementType: 'option',
              optionValue: elementInfo.optionValue,
              optionText: elementInfo.optionText,
              allOptions: elementInfo.allOptions.slice(0, 20),
              selectSelector,
              actionSuggested: 'browser_select',
              message:
                `Element "${originalSelector}" resolved to an <option value="${elementInfo.optionValue}"> element. ` +
                `<option> elements cannot be clicked directly. ` +
                (selectSelector
                  ? `Use browser_select with selector="${selectSelector}" and value="${elementInfo.optionValue}" instead.`
                  : `Use browser_select on the parent <select> element with value="${elementInfo.optionValue}" instead.`),
            };
          } else if (elementInfo && elementInfo.tagName === 'select') {
            // Element is a <select> itself — suggest using browser_select
            enrichedContext.recovery = {
              attempted: true,
              status: 'select_detected',
              originalSelector,
              elementType: 'select',
              actionSuggested: 'browser_select',
              message:
                `Element "${originalSelector}" is a <select> element. ` +
                `Use browser_select instead of browser_click to select an option. ` +
                `First use browser_get_dom_snapshot to see available options.`,
            };
          } else {
            // Other non-interactable element — just note it
            const elTag = elementInfo?.tagName || 'unknown';
            enrichedContext.recovery = {
              attempted: true,
              status: 'not_interactable',
              originalSelector,
              elementType: elTag,
              message:
                `Element "${originalSelector}" (${elTag}) is not interactable. ` +
                `It may be hidden, disabled, or behind another element. ` +
                `Try browser_get_element_info to check its state.`,
            };
          }
        } catch {
          // Recovery detection is best-effort
        }
      }

      // ─── Auto‑recovery: ELEMENT_NOT_FOUND ────────────────────
      // Try fallback selectors when the original selector failed.
      // If a fallback finds the element AND the action succeeds,
      // return a success response so the AI can continue uninterrupted.
      if (errorCode === 'ELEMENT_NOT_FOUND' && browser && ctx.input?.selector) {
        const originalSelector = String(ctx.input.selector);
        const fallbacks = generateFallbackSelectors(originalSelector);

        let recoveryAttempt: { strategy: string; selector: string } | null = null;

        for (const fb of fallbacks) {
          try {
            const el = await browser.$(fb.selector);
            if (el) {
              recoveryAttempt = { strategy: fb.strategy, selector: fb.selector };
              break;
            }
          } catch {
            continue;
          }
        }

        if (recoveryAttempt) {
          logger.info(
            {
              tool: ctx.toolName,
              originalSelector,
              fallbackSelector: recoveryAttempt.selector,
              strategy: recoveryAttempt.strategy,
            },
            'SmartHook: found element via fallback selector, attempting recovery',
          );

          const actionResult = await tryRecoverAction(ctx, browser, recoveryAttempt.selector);

          if (actionResult) {
            // ✅ Recovery succeeded — return a success response
            logger.info(
              {
                tool: ctx.toolName,
                originalSelector,
                fallbackSelector: recoveryAttempt.selector,
                strategy: recoveryAttempt.strategy,
              },
              'SmartHook: recovery succeeded',
            );

            return {
              success: true,
              data: {
                ...actionResult,
                recovered: true,
                originalSelector,
                recoveredSelector: recoveryAttempt.selector,
                recoveryStrategy: recoveryAttempt.strategy,
              },
              meta: resultObj.meta ?? {},
            };
          } else {
            // Element found but action failed — inject recovery info into error context
            enrichedContext.recovery = {
              attempted: true,
              recoveredSelector: recoveryAttempt.selector,
              recoveryStrategy: recoveryAttempt.strategy,
              status: 'action_failed',
              message: `Found element via ${recoveryAttempt.strategy} but could not complete the action`,
            };
          }
        } else {
          // No fallback found — still helpful for AI to know what was tried
          enrichedContext.recovery = {
            attempted: true,
            status: 'no_fallback_found',
            strategiesTried: fallbacks.length,
            message: `Tried ${fallbacks.length} fallback strategies but none matched any element`,
          };
        }

        enrichedContext.url = enrichedContext.currentUrl ?? 'unknown';
        enrichedContext.title = enrichedContext.pageTitle ?? 'unknown';
        enrichedContext.message =
          `Element not found on page: ${enrichedContext.url} ("${enrichedContext.title}"). ` +
          `Use browser_get_dom_snapshot to see available elements.`;
      }
      // ─── End Auto‑recovery ───────────────────────────────────
    }

    // === Scheduler Integration ===
    // Check if the scheduler has auto-triggered any workflow results
    // that could provide pre-computed diagnosis for this error context
    if (ctx.workflowScheduler) {
      try {
        const lastResult = ctx.workflowScheduler.getLastScheduledResult();
        if (lastResult && lastResult.status === 'completed') {
          const age = Date.now() - new Date(lastResult.completedAt!).getTime();
          // Only use results from the last 60 seconds
          if (age < 60000) {
            enrichedContext.autoDiagnosis = {
              workflowId: lastResult.workflowId,
              executionId: lastResult.id,
              completedAt: lastResult.completedAt,
              stepResults: lastResult.stepResults.map((sr) => ({
                stepId: sr.stepId,
                status: sr.status,
                result: sr.result,
                error: sr.error,
              })),
              contextSnapshot: lastResult.context,
            };

            logger.info(
              { executionId: lastResult.id, workflowId: lastResult.workflowId },
              'SmartHook: injected auto-triggered diagnosis result',
            );
          }
        }

        // Also check scheduler stats for recent triggers
        const stats = ctx.workflowScheduler.getStats();
        if (stats.lastTriggered) {
          const triggerAge = Date.now() - stats.lastTriggered.triggeredAt;
          if (triggerAge < 30000) {
            enrichedContext.recentTrigger = {
              ruleName: stats.lastTriggered.ruleName,
              ruleId: stats.lastTriggered.ruleId,
              eventType: stats.lastTriggered.event.type,
              triggeredAt: new Date(stats.lastTriggered.triggeredAt).toISOString(),
            };
          }
        }
      } catch (schedulerError) {
        // Scheduler integration is best-effort
        logger.warn({ error: schedulerError }, 'SmartHook: failed to check scheduler results');
      }
    }
    // === End Scheduler Integration ===

    // For ELEMENT_NOT_FOUND: inject URL as top-level field for AI visibility
    if (errorCode === 'ELEMENT_NOT_FOUND' && enrichedContext.url) {
      resultObj.currentUrl = enrichedContext.url;
      resultObj.pageTitle = enrichedContext.title;
    }

    // Inject context switch / session info into enriched context
    if (contextSwitchInfo) {
      enrichedContext.sessionContext = contextSwitchInfo;

      // Also inject as top-level field so AI immediately sees it
      resultObj.sessionContext = contextSwitchInfo;
    }

    // Attach enriched context to error response
    if (errorObj && Object.keys(enrichedContext).length > 0) {
      errorObj.context = {
        ...(errorObj.context ?? {}),
        ...sanitize(enrichedContext),
      };
    }

    return result;
  };
}
