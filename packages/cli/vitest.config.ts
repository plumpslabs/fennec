import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Unit tests only. The daemon-spawning e2e suite (tests/e2e, SIGKILL +
    // supervisor respawn loops) runs via `test:e2e` — never inside the
    // default unit run, where it can wedge CI workers (#152).
    include: ['tests/unit/**/*.test.ts'],
  },
});
