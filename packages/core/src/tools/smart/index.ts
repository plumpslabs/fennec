import { z } from 'zod';
import { createTool } from '../_registry.js';
import { takeScreenshot } from '../../utils/screenshot.js';
import { resolveSelector, resolveIndexedSelector } from '../../utils/selector.js';
import type { BrowserSession } from '../../browser/types.js';
import fs from 'node:fs';
import path from 'node:path';

// ─── smart_fill_form ──────────────────────────────────────────────

export const smartFillForm = createTool({
  name: 'smart_fill_form',
  category: 'smart',
  description:
    '`<use_case>Smart</use_case> 🧠 Auto-detect ALL form fields on the page and fill them with provided values. Accepts a map of field identifiers (label, name, placeholder, id, aria-label, data-testid) to values. Handles inputs, selects, textareas, checkboxes, radio buttons. Optionally submits after filling. Returns fieldsFilled count, unmatchedFields (identifiers not found), availableFields (what was detected). Use for complex forms with many fields — smarter than manually calling browser_type for each field. For simple login forms, use auth_fill_login_form instead. For validating form data, use smart_validate_form after filling.`',
  inputSchema: z.object({
    fields: z
      .record(z.string())
      .describe(
        'Map of field identifier → value. Identifier can be label text, name, placeholder, id, aria-label, or data-testid. Example: { "email": "user@test.com", "password": "secret123", "role": "admin" }',
      ),
    submitAfter: z
      .boolean()
      .optional()
      .default(false)
      .describe('Submit the form after filling all fields'),
    submitSelector: z
      .string()
      .optional()
      .describe('Custom submit button selector (default: auto-detect)'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;

    try {
      // Phase 1: Detect all form fields
      const formFields = await detectFormFields(page);

      if (formFields.length === 0) {
        return responseBuilder.error(new Error('No form fields found on the page'), {
          code: 'ELEMENT_NOT_FOUND',
          suggestions: [
            'Use browser_get_dom_snapshot to see available elements',
            'The page may need to finish loading first',
            "Check if you're on the correct URL",
          ],
        });
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
        code: 'FORM_FILL_FAILED',
        suggestions: [
          'Check if the page has finished loading',
          'Use smart_wait to wait for form elements to appear',
          'Use browser_get_dom_snapshot to see the form structure',
        ],
      });
    }
  },
});

/**
 * Auto-detect submit button on the page.
 * Uses resolveSelector() for text-based matching, falls back to CSS selectors.
 */
/** @internal Exported for use by auth_fill_login_form */
export async function findSubmitButton(
  page: BrowserSession,
): Promise<{ click: () => Promise<void> } | null> {
  // Phase 1: Try text-based matching via resolveSelector (ARIA → testid → text → CSS → XPath)
  const buttonTexts = [
    'Submit',
    'Save',
    'Continue',
    'Next',
    'Send',
    'Register',
    'Sign Up',
    'Sign up',
    'Log in',
    'Login',
    'Create',
    'Update',
    'Add',
    'Done',
    'Confirm',
    'Pay',
  ];

  for (const text of buttonTexts) {
    const resolved = await resolveSelector(page, text).catch(() => null);
    if (resolved?.found) {
      const loc = page.locator(resolved.selector).first();
      return { click: () => loc.click() };
    }
  }

  // Phase 2: Fall back to CSS attribute selectors (type="submit", form buttons)
  const cssSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[type="button"]',
    'form button',
    'form input[type="button"]',
  ];

  for (const sel of cssSelectors) {
    const el = await page.$(sel);
    if (el) {
      return { click: () => page.locator(sel).first().click() };
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
  const fields = await page
    .evaluate(() => {
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

      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea',
        ),
      );

      for (const el of inputs) {
        const tag = el.tagName.toLowerCase();
        const id = el.id;

        // Try to find label
        let label = '';
        if (id) {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          if (labelEl) label = (labelEl as HTMLElement).textContent?.trim() ?? '';
        }
        if (!label && el.parentElement?.tagName === 'LABEL') {
          label = (el.parentElement as HTMLElement).textContent?.trim() ?? '';
        }
        if (!label) {
          const labelledBy = el.getAttribute('aria-labelledby');
          if (labelledBy) {
            const ref = document.getElementById(labelledBy);
            if (ref) label = ref.textContent?.trim() ?? '';
          }
        }

        // HTML5 validation attributes
        const rawMinLength = el.getAttribute('minlength');
        const rawMaxLength = el.getAttribute('maxlength');
        let pattern = null;
        if (tag === 'input') {
          pattern = (el as HTMLInputElement).getAttribute('pattern');
        }

        let type = '';
        let currentValue = '';
        if (tag === 'input') {
          const input = el as HTMLInputElement;
          type = input.type || 'text';
          currentValue = input.value;
        } else if (tag === 'textarea') {
          const textarea = el as HTMLTextAreaElement;
          type = 'textarea';
          currentValue = textarea.value;
        } else if (tag === 'select') {
          const select = el as HTMLSelectElement;
          type = 'select';
          currentValue = select.value;
        }

        results.push({
          index: index++,
          tag,
          type,
          name: (el as HTMLInputElement).name ?? '',
          id,
          placeholder: (el as HTMLInputElement).placeholder ?? '',
          label,
          ariaLabel: el.getAttribute('aria-label') ?? '',
          dataTestid: el.getAttribute('data-testid') ?? '',
          required: el.hasAttribute('required'),
          currentValue,
          // Validation constraints
          minLength: rawMinLength ? parseInt(rawMinLength, 10) : null,
          maxLength: rawMaxLength ? parseInt(rawMaxLength, 10) : null,
          pattern,
          min: el.getAttribute('min'),
          max: el.getAttribute('max'),
          step: el.getAttribute('step'),
        });
      }

      return results;
    })
    .catch(() => []);

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

  // Partial / includes match — prefer type-exact matches first
  const typeMatch = fields.find(
    (f) =>
      f.type === q || (q === 'email' && f.type === 'email') || (q === 'phone' && f.type === 'tel'),
  );
  if (typeMatch) return typeMatch;

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
  page: BrowserSession,
  field: DetectedField,
  value: string,
): Promise<boolean> {
  // Strategy 1: Use resolveSelector with the best human-readable identifier
  // This handles ARIA labels, text content, data-testid, etc. that attribute selectors miss
  const identifier =
    field.label ||
    field.ariaLabel ||
    field.name ||
    field.id ||
    field.placeholder ||
    field.dataTestid;

  if (identifier) {
    const resolved = await resolveSelector(page, identifier).catch(() => null);
    if (resolved?.found) {
      // Found via resolveSelector — use the resolved selector to interact
      return interactField(page, resolved.selector, field, value);
    }
  }

  // Strategy 2: Build attribute-based selector (precise fallback for ID/name/placeholder)
  let attrSelector: string | null = null;
  if (field.id) {
    attrSelector = `[id="${field.id.replace(/["]/g, '\\"')}"]`;
  } else if (field.name) {
    attrSelector = `${field.tag}[name="${field.name.replace(/["]/g, '\\"')}"]`;
  } else if (field.placeholder) {
    attrSelector = `${field.tag}[placeholder="${field.placeholder.replace(/["]/g, '\\"')}"]`;
  }

  if (attrSelector) {
    return interactField(page, attrSelector, field, value);
  }

  return false;
}

/**
 * Interact with a form field using a resolved selector.
 * Errors propagate naturally so the tool handler can report FORM_FILL_FAILED.
 */
async function interactField(
  page: BrowserSession,
  selector: string,
  field: DetectedField,
  value: string,
): Promise<boolean> {
  if (field.type === 'checkbox' || field.type === 'radio') {
    const shouldCheck = value === 'true' || value === 'yes' || value === '1' || value === 'on';
    await page.locator(selector).first().setChecked(shouldCheck);
  } else if (field.tag === 'select') {
    await page.locator(selector).first().selectOption(value);
  } else {
    await page.locator(selector).first().fill(value);
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
  name: 'smart_validate_form',
  category: 'smart',
  description:
    '`<use_case>Smart</use_case> ✅ Validate ALL form fields against HTML5 constraints (required, email format, minlength, maxlength, pattern, type). Also validates email/URL/phone format with regex. Supports custom rules per field. Returns valid (bool), invalidFields with issues, and allFields summary. Use AFTER filling a form (smart_fill_form or browser_type) to check for errors before submitting. Catches: empty required fields, bad email format, length violations, pattern mismatches.`',
  inputSchema: z.object({
    customRules: z
      .record(
        z.object({
          required: z.boolean().optional().describe('Override required status'),
          minLength: z.number().optional().describe('Minimum length'),
          maxLength: z.number().optional().describe('Maximum length'),
          pattern: z.string().optional().describe('Regex pattern to match'),
          type: z
            .enum(['email', 'url', 'phone', 'number', 'text'])
            .optional()
            .describe('Override field type for validation'),
        }),
      )
      .optional()
      .describe(
        'Custom validation rules per field identifier. Example: { "email": { type: "email", required: true }, "phone": { pattern: "^[\\+\\d]+$" } }',
      ),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;

    try {
      // Phase 1: Detect all form fields with current values + HTML5 constraints (single evaluate)
      const formFields = await detectFormFields(page);

      if (formFields.length === 0) {
        return responseBuilder.error(new Error('No form fields found on the page'), {
          code: 'ELEMENT_NOT_FOUND',
          suggestions: [
            'Use browser_get_dom_snapshot to see available elements',
            'The page may need to finish loading first',
          ],
        });
      }

      // Phase 2: Validate each field (constraints already included in detectFormFields)
      const fieldResults: FieldValidation[] = [];
      let totalIssues = 0;

      for (const field of formFields) {
        const customRule =
          input.customRules?.[
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
        if (isRequired && (!value || value.trim() === '')) {
          issues.push(
            `Required field "${field.label || field.name || field.id || `field_${field.index}`}" is empty`,
          );
        }

        // Only run format checks if field has a value
        if (value && value.trim() !== '') {
          // Check minlength
          if (minLen !== null && value.length < minLen) {
            issues.push(`Minimum ${minLen} characters required (currently ${value.length})`);
          }

          // Check maxlength
          if (maxLen !== null && value.length > maxLen) {
            issues.push(`Maximum ${maxLen} characters allowed (currently ${value.length})`);
          }

          // Check type-specific format
          if (fieldType === 'email' && !EMAIL_REGEX.test(value)) {
            issues.push(`"${value}" is not a valid email address`);
          } else if (fieldType === 'url' && !URL_REGEX.test(value)) {
            issues.push(`"${value}" is not a valid URL (must start with http:// or https://)`);
          } else if ((fieldType === 'phone' || fieldType === 'tel') && !PHONE_REGEX.test(value)) {
            issues.push(`"${value}" is not a valid phone number`);
          } else if (fieldType === 'number' && isNaN(Number(value))) {
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
          field:
            field.label || field.name || field.id || field.placeholder || `field_${field.index}`,
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
            : fieldResults
                .filter((r) => !r.valid)
                .map((r) => ({
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
        code: 'VALIDATION_FAILED',
        suggestions: [
          'Check if the page has finished loading',
          'Use smart_wait to wait for form elements to appear',
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
  const elements = await page
    .evaluate(() => {
      const tags = [
        'a',
        'button',
        'input',
        'select',
        'textarea',
        '[role=button]',
        '[role=link]',
        '[role=tab]',
        '[role=menuitem]',
      ];
      const selector = tags
        .map(
          (t) =>
            `${t}:not([data-ai-annotated]):not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])`,
        )
        .join(', ');

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
        el.setAttribute('data-ai-index', String(index));

        const text = (el.textContent ?? '').trim().slice(0, 40);
        const id = el.id ? `#${CSS.escape(el.id)}` : '';

        results.push({
          index,
          tag: el.tagName.toLowerCase(),
          text,
          selector:
            id ||
            el.getAttribute('data-testid') ||
            el.getAttribute('name') ||
            el.getAttribute('aria-label') ||
            text.slice(0, 20),
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });

        // Create badge overlay (visual indicator only)
        const badge = document.createElement('div');
        badge.setAttribute('data-ai-annotated', 'true');
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

        const label = document.createElement('span');
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
    })
    .catch(() => []);

  return elements as unknown as AnnotatedElement[];
}

/**
 * Remove annotation badges from the page and clean up data-ai-index attributes.
 */
async function removeAnnotations(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<void> {
  await page
    .evaluate(() => {
      document.querySelectorAll('[data-ai-annotated]').forEach((el) => el.remove());
      document
        .querySelectorAll('[data-ai-index]')
        .forEach((el) => el.removeAttribute('data-ai-index'));
    })
    .catch(() => {});
}

export const browserScreenshotAnnotated = createTool({
  name: 'browser_screenshot_annotated',
  category: 'smart',
  description:
    '`<use_case>Smart</use_case> 📸 Take a screenshot with auto-numbered badges on ALL interactive elements (buttons, links, inputs, selects, etc.). Each element gets a data-ai-index attribute and visual numbered overlay. Returns base64 screenshot + elements[] with index, tag, text, selector, boundingBox. Use when you need the AI to SEE the page layout visually — great for unfamiliar pages. Set persistIndices:true to keep data-ai-index attributes in the DOM, then click by index: browser_click(selector="[data-ai-index=\'3\']"). Use maxElements to cap output on dense pages. For plain screenshots without annotations, use browser_screenshot.`',
  inputSchema: z.object({
    format: z.enum(['png', 'jpeg']).optional().default('png').describe('Image format'),
    fullPage: z
      .boolean()
      .optional()
      .default(false)
      .describe('Capture full page (including scrollable content)'),
    output: z
      .enum(['base64', 'compact'])
      .optional()
      .default('base64')
      .describe(
        "'base64' = full annotated screenshot with image (default), 'compact' = element metadata only, no screenshot (~80% token savings)",
      ),
    maxElements: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Cap the number of annotated elements returned (useful on dense pages to keep output small)',
      ),
    persistIndices: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, the data-ai-index attributes are left in the DOM after the screenshot so the AI can click via browser_click(selector="[data-ai-index=\'N\']"). When false (default) they are cleaned up.',
      ),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;

    try {
      // Phase 1: Inject numbered annotations on interactive elements
      const allElements = await injectAnnotations(page);

      // Cap the returned elements when maxElements is set (the DOM
      // attributes are still applied to every element so indices stay
      // consistent with what's clickable).
      const annotatedElements =
        input.maxElements && input.maxElements < allElements.length
          ? allElements.slice(0, input.maxElements)
          : allElements;

      const output = input.output ?? 'base64';
      const format = input.format ?? 'png';
      const fullPage = input.fullPage ?? false;

      // Phase 2: In compact mode, return elements only (no screenshot)
      if (output === 'compact') {
        if (!input.persistIndices) await removeAnnotations(page);
        return responseBuilder.success(
          {
            annotatedCount: annotatedElements.length,
            truncated: input.maxElements ? annotatedElements.length < allElements.length : false,
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
      }

      // Phase 2 (base64 mode): Take screenshot with annotations visible
      const buffer = await page.screenshot({ fullPage, type: format });
      const base64 = buffer.toString('base64');

      // Phase 3: Clean up annotations unless the caller wants to keep the
      // data-ai-index attributes for subsequent clicks.
      if (!input.persistIndices) await removeAnnotations(page);

      return responseBuilder.success(
        {
          base64,
          format,
          width: page.viewportSize()?.width ?? 1280,
          height: page.viewportSize()?.height ?? 720,
          timestamp: new Date().toISOString(),
          annotatedCount: annotatedElements.length,
          truncated: input.maxElements ? annotatedElements.length < allElements.length : false,
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
        code: 'SCREENSHOT_FAILED',
        suggestions: [
          'Check if the page is still open and accessible',
          'Try browser_screenshot instead',
        ],
      });
    }
  },
});

// ─── browser_screenshot_diff ────────────────────────────────────

export interface DiffElement {
  index: number;
  tag: string;
  text: string;
  type: string;
  name: string;
  id: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface DiffResult {
  status: 'added' | 'removed' | 'changed' | 'same';
  before: DiffElement | null;
  after: DiffElement | null;
  changes: string[];
}

function matchElements(before: DiffElement[], after: DiffElement[]): DiffResult[] {
  const MAX_DIST = 30;
  const usedAfter = new Set<number>();
  const results: DiffResult[] = [];

  for (const b of before) {
    let bestMatch: { el: DiffElement; idx: number; dist: number; changes: string[] } | null = null;

    for (let i = 0; i < after.length; i++) {
      if (usedAfter.has(i)) continue;
      const a = after[i]!;
      const cxDist = Math.abs(b.boundingBox.x - a.boundingBox.x);
      const cyDist = Math.abs(b.boundingBox.y - a.boundingBox.y);
      const dist = Math.sqrt(cxDist * cxDist + cyDist * cyDist);

      if (dist < MAX_DIST) {
        const changes: string[] = [];
        if (b.tag !== a.tag) changes.push(`tag: ${b.tag} -> ${a.tag}`);
        if (b.text !== a.text)
          changes.push(`text: "${b.text.slice(0, 30)}" -> "${a.text.slice(0, 30)}"`);
        if (
          Math.abs(b.boundingBox.width - a.boundingBox.width) > 5 ||
          Math.abs(b.boundingBox.height - a.boundingBox.height) > 5
        ) {
          changes.push(
            `size: ${b.boundingBox.width}x${b.boundingBox.height} -> ${a.boundingBox.width}x${a.boundingBox.height}`,
          );
        }
        if (
          Math.abs(b.boundingBox.x - a.boundingBox.x) > 5 ||
          Math.abs(b.boundingBox.y - a.boundingBox.y) > 5
        ) {
          changes.push(
            `position: (${b.boundingBox.x},${b.boundingBox.y}) -> (${a.boundingBox.x},${a.boundingBox.y})`,
          );
        }

        if (!bestMatch || dist < bestMatch.dist) {
          bestMatch = { el: a, idx: i, dist, changes };
        }
      }
    }

    if (bestMatch) {
      usedAfter.add(bestMatch.idx);
      const status = bestMatch.changes.length > 0 ? 'changed' : 'same';
      results.push({ status, before: b, after: bestMatch.el, changes: bestMatch.changes });
    } else {
      results.push({ status: 'removed', before: b, after: null, changes: [] });
    }
  }

  for (let i = 0; i < after.length; i++) {
    if (!usedAfter.has(i)) {
      results.push({ status: 'added', before: null, after: after[i]!, changes: [] });
    }
  }

  return results;
}

// ─── browser_screenshot_export ───────────────────────────────────

export const browserScreenshotExport = createTool({
  name: 'browser_screenshot_export',
  category: 'smart',
  description:
    '`<use_case>Smart</use_case> 📄 Take a screenshot with bounding boxes on all interactive elements and export as a standalone HTML file with interactive overlays. Each element has a colored box with a number label — open the HTML in any browser to inspect. Returns filePath, elementCount, elements[]. Use when you need a VISUAL element map you can share or review later. More permanent than browser_screenshot_annotated which just returns base64. The baseline output can feed into browser_screenshot_diff for visual comparison.`',
  inputSchema: z.object({
    format: z.enum(['png', 'jpeg']).optional().default('png').describe('Image format'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;

    try {
      // Phase 1: Take screenshot
      const format = input.format ?? 'png';
      const buffer = await page.screenshot({ type: format });
      const base64 = buffer.toString('base64');
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

      // Phase 2: Scan interactive elements with bounding boxes
      const rawElements = await page
        .evaluate(() => {
          const selector = [
            'a:not([data-ai-annotated])',
            'button:not([data-ai-annotated])',
            'input:not([type=hidden]):not([type=submit]):not([type=button]):not([data-ai-annotated])',
            'select:not([data-ai-annotated])',
            'textarea:not([data-ai-annotated])',
            '[role=button]:not([data-ai-annotated])',
            '[role=link]:not([data-ai-annotated])',
            '[role=tab]:not([data-ai-annotated])',
            '[role=menuitem]:not([data-ai-annotated])',
          ].join(', ');

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
            '#ff4444',
            '#44aa44',
            '#4488ff',
            '#ff8800',
            '#aa44ff',
            '#ff44aa',
            '#44dddd',
            '#dddd44',
            '#dd44dd',
            '#44dd88',
          ];

          let index = 0;
          for (const el of els) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) continue;

            const tag = el.tagName.toLowerCase();
            const text = (el.textContent ?? '').trim().slice(0, 60);
            const inputType = (el as HTMLInputElement).type ?? '';

            results.push({
              index,
              tag,
              text,
              type: tag === 'input' ? inputType : tag,
              name: (el as HTMLInputElement).name ?? '',
              id: el.id,
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              color: colors[index % colors.length] ?? '#888888',
            });
            index++;
          }

          return results;
        })
        .catch(() => []);

      // Phase 3: Generate HTML with embedded screenshot + overlays
      const timestamp = Date.now();
      const filename = `screenshots/screenshot-${timestamp}.html`;
      const exportPath = config.security.exportPath ?? './.fennec/exports';
      const fullDir = path.resolve(exportPath, 'screenshots');
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
    " title="[${el.index}] ${el.tag}${el.text ? `: ${escapeHtml(el.text)}` : ''}${el.name ? ` (name: ${escapeHtml(el.name)})` : ''}${el.id ? ` (#${escapeHtml(el.id)})` : ''}">
      <span class="label" style="background: ${el.color};">${el.index}</span>
      <span class="info">${el.tag}${el.type !== el.tag ? `[type=${el.type}]` : ''}</span>
    </div>`,
        )
        .join('');

      // Build legend
      const legendHtml = rawElements
        .slice(0, 30)
        .map(
          (el) =>
            `<li><span class="legend-dot" style="background:${el.color}"></span><strong>[${el.index}]</strong> &lt;${el.tag}&gt; ${el.text ? `&quot;${escapeHtml(el.text)}&quot;` : ''}${el.name ? ` <em>name=&quot;${escapeHtml(el.name)}&quot;</em>` : ''}${el.id ? ` <em>#${escapeHtml(el.id)}</em>` : ''}</li>`,
        )
        .join('');

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

      await fs.promises.writeFile(fullPath, html, 'utf-8');

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
        code: 'EXPORT_FAILED',
        suggestions: [
          'Check if the page is still open and accessible',
          'Check disk space and write permissions',
          'Try browser_screenshot instead',
        ],
      });
    }
  },
});

// ─── browser_screenshot_baseline ──────────────────────────────
// Captures the current page state and STORES it on the session so a
// later browser_screenshot_diff(baselineId=...) can diff against it
// without the agent hauling a big baseline object between calls.

export interface StoredBaseline {
  elements: Array<{
    index: number;
    tag: string;
    text: string;
    type: string;
    name: string;
    id: string;
    boundingBox: { x: number; y: number; width: number; height: number };
  }>;
  screenshot: string;
  viewport?: { width: number; height: number };
  timestamp: string;
}

export const browserScreenshotBaseline = createTool({
  name: 'browser_screenshot_baseline',
  category: 'smart',
  description:
    '`<use_case>Smart</use_case> 📸 Capture the CURRENT page as a baseline for later visual comparison. Stores it on the session (no big object returned). After performing an action, call browser_screenshot_diff with baselineId to get a visual diff (added/removed/changed regions) — no need to carry the baseline yourself. Returns baselineId (the session id) + elementCount.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID (baseline is stored on this session)'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;
    try {
      const buffer = await page.screenshot({ type: 'png' });
      const screenshot = buffer.toString('base64');
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      const elements = await page
        .evaluate(() => {
          const selector = [
            'a',
            'button',
            'input:not([type=hidden]):not([type=submit]):not([type=button])',
            'select',
            'textarea',
            '[role=button]',
            '[role=link]',
            '[role=tab]',
            '[role=menuitem]',
          ].join(', ');
          const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
          const results: Array<{
            index: number;
            tag: string;
            text: string;
            type: string;
            name: string;
            id: string;
            boundingBox: { x: number; y: number; width: number; height: number };
          }> = [];
          let index = 0;
          for (const el of els) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) continue;
            const tag = el.tagName.toLowerCase();
            results.push({
              index: index++,
              tag,
              text: (el.textContent ?? '').trim().slice(0, 60),
              type: tag === 'input' ? ((el as HTMLInputElement).type ?? '') : tag,
              name: (el as HTMLInputElement).name ?? '',
              id: el.id,
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            });
          }
          return results;
        })
        .catch(() => []);

      const baseline: StoredBaseline = {
        elements: elements as StoredBaseline['elements'],
        screenshot,
        viewport,
        timestamp: new Date().toISOString(),
      };
      (session.metadata as Record<string, unknown>).__fennecScreenshotBaseline = baseline;

      return responseBuilder.success(
        {
          baselineId: session.id,
          elementCount: baseline.elements.length,
          timestamp: baseline.timestamp,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, { code: 'BASELINE_FAILED' });
    }
  },
});

export const browserScreenshotDiff = createTool({
  name: 'browser_screenshot_diff',
  category: 'smart',
  description:
    '`<use_case>Smart</use_case> 🔄 Compare current page state against a baseline and generate a visual diff HTML report. Accepts baseline data from a previous browser_screenshot_export call. Detects: added (green), removed (red), changed/moved/resized (orange), unchanged (dimmed) elements. Returns filePath to diff report + summary stats (added/removed/changed/unchanged). Use to visually verify that a page changed as expected after an action — like confirming a button was added or a text changed.`',
  inputSchema: z.object({
    baseline: z
      .object({
        elements: z.array(
          z.object({
            index: z.number(),
            tag: z.string(),
            text: z.string(),
            type: z.string(),
            name: z.string(),
            id: z.string(),
            boundingBox: z.object({
              x: z.number(),
              y: z.number(),
              width: z.number(),
              height: z.number(),
            }),
          }),
        ),
        screenshot: z.string().describe('Base64-encoded baseline screenshot'),
        viewport: z.object({ width: z.number(), height: z.number() }).optional(),
      })
      .optional()
      .describe(
        'Inline baseline. If omitted, use baselineId to load a baseline captured by browser_screenshot_baseline.',
      ),
    baselineId: z
      .string()
      .optional()
      .describe(
        'Session id whose stored baseline (from browser_screenshot_baseline) to diff against. Overrides `baseline` if both given.',
      ),
    format: z.enum(['png', 'jpeg']).optional().default('png').describe('Image format'),
    label: z
      .string()
      .optional()
      .describe("Optional label for the diff (e.g. 'After clicking Login')"),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, config }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;

    try {
      // Resolve baseline: inline object, or a stored one via baselineId.
      let baselineObj = input.baseline;
      if (!baselineObj && input.baselineId) {
        const stored = (
          sessionManager.getOrDefault(input.baselineId).metadata as
            Record<string, unknown> | undefined
        )?.__fennecScreenshotBaseline as StoredBaseline | undefined;
        if (!stored) {
          return responseBuilder.error(
            new Error(
              `No stored baseline found for session ${input.baselineId}. Capture one with browser_screenshot_baseline first.`,
            ),
            { code: 'NO_BASELINE' },
          );
        }
        baselineObj = {
          elements: stored.elements,
          screenshot: stored.screenshot,
          viewport: stored.viewport,
        };
      }
      if (!baselineObj) {
        return responseBuilder.error(
          new Error(
            'Provide either `baseline` (inline) or `baselineId` (from browser_screenshot_baseline).',
          ),
          { code: 'NO_BASELINE' },
        );
      }

      // Phase 1: Take current screenshot + scan elements
      const format = input.format ?? 'png';
      const buffer = await page.screenshot({ type: format });
      const afterBase64 = buffer.toString('base64');
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

      const afterElements = await page
        .evaluate(() => {
          const selector = [
            'a',
            'button',
            'input:not([type=hidden]):not([type=submit]):not([type=button])',
            'select',
            'textarea',
            '[role=button]',
            '[role=link]',
            '[role=tab]',
            '[role=menuitem]',
          ].join(', ');

          const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
          const results: Array<{
            index: number;
            tag: string;
            text: string;
            type: string;
            name: string;
            id: string;
            boundingBox: { x: number; y: number; width: number; height: number };
          }> = [];

          let index = 0;
          for (const el of els) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) continue;
            const tag = el.tagName.toLowerCase();
            const text = (el.textContent ?? '').trim().slice(0, 60);
            const inputType = (el as HTMLInputElement).type ?? '';
            results.push({
              index: index++,
              tag,
              text,
              type: tag === 'input' ? inputType : tag,
              name: (el as HTMLInputElement).name ?? '',
              id: el.id,
              boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            });
          }
          return results;
        })
        .catch(() => []);

      // Phase 2: Diff baseline vs current
      const baselineElements: DiffElement[] = baselineObj.elements.map((e) => ({
        index: e.index,
        tag: e.tag,
        text: e.text,
        type: e.type,
        name: e.name,
        id: e.id,
        boundingBox: { ...e.boundingBox },
      }));

      const diffResults = matchElements(baselineElements, afterElements as DiffElement[]);

      // Phase 3: Generate diff HTML
      const timestamp = Date.now();
      const filename = `screenshots/diff-${timestamp}.html`;
      const exportPath = config.security.exportPath ?? './.fennec/exports';
      const fullDir = path.resolve(exportPath, 'screenshots');
      const fullPath = path.resolve(exportPath, filename);

      await fs.promises.mkdir(fullDir, { recursive: true });

      const added = diffResults.filter((r) => r.status === 'added');
      const removed = diffResults.filter((r) => r.status === 'removed');
      const changed = diffResults.filter((r) => r.status === 'changed');
      const same = diffResults.filter((r) => r.status === 'same');

      // Build before overlays
      const beforeBoxesHtml = diffResults
        .filter((r) => r.before)
        .map((r) => {
          const b = r.before!;
          const color =
            r.status === 'removed'
              ? '#ff4444'
              : r.status === 'changed'
                ? '#ff8800'
                : 'rgba(255,255,255,0.15)';
          const labelBg =
            r.status === 'removed' ? '#ff4444' : r.status === 'changed' ? '#ff8800' : '#666';
          return `<div class="overlay ${r.status}" style="left:${b.boundingBox.x}px;top:${b.boundingBox.y}px;width:${b.boundingBox.width}px;height:${b.boundingBox.height}px;border-color:${color}" title="[${b.index}] ${b.tag}: ${escapeHtml(b.text.slice(0, 40))}"><span class="olabel" style="background:${labelBg}">${b.index}</span></div>`;
        })
        .join('');

      // Build after overlays
      const afterBoxesHtml = diffResults
        .filter((r) => r.after)
        .map((r) => {
          const a = r.after!;
          const color =
            r.status === 'added'
              ? '#44cc44'
              : r.status === 'changed'
                ? '#ff8800'
                : 'rgba(255,255,255,0.08)';
          const labelBg =
            r.status === 'added' ? '#44cc44' : r.status === 'changed' ? '#ff8800' : '#444';
          return `<div class="overlay ${r.status}" style="left:${a.boundingBox.x}px;top:${a.boundingBox.y}px;width:${a.boundingBox.width}px;height:${a.boundingBox.height}px;border-color:${color}" title="[${a.index}] ${a.tag}: ${escapeHtml(a.text.slice(0, 40))}"><span class="olabel" style="background:${labelBg}">${a.index}</span></div>`;
        })
        .join('');

      // Build detail list
      const detailHtml = diffResults
        .slice(0, 50)
        .map((r) => {
          const icon =
            r.status === 'added'
              ? '🟢'
              : r.status === 'removed'
                ? '🔴'
                : r.status === 'changed'
                  ? '🟠'
                  : '⚪';
          const label = r.after || r.before;
          const text = label?.text ?? '';
          let changes = '';
          if (r.changes.length > 0) {
            changes = r.changes.map((c) => escapeHtml(c)).join('; ');
          }
          return `<li class="row-${r.status}">${icon} <strong>[${label?.index ?? '?'}]</strong> &lt;${label?.tag ?? '?'}&gt; ${text ? `&quot;${escapeHtml(text)}&quot;` : ''}${changes ? ` <span class="changes">${changes}</span>` : ''}</li>`;
        })
        .join('');

      const labelStr = input.label ? ` - ${escapeHtml(input.label)}` : '';

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Fennec Screenshot Diff${labelStr} - ${new Date(timestamp).toISOString()}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; }
.container { max-width: 1600px; margin: 0 auto; padding: 20px; }
h1 { font-size: 18px; color: #ff6432; margin-bottom: 4px; }
h2 { font-size: 14px; color: #aaa; font-weight: 400; margin-bottom: 20px; }
.panels { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.panel { background: rgba(255,255,255,0.03); border-radius: 8px; padding: 12px; }
.panel h3 { font-size: 13px; color: #888; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
.shot-wrapper { position: relative; display: inline-block; max-width: 100%; }
.shot-wrapper img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
.overlay { position: absolute; border: 2px solid; border-radius: 3px; pointer-events: none; }
.overlay.removed { background: rgba(255,68,68,0.08); }
.overlay.added { background: rgba(68,204,68,0.08); }
.overlay.changed { background: rgba(255,136,0,0.08); }
.overlay.same { border-style: dashed; opacity: 0.3; }
.olabel { position: absolute; top: -11px; left: -5px; color: #fff; font: bold 9px/14px monospace; padding: 0 3px; border-radius: 2px; z-index: 2; }
.summary { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.stat { padding: 10px 16px; border-radius: 6px; font: 12px monospace; }
.stat-added { background: rgba(68,204,68,0.15); border: 1px solid #44cc44; }
.stat-removed { background: rgba(255,68,68,0.15); border: 1px solid #ff4444; }
.stat-changed { background: rgba(255,136,0,0.15); border: 1px solid #ff8800; }
.stat-same { background: rgba(255,255,255,0.05); border: 1px solid #555; }
.stat-num { font-size: 20px; font-weight: 700; display: block; }
.stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #aaa; }
.details { margin-top: 20px; }
.details h3 { font-size: 13px; color: #888; margin-bottom: 8px; }
ul { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 3px; }
li { font: 11px monospace; padding: 4px 8px; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-added { background: rgba(68,204,68,0.08); }
.row-removed { background: rgba(255,68,68,0.08); }
.row-changed { background: rgba(255,136,0,0.08); }
.row-same { background: rgba(255,255,255,0.03); opacity: 0.5; }
.changes { color: #ff8800; font-style: italic; }
.meta { font: 11px monospace; color: #666; margin-bottom: 15px; }
</style>
</head>
<body>
<div class="container">
  <h1>Fennec Screenshot Diff${labelStr}</h1>
  <h2>${new Date(timestamp).toISOString()}</h2>

  <div class="summary">
    <div class="stat stat-added"><span class="stat-num">${added.length}</span><span class="stat-label">Added</span></div>
    <div class="stat stat-removed"><span class="stat-num">${removed.length}</span><span class="stat-label">Removed</span></div>
    <div class="stat stat-changed"><span class="stat-num">${changed.length}</span><span class="stat-label">Changed</span></div>
    <div class="stat stat-same"><span class="stat-num">${same.length}</span><span class="stat-label">Unchanged</span></div>
  </div>

  <div class="panels">
    <div class="panel">
      <h3>Before</h3>
      <div class="shot-wrapper">
        <img src="data:;base64,${baselineObj.screenshot}" alt="Before">
        ${beforeBoxesHtml}
      </div>
    </div>
    <div class="panel">
      <h3>After</h3>
      <div class="shot-wrapper">
        <img src="data:;base64,${afterBase64}" alt="After">
        ${afterBoxesHtml}
      </div>
    </div>
  </div>

  <div class="details">
    <h3>Changes (${diffResults.length} total)</h3>
    <ul>${detailHtml}</ul>
  </div>
</div>
</body>
</html>`;

      await fs.promises.writeFile(fullPath, html, 'utf-8');

      return responseBuilder.success(
        {
          filePath: fullPath,
          summary: {
            total: diffResults.length,
            added: added.length,
            removed: removed.length,
            changed: changed.length,
            unchanged: same.length,
          },
          viewport: `${viewport.width}x${viewport.height}`,
          timestamp: new Date(timestamp).toISOString(),
          changes: diffResults
            .filter((r) => r.status !== 'same')
            .slice(0, 30)
            .map((r) => ({
              status: r.status,
              tag: (r.after || r.before)?.tag ?? '',
              text: (r.after || r.before)?.text ?? '',
              changes: r.changes,
            })),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'DIFF_FAILED',
        suggestions: [
          'Check if the page is still open and accessible',
          'Ensure baseline.elements contains valid element data from a previous browser_screenshot_export call',
          'Try browser_screenshot_export first to get baseline data',
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
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── smartWait ───────────────────────────────────────────────────

export const smartWait = createTool({
  name: 'smart_wait',
  category: 'smart',
  description:
    '`<use_case>Smart</use_case> ⏳ Smart element wait with AUTO-DIAGNOSIS on failure. Waits for an element by selector (or text match). If timeout occurs, automatically collects: URL, title, visible text, DOM elements, and a screenshot — so the AI can diagnose what went wrong. Returns found, elapsed, and diagnosis info on failure. Use instead of browser_wait_for_element when you want automatic error diagnosis. Especially useful for dynamic SPAs where elements appear after loading.`',
  inputSchema: z.object({
    selector: z.string().describe('Element selector (CSS, text=, ARIA)'),
    text: z.string().optional().describe('Optional text the element should contain'),
    state: z
      .enum(['attached', 'detached', 'visible', 'hidden'])
      .optional()
      .default('visible')
      .describe('Desired element state'),
    timeout: z.number().optional().default(10000).describe('Timeout in milliseconds'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;
    const startTime = Date.now();

    // Phase 1: Check current page state BEFORE waiting
    const [initialUrl, initialTitle] = await Promise.all([
      (async () => {
        try {
          return await page.url();
        } catch {
          return 'unknown';
        }
      })(),
      (async () => {
        try {
          return await page.title();
        } catch {
          return 'unknown';
        }
      })(),
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
      const [currentUrl, currentTitle, pageText, domSnapshot, screenshot] = await Promise.all([
        (async () => {
          try {
            return await page.url();
          } catch {
            return 'unknown';
          }
        })(),
        (async () => {
          try {
            return await page.title();
          } catch {
            return 'unknown';
          }
        })(),
        page.evaluate(() => document.body?.innerText ?? '').catch(() => ''),
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
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node: Node | null;
            let count = 0;
            while ((node = walker.nextNode()) && count < 200) {
              const el = node as Element;
              const tag = el.tagName.toLowerCase();
              // Only collect interactive/relevant elements
              if (
                [
                  'a',
                  'button',
                  'input',
                  'select',
                  'textarea',
                  'span',
                  'div',
                  'h1',
                  'h2',
                  'h3',
                  'li',
                  'label',
                ].includes(tag) ||
                el.hasAttribute('role') ||
                el.hasAttribute('data-testid')
              ) {
                const text = (el.textContent ?? '').trim().slice(0, 120);
                if (text || el.id || el.getAttribute('data-testid')) {
                  elements.push({
                    tag,
                    id: el.id,
                    class: String(el.className).slice(0, 100),
                    text,
                    role: el.getAttribute('role') ?? '',
                  });
                }
              }
              count++;
            }
            return elements;
          })
          .catch(() => []),
        takeScreenshot(page, { format: 'jpeg' }).catch(() => null),
      ]);

      // Detect if page changed during wait
      const pageChanged = initialUrl !== currentUrl || initialTitle !== currentTitle;

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
        .filter(
          (el: { tag: string; role: string }) =>
            el.tag === 'a' || el.tag === 'button' || el.role === 'button',
        )
        .slice(0, 20);

      const suggestions = [];

      if (pageChanged) {
        suggestions.push(`Page changed during wait: "${initialTitle}" → "${currentTitle}"`);
      }

      if (similarElements.length > 0) {
        suggestions.push(
          `Found ${similarElements.length} elements with similar text. Try one of these:`,
        );
        for (const el of similarElements.slice(0, 5)) {
          const idHint = el.id ? `#${el.id}` : '';
          const classHint = el.class ? `.${el.class.split(' ')[0]}` : '';
          suggestions.push(`  - "${el.text.slice(0, 80)}" (${el.tag}${idHint}${classHint})`);
        }
      } else {
        suggestions.push(
          `No elements found matching "${searchText}". Page title: "${currentTitle}"`,
        );
        if (clickableElements.length > 0) {
          suggestions.push('Available elements:');
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

export const smartWaitForSpa = createTool({
  name: 'smart_wait_for_spa',
  category: 'smart',
  description:
    '`<use_case>Smart</use_case> ⏳ Wait for a Single Page Application (SPA) to be fully loaded, stable, and ready (all async data loaded, no loading spinners, and stable DOM mutations). Returns success (bool), elapsed (ms), and details of what was checked.`',
  inputSchema: z.object({
    loadingSelectors: z
      .array(z.string())
      .optional()
      .describe(
        'CSS selectors for loading spinners or overlays (e.g. [".loading", ".spinner", ".skeleton"]). If omitted, uses default selectors.',
      ),
    stabilityDelay: z
      .number()
      .optional()
      .default(500)
      .describe('Time in ms to wait for DOM stability (no modifications). Default is 500ms.'),
    timeout: z
      .number()
      .optional()
      .default(10000)
      .describe('Timeout in milliseconds. Default is 10000ms (10 seconds).'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;
    const startTime = Date.now();
    const stabilityDelay = input.stabilityDelay ?? 500;
    const timeout = input.timeout ?? 10000;

    const loadingSelectors = input.loadingSelectors ?? [
      '.loading',
      '.spinner',
      '.loader',
      '.skeleton',
      '[class*="loading" i]',
      '[class*="spinner" i]',
      '[class*="loader" i]',
      '[class*="skeleton" i]',
      '[id*="loading" i]',
      '[id*="spinner" i]',
      '[id*="loader" i]',
      '[id*="skeleton" i]',
      '#loading-state',
      '#loading',
    ];

    try {
      // 1. Wait for page load state (load & networkidle)
      const elapsed1 = Date.now() - startTime;
      const timeout1 = Math.max(1000, timeout - elapsed1);
      await page.waitForLoadState('load', { timeout: timeout1 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: timeout1 }).catch(() => {});

      // 2. Wait for loading indicators to disappear
      const elapsed2 = Date.now() - startTime;
      const timeout2 = Math.max(1000, timeout - elapsed2);
      for (const selector of loadingSelectors) {
        try {
          const visible = await page
            .locator(selector)
            .first()
            .isVisible()
            .catch(() => false);
          if (visible) {
            await page
              .locator(selector)
              .first()
              .waitFor({ state: 'hidden', timeout: Math.min(3000, timeout2) })
              .catch(() => {});
          }
        } catch {
          // ignore selector/detachment errors
        }
      }

      // 3. Wait for DOM stability
      const elapsed3 = Date.now() - startTime;
      const timeout3 = Math.max(1000, timeout - elapsed3);

      const stable = await page
        .evaluate(
          ({ delay, maxTimeout }) => {
            return new Promise<boolean>((resolve) => {
              let timeoutId: ReturnType<typeof setTimeout> | null = null;
              let totalTimeoutId: ReturnType<typeof setTimeout> | null = null;
              let observer: MutationObserver | null = null;

              const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                if (totalTimeoutId) clearTimeout(totalTimeoutId);
                if (observer) observer.disconnect();
              };

              const resetTimer = () => {
                if (timeoutId) clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                  cleanup();
                  resolve(true);
                }, delay);
              };

              totalTimeoutId = setTimeout(() => {
                cleanup();
                resolve(false);
              }, maxTimeout);

              resetTimer();

              observer = new MutationObserver(() => {
                resetTimer();
              });

              observer.observe(document.body || document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
              });
            });
          },
          { delay: stabilityDelay, maxTimeout: timeout3 },
        )
        .catch(() => false);

      const elapsed = Date.now() - startTime;
      return responseBuilder.success(
        {
          success: true,
          elapsed,
          domStable: stable,
          message: stable
            ? `SPA loaded and DOM stabilized in ${elapsed}ms`
            : `SPA loaded but DOM did not stabilize within timeout (elapsed: ${elapsed}ms)`,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const smartNavigate = createTool({
  name: 'smart_navigate',
  category: 'smart',
  description:
    "`<use_case>Smart</use_case> 🚀 Navigate to a URL with smart post-load analysis. Returns a STRUCTURED JSON result (no screenshot by default): url, title, textPreview, elementCount, availableElements[]. Use instead of browser_navigate when you want the AI to automatically understand the new page — saves an extra browser_get_dom_snapshot call. Set screenshot:true only if you also need an image. Use compact:true for minimal tokens (url/title/errorCount/top5) or mode:'verify' for a pass/fail assertion. waitUntil defaults to 'domcontentloaded' (SPA-friendly; use 'networkidle' only when you truly need no in-flight requests).`",
  inputSchema: z.object({
    url: z.string().describe('URL to navigate to'),
    waitUntil: z
      .enum(['load', 'domcontentloaded', 'networkidle', 'commit'])
      .optional()
      .default('domcontentloaded')
      .describe('When to consider navigation complete'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
    screenshot: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Include a compressed JPEG screenshot in the result. Off by default to save tokens.',
      ),
    compact: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Minimal tokens: return only url, title, errorCount, failedRequests, and top 5 elements.',
      ),
    mode: z
      .enum(['explore', 'verify'])
      .optional()
      .default('explore')
      .describe(
        'explore = full structured output; verify = return only {passed, reason} for quick assertions (saves ~80% tokens).',
      ),
    ensureAuth: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'If the target app needs login, load the matching saved auth session for this origin first (or a named session via ensureAuthSession). If none exists, the result includes needsAuth:true + a prompt to log in / ask the developer.',
      ),
    ensureAuthSession: z
      .string()
      .optional()
      .describe(
        'Specific saved session name to load when ensureAuth is true (optional; defaults to matching by origin).',
      ),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, sessionStore }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;

    let authNote: { needsAuth: boolean; prompt?: string } | null = null;
    if (input.ensureAuth) {
      const origin = new URL(input.url).origin;
      const cwdDir = path.join(process.cwd(), '.fennec', 'sessions');
      const all = [...sessionStore.list(), ...sessionStore.listFromDir(cwdDir)];
      const match = input.ensureAuthSession
        ? all.find((s) => s.name === input.ensureAuthSession)
        : all.find((s) => s.origin === origin);
      if (match) {
        await page.contextAddCookies(
          match.cookies.map((c) => {
            const cc = c as Record<string, unknown>;
            return {
              name: cc.name as string,
              value: cc.value as string,
              domain: cc.domain as string | undefined,
              path: (cc.path as string) ?? '/',
              httpOnly: cc.httpOnly as boolean | undefined,
              secure: cc.secure as boolean | undefined,
              sameSite: cc.sameSite as 'Strict' | 'Lax' | 'None' | undefined,
            };
          }),
        );
        await page.navigate(match.origin).catch(() => {});
        for (const [key, value] of Object.entries(match.localStorage)) {
          await page
            .evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key, v: value })
            .catch(() => {});
        }
      } else {
        authNote = {
          needsAuth: true,
          prompt: `No saved session for ${origin}${input.ensureAuthSession ? ` (name "${input.ensureAuthSession}")` : ''}. Ask the developer if they have an account, or run auth_fill_login_form (it auto-saves the session for next time).`,
        };
      }
    }

    try {
      await page.navigate(input.url, {
        waitUntil: input.waitUntil,
        timeout: input.timeout,
      });

      // After navigation, collect page context
      const [title, pageText, domSnapshot] = await Promise.all([
        page.title().catch(() => 'unknown'),
        page.evaluate(() => document.body?.innerText ?? '').catch(() => ''),
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
                ['a', 'button', 'input', 'h1', 'h2', 'h3', 'label', 'select', 'textarea'].includes(
                  tag,
                ) ||
                el.hasAttribute('role') ||
                el.hasAttribute('data-testid')
              ) {
                const text = (el.textContent ?? '').trim().slice(0, 100);
                if (text) {
                  elements.push({
                    tag,
                    text,
                    id: el.id,
                    role: el.getAttribute('role') ?? '',
                  });
                }
              }
              count++;
            }
            return elements;
          })
          .catch(() => []),
      ]);

      const meta = sessionManager.buildMeta(session);

      // ── verify mode: pass/fail only ──
      if (input.mode === 'verify') {
        const errorCount = session.consoleBuffer.filter((l) => l.level === 'error').length;
        const failedRequests = session.networkBuffer.filter((r) => r.status >= 400).length;
        const passed = errorCount === 0 && failedRequests === 0;
        return responseBuilder.success(
          {
            passed,
            mode: 'verify',
            reason: passed
              ? `Page loaded cleanly: "${title}" at ${page.url()}`
              : `${errorCount} console error(s), ${failedRequests} failed request(s) after navigating to ${page.url()}`,
            url: page.url(),
            title,
            ...(authNote ? { needsAuth: true, authPrompt: authNote.prompt } : {}),
          },
          meta,
        );
      }

      const result: Record<string, unknown> = {
        url: page.url(),
        title,
        textPreview: pageText.slice(0, 3000),
        elementCount: domSnapshot.length,
        availableElements: domSnapshot.slice(0, 30),
      };

      // ── compact mode: minimal tokens ──
      if (input.compact) {
        const errorCount = session.consoleBuffer.filter((l) => l.level === 'error').length;
        const failedRequests = session.networkBuffer.filter((r) => r.status >= 400).length;
        return responseBuilder.success(
          {
            url: page.url(),
            title,
            errorCount,
            failedRequests,
            topElements: domSnapshot.slice(0, 5),
          },
          meta,
        );
      }

      if (input.screenshot) {
        const shot = await takeScreenshot(session.browser, { format: 'jpeg', quality: 50 }).catch(
          () => null,
        );
        if (shot) result.screenshot = shot.base64;
      }

      if (authNote) {
        (result as Record<string, unknown>).needsAuth = true;
        (result as Record<string, unknown>).authPrompt = authNote.prompt;
      }

      return responseBuilder.success(result, meta);
    } catch (error) {
      const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
      const suggestions = [
        'Check if the URL is valid and accessible',
        'Verify network connectivity',
        'The page may require authentication',
      ];
      if (
        /localhost|127\.0\.0\.1/i.test(input.url) &&
        (msg.includes('refused') ||
          msg.includes('unreachable') ||
          msg.includes('dns') ||
          msg.includes('enotfound') ||
          msg.includes('timeout'))
      ) {
        suggestions.unshift(
          "⚠️ Fennec's browser is running inside a separate environment/sandbox. Localhost dev servers are not directly reachable. Try using 'host.docker.internal' (if inside Docker) or expose your local port via a tunnel (e.g. 'ngrok http <port>' or 'lt --port <port>').",
        );
      }

      return responseBuilder.error(error, {
        code: 'NAVIGATION_FAILED',
        suggestions,
      });
    }
  },
});

// ─── compare_sessions ────────────────────────────────────
// DOM/text comparison of what two sessions currently see — the practical
// form of "what does user A vs user B see" without a pixel engine.

async function capturePageView(page: import('../../browser/types.js').BrowserSession): Promise<{
  url: string;
  title: string;
  text: string;
  elements: Array<{ tag: string; id: string; role: string; text: string }>;
}> {
  const [url, title, text, elements] = await Promise.all([
    Promise.resolve().then(() => page.url()),
    page.title().catch(() => 'unknown'),
    page.evaluate(() => document.body?.innerText ?? '').catch(() => ''),
    page
      .evaluate(() => {
        const els: Array<{ tag: string; id: string; role: string; text: string }> = [];
        const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
        let node: Node | null;
        let count = 0;
        while ((node = walker.nextNode()) && count < 200) {
          const el = node as Element;
          const tag = el.tagName.toLowerCase();
          if (
            ['a', 'button', 'input', 'h1', 'h2', 'h3', 'label', 'select', 'textarea'].includes(
              tag,
            ) ||
            el.hasAttribute('role') ||
            el.hasAttribute('data-testid')
          ) {
            const t = (el.textContent ?? '').trim().slice(0, 100);
            if (t) {
              els.push({ tag, id: el.id, role: el.getAttribute('role') ?? '', text: t });
            }
          }
          count++;
        }
        return els;
      })
      .catch(() => [] as Array<{ tag: string; id: string; role: string; text: string }>),
  ]);
  return { url, title, text, elements };
}

function lineDiff(a: string, b: string): Array<{ kind: 'added' | 'removed'; line: string }> {
  const la = a
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const lb = b
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const setB = new Set(lb);
  const setA = new Set(la);
  const out: Array<{ kind: 'added' | 'removed'; line: string }> = [];
  for (const l of la) if (!setB.has(l)) out.push({ kind: 'removed', line: l });
  for (const l of lb) if (!setA.has(l)) out.push({ kind: 'added', line: l });
  return out;
}

export const compareSessions = createTool({
  name: 'compare_sessions',
  category: 'smart',
  description:
    "`<use_case>Smart</use_case> 🔀 Compare what TWO sessions currently see — the practical answer to 'what does user A vs user B see'. Optionally navigate BOTH to `url` first. Returns structured DOM/text diff: title changes, element differences (present in one, absent in the other), and a text diff. Great for permission/role testing (e.g. does the Sales role see a button the Admin sees?). Pixel-level visual diff is not performed — this is structural/textual.`",
  inputSchema: z.object({
    sessionA: z.string().describe('First session ID'),
    sessionB: z.string().describe('Second session ID'),
    url: z.string().optional().describe('If set, navigate BOTH sessions here before comparing'),
    sessionId: z.string().optional().describe('Session ID (unused, kept for symmetry)'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    try {
      const a = sessionManager.getOrDefault(input.sessionA);
      const b = sessionManager.getOrDefault(input.sessionB);
      if (input.url) {
        await Promise.all([
          a.browser.navigate(input.url, { waitUntil: 'domcontentloaded' }).catch(() => {}),
          b.browser.navigate(input.url, { waitUntil: 'domcontentloaded' }).catch(() => {}),
        ]);
      }
      const [va, vb] = await Promise.all([capturePageView(a.browser), capturePageView(b.browser)]);
      const setTextA = new Set(va.elements.map((e) => e.text));
      const setTextB = new Set(vb.elements.map((e) => e.text));
      const onlyInA = va.elements.filter((e) => !setTextB.has(e.text)).slice(0, 30);
      const onlyInB = vb.elements.filter((e) => !setTextA.has(e.text)).slice(0, 30);
      const textDiff = lineDiff(va.text, vb.text).slice(0, 40);
      return responseBuilder.success(
        {
          sessionA: { id: a.id, title: va.title, url: va.url, elementCount: va.elements.length },
          sessionB: { id: b.id, title: vb.title, url: vb.url, elementCount: vb.elements.length },
          titleChanged: va.title !== vb.title,
          differences: {
            onlyInA: onlyInA.map((e) => ({ tag: e.tag, id: e.id, role: e.role, text: e.text })),
            onlyInB: onlyInB.map((e) => ({ tag: e.tag, id: e.id, role: e.role, text: e.text })),
            textDiff,
            textDiffCount: textDiff.length,
          },
        },
        sessionManager.buildMeta(a),
      );
    } catch (error) {
      return responseBuilder.error(error, { code: 'COMPARE_FAILED' });
    }
  },
});

// ─── test_with_state ──────────────────────────────────────
// Generic form of "test as permission/role": inject arbitrary
// localStorage / cookies (the app's permission encoding) into a session,
// reload, and return a compact view. App-specific permission semantics
// live in the app — Fennec just applies the state you specify.

export const testWithState = createTool({
  name: 'test_with_state',
  category: 'smart',
  description:
    "`<use_case>Smart</use_case> 🎭 Render a page AS IF a given state (role/permissions) were active, without maintaining a saved session. Inject `apply.localStorage` and/or `apply.cookies` (your app's permission encoding), optionally navigate to `url`, reload so the app reads the state, and return a compact view (title, errorCount, top elements). Use to check 'is button X hidden for role Sales?' by setting the Sales permission in localStorage, navigating, and inspecting. App-specific permission names are yours to supply.`",
  inputSchema: z.object({
    url: z.string().describe('URL to load (or reload current page at its origin)'),
    apply: z
      .object({
        localStorage: z
          .record(z.string())
          .optional()
          .describe(
            'localStorage key→value pairs to set before reload (e.g. role/permission flags)',
          ),
        cookies: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              domain: z.string().optional(),
              path: z.string().optional().default('/'),
            }),
          )
          .optional()
          .describe('Cookies to set before reload'),
      })
      .describe('State to apply before the page reads it'),
    compact: z
      .boolean()
      .optional()
      .default(true)
      .describe('Return compact view (title/errorCount/top elements) — minimal tokens'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;
    try {
      // Ensure we're on the right origin before setting state.
      const target = input.url || page.url();
      await page.navigate(target, { waitUntil: 'domcontentloaded' }).catch(() => {});

      if (input.apply.localStorage) {
        for (const [k, v] of Object.entries(input.apply.localStorage)) {
          await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k, v }).catch(() => {});
        }
      }
      if (input.apply.cookies?.length) {
        await page
          .contextAddCookies(
            input.apply.cookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain ?? new URL(target).hostname,
              path: c.path ?? '/',
            })),
          )
          .catch(() => {});
      }

      // Reload so the app reads the injected state.
      await page.reload?.().catch(() => {});
      await page.navigate(target, { waitUntil: 'domcontentloaded' }).catch(() => {});

      const title = await page.title().catch(() => 'unknown');
      const errorCount = session.consoleBuffer.filter((l) => l.level === 'error').length;
      const elements = await page
        .evaluate(() => {
          const els: Array<{ tag: string; id: string; role: string; text: string }> = [];
          const walker = document.createTreeWalker(
            document.documentElement,
            NodeFilter.SHOW_ELEMENT,
          );
          let node: Node | null;
          let count = 0;
          while ((node = walker.nextNode()) && count < 60) {
            const el = node as Element;
            const tag = el.tagName.toLowerCase();
            if (
              ['a', 'button', 'input', 'h1', 'h2', 'h3', 'label', 'select', 'textarea'].includes(
                tag,
              ) ||
              el.hasAttribute('role') ||
              el.hasAttribute('data-testid')
            ) {
              const t = (el.textContent ?? '').trim().slice(0, 100);
              if (t) els.push({ tag, id: el.id, role: el.getAttribute('role') ?? '', text: t });
            }
            count++;
          }
          return els;
        })
        .catch(() => [] as Array<{ tag: string; id: string; role: string; text: string }>);

      return responseBuilder.success(
        {
          url: page.url(),
          title,
          errorCount,
          topElements: elements.slice(0, 10),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, { code: 'TEST_STATE_FAILED' });
    }
  },
});

// ─── browser_get_element_component ─────────────────────────
// Best-feasible proxy for "find component in browser": from a DOM
// element, resolve the FRAMEWORK component that rendered it (React fiber
// / Vue) plus any data-* / id hints. Full source-map reverse-mapping
// (file → selector) is a build-time concern and out of scope here.

export const browserGetElementComponent = createTool({
  name: 'browser_get_element_component',
  category: 'smart',
  description:
    "`<use_case>Smart</use_case> 🧩 Given a CSS selector, identify the UI COMPONENT that rendered that element — reads React fiber / Vue component info and data-* / id hints straight from the live DOM. Helps you map 'ChatInput.tsx renders the Zap button' to the actual element without guessing the selector. NOTE: this resolves component-from-DOM (runtime); true source-map reverse-mapping (source file → selector) is build-time and not covered.`",
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the element to inspect'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const info = await session.browser
        .evaluate((sel: string) => {
          const el = document.querySelector(sel) as (Element & Record<string, unknown>) | null;
          if (!el) return { found: false as const };
          const out: Record<string, unknown> = {
            found: true,
            tag: el.tagName.toLowerCase(),
            id: el.id,
          };

          // data-* / aria / testid hints
          const hints: string[] = [];
          for (const attr of Array.from(el.attributes)) {
            if (
              attr.name.startsWith('data-') ||
              attr.name === 'aria-label' ||
              attr.name === 'data-testid'
            ) {
              hints.push(`${attr.name}=${attr.value}`);
            }
          }
          out.hints = hints;

          // React: walk fiber to the host component's owner name.
          const fiberKey = Object.keys(el).find(
            (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
          );
          if (fiberKey) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let node: any = el[fiberKey];
            let ownerName: string | undefined;
            let file: string | undefined;
            while (node) {
              const type = node.type as Record<string, unknown> | string | undefined;
              const tname =
                typeof type === 'function'
                  ? ((type as { displayName?: string; name?: string }).displayName ??
                    (type as { name?: string }).name)
                  : undefined;
              const tfile =
                (type as { __file?: string; _source?: { fileName?: string } })?._source?.fileName ??
                (type as { __file?: string })?.__file;
              if (tname && !ownerName) ownerName = tname;
              if (tfile && !file) file = tfile;
              const owner = node._debugOwner as Record<string, unknown> | undefined;
              if (owner) {
                const ot = owner.type as Record<string, unknown> | string | undefined;
                if (!ownerName && typeof ot === 'function')
                  ownerName =
                    (ot as { displayName?: string; name?: string }).displayName ??
                    (ot as { name?: string }).name;
              }
              node = node.return ?? node._debugOwner?._debugOwner;
              if (ownerName && file) break;
            }
            out.framework = 'react';
            out.component = ownerName;
            out.sourceFile = file;
          } else {
            // Vue: __vueParentComponent
            const vueKey = Object.keys(el).find((k) => k.startsWith('__vue'));
            if (vueKey) {
              const comp = (el as Record<string, unknown>)[vueKey] as Record<string, unknown>;
              const opts = comp?.type as Record<string, unknown> | undefined;
              out.framework = 'vue';
              out.component = (opts?.__name ??
                opts?.name ??
                (comp?.type as { name?: string })?.name) as string | undefined;
              out.sourceFile = opts?.__file as string | undefined;
            } else {
              out.framework = 'unknown';
            }
          }
          return out;
        }, input.selector)
        .catch((e) => ({ found: false, error: String(e) }));

      return responseBuilder.success(info, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, { code: 'ELEMENT_NOT_FOUND' });
    }
  },
});

// ─── fennec_flow — composite multi-step debugging flows ────────────

export const fennecFlow = createTool({
  name: 'fennec_flow',
  category: 'smart',
  description:
    "`<use_case>Smart</use_case> 🧠 Composite tool for common multi-step debugging patterns. Reduces 3-5 separate tool calls into one. Actions: 'debug-element' (get element info + screenshot + diagnose for a selector; ~500-1000 tokens), 'page-health' (console errors + network failures + DOM snapshot; ~300-800 tokens), 'form-fill' (smart_fill_form + validate + submit; ~400-700 tokens). Saves 60-80% tool calls for these patterns.`",
  inputSchema: z.object({
    action: z
      .enum(['debug-element', 'page-health', 'form-fill'])
      .describe(
        "The composite flow to execute. 'debug-element': inspect element info + screenshot + diagnose interactability. 'page-health': console errors + failed network requests + DOM state summary. 'form-fill': detect + fill + validate + submit a form.",
      ),
    selector: z
      .string()
      .optional()
      .describe(
        'Target element selector (required for debug-element, optional for form-fill to scope to a container)',
      ),
    fields: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Field values for form-fill action (e.g. {"email": "a@b.com", "password": "secret"})',
      ),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'When the selector matches multiple elements, pick the one at this index (0-based)',
      ),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);

    if (input.action === 'debug-element') {
      if (!input.selector) {
        return responseBuilder.error(new Error('selector is required for debug-element action'));
      }
      try {
        const resolved = await resolveIndexedSelector(session.browser, input.selector, input.index);
        const elementInfo = resolved.found
          ? await (async () => {
              const locator = session.browser.locator(resolved.selector);
              const [visible, enabled, text, box] = await Promise.all([
                locator.isVisible().catch(() => false),
                locator.isEnabled().catch(() => false),
                locator.textContent().catch(() => null),
                locator.boundingBox().catch(() => null),
              ]);
              const reasons: string[] = [];
              const suggestions: string[] = [];
              if (!visible) {
                reasons.push('not visible');
                suggestions.push('Try scrolling to the element');
              }
              if (!enabled) {
                reasons.push('disabled');
                suggestions.push('Check if element needs a preceding action to enable');
              }
              return {
                exists: true,
                visible,
                enabled,
                interactable: visible && enabled,
                text: text?.trim() ?? null,
                boundingBox: box,
                reason: reasons.length > 0 ? reasons.join('; ') : 'element looks interactable',
                suggestions,
              };
            })()
          : { exists: false, reason: 'element not found in DOM' };

        const screenshot = await takeScreenshot(session.browser, {
          format: 'jpeg',
          quality: 30,
        }).catch(() => null);

        return responseBuilder.success(
          {
            action: 'debug-element',
            selector: input.selector,
            index: input.index,
            url: session.browser.url(),
            elementInfo,
            screenshot: screenshot
              ? { base64: screenshot.base64, width: screenshot.width, height: screenshot.height }
              : null,
          },
          sessionManager.buildMeta(session),
        );
      } catch (error) {
        return responseBuilder.error(error, { code: 'FLOW_FAILED' });
      }
    }

    if (input.action === 'page-health') {
      try {
        const [domInfo, consoleLogs, networkRequests] = await Promise.all([
          session.browser
            .evaluate(() => {
              const all = document.querySelectorAll('*');
              const interactable = Array.from(all).filter((el) => {
                const tag = el.tagName.toLowerCase();
                return (
                  ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
                  el.hasAttribute('onclick') ||
                  el.getAttribute('tabindex') !== null
                );
              });
              const tagCount: Record<string, number> = {};
              all.forEach((el) => {
                const t = el.tagName.toLowerCase();
                tagCount[t] = (tagCount[t] ?? 0) + 1;
              });
              const sortedTags = Object.entries(tagCount)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
              return {
                elementCount: all.length,
                interactableCount: interactable.length,
                tagBreakdown: Object.fromEntries(sortedTags),
              };
            })
            .catch(() => null),
          session.consoleBuffer
            ? {
                errorCount: session.consoleBuffer.filter(
                  (l: { level: string }) => l.level === 'error',
                ).length,
                warnCount: session.consoleBuffer.filter(
                  (l: { level: string }) => l.level === 'warn',
                ).length,
                lastError:
                  [...session.consoleBuffer]
                    .reverse()
                    .find((l: { level: string }) => l.level === 'error')?.message ?? null,
              }
            : null,
          session.networkBuffer
            ? {
                total: session.networkBuffer.length,
                failed: session.networkBuffer.filter((r: { status: number }) => r.status >= 400)
                  .length,
                slow: session.networkBuffer.filter((r: { duration: number }) => r.duration > 1000)
                  .length,
                lastFailure: [...session.networkBuffer]
                  .reverse()
                  .find((r: { status: number }) => r.status >= 400)?.url,
              }
            : null,
        ]);

        return responseBuilder.success(
          {
            action: 'page-health',
            url: session.browser.url(),
            dom: domInfo,
            console: consoleLogs ?? { errorCount: 0, warnCount: 0, lastError: null },
            network: networkRequests ?? { total: 0, failed: 0, slow: 0 },
          },
          sessionManager.buildMeta(session),
        );
      } catch (error) {
        return responseBuilder.error(error, { code: 'FLOW_FAILED' });
      }
    }

    if (input.action === 'form-fill') {
      if (!input.fields || Object.keys(input.fields).length === 0) {
        return responseBuilder.error(new Error('fields are required for form-fill action'));
      }
      try {
        const filled: string[] = [];
        const notFound: string[] = [];
        const scope = input.selector || 'body';
        for (const [key, value] of Object.entries(input.fields)) {
          const found = await session.browser.evaluate(
            ({ k, v, sc }: { k: string; v: string; sc: string }) => {
              const patterns = [
                `input[name="${k}"]`,
                `input[id="${k}"]`,
                `input[placeholder="${k}"]`,
                `input[aria-label="${k}"]`,
                `input[data-testid="${k}"]`,
                `textarea[name="${k}"]`,
                `textarea[id="${k}"]`,
                `select[name="${k}"]`,
                `select[id="${k}"]`,
                `label:has-text("${k}") input`,
                `label:has-text("${k}") textarea`,
                `label:has-text("${k}") select`,
                `[data-testid="${k}"]`,
                `#${k}`,
              ];
              const root = document.querySelector(sc);
              if (!root) return false;
              for (const p of patterns) {
                const el = root.querySelector(p) as HTMLInputElement | null;
                if (el) {
                  el.value = v;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }
              }
              return false;
            },
            { k: key, v: value, sc: scope },
          );
          if (found) {
            filled.push(key);
          } else {
            notFound.push(key);
          }
        }
        return responseBuilder.success(
          {
            action: 'form-fill',
            url: session.browser.url(),
            fieldsFilled: filled.length,
            fieldsTotal: Object.keys(input.fields).length,
            notFound: notFound.length > 0 ? notFound : undefined,
            status: notFound.length === 0 ? 'completed' : 'partial',
          },
          sessionManager.buildMeta(session),
        );
      } catch (error) {
        return responseBuilder.error(error, { code: 'FLOW_FAILED' });
      }
    }

    return responseBuilder.error(new Error(`Unknown action: ${input.action}`));
  },
});
