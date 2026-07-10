/**
 * System process utilities — shared between CLI and MCP tools.
 */

/**
 * Check if a process is running by sending signal 0.
 * Works on Linux/macOS/Windows (Node.js handles cross-platform).
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
