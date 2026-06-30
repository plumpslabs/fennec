# Smart Tools 🔥

AI-powered page interaction tools with auto-diagnosis, form filling, validation, and visual testing capabilities.

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `smart_wait` | Smart element wait with auto-diagnosis on timeout (URL, DOM snapshot, visible text, screenshot) | selector, text?, state?, timeout?, sessionId? |
| `smart_navigate` | Navigate + auto-collect DOM snapshot, page text, and available elements after load | url, waitUntil?, timeout?, sessionId? |
| `smart_fill_form` | Auto-detect ALL form fields, fill by label/name/placeholder, optionally submit | fields, submitAfter?, submitSelector?, sessionId? |
| `smart_validate_form` | Validate all form fields against HTML5 constraints + custom rules | customRules?, sessionId? |
| `browser_screenshot_annotated` | Screenshot with numbered badges on all interactive elements + `data-ai-index` for clicking | format?, fullPage?, sessionId? |
| `browser_screenshot_export` | Screenshot + bounding box highlights exported as standalone HTML file | format?, sessionId? |
| `browser_screenshot_diff` | Compare current page against baseline — detect added/removed/changed elements, export diff HTML | baseline, format?, label?, sessionId? |

## Smart Wait Auto-Diagnosis

When `smart_wait` times out, it automatically collects:

- URL before and after wait (detect page redirects)
- Page title
- DOM snapshot (200 elements)
- `document.body.innerText`
- JPEG screenshot
- Similar element detection (fuzzy text match)
- Available clickable elements list

This helps the AI diagnose why the element wasn't found.

## Smart Form Filling

`smart_fill_form` has a 3-phase pipeline:

1. **Detect**: `detectFormFields()` scans for ALL inputs, selects, textareas (excludes hidden/submit/button/reset/image)
2. **Match**: `matchField()` tries exact match → partial match on: label, name, id, placeholder, aria-label, data-testid
3. **Fill**: `fillField()` uses `resolveSelector()` (ARIA → testid → text → CSS → XPath), falls back to attribute selectors

## Visual Testing Pipeline

```typescript
// Step 1: Capture baseline screenshot + elements (use browser_screenshot_annotated
// which returns both base64 and elements — required by the diff tool)
const baseline = await toolRegistry.call("browser_screenshot_annotated", {});
// Returns: { base64, elements: [{index, tag, text, boundingBox}], ... }

// Step 2: Do something (navigate, click, fill form)
await toolRegistry.call("browser_click", { selector: "#submit" });

// Step 3: Diff against baseline — uses baseline.base64 for 'before' screenshot
const diff = await toolRegistry.call("browser_screenshot_diff", {
  baseline: {
    elements: baseline.elements,
    screenshot: baseline.base64
  },
  label: "After clicking submit"
});
// Returns: { filePath: "...", summary: { total, added, removed, changed, unchanged }, changes: [...] }
```

## Examples

```typescript
// Smart fill form
const form = await toolRegistry.call("smart_fill_form", {
  fields: {
    "email": "user@test.com",
    "password": "secret123",
    "country": "US"
  },
  submitAfter: true
});
// Returns: { formFound, fieldsFilled, unmatchedFields, submitted, availableFields }

// Validate form before submit
const validation = await toolRegistry.call("smart_validate_form", {
  customRules: {
    "email": { type: "email", required: true },
    "age": { type: "number", min: 18 }
  }
});
// Returns: { valid: bool, validFields: N, invalidFields: N, fieldResults: [...] }

// Annotated screenshot — click by index
const shot = await toolRegistry.call("browser_screenshot_annotated", {});
// elements[0].index = 0 → click with: browser_click({ selector: "[data-ai-index='0']" })

// Smart navigate — auto-collects page context
const nav = await toolRegistry.call("smart_navigate", {
  url: "https://example.com/login"
});
// Returns: { url, title, textPreview, elementCount, availableElements: [...] }
```

## Diff Element Matching

The screenshot diff engine matches elements between baseline and current state using proximity matching (position within 30px). Elements are classified as:

| Status | Color | Description |
|--------|-------|-------------|
| **Added** | 🟢 Green | Element exists in current page but not in baseline |
| **Removed** | 🔴 Red | Element existed in baseline but not in current page |
| **Changed** | 🟠 Orange | Element exists in both but position/size/text changed |
| **Unchanged** | ⚪ Dimmed | Element is the same in both states |
