import type { Page } from "playwright";

export interface PerformanceMetrics {
  FCP: number | null;
  LCP: number | null;
  TBT: number | null;
  CLS: number | null;
  TTI: number | null;
  memoryUsage: {
    jsHeapSize: number;
    totalSize: number;
    limit: number;
  } | null;
}

export interface DOMCounters {
  nodes: number;
  documents: number;
  frames: number;
}

export class PerformanceCollector {
  async getMetrics(page: Page): Promise<PerformanceMetrics> {
    const metrics: PerformanceMetrics = {
      FCP: null,
      LCP: null,
      TBT: null,
      CLS: null,
      TTI: null,
      memoryUsage: null,
    };

    try {
      // Get performance navigation timing
      const timing = await page.evaluate(() => {
        const t = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (!t) return null;
        return {
          domContentLoaded: t.domContentLoadedEventEnd - t.domContentLoadedEventStart,
          loadEvent: t.loadEventEnd - t.loadEventStart,
          domInteractive: t.domInteractive,
          domComplete: t.domComplete,
        };
      });

      // Get paint metrics
      const paintEntries = await page.evaluate(() => {
        return performance.getEntriesByType("paint").map((e) => ({
          name: e.name,
          startTime: e.startTime,
        }));
      });

      const fcp = paintEntries.find((e) => e.name === "first-contentful-paint");
      if (fcp) metrics.FCP = fcp.startTime;

      // Get Largest Contentful Paint via performance observer (best effort)
      // In a real implementation, we'd use PerformanceObserver

      // Get memory info
      try {
        const memory = await page.evaluate(() => {
          const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
          if (!m) return null;
          return {
            jsHeapSize: m.usedJSHeapSize,
            totalSize: m.totalJSHeapSize,
            limit: m.jsHeapSizeLimit,
          };
        });
        if (memory) metrics.memoryUsage = memory;
      } catch {
        // Memory info not available in all browsers
      }
    } catch {
      // Page might not be ready
    }

    return metrics;
  }

  async getDOMCounters(page: Page): Promise<DOMCounters> {
    try {
      return await page.evaluate(() => {
        const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ALL);
        let nodes = 0;
        while (walker.nextNode()) nodes++;

        return {
          nodes,
          documents: document.childNodes.length,
          frames: window.length,
        };
      });
    } catch {
      return { nodes: 0, documents: 0, frames: 0 };
    }
  }
}
