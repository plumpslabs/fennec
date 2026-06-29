import { z } from "zod";
import { createTool } from "../_registry.js";
import { resolveSelector } from "../../utils/selector.js";
import { takeScreenshot } from "../../utils/screenshot.js";

export const browserScreenshot = createTool({
  name: "browser_screenshot",
  description: "`<use_case>Visual capture</use_case> Take a screenshot. Supports fullPage, selector-scoped capture, and png/jpeg format. base64, width, height, timestamp.`",
  inputSchema: z.object({
    fullPage: z.boolean().optional().default(false).describe("Capture full page (including scrollable content)"),
    selector: z.string().optional().describe("Element selector to capture (instead of viewport)"),
    format: z.enum(["png", "jpeg"]).optional().default("png").describe("Image format"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const result = await takeScreenshot(session.page, {
        fullPage: input.fullPage,
        selector: input.selector,
        format: input.format,
      });

      return responseBuilder.success(result, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "CDP_ERROR",
        suggestions: ["Check if the page is still open and accessible"],
      });
    }
  },
});

export const browserGetDomSnapshot = createTool({
  name: "browser_get_dom_snapshot",
  description: "`<use_case>DOM inspection</use_case> Get DOM snapshot as HTML with element count and tree depth. Optionally scope to a selector or include computed styles. html, elementCount, depth.`",
  inputSchema: z.object({
    selector: z.string().optional().describe("Optional selector to scope the snapshot"),
    includeStyles: z.boolean().optional().default(false).describe("Include computed styles in output"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const result = await session.page.evaluate(
        ({ selector, includeStyles }) => {
          const root = selector
            ? document.querySelector(selector)
            : document.documentElement;
          if (!root) return { html: "", elementCount: 0, depth: 0 };

          let elementCount = 0;
          let maxDepth = 0;

          const getDepth = (el: Element, depth: number): void => {
            elementCount++;
            if (depth > maxDepth) maxDepth = depth;
            for (const child of Array.from(el.children)) {
              getDepth(child, depth + 1);
            }
          };

          getDepth(root, 0);

          const html = root.outerHTML;
          return { html, elementCount, depth: maxDepth + 1 };
        },
        { selector: input.selector, includeStyles: input.includeStyles },
      );

      return responseBuilder.success(result, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserGetAccessibilityTree = createTool({
  name: "browser_get_accessibility_tree",
  description: "`<use_case>Accessibility</use_case> Get the accessibility tree — interactable elements with ARIA attributes. Optionally scope to a selector. tree.`",
  inputSchema: z.object({
    selector: z.string().optional().describe("Optional selector to scope the tree"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const tree = await (session.page as any).accessibility.snapshot({
        interestingOnly: true,
        root: input.selector ? await session.page.$(input.selector) : undefined,
      });

      return responseBuilder.success({
        tree: tree ?? null,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserFindElements = createTool({
  name: "browser_find_elements",
  description: "`<use_case>DOM inspection</use_case> Find all elements matching a CSS selector and return specified attributes. elements[], count.`",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector to find elements"),
    returnAttributes: z
      .array(z.string())
      .optional()
      .default(["id", "class", "textContent", "tagName"])
      .describe("Attributes to return for each element"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const elements = await session.page.evaluate(
        ({ selector, attributes }) => {
          const els = document.querySelectorAll(selector);
          return Array.from(els).map((el) => {
            const attrs: Record<string, string | null> = {};
            for (const attr of attributes) {
              if (attr === "textContent") {
                attrs[attr] = el.textContent?.trim() ?? null;
              } else {
                attrs[attr] = el.getAttribute(attr) ?? null;
              }
            }
            return attrs;
          });
        },
        { selector: input.selector, attributes: input.returnAttributes! },
      );

      return responseBuilder.success({
        elements,
        count: elements.length,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserGetElementInfo = createTool({
  name: "browser_get_element_info",
  description: "`<use_case>Element inspection</use_case> Get element details: visibility, enabled state, text content, attributes, and bounding box. exists, visible, enabled, text, attributes, boundingBox.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.page, input.selector);
      if (!resolved.found) {
        return responseBuilder.success({
          exists: false,
          visible: false,
          enabled: false,
          text: null,
          attributes: null,
          boundingBox: null,
        }, sessionManager.buildMeta(session));
      }

      const locator = session.page.locator(resolved.selector);
      const [visible, enabled, text, attributes, box] = await Promise.all([
        locator.isVisible().catch(() => false),
        locator.isEnabled().catch(() => false),
        locator.textContent().catch(() => null),
        locator.evaluate((el) => {
          const attrs: Record<string, string> = {};
          for (const attr of Array.from(el.attributes as unknown as ArrayLike<Attr>)) {
            attrs[attr.name] = attr.value;
          }
          return attrs;
        }).catch(() => null),
        locator.boundingBox().catch(() => null),
      ]);

      return responseBuilder.success({
        exists: true,
        visible,
        enabled,
        text: text?.trim() ?? null,
        attributes,
        boundingBox: box,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserWaitForElement = createTool({
  name: "browser_wait_for_element",
  description: "`<use_case>Page state</use_case> Wait for an element to reach a state: attached, detached, visible, or hidden. elapsed (ms), finalState.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector"),
    state: z
      .enum(["attached", "detached", "visible", "hidden"])
      .optional()
      .default("visible")
      .describe("Desired element state"),
    timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const startTime = Date.now();

    try {
      await session.page.waitForSelector(input.selector, {
        state: input.state,
        timeout: input.timeout,
      });

      return responseBuilder.success({
        elapsed: Date.now() - startTime,
        finalState: input.state,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "ELEMENT_NOT_FOUND",
        suggestions: [
          `Element with selector "${input.selector}" did not reach state "${input.state}" within ${input.timeout}ms`,
          "Try checking if the page is on the correct URL",
          "Try using browser_get_dom_snapshot to see available elements",
        ],
      });
    }
  },
});

export const browserGetPageText = createTool({
  name: "browser_get_page_text",
  description: "`<use_case>Content extraction</use_case> Get visible text from the page or a scoped element. text, wordCount.`",
  inputSchema: z.object({
    selector: z.string().optional().describe("Optional selector to scope text extraction"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const text = input.selector
        ? await session.page.locator(input.selector).innerText()
        : await session.page.evaluate(() => document.body?.innerText ?? "");

      return responseBuilder.success({
        text,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserGetPageTitle = createTool({
  name: "browser_get_page_title",
  description: "`<use_case>Page state</use_case> Get the current page title. title.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const title = await session.page.title();
      return responseBuilder.success({ title }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserGetMeta = createTool({
  name: "browser_get_meta",
  description: "`<use_case>SEO/Meta inspection</use_case> Get page metadata: title, description, Open Graph tags, Twitter cards, canonical URL, favicon, and viewport info. title, description, ogTags, twitterTags, canonical, favicon, viewport, metaTags.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const meta = await session.page.evaluate(() => {
        const getMeta = (name: string): string | null => {
          const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          return el ? el.getAttribute("content") : null;
        };

        const ogTags: Record<string, string | null> = {};
        const twitterTags: Record<string, string | null> = {};
        const allMeta: Record<string, string | null> = {};

        document.querySelectorAll("meta").forEach((el) => {
          const property = el.getAttribute("property");
          const name = el.getAttribute("name");
          const content = el.getAttribute("content");
          const key = property || name;
          if (key && content) {
            allMeta[key] = content;
            if (key.startsWith("og:")) ogTags[key] = content;
            if (key.startsWith("twitter:")) twitterTags[key] = content;
          }
        });

        const canonical = document.querySelector("link[rel='canonical']")?.getAttribute("href") ?? null;
        const favicon = document.querySelector("link[rel='icon'], link[rel='shortcut icon']")?.getAttribute("href") ?? null;
        const viewport = getMeta("viewport");

        return {
          title: document.title,
          description: getMeta("description"),
          ogTags,
          twitterTags,
          canonical,
          favicon,
          viewport,
          metaTags: allMeta,
        };
      });

      return responseBuilder.success(meta, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});
