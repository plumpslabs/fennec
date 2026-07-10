/**
 * Performance Budget Tools — benchmark page performance against defined thresholds.
 *
 * Allows AI agents to check if a page meets performance targets:
 * - Max load time (LCP)
 * - Max DOM node count
 * - Max total request count
 * - Max JS heap size
 *
 * Returns PASS/FAIL status for each budget item with actual values.
 */
import { z } from "zod";
import { createTool } from "../_registry.js";
import { PerformanceCollector } from "../../cdp/PerformanceCollector.js";

const collector = new PerformanceCollector();

export const budgetCheckPage = createTool({
  name: "budget_check_page",
  category: "devtools",
  description: "`<use_case>Performance</use_case> 📊 Benchmark the page against performance budgets. Define max: LCP (default 2500ms), DOM nodes (1500), requests (100), JS heap (50MB). Returns PASS/FAIL for each metric with actual values. Use for CI gates, performance regression detection, or checking if a page meets performance SLAs. For a simpler overview without thresholds, use budget_get_summary. For raw Web Vitals, use devtools_get_performance_metrics.`",
  inputSchema: z.object({
    maxLCP: z.number().optional().describe("Max Largest Contentful Paint in ms (default: 2500)"),
    maxDOMNodes: z.number().optional().describe("Max DOM node count (default: 1500)"),
    maxRequests: z.number().optional().describe("Max total network requests (default: 100)"),
    maxJSHeapMB: z.number().optional().describe("Max JS heap size in MB (default: 50)"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const budgets = {
      lcp: input.maxLCP ?? 2500,
      domNodes: input.maxDOMNodes ?? 1500,
      requests: input.maxRequests ?? 100,
      jsHeapMB: input.maxJSHeapMB ?? 50,
    };

    try {
      // 1. Get performance metrics
      const metrics = await collector.getMetrics(session.browser);

      // 2. Get DOM counters
      const counters = await collector.getDOMCounters(session.browser);

      // 3. Count network requests
      const requestCount = session.networkBuffer.length;

      // 4. Evaluate budgets
      const results: Array<{
        name: string;
        status: "pass" | "fail" | "no_data";
        actual: number | null;
        budget: number;
        unit: string;
      }> = [];

      // LCP budget
      results.push({
        name: "Largest Contentful Paint",
        status: metrics.LCP != null ? (metrics.LCP <= budgets.lcp ? "pass" : "fail") : "no_data",
        actual: metrics.LCP,
        budget: budgets.lcp,
        unit: "ms",
      });

      // DOM nodes budget
      results.push({
        name: "DOM Node Count",
        status: counters.nodes <= budgets.domNodes ? "pass" : "fail",
        actual: counters.nodes,
        budget: budgets.domNodes,
        unit: "nodes",
      });

      // Request count budget
      results.push({
        name: "Network Requests",
        status: requestCount <= budgets.requests ? "pass" : "fail",
        actual: requestCount,
        budget: budgets.requests,
        unit: "requests",
      });

      // JS heap budget
      const heapMB = metrics.memoryUsage ? Math.round(metrics.memoryUsage.jsHeapSize / (1024 * 1024)) : null;
      results.push({
        name: "JS Heap Size",
        status: heapMB != null ? (heapMB <= budgets.jsHeapMB ? "pass" : "fail") : "no_data",
        actual: heapMB,
        budget: budgets.jsHeapMB,
        unit: "MB",
      });

      const passed = results.filter((r) => r.status === "pass").length;
      const failed = results.filter((r) => r.status === "fail").length;
      const noData = results.filter((r) => r.status === "no_data").length;

      return responseBuilder.success({
        budgets,
        results,
        summary: `${passed} passed, ${failed} failed${noData > 0 ? `, ${noData} no data` : ""}`,
        allPassed: failed === 0,
        metrics: {
          lcp: metrics.LCP,
          domNodes: counters.nodes,
          requestCount,
          jsHeapMB: heapMB,
        },
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "BUDGET_CHECK_FAILED",
        suggestions: ["Ensure the page has fully loaded", "Try calling devtools_get_performance_metrics first"],
      });
    }
  },
});

export const budgetGetSummary = createTool({
  name: "budget_get_summary",
  category: "devtools",
  description: "`<use_case>Performance</use_case> 📈 Get a comprehensive one-shot performance overview: FCP, LCP, DOM nodes, request count, failed requests, memory usage (MB), navigation timing breakdown (TTFB, DNS, TCP, TLS, DOM), and quality scores. No thresholds — just raw data + quality ratings (good/needs-improvement/poor). Use for quick performance assessment without setting budgets. For budget-based checks, use budget_check_page instead. For basic Web Vitals, use devtools_get_performance_metrics.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const metrics = await collector.getMetrics(session.browser);
      const counters = await collector.getDOMCounters(session.browser);

      // Get navigation timing breakdown
      const timingBreakdown = await session.browser.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (!nav) return null;
        return {
          ttfb: nav.responseStart - nav.requestStart,
          domInteractive: nav.domInteractive,
          domComplete: nav.domComplete,
          loadTime: nav.loadEventEnd,
          domContentLoaded: nav.domContentLoadedEventEnd,
          redirectTime: nav.redirectEnd - nav.redirectStart,
          dnsTime: nav.domainLookupEnd - nav.domainLookupStart,
          tcpTime: nav.connectEnd - nav.connectStart,
          secureTime: (nav as any).secureConnectionStart ? (nav.connectEnd - (nav as any).secureConnectionStart) : 0,
        };
      }).catch(() => null);

      const requestCount = session.networkBuffer.length;
      const failedRequests = session.networkBuffer.filter((r) => r.status >= 400).length;

      return responseBuilder.success({
        fcp: metrics.FCP,
        lcp: metrics.LCP,
        domNodes: counters.nodes,
        requestCount,
        failedRequests,
        memoryMB: metrics.memoryUsage ? Math.round(metrics.memoryUsage.jsHeapSize / (1024 * 1024)) : null,
        navigationTiming: timingBreakdown,
        scores: {
          fcp: metrics.FCP != null ? (metrics.FCP <= 1800 ? "good" : metrics.FCP <= 3000 ? "needs-improvement" : "poor") : null,
          lcp: metrics.LCP != null ? (metrics.LCP <= 2500 ? "good" : metrics.LCP <= 4000 ? "needs-improvement" : "poor") : null,
          domNodes: counters.nodes <= 1500 ? "good" : counters.nodes <= 3000 ? "needs-improvement" : "poor",
        },
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "SUMMARY_FAILED",
        suggestions: ["Ensure the page has loaded", "Try navigating to a page first"],
      });
    }
  },
});
