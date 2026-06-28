# Integration Tests

Integration tests for Fennec that test multiple components together.

## Planned Tests

- Browser session lifecycle (create, use, destroy)
- Process spawn + log collection end-to-end
- Network intercept + mock response flow
- Auth session save/load flow
- Multi-session parallel operations

## Running

```bash
pnpm --filter @fennec/core test:integration
```
