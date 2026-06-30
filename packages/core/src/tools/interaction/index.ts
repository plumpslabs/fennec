import { z } from "zod";
import { createTool } from "../_registry.js";
import type { ToolContext } from "../_registry.js";
import { resolveSelector } from "../../utils/selector.js";

export const browserClick = createTool({
  name: "browser_click",
  category: "interaction",
  description: "`<use_case>Element interaction</use_case> Click an element. Supports left/right/middle buttons and clickCount for double-click. elementFound (bool), coordinates.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector (ARIA, testid, text, CSS, or XPath)"),
    button: z.enum(["left", "right", "middle"]).optional().default("left").describe("Mouse button"),
    clickCount: z.number().optional().default(1).describe("Number of clicks (1=single, 2=double)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(
          new Error(`Element not found: ${input.selector}`),
          {
            code: "ELEMENT_NOT_FOUND",
            suggestions: [
              "Check if the page has finished loading",
              "Try using a different selector strategy",
              "Use browser_get_current_url to verify the page",
              "Try browser_get_dom_snapshot to see available elements",
            ],
          },
        );
      }

      const box = await session.browser.locator(resolved.selector).boundingBox();

      await session.browser.locator(resolved.selector).click({
        button: input.button,
        clickCount: input.clickCount,
      });

      return responseBuilder.success({
        elementFound: true,
        coordinates: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ELEMENT_NOT_INTERACTABLE",
        suggestions: [
          "Check if the element is visible and enabled",
          "Try scrolling to the element first",
          "Use browser_get_element_info to check element state",
        ],
      });
    }
  },
});

export const browserType = createTool({
  name: "browser_type",
  category: "interaction",
  description: "`<use_case>Form input</use_case> Type text into an input field. Optionally clear the field first. elementFound (bool), valueAfter.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector"),
    text: z.string().describe("Text to type"),
    delay: z.number().optional().default(0).describe("Delay between keystrokes in ms"),
    clear: z.boolean().optional().default(false).describe("Clear the field before typing"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(
          new Error(`Element not found: ${input.selector}`),
          { code: "ELEMENT_NOT_FOUND" },
        );
      }

      if (input.clear) {
        await session.browser.locator(resolved.selector).fill("");
      }

      await session.browser.locator(resolved.selector).pressSequentially(input.text, {
        delay: input.delay,
      });

      const valueAfter = await session.browser.locator(resolved.selector).inputValue().catch(() => null);

      return responseBuilder.success({
        elementFound: true,
        valueAfter,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ELEMENT_NOT_INTERACTABLE",
        suggestions: [
          "Check if the element is a valid input field",
          "Try clicking the field first",
        ],
      });
    }
  },
});

export const browserSelect = createTool({
  name: "browser_select",
  category: "interaction",
  description: "`<use_case>Form input</use_case> Select an option from a <select> dropdown element. selectedValue, allOptions[].`",
  inputSchema: z.object({
    selector: z.string().describe("Select element selector"),
    value: z.string().describe("Option value to select"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), { code: "ELEMENT_NOT_FOUND" });
      }

      await session.browser.locator(resolved.selector).selectOption(input.value);

      const allOptions = await session.browser.locator(`${resolved.selector} option`).allTextContents();

      return responseBuilder.success({
        selectedValue: input.value,
        allOptions,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ELEMENT_NOT_INTERACTABLE",
        suggestions: ["Check if the element is a valid <select> element"],
      });
    }
  },
});

export const browserHover = createTool({
  name: "browser_hover",
  category: "interaction",
  description: "`<use_case>Element interaction</use_case> Hover over an element to trigger hover states or tooltips. coordinates.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), { code: "ELEMENT_NOT_FOUND" });
      }

      const box = await session.browser.locator(resolved.selector).boundingBox();
      await session.browser.locator(resolved.selector).hover();

      return responseBuilder.success({
        coordinates: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ELEMENT_NOT_INTERACTABLE",
      });
    }
  },
});

export const browserScroll = createTool({
  name: "browser_scroll",
  category: "interaction",
  description: "`<use_case>Page navigation</use_case> Scroll the page or a specific element. Supports pixel position, selector-based, or directional (up/down/left/right) scrolling. scrollPosition {x, y}.`",
  inputSchema: z.object({
    x: z.number().optional().describe("Horizontal scroll position"),
    y: z.number().optional().describe("Vertical scroll position"),
    selector: z.string().optional().describe("Element to scroll within"),
    direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      if (input.selector) {
        const resolved = await resolveSelector(session.browser, input.selector);
        if (!resolved.found) {
          return responseBuilder.error(new Error(`Element not found: ${input.selector}`), { code: "ELEMENT_NOT_FOUND" });
        }

        await session.browser.locator(resolved.selector).evaluate((el, { x, y, direction: dir }) => {
          const element = el as HTMLElement;
          if (dir) {
            const amount = 200;
            const sx = dir === "up" || dir === "down" ? 0 : (dir === "left" ? -amount : amount);
            const sy = dir === "left" || dir === "right" ? 0 : (dir === "up" ? -amount : amount);
            element.scrollBy(sx, sy);
          } else {
            element.scrollTo(x ?? 0, y ?? 0);
          }
        }, { x: input.x, y: input.y, direction: input.direction });
      } else {
        await session.browser.evaluate(({ x, y, direction: dir }) => {
          if (dir) {
            const amount = 200;
            const sx = dir === "up" || dir === "down" ? 0 : (dir === "left" ? -amount : amount);
            const sy = dir === "left" || dir === "right" ? 0 : (dir === "up" ? -amount : amount);
            window.scrollBy(sx, sy);
          } else {
            window.scrollTo(x ?? 0, y ?? 0);
          }
        }, { x: input.x, y: input.y, direction: input.direction });
      }

      const scrollPos = await session.browser.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY,
      }));

      return responseBuilder.success({
        scrollPosition: scrollPos,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserPressKey = createTool({
  name: "browser_press_key",
  category: "interaction",
  description: "`<use_case>Keyboard input</use_case> Press a keyboard key with optional modifier keys (Control, Shift, Alt, Meta). success.`",
  inputSchema: z.object({
    key: z.string().describe("Key to press (e.g., 'Enter', 'Escape', 'Tab', 'ArrowDown')"),
    modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional().describe("Modifier keys"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const pressOptions = input.modifiers?.length ? { modifiers: input.modifiers } as any : undefined;
      await session.browser.keyboardPress(input.key, { modifiers: input.modifiers });
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserFocus = createTool({
  name: "browser_focus",
  category: "interaction",
  description: "`<use_case>Element interaction</use_case> Focus on an element by selector. success.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), { code: "ELEMENT_NOT_FOUND" });
      }

      await session.browser.locator(resolved.selector).focus();
      return responseBuilder.success({}, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserClear = createTool({
  name: "browser_clear",
  category: "interaction",
  description: "`<use_case>Form input</use_case> Clear the content of an input field. previousValue.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`Element not found: ${input.selector}`), { code: "ELEMENT_NOT_FOUND" });
      }

      const previousValue = await session.browser.locator(resolved.selector).inputValue().catch(() => null);
      await session.browser.locator(resolved.selector).fill("");

      return responseBuilder.success({
        previousValue,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

// ─── File Upload ─────────────────────────────────────────────────

export const browserUploadFile = createTool({
  name: "browser_upload_file",
  category: "interaction",
  description: "`<use_case>File upload</use_case> Upload a file to a file input element. Supports single or multiple files by path. fileName, fileSize.`",
  inputSchema: z.object({
    selector: z.string().describe("File input element selector"),
    filePaths: z.array(z.string()).describe("Absolute file paths to upload"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
      if (!resolved.found) {
        return responseBuilder.error(new Error(`File input not found: ${input.selector}`), { code: "ELEMENT_NOT_FOUND" });
      }

      await session.browser.locator(resolved.selector).setInputFiles(input.filePaths);

      return responseBuilder.success({
        fileCount: input.filePaths.length,
        fileName: input.filePaths[0]?.split(/[\\/]/).pop(),
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "FILE_UPLOAD_FAILED",
        suggestions: [
          "Ensure the element is a valid <input type=\"file\">",
          "Verify file paths exist and are accessible",
        ],
      });
    }
  },
});

export const browserDragDrop = createTool({
  name: "browser_drag_drop",
  category: "interaction",
  description: "`<use_case>Drag and drop</use_case> Drag an element to a target element. Uses Playwright's built-in dragTo() for reliable mouse-based DnD. Returns: success.`",
  inputSchema: z.object({
    sourceSelector: z.string().describe("Source element selector to drag"),
    targetSelector: z.string().describe("Target element selector to drop onto"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const sourceResolved = await resolveSelector(session.browser, input.sourceSelector);
      if (!sourceResolved.found) {
        return responseBuilder.error(new Error(`Source element not found: ${input.sourceSelector}`), { code: "ELEMENT_NOT_FOUND" });
      }

      const targetResolved = await resolveSelector(session.browser, input.targetSelector);
      if (!targetResolved.found) {
        return responseBuilder.error(new Error(`Target element not found: ${input.targetSelector}`), { code: "ELEMENT_NOT_FOUND" });
      }

      await session.browser.locator(sourceResolved.selector).dragTo(
        session.browser.locator(targetResolved.selector),
      );

      return responseBuilder.success({ success: true }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "DRAG_DROP_FAILED",
        suggestions: [
          "Ensure both elements are visible and interactable",
          "Check if the page uses custom HTML5 drag events"
        ],
      });
    }
  },
});
