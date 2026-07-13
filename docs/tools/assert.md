# Assert Tools

Token-efficient, structured assertions for AI-driven verification. Unlike `browser_screenshot` + vision, assertions return a small `{ passed, reason, actual, expected }` payload — cheap to reason about and easy to branch on.

## Tools

| Tool             | Description                                         | Parameters                                                                |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| `browser_assert` | Assert page/element state with structured pass/fail | name, type, selector?, url?, text?, value?, expected?, attribute?, count? |

## Assertion Types

| `type`                 | Meaning                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `page-url`             | Current URL matches `expected` (string or regex literal)        |
| `url-contains`         | Current URL contains `expected`                                 |
| `element-exists`       | At least one element matches `selector`                         |
| `element-text-equals`  | First match's text equals `expected`                            |
| `element-value-equals` | First input's value equals `expected`                           |
| `count-equals`         | Number of matches equals `count`                                |
| `exists-with-attr`     | First match has `attribute` (and equals `expected` if provided) |

## Examples

```typescript
// Assert the login succeeded by checking the URL
await toolRegistry.call('browser_assert', {
  name: 'redirected to dashboard',
  type: 'page-url',
  expected: 'https://app.example.com/dashboard',
});
// → { passed: true, reason: 'URL matches' }

// Assert a form error is visible
await toolRegistry.call('browser_assert', {
  name: 'email error shown',
  type: 'element-text-equals',
  selector: '#email-error',
  expected: 'Invalid email',
});
// → { passed: false, reason: "Text = \"\" !== \"Invalid email\"", actual: "" }
```
