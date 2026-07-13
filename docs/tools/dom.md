# DOM Inspection Tools

Tools for inspecting and extracting page content, with full Shadow DOM support.

## Tools

| Tool                             | Description                                                                                                      | Parameters                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `browser_screenshot`             | Take a screenshot                                                                                                | fullPage?, selector?, format?, sessionId?                  |
| `browser_get_dom_snapshot`       | Get DOM snapshot with Shadow DOM                                                                                 | selector?, includeStyles?, includeShadowDom?, sessionId?   |
| `browser_get_accessibility_tree` | Get accessibility tree                                                                                           | selector?, sessionId?                                      |
| `browser_find_elements`          | Find elements by selector (CSS / `text=` / `:has-text()` / `role=` / `xpath=`) with Shadow DOM piercing fallback | selector, returnAttributes?, includeShadowDom?, sessionId? |
| `browser_get_element_info`       | Get element details                                                                                              | selector, sessionId?                                       |
| `browser_wait_for_element`       | Wait for element state                                                                                           | selector, state?, timeout?, sessionId?                     |
| `browser_get_page_text`          | Get visible page text                                                                                            | selector?, sessionId?                                      |
| `browser_get_page_title`         | Get page title                                                                                                   | sessionId?                                                 |
| `browser_get_meta`               | Get SEO/meta tags                                                                                                | sessionId?                                                 |

## Shadow DOM Support

Both `browser_get_dom_snapshot` and `browser_find_elements` support traversing into Shadow DOM trees. When `includeShadowDom: true` (default), the tools:

1. Traverse into `shadowRoot` of all custom elements
2. Include shadow DOM content in the serialized HTML output
3. Mark shadow DOM boundaries with `<!--shadow-root-->` comments in the HTML

```typescript
// Get full DOM including Shadow DOM
const snapshot = await toolRegistry.call('browser_get_dom_snapshot', {
  includeShadowDom: true,
});
// Returns: { html: "...<!--shadow-root-->...<!--/shadow-root-->...", elementCount, depth }

// Find elements that may be inside shadow DOM
const elements = await toolRegistry.call('browser_find_elements', {
  selector: '.my-class',
  includeShadowDom: true,
});
// Returns: { elements: [...], count: N }
```
