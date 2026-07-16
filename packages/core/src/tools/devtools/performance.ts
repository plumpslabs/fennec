import { z } from 'zod';
import { createTool } from '../_registry.js';
import { PerformanceCollector } from '../../cdp/PerformanceCollector.js';
import type { FennecSession } from '../../session/types.js';

const collector = new PerformanceCollector();

// ─── Runtime metadata ───────────────────────────────────────────
// Extends FennecSession.metadata with CPU profiling state.

interface ActiveProfileInfo {
  startedAt: number;
}

interface PerformanceRuntimeMeta {
  activeProfiles?: Record<string, ActiveProfileInfo>;
}

function getPerfMeta(session: FennecSession): PerformanceRuntimeMeta {
  return session.metadata as PerformanceRuntimeMeta;
}

// ─── CDP Profiler types ─────────────────────────────────────────

interface CPUProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount?: number;
  children?: number[];
}

interface CPUProfile {
  nodes: CPUProfileNode[];
  totalSamples?: number;
  startTime?: number;
  endTime?: number;
}

interface ProfilerStopResult {
  profile: CPUProfile;
}

export const devtoolsGetPerformanceMetrics = createTool({
  name: 'devtools_get_performance_metrics',
  category: 'devtools',
  description:
    '`<use_case>Performance</use_case> 📊 Get core Web Vitals: FCP (First Contentful Paint), LCP (Largest Contentful Paint), TBT (Total Blocking Time), CLS (Cumulative Layout Shift), TTI (Time to Interactive), and memory usage. Use for performance auditing, checking if a page meets Core Web Vitals thresholds. More comprehensive than diagnose_performance which also adds recommendations.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const metrics = await collector.getMetrics(session.browser);
      return responseBuilder.success(metrics, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'CDP_ERROR',
        suggestions: ['Ensure the page has finished loading'],
      });
    }
  },
});

export const devtoolsGetMemoryUsage = createTool({
  name: 'devtools_get_memory_usage',
  category: 'devtools',
  description:
    '`<use_case>Performance</use_case> 💾 Get JavaScript heap memory stats: jsHeapSize (used), totalSize (allocated), limit (max), plus DOM node count. Use for detecting memory leaks, checking memory pressure on SPAs, or monitoring DOM size growth over time.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const metrics = await collector.getMetrics(session.browser);
      return responseBuilder.success(
        {
          jsHeapSize: metrics.memoryUsage?.jsHeapSize ?? 0,
          totalSize: metrics.memoryUsage?.totalSize ?? 0,
          limit: metrics.memoryUsage?.limit ?? 0,
          domNodes: (await collector.getDOMCounters(session.browser)).nodes,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const devtoolsGetDomCounters = createTool({
  name: 'devtools_get_dom_counters',
  category: 'devtools',
  description:
    '`<use_case>Performance</use_case> 🏗️ Get DOM node counters: nodes count, documents count, frames (iframes) count. Use for detecting DOM bloat — pages with thousands of nodes can lag. Simpler than devtools_get_memory_usage which also returns JS heap stats.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const counters = await collector.getDOMCounters(session.browser);
      return responseBuilder.success(counters, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const devtoolsStartProfiling = createTool({
  name: 'devtools_start_profiling',
  category: 'devtools',
  description:
    '`<use_case>Performance</use_case> ⏺️ Start CPU profiling via Chrome DevTools Protocol. Returns a profileId. Use BEFORE performing a slow operation — then call devtools_stop_profiling to get the profile data including top functions by execution time. Pair with devtools_stop_profiling — start before the action, stop after.`',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cdpSession = session.browser.cdp();
      await cdpSession.send('Profiler.enable');
      await cdpSession.send('Profiler.start');
      const profileId = `profile_${Date.now()}`;
      const meta = getPerfMeta(session);
      if (!meta.activeProfiles) meta.activeProfiles = {};
      meta.activeProfiles[profileId] = { startedAt: Date.now() };
      return responseBuilder.success({ profileId }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'CDP_ERROR',
        suggestions: ['CDP Profiler may not be available in all browser contexts'],
      });
    }
  },
});

export const devtoolsStopProfiling = createTool({
  name: 'devtools_stop_profiling',
  category: 'devtools',
  description:
    '`<use_case>Performance</use_case> ⏹️ Stop CPU profiling and get results. Returns topFunctions[] (most CPU-hungry JS functions sorted by hitCount), duration, totalSamples. Must have called devtools_start_profiling first. Use after performing a slow operation to identify which JavaScript functions are causing performance bottlenecks.`',
  inputSchema: z.object({
    profileId: z.string().describe('Profile ID from devtools_start_profiling'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const meta = getPerfMeta(session);
      const profileMeta = meta.activeProfiles?.[input.profileId];
      if (!profileMeta) {
        return responseBuilder.error(new Error(`Profile not found: ${input.profileId}`), {
          code: 'INVALID_INPUT',
        });
      }

      const cdpSession = session.browser.cdp();
      const result = await cdpSession.send<ProfilerStopResult>('Profiler.stop');
      const profile = result.profile;

      const nodes = profile.nodes ?? [];
      const topFunctions = nodes
        .filter((n) => (n.hitCount ?? 0) > 0)
        .sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0))
        .slice(0, 20)
        .map((n) => ({
          functionName: n.callFrame.functionName || '(anonymous)',
          url: n.callFrame.url || '',
          lineNumber: n.callFrame.lineNumber,
          hitCount: n.hitCount ?? 0,
        }));

      if (meta.activeProfiles) {
        delete meta.activeProfiles[input.profileId];
      }

      return responseBuilder.success(
        {
          topFunctions,
          duration: Date.now() - (profileMeta.startedAt ?? Date.now()),
          totalSamples: profile.totalSamples ?? 0,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        code: 'CDP_ERROR',
        suggestions: ['Ensure profiling was started with devtools_start_profiling first'],
      });
    }
  },
});

export const devtoolsSimulateNetwork = createTool({
  name: 'devtools_simulate_network',
  category: 'devtools',
  description:
    '`<use_case>Performance</use_case> 🌍 Simulate network conditions to test app behavior under different speeds. Options: offline, slow-3g, fast-3g, 4g, reset. Returns the applied condition. Use for testing loading states, offline behavior, throttling analysis, or verifying your app works on slow connections. Call reset when done to restore normal speeds.`',
  inputSchema: z.object({
    condition: z
      .enum(['offline', 'slow-3g', 'fast-3g', '4g', 'reset'])
      .describe('Network condition to simulate'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cdpSession = session.browser.cdp();

      // Reset first
      const resetParams = {
        offline: false,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      } satisfies Record<string, unknown>;

      await cdpSession.send('Network.emulateNetworkConditions', resetParams);

      const conditions: Record<
        string,
        { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }
      > = {
        offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
        'slow-3g': {
          offline: false,
          latency: 400,
          downloadThroughput: 40000,
          uploadThroughput: 10000,
        },
        'fast-3g': {
          offline: false,
          latency: 150,
          downloadThroughput: 700000,
          uploadThroughput: 100000,
        },
        '4g': {
          offline: false,
          latency: 50,
          downloadThroughput: 3000000,
          uploadThroughput: 1000000,
        },
        reset: { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
      };

      const cond = conditions[input.condition]!;
      await cdpSession.send('Network.emulateNetworkConditions', cond);

      return responseBuilder.success(
        { applied: input.condition },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error, {
        suggestions: ['CDP network simulation may not be available in all browser contexts'],
      });
    }
  },
});
