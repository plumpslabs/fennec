import { z } from "zod";
import { createTool } from "../_registry.js";
import { resolveSelector } from "../../utils/selector.js";
import { takeScreenshot } from "../../utils/screenshot.js";

export const browserScreenshot = createTool({
  name: "browser_screenshot",
  category: "dom",
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
      const result = await takeScreenshot(session.browser, {
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
  category: "dom",
  description: "`<use_case>DOM inspection</use_case> Get DOM summary (not full HTML) — interactable elements, forms, buttons, links, headings, inputs with their attributes. Returns a tree that summarizes the page structure without the overhead of serializing the entire DOM. elementCount, depth, structure[]. For full raw HTML, use browser_evaluate with document.documentElement.outerHTML instead.",
  inputSchema: z.object({
    selector: z.string().optional().describe("Optional selector to scope the summary"),
    includeAllElements: z.boolean().optional().default(false).describe("Include all elements (not just interactable ones)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const result = await session.browser.evaluate(
        function evaluateSnapshot({ selector, includeAll }: { selector?: string; includeAll?: boolean }): Record<string, unknown> {
          function getRoot(sel?: string): Element | null {
            if (!sel) return document.documentElement;
            const el = document.querySelector(sel);
            return el;
          }

          const root = getRoot(selector);
          if (!root) return { elementCount: 0, summary: "", structure: [] };

          // ─── Summary counters ────────────────────────
          let totalElements = 0;
          let interactableCount = 0;
          const tagCounts: Record<string, number> = {};
          let depth = 0;

          const INTERACTABLE_TAGS = new Set([
            "a", "button", "input", "select", "textarea",
            "form", "label", "option",
            "details", "summary",
            "video", "audio", "img",
          ]);

          const INTERACTABLE_ROLES = new Set([
            "button", "link", "textbox", "combobox", "listbox",
            "checkbox", "radio", "switch", "slider", "tab",
            "menuitem", "option", "searchbox", "spinbutton",
          ]);

          function buildTree(node: Element, currentDepth: number): Record<string, unknown> | null {
            totalElements++;
            const tag = node.tagName.toLowerCase();
            tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
            if (currentDepth > depth) depth = currentDepth;

            const role = node.getAttribute("role") ?? "";
            const isInteractable =
              INTERACTABLE_TAGS.has(tag) ||
              INTERACTABLE_ROLES.has(role) ||
              node.hasAttribute("onclick") ||
              node.getAttribute("tabindex") !== null ||
              node.getAttribute("contenteditable") === "true" ||
              (tag === "div" && role !== "");

            if (isInteractable) interactableCount++;

            if (!isInteractable && !includeAll) {
              for (const child of Array.from(node.children)) {
                buildTree(child, currentDepth + 1);
              }
              return null;
            }

            const children: Record<string, unknown>[] = [];
            for (const child of Array.from(node.children)) {
              const built = buildTree(child, currentDepth + 1);
              if (built) children.push(built);
            }

            const text = (node.textContent ?? "").trim().slice(0, 120);

            return {
              tag,
              text,
              id: node.id || undefined,
              class: node.className.slice(0, 100) || undefined,
              role: role || undefined,
              type: (node as HTMLInputElement).type || undefined,
              name: (node as HTMLInputElement).name || node.getAttribute("name") || undefined,
              href: (node as HTMLAnchorElement).href || undefined,
              src: (node as HTMLImageElement).src || undefined,
              alt: node.getAttribute("alt") || undefined,
              placeholder: node.getAttribute("placeholder") || undefined,
              checked: (node as HTMLInputElement).checked || undefined,
              disabled: (node as HTMLInputElement).disabled || undefined,
              required: node.hasAttribute("required") || undefined,
              children,
            };
          }

          const structure = buildTree(root, 0);

          const summaryParts: string[] = [];
          summaryParts.push(`Page has ${totalElements} elements (${interactableCount} interactable) in ${depth + 1} levels`);

          const sortedTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
          if (sortedTags.length > 0) {
            summaryParts.push("Elements: " + sortedTags.map(([t, c]) => `${t}:${c}`).join(", "));
          }

          const buttons = tagCounts["button"] ?? 0;
          const inputs = tagCounts["input"] ?? 0;
          const links = tagCounts["a"] ?? 0;
          const forms = tagCounts["form"] ?? 0;
          const headings = ["h1", "h2", "h3", "h4", "h5", "h6"]
            .reduce((sum, h) => sum + (tagCounts[h] ?? 0), 0);

          if (buttons > 0) summaryParts.push(`${buttons} button(s)`);
          if (inputs > 0) summaryParts.push(`${inputs} input(s)`);
          if (links > 0) summaryParts.push(`${links} link(s)`);
          if (forms > 0) summaryParts.push(`${forms} form(s)`);
          if (headings > 0) summaryParts.push(`${headings} heading(s)`);

          return {
            elementCount: totalElements,
            interactableCount,
            depth: depth + 1,
            summary: summaryParts.join(". "),
            tagBreakdown: sortedTags.map(([tag, count]) => ({ tag, count })),
            structure: structure ? [structure] : [],
          };
        },
        {
          selector: input.selector,
          includeAll: input.includeAllElements ?? false,
        },
      );

      return responseBuilder.success(result as Record<string, unknown>, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserGetAccessibilityTree = createTool({
  name: "browser_get_accessibility_tree",
  category: "dom",
  description: "`<use_case>Accessibility</use_case> Get the accessibility tree — interactable elements with ARIA attributes. Optionally scope to a selector. tree.`",
  inputSchema: z.object({
    selector: z.string().optional().describe("Optional selector to scope the tree"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const tree = await session.browser.evaluate((sel?: string) => {
        // Build accessibility tree from the DOM
        const root = sel ? document.querySelector(sel) : document.documentElement;
        if (!root) return null;

        function getAccessibleNode(el: Element): Record<string, unknown> | null {
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          const name = el.getAttribute('aria-label') || el.textContent?.trim() || '';
          const children = Array.from(el.children)
            .map((child) => getAccessibleNode(child))
            .filter(Boolean) as Record<string, unknown>[];
          return {
            role,
            name: name.slice(0, 100),
            children: children.length > 0 ? children : undefined,
          };
        }

        return getAccessibleNode(root);
      }, input.selector);

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
  category: "dom",
  description: "`<use_case>DOM inspection</use_case> Find all elements matching a CSS selector and return specified attributes. Supports Shadow DOM piercing. elements[], count.`",
  inputSchema: z.object({
    selector: z.string().describe("CSS selector to find elements"),
    returnAttributes: z
      .array(z.string())
      .optional()
      .default(["id", "class", "textContent", "tagName"])
      .describe("Attributes to return for each element"),
    includeShadowDom: z.boolean().optional().default(true).describe("Include Shadow DOM elements in search"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const elements = await session.browser.evaluate(
        ({ selector, attributes, includeShadowDom }) => {
          function queryAllDeep(root: Document | ShadowRoot, sel: string): Element[] {
            // Start with light DOM
            const results: Element[] = [];
            try {
              const light = Array.from(root.querySelectorAll(sel));
              results.push(...light);
            } catch { /* invalid selector */ }

            if (!includeShadowDom) return results;

            // Find all shadow hosts and recurse
            const allElements = root.querySelectorAll('*');
            for (const el of Array.from(allElements)) {
              const shadowRoot = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
              if (shadowRoot) {
                results.push(...queryAllDeep(shadowRoot, sel));
              }
            }

            return results;
          }

          // Try standard querySelector first (handles flat DOM)
          let els = Array.from(document.querySelectorAll(selector));

          if (els.length === 0 && includeShadowDom) {
            // Fall back to deep piercing
            els = queryAllDeep(document, selector);
          } else if (includeShadowDom) {
            // Also include shadow DOM results
            const shadowResults = queryAllDeep(document, selector);
            const existingIds = new Set(els.map((e) => {
              const attrs: Record<string, string | null> = {};
              for (const attr of ['id', 'data-testid']) {
                if (attr === 'textContent') continue;
                const val = e.getAttribute(attr);
                if (val) attrs[attr] = val;
              }
              return attrs.id || attrs['data-testid'] || '';
            }));
            for (const el of shadowResults) {
              const id = el.id || el.getAttribute('data-testid') || '';
              if (id && !existingIds.has(id)) {
                els.push(el);
              }
            }
          }

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
        { selector: input.selector, attributes: input.returnAttributes!, includeShadowDom: input.includeShadowDom ?? true },
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
  category: "dom",
  description: "`<use_case>Element inspection</use_case> Get element details: visibility, enabled state, text content, attributes, and bounding box. exists, visible, enabled, text, attributes, boundingBox.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const resolved = await resolveSelector(session.browser, input.selector);
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

      const locator = session.browser.locator(resolved.selector);
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
  category: "dom",
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
      await session.browser.waitForSelector(input.selector, {
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
  category: "dom",
  description: "`<use_case>Content extraction</use_case> Get visible text from the page or a scoped element. text, wordCount.`",
  inputSchema: z.object({
    selector: z.string().optional().describe("Optional selector to scope text extraction"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const text = input.selector
        ? await session.browser.locator(input.selector).innerText()
        : await session.browser.evaluate(() => document.body?.innerText ?? "");

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
  category: "dom",
  description: "`<use_case>Page state</use_case> Get the current page title. title.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const title = await session.browser.title();
      return responseBuilder.success({ title }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const browserGetMeta = createTool({
  name: "browser_get_meta",
  category: "dom",
  description: "`<use_case>SEO/Meta inspection</use_case> Get page metadata: title, description, Open Graph tags, Twitter cards, canonical URL, favicon, and viewport info. title, description, ogTags, twitterTags, canonical, favicon, viewport, metaTags.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const meta = await session.browser.evaluate(() => {
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
