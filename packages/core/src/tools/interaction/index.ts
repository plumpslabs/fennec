import { z } from 'zod';
import { createTool } from '../_registry.js';
import type { ToolContext } from '../_registry.js';
import { resolveSelector, resolveIndexedSelector } from '../../utils/selector.js';

function isStrictModeViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('strict mode violation') || (msg.includes('resolved to') && msg.includes('elements'));
}

export const browserClick = createTool({
  name: 'browser_click',
  category: 'interaction',
  description:
    '`<use_case>Interaction</use_case> 🖱️ Click on a page element. Supports left/right/middle buttons and clickCount (single/double click). Returns elementFound and click coordinates. Uses smart selector resolution (ARIA label, data-testid, text content, CSS, XPath). Use for clicking buttons, links, checkboxes — the primary way AI agents interact with pages. For keyboard input, use browser_type. For hovering, use browser_hover.`',
  inputSchema: z.object({
    selector: z.string().describe('Element selector (ARIA, testid, text, CSS, or XPath)'),
    index: z.number().int().min(0).optional().describe('When the selector matches multiple elements, pick the one at this index (0-based)'),
    button: z.enum(['left', 'right', 'middle']).optional().default('left').describe('Mouse button'),
    clickCount: z.number().optional().default(1).describe('Number of clicks (1=single, 2=double)'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveIndexedSelector(session.browser, input.selector, input.index);
      if (!resolved.found) {
        const currentUrl = session.browser.url();
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), {
          code: 'ELEMENT_NOT_FOUND',
          context: { url: currentUrl },
          suggestions: [
            'Check if the page has finished loading',
            'Try using a different selector strategy',
            'Use browser_get_current_url to verify the page',
            'Try browser_get_dom_snapshot to see available elements',
          ],
        });
      }

      const box = await session.browser.locator(resolved.selector).boundingBox();

      await session.browser.locator(resolved.selector).click({
        button: input.button,
        clickCount: input.clickCount,
      });

      return responseBuilder.success(
        {
          elementFound: true,
          coordinates: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      const suggestions = [
        'Check if the element is visible and enabled',
        'Try scrolling to the element first',
        'Use browser_get_element_info to check element state',
      ];
      if (isStrictModeViolation(error)) {
        suggestions.push('Use the index parameter to target a specific element when multiple match');
      }
      return responseBuilder.error(error, { code: 'ELEMENT_NOT_INTERACTABLE', suggestions });
    }
  },
});

export const browserType = createTool({
  name: 'browser_type',
  category: 'interaction',
  description:
    "`<use_case>Interaction</use_case> ⌨️ Type text into an input field (or any focusable element). Optionally clear the field first. Returns valueAfter (the field's value after typing). Use for filling out forms, search boxes, text areas. For dropdown/select elements, use browser_select instead. For just clearing without typing, use browser_clear. For key combinations (Ctrl+C, Enter), use browser_press_key.`",
  inputSchema: z.object({
    selector: z.string().describe('Element selector'),
    index: z.number().int().min(0).optional().describe('When the selector matches multiple elements, pick the one at this index (0-based)'),
    text: z.string().describe('Text to type'),
    delay: z.number().optional().default(0).describe('Delay between keystrokes in ms'),
    clear: z.boolean().optional().default(false).describe('Clear the field before typing'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveIndexedSelector(session.browser, input.selector, input.index);
      if (!resolved.found) {
        const currentUrl = session.browser.url();
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), {
          code: 'ELEMENT_NOT_FOUND',
          context: { url: currentUrl },
        });
      }

      if (input.clear) {
        await session.browser.locator(resolved.selector).fill('');
      }

      await session.browser.locator(resolved.selector).pressSequentially(input.text, {
        delay: input.delay,
      });

      const valueAfter = await session.browser
        .locator(resolved.selector)
        .inputValue()
        .catch(() => null);

      return responseBuilder.success(
        {
          elementFound: true,
          valueAfter,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      const suggestions = [
        'Check if the element is a valid input field',
        'Try clicking the field first',
      ];
      if (isStrictModeViolation(error)) {
        suggestions.push('Use the index parameter to target a specific element when multiple match');
      }
      return responseBuilder.error(error, { code: 'ELEMENT_NOT_INTERACTABLE', suggestions });
    }
  },
});

export const browserSelect = createTool({
  name: 'browser_select',
  category: 'interaction',
  description:
    '`<use_case>Interaction</use_case> 📋 Select an option from a <select> dropdown element by value. Returns selectedValue and all available options. Use specifically for native HTML <select> elements — not for custom dropdowns built with divs/buttons. For filling text inputs, use browser_type. For custom dropdowns, use browser_click on the option.`',
  inputSchema: z.object({
    selector: z.string().describe('Select element selector'),
    value: z.string().describe('Option value to select'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), {
          code: 'ELEMENT_NOT_FOUND',
        });
      }

      await session.browser.locator(resolved.selector).selectOption(input.value);

      const allOptions = await session.browser
        .locator(`${resolved.selector} option`)
        .allTextContents();

      return responseBuilder.success(
        {
          selectedValue: input.value,
          allOptions,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'ELEMENT_NOT_INTERACTABLE',
        suggestions: ['Check if the element is a valid <select> element'],
      });
    }
  },
});

export const browserHover = createTool({
  name: 'browser_hover',
  category: 'interaction',
  description:
    '`<use_case>Interaction</use_case> 👆 Hover over an element to trigger CSS :hover states, tooltips, or dropdown menus that appear on hover. Returns element coordinates. Use for triggering hover-dependent UI elements before clicking them, inspecting tooltip content, or activating nested menus. Follow up with browser_get_element_info to check what appeared.`',
  inputSchema: z.object({
    selector: z.string().describe('Element selector'),
    index: z.number().int().min(0).optional().describe('When the selector matches multiple elements, pick the one at this index (0-based)'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveIndexedSelector(session.browser, input.selector, input.index);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), {
          code: 'ELEMENT_NOT_FOUND',
        });
      }

      const box = await session.browser.locator(resolved.selector).boundingBox();
      await session.browser.locator(resolved.selector).hover();

      return responseBuilder.success(
        {
          coordinates: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      const suggestions: string[] = [];
      if (isStrictModeViolation(error)) {
        suggestions.push('Use the index parameter to target a specific element when multiple match');
      }
      return responseBuilder.error(error, { code: 'ELEMENT_NOT_INTERACTABLE', suggestions });
    }
  },
});

export const browserScroll = createTool({
  name: 'browser_scroll',
  category: 'interaction',
  description:
    '`<use_case>Interaction</use_case> 📜 Scroll the page or a specific scrollable element. Supports: exact position (x, y), selector-based targeting, or directional scrolling (up/down/left/right by 200px). Returns new scrollPosition {x, y}. Use when content is below the fold, infinite scroll pages, or scrollable containers. For page navigation (URL changes), use browser_navigate or browser_scroll instead.`',
  inputSchema: z.object({
    x: z.number().optional().describe('Horizontal scroll position'),
    y: z.number().optional().describe('Vertical scroll position'),
    selector: z.string().optional().describe('Element to scroll within'),
    direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Scroll direction'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      if (input.selector) {
        const resolved = await resolveSelector(session.browser, input.selector);
        if (!resolved.found) {
          return responseBuilder.error(new Error(`Element not found: ${input.selector}`), {
            code: 'ELEMENT_NOT_FOUND',
          });
        }

        await session.browser.locator(resolved.selector).evaluate(
          (el, { x, y, direction: dir }) => {
            const element = el as HTMLElement;
            if (dir) {
              const amount = 200;
              const sx = dir === 'up' || dir === 'down' ? 0 : dir === 'left' ? -amount : amount;
              const sy = dir === 'left' || dir === 'right' ? 0 : dir === 'up' ? -amount : amount;
              element.scrollBy(sx, sy);
            } else {
              element.scrollTo(x ?? 0, y ?? 0);
            }
          },
          { x: input.x, y: input.y, direction: input.direction },
        );
      } else {
        await session.browser.evaluate(
          ({ x, y, direction: dir }) => {
            if (dir) {
              const amount = 200;
              const sx = dir === 'up' || dir === 'down' ? 0 : dir === 'left' ? -amount : amount;
              const sy = dir === 'left' || dir === 'right' ? 0 : dir === 'up' ? -amount : amount;
              window.scrollBy(sx, sy);
            } else {
              window.scrollTo(x ?? 0, y ?? 0);
            }
          },
          { x: input.x, y: input.y, direction: input.direction },
        );
      }

      const scrollPos = await session.browser.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY,
      }));

      return responseBuilder.success(
        {
          scrollPosition: scrollPos,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserPressKey = createTool({
  name: 'browser_press_key',
  category: 'interaction',
  description:
    "`<use_case>Interaction</use_case> 🔑 Press keyboard keys with optional modifiers (Control/Shift/Alt/Meta). Use for keyboard shortcuts (Ctrl+S, Ctrl+C/V), special keys (Enter, Escape, Tab, ArrowDown), or combo inputs. For typing text into inputs, use browser_type instead. For focusing elements, use browser_focus. Examples: key='Enter' to submit, key='Escape' to close modals, key='Tab' modifiers=['Shift'] to go backwards.`",
  inputSchema: z.object({
    key: z.string().describe("Key to press (e.g., 'Enter', 'Escape', 'Tab', 'ArrowDown')"),
    modifiers: z
      .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
      .optional()
      .describe('Modifier keys'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      await session.browser.keyboardPress(input.key, {
        modifiers: input.modifiers,
      });
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserFocus = createTool({
  name: 'browser_focus',
  category: 'interaction',
  description:
    '`<use_case>Interaction</use_case> 🎯 Set focus on an element by selector. Use before typing into a field that requires explicit focus, or triggering focus-dependent UI changes (like showing a cursor, activating input styles). Less common than browser_click which naturally focuses elements — use only when clicking would cause unwanted side effects.`',
  inputSchema: z.object({
    selector: z.string().describe('Element selector'),
    index: z.number().int().min(0).optional().describe('When the selector matches multiple elements, pick the one at this index (0-based)'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveIndexedSelector(session.browser, input.selector, input.index);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), {
          code: 'ELEMENT_NOT_FOUND',
        });
      }

      await session.browser.locator(resolved.selector).focus();
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      const suggestions: string[] = [];
      if (isStrictModeViolation(error)) {
        suggestions.push('Use the index parameter to target a specific element when multiple match');
      }
      return responseBuilder.error(error, { code: 'ELEMENT_NOT_INTERACTABLE', suggestions });
    }
  },
});

export const browserClear = createTool({
  name: 'browser_clear',
  category: 'interaction',
  description:
    '`<use_case>Interaction</use_case> 🧹 Clear the content of an input field without typing new text. Returns previousValue (the text that was cleared). Use when you want to empty a field without replacing it — e.g., clearing a search box before a new query. For clear + type in one step, use browser_type with clear=true instead.`',
  inputSchema: z.object({
    selector: z.string().describe('Element selector'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), {
          code: 'ELEMENT_NOT_FOUND',
        });
      }

      const previousValue = await session.browser
        .locator(resolved.selector)
        .inputValue()
        .catch(() => null);
      await session.browser.locator(resolved.selector).fill('');

      return responseBuilder.success(
        {
          previousValue,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

// ─── File Upload ─────────────────────────────────────────────────

export const browserUploadFile = createTool({
  name: 'browser_upload_file',
  category: 'interaction',
  description:
    "`<use_case>Interaction</use_case> 📎 Upload a file to a <input type='file'> element. Provide absolute file paths (supports multiple files). Returns fileCount and fileName. Use for uploading images, documents, or any file via a web form. The files must exist on the server filesystem. For non-file inputs, use browser_type instead.`",
  inputSchema: z.object({
    selector: z.string().describe('File input element selector'),
    filePaths: z.array(z.string()).describe('Absolute file paths to upload'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`File input not found: ${input.selector}`), {
          code: 'ELEMENT_NOT_FOUND',
        });
      }

      await session.browser.locator(resolved.selector).setInputFiles(input.filePaths);

      return responseBuilder.success(
        {
          fileCount: input.filePaths.length,
          fileName: input.filePaths[0]?.split(/[\\/]/).pop(),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'FILE_UPLOAD_FAILED',
        suggestions: [
          'Ensure the element is a valid <input type="file">',
          'Verify file paths exist and are accessible',
        ],
      });
    }
  },
});

export const browserDragDrop = createTool({
  name: 'browser_drag_drop',
  category: 'interaction',
  description:
    "`<use_case>Interaction</use_case> 🔄 Drag a source element and drop it onto a target element. Uses Playwright's dragTo() for reliable mouse-based drag-and-drop. Returns success. Use for reordering lists, moving elements in builders, or any drag-and-drop interaction. For scrolling to make elements visible before drag, use browser_scroll first.`",
  inputSchema: z.object({
    sourceSelector: z.string().describe('Source element selector to drag'),
    targetSelector: z.string().describe('Target element selector to drop onto'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const sourceResolved = await resolveSelector(session.browser, input.sourceSelector);
      if (!sourceResolved.found) {
        return responseBuilder.error(
          new Error(`Source element not found: ${input.sourceSelector}`),
          { code: 'ELEMENT_NOT_FOUND' },
        );
      }

      const targetResolved = await resolveSelector(session.browser, input.targetSelector);
      if (!targetResolved.found) {
        return responseBuilder.error(
          new Error(`Target element not found: ${input.targetSelector}`),
          { code: 'ELEMENT_NOT_FOUND' },
        );
      }

      await session.browser
        .locator(sourceResolved.selector)
        .dragTo(session.browser.locator(targetResolved.selector));

      return responseBuilder.success({ success: true }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'DRAG_DROP_FAILED',
        suggestions: [
          'Ensure both elements are visible and interactable',
          'Check if the page uses custom HTML5 drag events',
        ],
      });
    }
  },
});
