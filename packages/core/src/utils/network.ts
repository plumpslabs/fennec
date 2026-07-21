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
