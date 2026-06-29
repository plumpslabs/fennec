import { z } from "zod";
import { createTool } from "../_registry.js";
import { takeScreenshot } from "../../utils/screenshot.js";
import fs from "node:fs";
import path from "node:path";

// ─── smart_fill_form ──────────────────────────────────────────────

export const smartFillForm = createTool({
  name: "smart_fill_form",
  description:
    "`<use_case>Smart form filling</use_case> Auto-detect ALL form fields on the page and fill them with provided values. Accepts a map of field identifiers (label, name, placeholder, id, aria-label) to values. Handles inputs, selects, textareas, checkboxes. Optionally submits after filling. Returns fieldsDetected, fieldsFilled, unmatchedFields, availableFields, submitted.`",
  inputSchema: z.object({
    fields: z
      .record(z.string())
      .describe(
        "Map of field identifier → value. Identifier can be label text, name, placeholder, id, aria-label, or data-testid. Example: { \"email\": \"user@test.com\", \"password\": \"secret123\", \"role\": \"admin\" }",
      ),
    submitAfter: z
      .boolean()
      .optional()
      .default(false)
      .describe("Submit the form after filling all fields"),
    submitSelector: z
      .string()
      .optional()
      .describe("Custom submit button selector (default: auto-detect)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.page;

    try {
      // Phase 1: Detect all form fields
      const formFields = await detectFormFields(page);

      if (formFields.length === 0) {
        return responseBuilder.error(
          new Error("No form fields found on the page"),
          {
            code: "ELEMENT_NOT_FOUND",
            suggestions: [
              "Use browser_get_dom_snapshot to see available elements",
              "The page may need to finish loading first",
              "Check if you're on the correct URL",
            ],
          },
        );
      }

      // Phase 2: Match provided fields to detected fields
      const fieldEntries = Object.entries(input.fields);
      const fieldsFilled: Array<{ identifier: string; field: string; value: string }> = [];
      const unmatchedFields: Array<{ identifier: string; value: string }> = [];

      for (const [identifier, value] of fieldEntries) {
        const matched = matchField(formFields, identifier);
        if (matched) {
          const filled = await fillField(page, matched, value);
          if (filled) {
            fieldsFilled.push({
              identifier,
              field: matched.label || matched.name || matched.id || matched.placeholder,
              value,
            });
          } else {
            unmatchedFields.push({ identifier, value });
          }
        } else {
          unmatchedFields.push({ identifier, value });
        }
      }

      // Phase 3: Submit if requested
      let submitted = false;
      if (input.submitAfter) {
        const submitBtn = input.submitSelector
          ? page.locator(input.submitSelector)
          : await findSubmitButton(page);

        if (submitBtn) {
          await submitBtn.click();
          submitted = true;
        }
      }

      return responseBuilder.success(
        {
          formFound: true,
          totalFieldsDetected: formFields.length,
          totalFieldsProvided: fieldEntries.length,
          fieldsFilled: fieldsFilled.length,
          unmatchedFields: unmatchedFields.length,
          submitted,
          fieldsFilledDetails: fieldsFilled,
          unmatchedFieldsDetails: unmatchedFields,
          availableFields: formFields.map((f) => ({
            label: f.label || f.placeholder || f.name || f.id || `field_${f.index}`,
            type: f.type,
            required: f.required,
            currentValue: f.currentValue,
          })),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: "FORM_FILL_FAILED",
        suggestions: [
          "Check if the page has finished loading",
          "Use smart_wait to wait for form elements to appear",
          "Use browser_get_dom_snapshot to see the form structure",
        ],
      });
    }
  },
});

/**
 * Auto-detect submit button on the page.
 */
/** @internal Exported for use by auth_fill_login_form */
export async function findSubmitButton(page: {
  locator: (selector: string) => { click: () => Promise<void> };
  $: (selector: string) => Promise<unknown>;
}): Promise<{ click: () => Promise<void> } | null> {
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Submit")',
    'button:has-text("Save")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button:has-text("Send")',
    'button:has-text("Register")',
    'button:has-text("Sign Up")',
    'button:has-text("Create")',
    'button:has-text("Update")',
    '[role="button"]:has-text("Submit")',
    '[role="button"]:has-text("Save")',
    'form button',
    'form input[type="button"]',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      return page.locator(sel);
    }
  }

  return null;
}

// ─── Shared DOM helpers (used by smart_fill_form and reusable by auth, etc.) ─

/** @internal Exported for use by auth_fill_login_form */
export interface DetectedField {
  index: number;
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  ariaLabel: string;
  dataTestid: string;
  required: boolean;
  currentValue: string;
  // HTML5 validation constraints (populated in same evaluate pass)
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
  min: string | null;
  max: string | null;
  step: string | null;
}

/** @internal Exported for use by auth_fill_login_form */
export async function detectFormFields(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<DetectedField[]> {
  const fields = await page.evaluate(() => {
    const results: Array<{
      index: number;
      tag: string;
      type: string;
      name: string;
      id: string;
      placeholder: string;
      label: string;
      ariaLabel: string;
      dataTestid: string;
      required: boolean;
      currentValue: string;
      minLength: number | null;
      maxLength: number | null;
      pattern: string | null;
      min: string | null;
      max: string | null;
      step: string | null;
    }> = [];
    let index = 0;

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea",
    ));

    for (const el of inputs) {
      const tag = el.tagName.toLowerCase();
      const id = el.id;

      // Try to find label
      let label = "";
      if (id) {
        const labelEl = document.querySelector(`label[for="${id}"]`);
        if (labelEl) label = (labelEl as HTMLElement).textContent?.trim() ?? "";
      }
      if (!label && el.parentElement?.tagName === "LABEL") {
        label = (el.parentElement as HTMLElement).textContent?.trim() ?? "";
      }
      if (!label) {
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const ref = document.getElementById(labelledBy);
          if (ref) label = ref.textContent?.trim() ?? "";
        }
      }

      // HTML5 validation attributes
      const rawMinLength = el.getAttribute("minlength");
      const rawMaxLength = el.getAttribute("maxlength");
      let pattern = null;
      if (tag === "input") {
        pattern = (el as HTMLInputElement).getAttribute("pattern");
      }

      let type = "";
      let currentValue = "";
      if (tag === "input") {
        const input = el as HTMLInputElement;
        type = input.type || "text";
        currentValue = input.value;
      } else if (tag === "textarea") {
        const textarea = el as HTMLTextAreaElement;
        type = "textarea";
        currentValue = textarea.value;
      } else if (tag === "select") {
        const select = el as HTMLSelectElement;
        type = "select";
        currentValue = select.value;
      }

      results.push({
        index: index++,
        tag,
        type,
        name: (el as HTMLInputElement).name ?? "",
        id,
        placeholder: (el as HTMLInputElement).placeholder ?? "",
        label,
        ariaLabel: el.getAttribute("aria-label") ?? "",
        dataTestid: el.getAttribute("data-testid") ?? "",
        required: el.hasAttribute("required"),
        currentValue,
        // Validation constraints
        minLength: rawMinLength ? parseInt(rawMinLength, 10) : null,
        maxLength: rawMaxLength ? parseInt(rawMaxLength, 10) : null,
        pattern,
        min: el.getAttribute("min"),
        max: el.getAttribute("max"),
        step: el.getAttribute("step"),
      });
    }

    return results;
  }).catch(() => []);

  return fields as DetectedField[];
}

/** @internal Exported for use by auth_fill_login_form */
export function matchField(fields: DetectedField[], query: string): DetectedField | null {
  const q = query.toLowerCase().trim();

  // Exact match first
  for (const f of fields) {
    if (
      f.label.toLowerCase() === q ||
      f.name.toLowerCase() === q ||
      f.id.toLowerCase() === q ||
      f.placeholder.toLowerCase() === q ||
      f.ariaLabel.toLowerCase() === q ||
      f.dataTestid.toLowerCase() === q
    ) {
      return f;
    }
  }

  // Partial / includes match
  for (const f of fields) {
    if (
      f.label.toLowerCase().includes(q) ||
      f.name.toLowerCase().includes(q) ||
      f.id.toLowerCase().includes(q) ||
      f.placeholder.toLowerCase().includes(q) ||
      f.ariaLabel.toLowerCase().includes(q) ||
      f.dataTestid.toLowerCase().includes(q)
    ) {
      return f;
    }
  }

  return null;
}

/** @internal Exported for use by auth_fill_login_form */
export async function fillField(
  page: {
    locator: (selector: string) => {
      fill: (text: string) => Promise<void>;
      selectOption: (val: string) => Promise<string[]>;
      setChecked: (checked: boolean) => Promise<void>;
    };
  },
  field: DetectedField,
  value: string,
): Promise<boolean> {
  // Build a robust selector (use attribute selectors to avoid CSS.escape issue in Node.js)
  let selector: string;
  if (field.id) {
    selector = `[id="${field.id.replace(/["]/g, '\\"')}"]`;
  } else if (field.name) {
    selector = `${field.tag}[name="${field.name.replace(/["]/g, '\\"')}"]`;
  } else if (field.placeholder) {
    selector = `${field.tag}[placeholder="${field.placeholder.replace(/["]/g, '\\"')}"]`;
  } else {
    // No reliable selector available — skip filling this field
    return false;
  }

  if (field.type === "checkbox" || field.type === "radio") {
    const shouldCheck = value === "true" || value === "yes" || value === "1" || value === "on";
    await page.locator(selector).setChecked(shouldCheck);
  } else if (field.tag === "select") {
    await page.locator(selector).selectOption(value);
  } else {
    await page.locator(selector).fill(value);
  }

  return true;
}

// ─── smart_validate_form ─────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\/.+/i;
const PHONE_REGEX = /^[\+\d][\d\s\-\(\)]{6,20}$/;

export interface FieldValidation {
  field: string;
  label: string;
  type: string;
  value: string;
  required: boolean;
  valid: boolean;
  issues: string[];
  htmlAttributes: {
    minLength: number | null;
    maxLength: number | null;
    pattern: string | null;
    min: string | null;
    max: string | null;
    step: string | null;
  };
}

export const smartValidateForm = createTool({
  name: "smart_validate_form",
  description:
    "`<use_case>Smart form validation</use_case> Validate all form fields on the page against HTML5 constraints (required, email format, minlength, maxlength, pattern, type). Also checks for common issues like empty required fields, invalid email/URL/phone format. Returns valid (bool), fieldResults[], totalIssues (int).`",
  inputSchema: z.object({
    customRules: z
      .record(
        z.object({
          required: z.boolean().optional().describe("Override required status"),
          minLength: z.number().optional().describe("Minimum length"),
          maxLength: z.number().optional().describe("Maximum length"),
          pattern: z.string().optional().describe("Regex pattern to match"),
          type: z
            .enum(["email", "url", "phone", "number", "text"])
            .optional()
            .describe("Override field type for validation"),
        }),
      )
      .optional()
      .describe(
        "Custom validation rules per field identifier. Example: { \"email\": { type: \"email\", required: true }, \"phone\": { pattern: \"^[\\+\\d]+$\" } }",
      ),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.page;

    try {
      // Phase 1: Detect all form fields with current values + HTML5 constraints (single evaluate)
      const formFields = await detectFormFields(page);

      if (formFields.length === 0) {
        return responseBuilder.error(
          new Error("No form fields found on the page"),
          {
            code: "ELEMENT_NOT_FOUND",
            suggestions: [
              "Use browser_get_dom_snapshot to see available elements",
              "The page may need to finish loading first",
            ],
          },
        );
      }

      // Phase 2: Validate each field (constraints already included in detectFormFields)
      const fieldResults: FieldValidation[] = [];
      let totalIssues = 0;

      for (const field of formFields) {
        const customRule = input.customRules?.[
          field.label || field.name || field.id || field.placeholder || `field_${field.index}`
        ];

        const issues: string[] = [];
        const value = field.currentValue;
        const isRequired = customRule?.required ?? field.required;
        const fieldType = customRule?.type ?? field.type;
        const minLen = customRule?.minLength ?? field.minLength ?? null;
        const maxLen = customRule?.maxLength ?? field.maxLength ?? null;
        const pattern = customRule?.pattern ?? field.pattern ?? null;

        // Check required
        if (isRequired && (!value || value.trim() === "")) {
          issues.push(`Required field "${field.label || field.name || field.id || `field_${field.index}`}" is empty`);
        }

        // Only run format checks if field has a value
        if (value && value.trim() !== "") {
          // Check minlength
          if (minLen !== null && value.length < minLen) {
            issues.push(`Minimum ${minLen} characters required (currently ${value.length})`);
          }

          // Check maxlength
          if (maxLen !== null && value.length > maxLen) {
            issues.push(`Maximum ${maxLen} characters allowed (currently ${value.length})`);
          }

          // Check type-specific format
          if (fieldType === "email" && !EMAIL_REGEX.test(value)) {
            issues.push(`"${value}" is not a valid email address`);
          } else if (fieldType === "url" && !URL_REGEX.test(value)) {
            issues.push(`"${value}" is not a valid URL (must start with http:// or https://)`);
          } else if ((fieldType === "phone" || fieldType === "tel") && !PHONE_REGEX.test(value)) {
            issues.push(`"${value}" is not a valid phone number`);
          } else if (fieldType === "number" && isNaN(Number(value))) {
            issues.push(`"${value}" is not a valid number`);
          }

          // Check custom regex pattern
          if (pattern) {
            try {
              const regex = new RegExp(pattern);
              if (!regex.test(value)) {
                issues.push(`Value does not match required pattern: ${pattern}`);
              }
            } catch {
              // Invalid regex in pattern attribute — skip
            }
          }
        }

        if (issues.length > 0) {
          totalIssues += issues.length;
        }

        fieldResults.push({
          field: field.label || field.name || field.id || field.placeholder || `field_${field.index}`,
          label: field.label,
          type: fieldType,
          value,
          required: isRequired,
          valid: issues.length === 0,
          issues,
          htmlAttributes: {
            minLength: minLen,
            maxLength: maxLen,
            pattern,
            min: field.min ?? null,
            max: field.max ?? null,
            step: field.step ?? null,
          },
        });
      }

      const allValid = fieldResults.every((r) => r.valid);

      return responseBuilder.success(
        {
          valid: allValid,
          totalFields: fieldResults.length,
          validFields: fieldResults.filter((r) => r.valid).length,
          invalidFields: fieldResults.filter((r) => !r.valid).length,
          totalIssues,
          fieldResults: allValid
            ? undefined
            : fieldResults.filter((r) => !r.valid).map((r) => ({
                field: r.field,
                type: r.type,
                value: r.value,
                required: r.required,
                issues: r.issues,
              })),
          allFields: fieldResults.map((r) => ({
            field: r.field,
            type: r.type,
            value: r.value,
            required: r.required,
            valid: r.valid,
          })),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: "VALIDATION_FAILED",
        suggestions: [
          "Check if the page has finished loading",
          "Use smart_wait to wait for form elements to appear",
        ],
      });
    }
  },
});

// ─── browser_screenshot_annotated ───────────────────────────────

interface AnnotatedElement {
  index: number;
  tag: string;
  text: string;
  selector: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

/**
 * Inject numbered annotation badges on interactive elements.
 */
async function injectAnnotations(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<AnnotatedElement[]> {
  const elements = await page.evaluate(() => {
    const tags = ["a", "button", "input", "select", "textarea", "[role=button]", "[role=link]", "[role=tab]", "[role=menuitem]"];
    const selector = tags
      .map((t) => `${t}:not([data-ai-annotated]):not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])`)
      .join(", ");

    const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const results: Array<{
      index: number;
      tag: string;
      text: string;
      selector: string;
      boundingBox: { x: number; y: number; width: number; height: number };
    }> = [];

    let index = 0;
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.x + rect.width < 0 || rect.y + rect.height < 0) continue;

      // Add data-ai-index directly on the element so AI can click via [data-ai-index='N']
      el.setAttribute("data-ai-index", String(index));

      const text = (el.textContent ?? "").trim().slice(0, 40);
      const id = el.id ? `#${CSS.escape(el.id)}` : "";

      results.push({
        index,
        tag: el.tagName.toLowerCase(),
        text,
        selector: id || el.getAttribute("data-testid") || el.getAttribute("name") || el.getAttribute("aria-label") || text.slice(0, 20),
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });

      // Create badge overlay (visual indicator only)
      const badge = document.createElement("div");
      badge.setAttribute("data-ai-annotated", "true");
      badge.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        top: ${rect.y}px;
        left: ${rect.x}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        pointer-events: none;
        box-sizing: border-box;
        border: 2px solid rgba(255, 100, 50, 0.7);
        background: rgba(255, 100, 50, 0.08);
      `;

      const label = document.createElement("span");
      label.style.cssText = `
        position: absolute;
        top: -12px;
        left: -6px;
        background: #ff6432;
        color: white;
        font: bold 11px/18px monospace;
        padding: 0 5px;
        border-radius: 3px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      `;
      label.textContent = String(index);
      badge.appendChild(label);

      document.body.appendChild(badge);
      index++;
    }

    return results;
  }).catch(() => []);

  return elements as unknown as AnnotatedElement[];
}

/**
 * Remove annotation badges from the page and clean up data-ai-index attributes.
 */
async function removeAnnotations(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll("[data-ai-annotated]").forEach((el) => el.remove());
    document.querySelectorAll("[data-ai-index]").forEach((el) => el.removeAttribute("data-ai-index"));
  }).catch(() => {});
}

export const browserScreenshotAnnotated = createTool({
  name: "browser_screenshot_annotated",
  description:
    "`<use_case>Visual capture</use_case> Take a screenshot with auto-numbered annotations on all interactive elements (buttons, links, inputs, selects, etc.). Each element gets a numbered badge in the screenshot + a data-ai-index attribute for easy clicking. Returns base64 screenshot, elements[ {index, tag, text, selector, boundingBox} ]. Use the index to click: browser_click(selector=\"[data-ai-index='3']\").`",
  inputSchema: z.object({
    format: z
      .enum(["png", "jpeg"])
      .optional()
      .default("png")
      .describe("Image format"),
    fullPage: z
      .boolean()
      .optional()
      .default(false)
      .describe("Capture full page (including scrollable content)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.page;

    try {
      // Phase 1: Inject numbered annotations on interactive elements
      const annotatedElements = await injectAnnotations(page);

      // Phase 2: Take screenshot with annotations visible
      const format = input.format ?? "png";
      const fullPage = input.fullPage ?? false;
      const buffer = await page.screenshot({ fullPage, type: format });

      const base64 = buffer.toString("base64");

      // Phase 3: Clean up annotations
      await removeAnnotations(page);

      return responseBuilder.success(
        {
          base64,
          format,
          width: page.viewportSize()?.width ?? 1280,
          height: page.viewportSize()?.height ?? 720,
          timestamp: new Date().toISOString(),
          annotatedCount: annotatedElements.length,
          elements: annotatedElements.map((el) => ({
            index: el.index,
            tag: el.tag,
            text: el.text.slice(0, 80),
            selector: el.selector,
            boundingBox: el.boundingBox,
          })),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      // Ensure cleanup even on error
      await removeAnnotations(page).catch(() => {});
      return responseBuilder.error(error, {
        code: "SCREENSHOT_FAILED",
        suggestions: [
          "Check if the page is still open and accessible",
          "Try browser_screenshot instead",
        ],
      });
    }
  },
});

// ─── browser_screenshot_export ───────────────────────────────────

export const browserScreenshotExport = createTool({
  name: "browser_screenshot_export",
  description:
    "`<use_case>Visual capture</use_case> Take a screenshot with bounding box highlights on all interactive elements and export as a standalone HTML file. The HTML file embeds the screenshot + interactive overlays so you can open it in any browser to visually inspect elements. Returns filePath, elementCount, elements[].`",
  inputSchema: z.object({
    format: z
      .enum(["png", "jpeg"])
      .optional()
      .default("png")
      .describe("Image format"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.page;

    try {
      // Phase 1: Take screenshot
      const format = input.format ?? "png";
      const buffer = await page.screenshot({ type: format });
      const base64 = buffer.toString("base64");
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

      // Phase 2: Scan interactive elements with bounding boxes
      const rawElements = await page.evaluate(() => {
        const selector = [
          "a:not([data-ai-annotated])",
          "button:not([data-ai-annotated])",
          "input:not([type=hidden]):not([type=submit]):not([type=button]):not([data-ai-annotated])",
          "select:not([data-ai-annotated])",
          "textarea:not([data-ai-annotated])",
          "[role=button]:not([data-ai-annotated])",
          "[role=link]:not([data-ai-annotated])",
          "[role=tab]:not([data-ai-annotated])",
          "[role=menuitem]:not([data-ai-annotated])",
        ].join(", ");

        const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
        const results: Array<{
          index: number;
          tag: string;
          text: string;
          type: string;
          name: string;
          id: string;
          boundingBox: { x: number; y: number; width: number; height: number };
          color: string;
        }> = [];

        const colors = [
          "#ff4444", "#44aa44", "#4488ff", "#ff8800", "#aa44ff",
          "#ff44aa", "#44dddd", "#dddd44", "#dd44dd", "#44dd88",
        ];

        let index = 0;
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.width < 5 || rect.height < 5) continue;

          const tag = el.tagName.toLowerCase();
          const text = (el.textContent ?? "").trim().slice(0, 60);
          const inputType = (el as HTMLInputElement).type ?? "";

          results.push({
            index,
            tag,
            text,
            type: tag === "input" ? inputType : tag,
            name: (el as HTMLInputElement).name ?? "",
            id: el.id,
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            color: colors[index % colors.length] ?? "#888888",
          });
          index++;
        }

        return results;
      }).catch(() => []);

      // Phase 3: Generate HTML with embedded screenshot + overlays
      const timestamp = Date.now();
      const filename = `screenshots/screenshot-${timestamp}.html`;
      const exportPath = config.security.exportPath ?? "./.fennec/exports";
      const fullDir = path.resolve(exportPath, "screenshots");
      const fullPath = path.resolve(exportPath, filename);

      await fs.promises.mkdir(fullDir, { recursive: true });

      const boxesHtml = rawElements
        .map(
          (el) => `
    <div class="box" style="
      left: ${el.boundingBox.x}px;
      top: ${el.boundingBox.y}px;
      width: ${el.boundingBox.width}px;
      height: ${el.boundingBox.height}px;
      border-color: ${el.color};
    " title="[${el.index}] ${el.tag}${el.text ? `: ${escapeHtml(el.text)}` : ""}${el.name ? ` (name: ${escapeHtml(el.name)})` : ""}${el.id ? ` (#${escapeHtml(el.id)})` : ""}">
      <span class="label" style="background: ${el.color};">${el.index}</span>
      <span class="info">${el.tag}${el.type !== el.tag ? `[type=${el.type}]` : ""}</span>
    </div>`,
        )
        .join("");

      // Build legend
      const legendHtml = rawElements
        .slice(0, 30)
        .map(
          (el) =>
            `<li><span class="legend-dot" style="background:${el.color}"></span><strong>[${el.index}]</strong> &lt;${el.tag}&gt; ${el.text ? `&quot;${escapeHtml(el.text)}&quot;` : ""}${el.name ? ` <em>name=&quot;${escapeHtml(el.name)}&quot;</em>` : ""}${el.id ? ` <em>#${escapeHtml(el.id)}</em>` : ""}</li>`,
        )
        .join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Fennec Screenshot Export - ${new Date(timestamp).toISOString()}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; }
.container { max-width: 1400px; margin: 0 auto; padding: 20px; }
h1 { font-size: 18px; color: #ff6432; margin-bottom: 20px; }
.screenshot-wrapper { position: relative; display: inline-block; max-width: 100%; }
.screenshot-wrapper img { max-width: 100%; height: auto; display: block; }
.box { position: absolute; border: 2px solid; border-radius: 3px; cursor: pointer; transition: background 0.2s; }
.box:hover { background: rgba(255,255,255,0.15) !important; }
.label { position: absolute; top: -12px; left: -6px; color: #fff; font: bold 10px/16px monospace; padding: 0 4px; border-radius: 2px; z-index: 2; }
.info { display: none; position: absolute; bottom: -18px; left: 0; font: 10px monospace; color: #aaa; white-space: nowrap; }
.box:hover .info { display: block; }
.sidebar { margin-top: 20px; }
h2 { font-size: 14px; color: #ff6432; margin-bottom: 10px; }
ul { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 4px; }
li { font: 11px monospace; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.meta { font: 11px monospace; color: #888; margin-bottom: 15px; }
</style>
</head>
<body>
<div class="container">
  <h1>Fennec Screenshot Export</h1>
  <div class="meta">
    ${rawElements.length} elements detected &middot;
    ${viewport.width}x${viewport.height} viewport &middot;
    ${new Date(timestamp).toISOString()}
  </div>
  <div class="screenshot-wrapper">
    <img src="data:image/${format};base64,${base64}" alt="Screenshot">
    ${boxesHtml}
  </div>
  <div class="sidebar">
    <h2>Elements (${rawElements.length})</h2>
    <ul>${legendHtml}</ul>
  </div>
</div>
</body>
</html>`;

      await fs.promises.writeFile(fullPath, html, "utf-8");

      return responseBuilder.success(
        {
          filePath: fullPath,
          elementCount: rawElements.length,
          viewport: `${viewport.width}x${viewport.height}`,
          timestamp: new Date(timestamp).toISOString(),
          elements: rawElements.map((el) => ({
            index: el.index,
            tag: el.tag,
            text: el.text.slice(0, 80),
            type: el.type,
            name: el.name,
            id: el.id,
            boundingBox: el.boundingBox,
          })),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: "EXPORT_FAILED",
        suggestions: [
          "Check if the page is still open and accessible",
          "Check disk space and write permissions",
          "Try browser_screenshot instead",
        ],
      });
    }
  },
});

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── smartWait ───────────────────────────────────────────────────

export const smartWait = createTool({
  name: "smart_wait",
  description:
    "`<use_case>Smart page interaction</use_case> Smart element wait with auto-diagnosis. Waits for an element by selector/text and if timeout occurs, automatically collects page context (URL, DOM snapshot, visible text, screenshot) so AI can diagnose what went wrong. Returns found (bool), elapsed (ms), and diagnosis info on failure.`",
  inputSchema: z.object({
    selector: z.string().describe("Element selector (CSS, text=, ARIA)"),
    text: z
      .string()
      .optional()
      .describe("Optional text the element should contain"),
    state: z
      .enum(["attached", "detached", "visible", "hidden"])
      .optional()
      .default("visible")
      .describe("Desired element state"),
    timeout: z
      .number()
      .optional()
      .default(10000)
      .describe("Timeout in milliseconds"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.page;
    const startTime = Date.now();

    // Phase 1: Check current page state BEFORE waiting
    const [initialUrl, initialTitle] = await Promise.all([
      (async () => { try { return await page.url(); } catch { return "unknown"; } })(),
      (async () => { try { return await page.title(); } catch { return "unknown"; } })(),
    ]);

    // Phase 2: Try waiting for the element
    try {
      if (input.text) {
        // If text provided, try finding element by text content
        await page.waitForSelector(`${input.selector}:has-text("${input.text}")`, {
          state: input.state,
          timeout: input.timeout,
        });
      } else {
        await page.waitForSelector(input.selector, {
          state: input.state,
          timeout: input.timeout,
        });
      }

      const elapsed = Date.now() - startTime;
      return responseBuilder.success(
        {
          found: true,
          elapsed,
          message: `Element found in ${elapsed}ms`,
          url: initialUrl,
          title: initialTitle,
        },
        sessionManager.buildMeta(session),
      );
    } catch (waitError) {
      const elapsed = Date.now() - startTime;

      // Phase 3: Timeout — auto-diagnose page state
      const [currentUrl, currentTitle, pageText, domSnapshot, screenshot] =
        await Promise.all([
          (async () => { try { return await page.url(); } catch { return "unknown"; } })(),
          (async () => { try { return await page.title(); } catch { return "unknown"; } })(),
          page
            .evaluate(() => document.body?.innerText ?? "")
            .catch(() => ""),
          page
            .evaluate(() => {
              const root = document.documentElement;
              const elements: Array<{
                tag: string;
                id: string;
                class: string;
                text: string;
                role: string;
              }> = [];
              const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT,
              );
              let node: Node | null;
              let count = 0;
              while ((node = walker.nextNode()) && count < 200) {
                const el = node as Element;
                const tag = el.tagName.toLowerCase();
                // Only collect interactive/relevant elements
                if (
                  ["a", "button", "input", "select", "textarea", "span", "div", "h1", "h2", "h3", "li", "label"].includes(
                    tag,
                  ) ||
                  el.hasAttribute("role") ||
                  el.hasAttribute("data-testid")
                ) {
                  const text = (el.textContent ?? "").trim().slice(0, 120);
                  if (text || el.id || el.getAttribute("data-testid")) {
                    elements.push({
                      tag,
                      id: el.id,
                      class: el.className.slice(0, 100),
                      text,
                      role: el.getAttribute("role") ?? "",
                    });
                  }
                }
                count++;
              }
              return elements;
            })
            .catch(() => []),
          takeScreenshot(page, { format: "jpeg" }).catch(() => null),
        ]);

      // Detect if page changed during wait
      const pageChanged =
        initialUrl !== currentUrl || initialTitle !== currentTitle;

      // Check if the selector works as a text search
      const searchText = input.text ?? input.selector;
      const similarElements = domSnapshot
        .filter(
          (el: { text: string; id: string; tag: string; class: string; role: string }) =>
            el.text.toLowerCase().includes(searchText.toLowerCase()) ||
            el.id.toLowerCase().includes(searchText.toLowerCase()),
        )
        .slice(0, 10);

      // Find clickable elements
      const clickableElements = domSnapshot
        .filter((el: { tag: string; role: string }) => el.tag === "a" || el.tag === "button" || el.role === "button")
        .slice(0, 20);

      const suggestions = [];

      if (pageChanged) {
        suggestions.push(
          `Page changed during wait: "${initialTitle}" → "${currentTitle}"`,
        );
      }

      if (similarElements.length > 0) {
        suggestions.push(
          `Found ${similarElements.length} elements with similar text. Try one of these:`,
        );
        for (const el of similarElements.slice(0, 5)) {
          const idHint = el.id ? `#${el.id}` : "";
          const classHint = el.class ? `.${el.class.split(" ")[0]}` : "";
          suggestions.push(
            `  - "${el.text.slice(0, 80)}" (${el.tag}${idHint}${classHint})`,
          );
        }
      } else {
        suggestions.push(
          `No elements found matching "${searchText}". Page title: "${currentTitle}"`,
        );
        if (clickableElements.length > 0) {
          suggestions.push("Available elements:");
          for (const el of clickableElements.slice(0, 10)) {
            const text = el.text.slice(0, 60);
            if (text) {
              suggestions.push(`  - "${text}" (${el.tag})`);
            }
          }
        }
      }

      const diagnosis = {
        found: false,
        elapsed,
        message: `Element "${input.selector}" not found within ${input.timeout}ms`,
        pageState: {
          urlBefore: initialUrl,
          urlAfter: currentUrl,
          titleBefore: initialTitle,
          titleAfter: currentTitle,
          pageChanged,
        },
        pageText: pageText.slice(0, 2000),
        screenshot: screenshot?.base64 ?? null,
        similarElements,
        availableElements: clickableElements,
        suggestions,
      };

      return responseBuilder.success(diagnosis, sessionManager.buildMeta(session));
    }
  },
});

export const smartNavigate = createTool({
  name: "smart_navigate",
  description:
    "`<use_case>Smart page interaction</use_case> Navigate to a URL with smart waiting. After navigation, waits for the page to load AND collects DOM snapshot to help AI understand what's on the page. Returns url, title, elementCount, availableElements[].`",
  inputSchema: z.object({
    url: z.string().describe("URL to navigate to"),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle", "commit"])
      .optional()
      .default("networkidle")
      .describe("When to consider navigation complete"),
    timeout: z
      .number()
      .optional()
      .default(30000)
      .describe("Timeout in milliseconds"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.page;

    try {
      await page.goto(input.url, {
        waitUntil: input.waitUntil,
        timeout: input.timeout,
      });

      // After navigation, collect page context
      const [title, pageText, domSnapshot] = await Promise.all([
        page.title().catch(() => "unknown"),
        page.evaluate(() => document.body?.innerText ?? "").catch(() => ""),
        page
          .evaluate(() => {
            const elements: Array<{
              tag: string;
              text: string;
              id: string;
              role: string;
            }> = [];
            const walker = document.createTreeWalker(
              document.documentElement,
              NodeFilter.SHOW_ELEMENT,
            );
            let node: Node | null;
            let count = 0;
            while ((node = walker.nextNode()) && count < 150) {
              const el = node as Element;
              const tag = el.tagName.toLowerCase();
              if (
                ["a", "button", "input", "h1", "h2", "h3", "label", "select", "textarea"].includes(tag) ||
                el.hasAttribute("role") ||
                el.hasAttribute("data-testid")
              ) {
                const text = (el.textContent ?? "").trim().slice(0, 100);
                if (text) {
                  elements.push({
                    tag,
                    text,
                    id: el.id,
                    role: el.getAttribute("role") ?? "",
                  });
                }
              }
              count++;
            }
            return elements;
          })
          .catch(() => []),
      ]);

      return responseBuilder.success(
        {
          url: page.url(),
          title,
          textPreview: pageText.slice(0, 3000),
          elementCount: domSnapshot.length,
          availableElements: domSnapshot.slice(0, 30),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: "NAVIGATION_FAILED",
        suggestions: [
          "Check if the URL is valid and accessible",
          "Verify network connectivity",
          "The page may require authentication",
        ],
      });
    }
  },
});
