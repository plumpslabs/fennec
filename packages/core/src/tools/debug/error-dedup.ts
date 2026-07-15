/**
 * Error Dedup — Utility for grouping identical errors by stack hash.
 * Token-efficient: 10 identical errors → 1 entry with count.
 * Also filters known noise patterns (Vite HMR, etc.).
 */

export interface ErrorGroup {
  /** Hash of the normalized stack trace */
  hash: string;
  /** Error message (first occurrence) */
  message: string;
  /** Occurrence count */
  count: number;
  /** First seen timestamp */
  firstSeen: string;
  /** Last seen timestamp */
  lastSeen: string;
  /** Log level */
  level: 'error' | 'warn' | 'critical';
  /** Top stack frame (most useful for debugging) */
  topFrame?: string;
  /** Full stack trace (first occurrence, for detail expansion) */
  stackTrace?: string;
}

export interface ErrorDedupOptions {
  /** Max number of groups to retain (default: 100) */
  maxGroups?: number;
  /** Patterns to silently ignore (regex strings) */
  ignorePatterns?: string[];
}

/** Default noise patterns to ignore — dev-tool artifacts, not app bugs. */
const DEFAULT_IGNORE_PATTERNS: RegExp[] = [
  /failed to connect to websocket/i,
  /insecure websocket connection/i,
  /websocket connection to/i,
  /hot update failed/i,
  /hmr update failed/i,
  /^\[\w+\].*404.*favicon/i,
  /^\[\w+\].*preflight.*CORS/i,
  /chunk load error/i,
  /loading chunk \d+ failed/i,
];

/**
 * Normalize a stack trace to produce a hash for dedup.
 * Strips: line numbers, column numbers, timestamps, memory addresses.
 */
function hashStackTrace(stackTrace: string): string {
  const normalized = stackTrace
    .replace(/:(\d+):(\d+)/g, ':N:N')     // normalize line:col
    .replace(/0x[0-9a-fA-F]+/g, '0x...')  // normalize hex addresses
    .replace(/\bat\s+/g, 'at ')            // normalize whitespace
    .replace(/\s+/g, ' ')                  // collapse whitespace
    .trim();

  // Simple hash (djb2)
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Extract the top frame from a stack trace for quick identification.
 */
function extractTopFrame(stackTrace: string): string | undefined {
  const lines = stackTrace.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('at ')) {
      return trimmed.slice(0, 120); // truncate long frames
    }
  }
  return undefined;
}

export class ErrorDedup {
  private groups: Map<string, ErrorGroup> = new Map();
  private order: string[] = [];
  private maxGroups: number;
  private ignorePatterns: RegExp[];

  constructor(options: ErrorDedupOptions = {}) {
    this.maxGroups = options.maxGroups ?? 100;
    this.ignorePatterns = [
      ...DEFAULT_IGNORE_PATTERNS,
      ...(options.ignorePatterns?.map((p) => new RegExp(p, 'i')) ?? []),
    ];
  }

  /**
   * Add an error to the dedup buffer.
   * Returns the error group (new or existing).
   */
  add(
    message: string,
    stackTrace?: string,
    level: ErrorGroup['level'] = 'error',
  ): ErrorGroup | null {
    // Check ignore patterns first (zero token cost for noise)
    if (this.shouldIgnore(message)) return null;

    const hash = stackTrace ? hashStackTrace(stackTrace) : hashStackTrace(message);

    // Check if we already have this error
    const existing = this.groups.get(hash);
    if (existing) {
      existing.count++;
      existing.lastSeen = new Date().toISOString();
      // Move to end of order list
      const idx = this.order.indexOf(hash);
      if (idx !== -1) {
        this.order.splice(idx, 1);
        this.order.push(hash);
      }
      return existing;
    }

    // Create new group
    const group: ErrorGroup = {
      hash,
      message: message.slice(0, 200), // truncate long messages
      count: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      level,
      topFrame: stackTrace ? extractTopFrame(stackTrace) : undefined,
      stackTrace: stackTrace?.slice(0, 500), // store partial trace for detail
    };

    this.groups.set(hash, group);
    this.order.push(hash);

    // Evict oldest if over limit
    if (this.order.length > this.maxGroups) {
      const oldest = this.order.shift();
      if (oldest) this.groups.delete(oldest);
    }

    return group;
  }

  /**
   * Get all error groups, sorted by most recent first.
   */
  getGroups(): ErrorGroup[] {
    return this.order
      .map((hash) => this.groups.get(hash))
      .filter((g): g is ErrorGroup => g !== undefined)
      .reverse(); // most recent first
  }

  /**
   * Get a specific error group by hash.
   */
  getGroup(hash: string): ErrorGroup | undefined {
    return this.groups.get(hash);
  }

  /**
   * Get grouped errors as a token-efficient summary string.
   * Format: "3 error(s): TypeError at api.js:42 (5x), Timeout at worker.js:10 (2x)"
   */
  getSummary(maxGroups = 5): string {
    const groups = this.getGroups().slice(0, maxGroups);
    if (groups.length === 0) return 'No errors';

    const parts = groups.map(
      (g) =>
        `${g.message.slice(0, 60)} at ${g.topFrame?.slice(0, 60) ?? 'unknown'} (${g.count}x)`,
    );

    const total = groups.reduce((acc, g) => acc + g.count, 0);
    return `${total} error(s): ${parts.join('; ')}`;
  }

  /**
   * Get a count of unique error types.
   */
  get uniqueCount(): number {
    return this.groups.size;
  }

  /**
   * Get total occurrences across all groups.
   */
  get totalCount(): number {
    let total = 0;
    for (const group of this.groups.values()) {
      total += group.count;
    }
    return total;
  }

  /**
   * Clear all error groups.
   */
  clear(): void {
    this.groups.clear();
    this.order = [];
  }

  /**
   * Check if a message should be ignored.
   */
  private shouldIgnore(message: string): boolean {
    for (const re of this.ignorePatterns) {
      if (re.test(message)) return true;
    }
    return false;
  }
}

/** Singleton instance — lazy, never created until first use. */
let _instance: ErrorDedup | null = null;

export function getErrorDedup(options?: ErrorDedupOptions): ErrorDedup {
  if (!_instance) {
    _instance = new ErrorDedup(options);
  }
  return _instance;
}
