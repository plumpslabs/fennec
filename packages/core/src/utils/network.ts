/**
 * Shared network utilities — used by PulseContext, observe, diagnostics, etc.
 */

/**
 * URL patterns that are expected to return 401 when the user is not
 * authenticated (e.g. token refresh, auth endpoints). These should NOT
 * count as "failures" in health checks and pulse summaries since they
 * are normal for unauthenticated pages.
 */
const EXPECTED_AUTH_FAILURE_PATTERNS = [
  '/token',
  '/ably/',
  '/auth/refresh',
  '/auth/token',
  '/connect/',
  '/login/',
  '/signin',
  '/oauth',
  '/refresh',
  '/session',
  '/health',
  '/version',
  '/status',
  '/heartbeat',
  '/ping',
];

/**
 * Static asset URL patterns that should NOT trigger "slow request" warnings
 * during development — dev servers (Vite, webpack-dev-server, etc.) frequently
 * serve JS/CSS chunks with long times on first load. Filtering these out
 * prevents false-positive slow request alerts in observe().
 */
const STATIC_ASSET_PATTERNS = [
  '.js',
  '.css',
  '.map',
  '.hot-update.',
  '__vite_',
  '/@vite/',
  '/@react-refresh',
  '/node_modules/',
  '.tsbuildinfo',
];

/**
 * Returns true when a URL is a static asset (JS/CSS/sourcemap/hot-update)
 * that should be excluded from "slow request" counts in health summaries.
 * These are typically dev-server artifacts, not app-critical requests.
 */
export function isStaticAsset(url: string): boolean {
  const lower = url.toLowerCase();
  return STATIC_ASSET_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Returns true when a network request is an expected, non-critical failure
 * (e.g. 401 on an auth/token endpoint for unauthenticated users) that should
 * be excluded from health-status pulses and failure alerts.
 *
 * These requests are still visible in raw network logs but do NOT flip the
 * pulse to "error" or count in the observe() pulse failure summary.
 */
export function isExpectedNetworkFailure(status: number, url: string): boolean {
  // Only 401/403 auth failures are expected — real 500s are never expected
  if (status !== 401 && status !== 403) return false;
  const lower = url.toLowerCase();
  return EXPECTED_AUTH_FAILURE_PATTERNS.some((pattern) => lower.includes(pattern));
}
