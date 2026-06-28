# End-to-End Tests

Full end-to-end tests that exercise Fennec's complete feature set.

## Planned Tests

- Full-stack debugging workflow
- Login flow with session persistence
- Multi-user parallel testing
- Process management lifecycle
- Memory leak detection over extended sessions

## Running

```bash
pnpm --filter @fennec/core test:e2e
```
