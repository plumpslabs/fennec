import { z } from "zod";
import { createTool } from "../_registry.js";
import { PerformanceCollector } from "../../cdp/PerformanceCollector.js";

const collector = new PerformanceCollector();

export const devtoolsGetPerformanceMetrics = createTool({
  name: "devtools_get_performance_metrics",
  description: "`<use_case>Performance analysis</use_case> Get core web vitals: FCP, LCP, TBT, CLS, TTI, and memory usage. metrics.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const metrics = await collector.getMetrics(session.page);
      return responseBuilder.success(metrics, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "CDP_ERROR",
        suggestions: ["Ensure the page has finished loading"],
      });
    }
  },
});

export const devtoolsGetMemoryUsage = createTool({
  name: "devtools_get_memory_usage",
  description: "`<use_case>Performance analysis</use_case> Get JavaScript memory usage (jsHeapSize, totalSize, limit) and DOM node count. jsHeapSize, totalSize, limit, domNodes.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const metrics = await collector.getMetrics(session.page);
      return responseBuilder.success({
        jsHeapSize: metrics.memoryUsage?.jsHeapSize ?? 0,
        totalSize: metrics.memoryUsage?.totalSize ?? 0,
        limit: metrics.memoryUsage?.limit ?? 0,
        domNodes: (await collector.getDOMCounters(session.page)).nodes,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const devtoolsGetDomCounters = createTool({
  name: "devtools_get_dom_counters",
  description: "`<use_case>Performance analysis</use_case> Get DOM node counters: nodes, documents, frames. nodes, documents, frames.`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const counters = await collector.getDOMCounters(session.page);
      return responseBuilder.success(counters, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const devtoolsStartProfiling = createTool({
  name: "devtools_start_profiling",
  description: "`<use_case>Performance analysis</use_case> Start CPU performance profiling via CDP. Returns a profileId for use with devtools_stop_profiling. Captures JavaScript stack traces and execution timing. profileId (string).`",
  inputSchema: z.object({
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cdpSession = session.cdpSession;
      await cdpSession.send("Profiler.enable" as never);
      await cdpSession.send("Profiler.start" as never);
      const profileId = `profile_${Date.now()}`;
      const meta = session.metadata as Record<string, any>;
      if (!meta.activeProfiles) meta.activeProfiles = {};
      meta.activeProfiles[profileId] = { startedAt: Date.now() };
      return responseBuilder.success({ profileId }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "CDP_ERROR",
        suggestions: ["CDP Profiler may not be available in all browser contexts"],
      });
    }
  },
});

export const devtoolsStopProfiling = createTool({
  name: "devtools_stop_profiling",
  description: "`<use_case>Performance analysis</use_case> Stop CPU profiling and return collected profile data. topFunctions[], duration (ms), totalSamples.`",
  inputSchema: z.object({
    profileId: z.string().describe("Profile ID from devtools_start_profiling"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const meta = session.metadata as Record<string, any>;
      const profileMeta = meta.activeProfiles?.[input.profileId];
      if (!profileMeta) {
        return responseBuilder.error(
          new Error(`Profile not found: ${input.profileId}`),
          { code: "INVALID_INPUT" },
        );
      }

      const cdpSession = session.cdpSession;
      const result = await cdpSession.send("Profiler.stop" as never) as any;
      const profile = result.profile;

      const nodes = profile.nodes ?? [];
      const topFunctions = nodes
        .filter((n: any) => (n.hitCount ?? 0) > 0)
        .sort((a: any, b: any) => (b.hitCount ?? 0) - (a.hitCount ?? 0))
        .slice(0, 20)
        .map((n: any) => ({
          functionName: n.callFrame.functionName || "(anonymous)",
          url: n.callFrame.url || "",
          lineNumber: n.callFrame.lineNumber,
          hitCount: n.hitCount ?? 0,
        }));

      delete meta.activeProfiles[input.profileId];

      return responseBuilder.success({
        topFunctions,
        duration: Date.now() - (profileMeta.startedAt ?? Date.now()),
        totalSamples: profile.totalSamples ?? 0,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        code: "CDP_ERROR",
        suggestions: ["Ensure profiling was started with devtools_start_profiling first"],
      });
    }
  },
});

export const devtoolsSimulateNetwork = createTool({
  name: "devtools_simulate_network",
  description: "`<use_case>Testing</use_case> Simulate network conditions: offline, slow-3g, fast-3g, 4g, or reset. applied (string).`",
  inputSchema: z.object({
    condition: z.enum(["offline", "slow-3g", "fast-3g", "4g", "reset"]).describe("Network condition to simulate"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cdpSession = session.cdpSession;

      // Reset first
      await cdpSession.send("Network.emulateNetworkConditions" as never, {
        offline: false,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      } as never);

      const conditions: Record<string, { offline: boolean; latency: number; downloadThroughput: number; uploadThroughput: number }> = {
        offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
        "slow-3g": { offline: false, latency: 400, downloadThroughput: 40000, uploadThroughput: 10000 },
        "fast-3g": { offline: false, latency: 150, downloadThroughput: 700000, uploadThroughput: 100000 },
        "4g": { offline: false, latency: 50, downloadThroughput: 3000000, uploadThroughput: 1000000 },
        reset: { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
      };

      const cond = conditions[input.condition]!;
      await cdpSession.send("Network.emulateNetworkConditions" as never, cond as never);

      return responseBuilder.success({ applied: input.condition }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error, {
        suggestions: ["CDP network simulation may not be available in all browser contexts"],
      });
    }
  },
});
