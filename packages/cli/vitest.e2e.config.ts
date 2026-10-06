import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Daemon-spawning suite (SIGKILL + supervisor respawn loops) — runs via
    // `test:e2e` with this config, never inside the default unit run (#152).
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
