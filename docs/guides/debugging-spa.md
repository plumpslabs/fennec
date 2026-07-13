# Debugging Single-Page Applications

Single-Page Applications (SPAs) present unique debugging challenges: client-side routing, async data fetching, state management, and dynamic DOM updates. Fennec is designed to handle all of these.

## Common SPA Issues

### 1. Client-Side Routing

SPAs handle routing in the browser, so server logs won't show page transitions.

```javascript
// Watch for route changes
browser_wait_for_navigation({
  urlPattern: '/dashboard',
  timeout: 5000,
});

// Or check current route
browser_get_current_url();
// → { url: "http://localhost:5173/dashboard", ... }
```

### 2. Async Data Fetching

Most SPAs fetch data asynchronously after route changes.

```javascript
// Wait for network requests to complete
network_get_logs({ status: 500 });
network_get_failed_requests();

// Or intercept specific requests
network_get_logs({
  urlPattern: '/api/users',
  limit: 5,
});

// Check if data loaded correctly
browser_get_page_text({ selector: '.user-list' });
```

### 3. State Management Issues

```javascript
// Check for console errors (React errors, Vue warnings, etc.)
devtools_get_console_logs({ level: 'error' });

// Common React errors:
// "Cannot read properties of undefined" → missing data
// "Each child in a list should have a key" → rendering warnings
// "Warning: Maximum update depth exceeded" → infinite loop

// Check component state via evaluate
devtools_evaluate({
  expression: 'window.__store?.getState()',
});
```

## SPA Debugging Workflow

### Step 1: Check Route

```javascript
browser_get_current_url();
```

### Step 2: Check Network

```javascript
diagnose_network();
// → Failed requests, slow requests, CORS issues
```

### Step 3: Check Console

```javascript
devtools_get_console_logs({ level: 'error' });
```

### Step 4: Check DOM

```javascript
// Is the expected content there?
browser_find_elements({ selector: "[data-testid='content']" });
browser_get_element_info({ selector: '.loading-spinner' });
```

### Step 5: Check Performance

```javascript
devtools_get_performance_metrics();
// Slow SPAs often have render issues
```

## Framework-Specific Tips

### React

```javascript
// Check React DevTools-like info
devtools_evaluate({
  expression: "document.querySelector('#root')?._reactRootContainer",
});
```

### Vue

```javascript
// Check Vue app state
devtools_evaluate({
  expression: "document.querySelector('#app')?.__vue_app__",
});
```

### Next.js / Nuxt

```javascript
// Check SSR vs CSR state
browser_get_page_text({ selector: 'body' });
// Look for hydration errors in console
```

## Best Practices

1. **Wait for SPA to hydrate**: SPAs may take time after initial page load
2. **Check the right layer**: Console errors often point to React/Vue issues, network errors point to API issues
3. **Use `browser_wait_for_element`**: Elements may be rendered async — wait for them
4. **Screenshot for visual bugs**: Use `browser_screenshot` to capture visual state
5. **Check localStorage**: SPAs often store auth tokens and state there

```javascript
// Example SPA debugging session
browser_navigate({ url: 'http://localhost:5173/dashboard' });
browser_wait_for_element({ selector: '.dashboard-content', timeout: 10000 });
diagnose_page({ focus: 'errors' });
storage_get_local(); // Check cached data
devtools_evaluate({ expression: 'window.__INITIAL_STATE__' });
```
