import { z } from 'zod';
import { createTool } from '../_registry.js';
import { resolveSelector } from '../../utils/selector.js';

export const browserAssert = createTool({
  name: 'browser_assert',
  category: 'devtools',
  description:
    "`<use_case>Test authoring</use_case> ✅ Assert the current page state without dumping the DOM. Returns { passed, reason } like smart_navigate mode:'verify', but with richer checks: element-exists, element-text-equals, value-equals, count-equals, exists-with-attr. Use to build assertions in a recorded test (recorder_start) or to verify UI after an action.",
  inputSchema: z.object({
    assertion: z
      .enum([
        'element-exists',
        'element-text-equals',
        'value-equals',
        'count-equals',
        'exists-with-attr',
        'url-matches',
        'url-param-equals',
        'text-present',
      ])
      .describe('Type of assertion to run'),
    selector: z
      .string()
      .optional()
      .describe(
        'Element selector (CSS / text= / role= / :has-text(), required for element/attribute assertions)',
      ),
    expected: z
      .string()
      .optional()
      .describe('Expected text/value/attribute-value/URL-pattern for assertions'),
    count: z.number().optional().describe('Expected element count for count-equals'),
    attribute: z
      .string()
      .optional()
      .describe(
        'Attribute name for exists-with-attr, or URL query param name for url-param-equals',
      ),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      let passed = false;
      let reason = '';
      let found = 0;

      if (input.assertion === 'url-matches') {
        const url = session.browser.url();
        const expected = input.expected ?? '';
        passed = url.includes(expected);
        reason = passed
          ? `URL matches pattern "${expected}" (current: "${url}")`
          : `URL "${url}" does not match pattern "${expected}"`;
      } else if (input.assertion === 'url-param-equals') {
        const url = session.browser.url();
        const parsed = new URL(url);
        const name = input.attribute ?? '';
        const value = parsed.searchParams.get(name);
        passed = value === (input.expected ?? '');
        reason = passed
          ? `URL parameter "${name}" matches "${input.expected}"`
          : `URL parameter "${name}" value "${value}" !== expected "${input.expected}"`;
      } else if (input.assertion === 'text-present') {
        const text = await session.browser
          .evaluate(() => document.body?.innerText ?? '')
          .catch(() => '');
        const expected = input.expected ?? '';
        passed = text.includes(expected);
        reason = passed
          ? `Text "${expected}" is present on the page`
          : `Text "${expected}" was not found on the page`;
      } else {
        if (!input.selector) {
          throw new Error(`selector is required for element assertion: ${input.assertion}`);
        }
        const resolved = await resolveSelector(session.browser, input.selector);
        const locator = session.browser.locator(resolved.selector);
        found = await locator.count();

        switch (input.assertion) {
          case 'element-exists':
            passed = found > 0;
            reason = passed ? `Found ${found} matching element(s)` : 'No matching element';
            break;
          case 'count-equals':
            passed = found === (input.count ?? 0);
            reason = passed
              ? `Count ${found} === expected ${input.count}`
              : `Count ${found} !== expected ${input.count}`;
            break;
          case 'element-text-equals': {
            const text =
              (await locator
                .first()
                .textContent()
                .catch(() => '')) ?? '';
            passed = text.trim() === (input.expected ?? '').trim();
            reason = passed
              ? `Text matches "${input.expected}"`
              : `Text "${text.trim()}" !== expected "${input.expected}"`;
            break;
          }
          case 'value-equals': {
            const value =
              (await locator
                .first()
                .inputValue()
                .catch(() => '')) ?? '';
            passed = value === (input.expected ?? '');
            reason = passed
              ? `Value matches "${input.expected}"`
              : `Value "${value}" !== expected "${input.expected}"`;
            break;
          }
          case 'exists-with-attr': {
            const attr = await locator
              .first()
              .evaluate(
                (el, attr) => (el as Element).getAttribute(attr as string),
                input.attribute ?? '',
              )
              .catch(() => null);
            if (input.expected === undefined) {
              passed = attr !== null;
              reason = passed
                ? `Attribute "${input.attribute}" present`
                : `Attribute "${input.attribute}" missing`;
            } else {
              passed = attr === input.expected;
              reason = passed
                ? `Attribute "${input.attribute}" === "${input.expected}"`
                : `Attribute "${input.attribute}" = "${attr}" !== "${input.expected}"`;
            }
            break;
          }
        }
      }

      return responseBuilder.success({
        passed,
        assertion: input.assertion,
        selector: input.selector,
        reason,
        found,
      });
    } catch (error) {
      return responseBuilder.error(error, { code: 'ASSERT_FAILED' });
    }
  },
});
