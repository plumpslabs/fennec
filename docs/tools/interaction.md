# Interaction Tools

Tools for clicking, typing, selecting, and other element interactions.

## Tools

| Tool                  | Description            | Parameters                                 |
| --------------------- | ---------------------- | ------------------------------------------ |
| `browser_click`       | Click an element       | selector, button?, clickCount?, sessionId? |
| `browser_type`        | Type text into input   | selector, text, delay?, clear?, sessionId? |
| `browser_select`      | Select dropdown option | selector, value, sessionId?                |
| `browser_hover`       | Hover over element     | selector, sessionId?                       |
| `browser_scroll`      | Scroll page/element    | x?, y?, selector?, direction?, sessionId?  |
| `browser_press_key`   | Press keyboard key     | key, modifiers?, sessionId?                |
| `browser_focus`       | Focus on element       | selector, sessionId?                       |
| `browser_clear`       | Clear input field      | selector, sessionId?                       |
| `browser_upload_file` | Upload file(s)         | selector, filePaths, sessionId?            |
| `browser_drag_drop`   | Drag element to target | sourceSelector, targetSelector, sessionId? |

## Examples

```typescript
// Click an element
await toolRegistry.call('browser_click', {
  selector: 'button#submit',
  button: 'left',
});

// Type text with delay to simulate human typing
await toolRegistry.call('browser_type', {
  selector: "input[name='email']",
  text: 'user@example.com',
  delay: 50,
});
```
