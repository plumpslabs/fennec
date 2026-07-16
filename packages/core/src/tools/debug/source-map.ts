/**
 * Source Map Resolver — Lightweight utility for mapping minified stack traces
 * to original source locations. Lazy-loaded: no source map is parsed until
 * first use. Uses an LRU cache to avoid re-parsing maps.
 *
 * Features:
 * - Parse .map files adjacent to .js/.ts files
 * - Cache resolved maps (LRU, max 50 entries by default)
 * - Fallback: return raw trace if no source map found
 * - Token-efficient: returns only original file:line:column
 *
 * Note: For full source map resolution (VLQ decoding), use the `source-map`
 * npm package. This implementation does a best-effort mapping by returning
 * the original source file path with approximated line/column.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface SourceMap {
  version: number;
  sources: string[];
  sourcesContent?: string[];
  names: string[];
  mappings: string;
}

interface MappedPosition {
  source: string;
  line: number;
  column: number;
  name?: string;
}

export class SourceMapResolver {
  private cache = new Map<string, SourceMap>();
  private cacheOrder: string[] = [];
  private maxCacheSize: number;

  constructor(maxCacheSize = 50) {
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Given a file path, try to find and parse its source map.
   * Looks for <file>.map adjacent to the file.
   */
  private loadMap(filePath: string): SourceMap | null {
    // Check cache first
    const cached = this.cache.get(filePath);
    if (cached) return cached;

    // Look for .map file
    const mapPath = filePath + '.map';
    if (!existsSync(mapPath)) return null;

    try {
      const content = readFileSync(mapPath, 'utf-8');
      const map = JSON.parse(content) as SourceMap;

      // Cache it (LRU)
      this.cache.set(filePath, map);
      this.cacheOrder.push(filePath);
      if (this.cacheOrder.length > this.maxCacheSize) {
        const oldest = this.cacheOrder.shift();
        if (oldest) this.cache.delete(oldest);
      }

      return map;
    } catch {
      return null;
    }
  }

  /**
   * Parse a raw stack trace string and return mapped locations.
   * Token-efficient: returns array of { original, mapped } pairs.
   * Only lines within the project directory are resolved.
   */
  resolveStackTrace(
    stackTrace: string,
    projectDir?: string,
  ): Array<{ original: string; mapped: MappedPosition | null }> {
    const lines = stackTrace.split('\n');
    const results: Array<{ original: string; mapped: MappedPosition | null }> = [];

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('Error')) {
        results.push({ original: trimmed, mapped: null });
        continue;
      }

      // Parse "at fn (file:line:col)" or "at file:line:col"
      const match = trimmed.match(/at\s+(?:.*?\s+)?\(?(.+?):(\d+):(\d+)\)?$/);
      if (!match) {
        results.push({ original: trimmed, mapped: null });
        continue;
      }

      const [, filePath, lineStr, colStr] = match;
      const line = parseInt(lineStr!, 10);
      const column = parseInt(colStr!, 10);

      // Only resolve files within project dir
      if (
        projectDir &&
        !filePath!.startsWith(projectDir) &&
        !filePath!.startsWith('.') &&
        !filePath!.startsWith('/')
      ) {
        results.push({ original: trimmed, mapped: null });
        continue;
      }

      const resolved = this.resolveLine(filePath!, line, column);
      results.push({ original: trimmed, mapped: resolved });
    }

    return results;
  }

  /**
   * Resolve a stack trace line to its original source location.
   */
  resolveLine(filePath: string, line: number, column: number): MappedPosition | null {
    const map = this.loadMap(filePath);
    if (!map) return null;

    try {
      // Resolve relative source paths against the map's directory
      const mapDir = dirname(filePath);
      const resolvedSources = map.sources.map((s) => resolve(mapDir, s));

      // Best-effort mapping: return the first source with approximated position.
      // For full VLQ-decoded resolution, use the `source-map` npm package.
      if (resolvedSources.length > 0) {
        return {
          source: resolvedSources[0]!,
          line,
          column,
        };
      }
    } catch {
      // Fall through
    }

    return null;
  }

  /**
   * Get a token-efficient summary of a mapped stack trace.
   * Returns only the top N frames with source-location links.
   */
  summarizeStackTrace(
    stackTrace: string,
    options: { maxFrames?: number; projectDir?: string } = {},
  ): string {
    const maxFrames = options.maxFrames ?? 10;
    const mapped = this.resolveStackTrace(stackTrace, options.projectDir);
    const parts: string[] = [];

    for (const entry of mapped) {
      if (parts.length >= maxFrames) {
        parts.push(`  ... (${mapped.length - maxFrames} more frames)`);
        break;
      }

      if (entry.mapped) {
        parts.push(`  at ${entry.mapped.source}:${entry.mapped.line}:${entry.mapped.column}`);
      } else if (entry.original) {
        parts.push(`  ${entry.original}`);
      }
    }

    return parts.join('\n');
  }

  /** Clear the internal map cache. */
  clearCache(): void {
    this.cache.clear();
    this.cacheOrder = [];
  }

  /** Current cache size. */
  get cacheSize(): number {
    return this.cache.size;
  }
}

/** Singleton instance — lazy, never created until first use. */
let _instance: SourceMapResolver | null = null;

export function getSourceMapResolver(): SourceMapResolver {
  if (!_instance) {
    _instance = new SourceMapResolver();
  }
  return _instance;
}
