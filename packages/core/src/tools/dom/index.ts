import { z } from "zod";
import { createTool } from "../_registry.js";
import { resolveSelector } from "../../utils/selector.js";
import { takeScreenshot } from "../../utils/screenshot.js";

export const browserScreenshot = createTool({
  name: "browser_screenshot",
  category: "dom",
  description: "`<use_case>DOM/Visual</use_case> 📸 Take a screenshot of the current page. Supports fullPage (scrollable content), selector-scoped (specific element), and png/jpeg format. Returns base64 image, dimensions, timestamp. For annotated screenshots with numbered elements, use browser_screenshot_annotated. For visual diffs, use browser_screenshot_diff.`",
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
  description: "`<use_case>DOM inspection</use_case> 🌳 Get a summarized DOM tree — interactable elements, forms, buttons, links, headings, inputs with their attributes. Much lighter than dumping full HTML. Returns elementCount, interactableCount, depth, structure[] (tree), tagBreakdown. Use as your FIRST step on any new page to understand what's there. For full raw HTML, use devtools_evaluate with document.documentElement.outerHTML. For finding specific elements by CSS, use browser_find_elements.`",
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
  description: "`<use_case>DOM inspection</use_case> ♿ Get the accessibility tree with ARIA roles, labels, and nested structure. Optionally scope to a CSS selector. Returns a tree of accessible nodes with role and name. Use for accessibility auditing, finding elements by their ARIA role, or understanding how screen readers will interpret the page. Also works well for finding elements that browser_get_dom_snapshot might miss.`",
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
  description: "`<use_case>DOM inspection</use_case> 🔎 Find ALL elements matching a CSS selector. Returns specified attributes for each element (default: id, class, textContent, tagName). Supports Shadow DOM piercing (automatically searches within shadow roots if standard querySelector finds nothing). Use when you know the CSS selector and need specific elements. For exploring the whole page structure, use browser_get_dom_snapshot first.`",
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
  description: "`<use_case>DOM inspection</use_case> 🔍 Get detailed info about a specific element: exists, visible (isVisible), enabled (isEnabled), text (textContent), attributes (all), boundingBox (x, y, width, height). Use BEFORE clicking or typing to verify the element is in the right state. For quicker existence checks without details, use diagnose_element. For finding elements by attributes, use browser_find_elements.`",
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
  description: "`<use_case>Page state</use_case> ⏳ Wait for an element to reach a specific state. States: attached (in DOM), detached (removed), visible (displayed), hidden (not displayed). Configurable timeout (default 30s). Returns elapsed time. Use before interacting with dynamic elements that appear after loading. For smarter waiting with auto-diagnosis on failure, use smart_wait instead.`",
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
  description: "`<use_case>DOM inspection</use_case> 📝 Get visible (rendered) text from the full page or a scoped element. Returns text content and wordCount. Use to extract page content, read article text, or verify text appears on the page. Unlike browser_get_dom_snapshot which returns structure, this returns raw readable text. For page metadata (title, description, OG tags), use browser_get_meta.`",
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
  description: "`<use_case>Page state</use_case> 📌 Get just the page title (document.title). Fast — no full DOM scan needed. Returns title string. Use for quick page identification, verifying navigation success, or checking if the page loaded correctly. For more details including URL and readyState, use tab_get_current or browser_get_current_url.`",
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
  description: "`<use_case>DOM inspection</use_case> 🏷️ Get comprehensive page metadata: title, description, Open Graph tags (og:*), Twitter cards (twitter:*), canonical URL, favicon, viewport, and ALL meta tags. Use for SEO analysis, link preview verification, social sharing checks, or extracting structured page info. More complete than browser_get_page_title which only returns the title.`",
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
