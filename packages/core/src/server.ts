import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { ToolRegistry, type ToolContext } from "./tools/_registry.js";
import { SessionManager } from "./session/SessionManager.js";
import { SessionStore } from "./session/SessionStore.js";
import { ResponseBuilder } from "./response/ResponseBuilder.js";
import { ConfigLoader } from "./config/ConfigLoader.js";
import { ErrorEnricher } from "./response/ErrorEnricher.js";
import { createLogger, getLogger } from "./utils/logger.js";
import { ProcessManager } from "./process/ProcessManager.js";
import { LogWatcher } from "./process/LogWatcher.js";
import type { FennecConfig } from "./config/defaults.js";

// Import all tools
import { browserNavigate, browserGoBack, browserGoForward, browserReload, browserGetCurrentUrl, browserWaitForNavigation } from "./tools/navigation/index.js";
import { browserClick, browserType, browserSelect, browserHover, browserScroll, browserPressKey, browserFocus, browserClear, browserUploadFile, browserDragDrop } from "./tools/interaction/index.js";
import { browserScreenshot, browserGetDomSnapshot, browserGetAccessibilityTree, browserFindElements, browserGetElementInfo, browserWaitForElement, browserGetPageText, browserGetPageTitle, browserGetMeta } from "./tools/dom/index.js";
import { devtoolsGetConsoleLogs, devtoolsClearConsole, devtoolsEvaluate, devtoolsGetJsErrors, devtoolsWatchConsole } from "./tools/devtools/console.js";
import { networkGetLogs, networkGetFailedRequests, networkGetCorsIssues, networkClearLogs, networkIntercept, networkRemoveIntercept, networkMockResponse, networkWaitForRequest, networkGetRequestDetail } from "./tools/devtools/network.js";
import { devtoolsGetPerformanceMetrics, devtoolsGetMemoryUsage, devtoolsGetDomCounters, devtoolsStartProfiling, devtoolsStopProfiling, devtoolsSimulateNetwork } from "./tools/devtools/performance.js";
import { storageGetLocal, storageSetLocal, storageRemoveLocal, storageClearLocal, storageGetSession, storageSetSession, storageGetCookies, storageSetCookie, storageDeleteCookie, storageGetIndexedDB, storageExportState, storageImportState } from "./tools/storage/index.js";
import { authFillLoginForm, authSaveSession, authLoadSession, authListSessions, authDeleteSession, authCheckLoggedIn } from "./tools/auth/index.js";
import { tabNew, tabClose, tabList, tabSwitch, tabGetCurrent, contextNew, contextClose } from "./tools/tabs/index.js";
import { processSpawn, processList, processGetLogs, processGetStatus, processSendInput, processKill, processWaitForReady, processAttachPid, processAttachPort, processRestart } from "./tools/process/index.js";
import { terminalWatchFile, terminalGetLogs, terminalGetErrors, terminalListWatchers, terminalStopWatcher, terminalWatchPipe, terminalClearBuffer } from "./tools/terminal/index.js";
import { diagnosePage, diagnoseElement, diagnoseNetwork, diagnoseAuth, diagnoseFullstack, diagnosePerformance } from "./tools/diagnostic/index.js";

export class FennecServer {
  private server: Server;
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;
  private responseBuilder: ResponseBuilder;
  private processManager: ProcessManager;
  private logWatcher: LogWatcher;
  private sessionStore: SessionStore;
  private config: FennecConfig;

  constructor(configPath?: string) {
    const configLoader = new ConfigLoader(configPath);
    this.config = configLoader.getConfig();

    createLogger(this.config.logging);
    const logger = getLogger();

    this.toolRegistry = new ToolRegistry();
    this.responseBuilder = new ResponseBuilder();
    this.sessionManager = new SessionManager(this.config);
    this.processManager = new ProcessManager(this.config.process);
    this.logWatcher = new LogWatcher(this.config.terminal.logBufferLines);
    this.sessionStore = new SessionStore(this.config.session.persistPath);

    this.server = new Server(
      { name: "fennec", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    this.registerAllTools();
    this.setupHandlers();
    logger.info({ config: this.config }, "Fennec server initialized");
  }

  private registerAllTools(): void {
    const tools = [
      browserNavigate, browserGoBack, browserGoForward, browserReload, browserGetCurrentUrl, browserWaitForNavigation,
      browserClick, browserType, browserSelect, browserHover, browserScroll, browserPressKey, browserFocus, browserClear, browserUploadFile, browserDragDrop,
      browserScreenshot, browserGetDomSnapshot, browserGetAccessibilityTree, browserFindElements, browserGetElementInfo, browserWaitForElement, browserGetPageText, browserGetPageTitle, browserGetMeta,
      devtoolsGetConsoleLogs, devtoolsClearConsole, devtoolsEvaluate, devtoolsGetJsErrors, devtoolsWatchConsole,
      networkGetLogs, networkGetFailedRequests, networkGetCorsIssues, networkClearLogs, networkIntercept, networkRemoveIntercept, networkMockResponse, networkWaitForRequest, networkGetRequestDetail,
      devtoolsGetPerformanceMetrics, devtoolsGetMemoryUsage, devtoolsGetDomCounters, devtoolsStartProfiling, devtoolsStopProfiling, devtoolsSimulateNetwork,
      storageGetLocal, storageSetLocal, storageRemoveLocal, storageClearLocal, storageGetSession, storageSetSession, storageGetCookies, storageSetCookie, storageDeleteCookie, storageGetIndexedDB, storageExportState, storageImportState,
      authFillLoginForm, authSaveSession, authLoadSession, authListSessions, authDeleteSession, authCheckLoggedIn,
      tabNew, tabClose, tabList, tabSwitch, tabGetCurrent, contextNew, contextClose,
      processSpawn, processList, processGetLogs, processGetStatus, processSendInput, processKill, processWaitForReady, processAttachPid, processAttachPort, processRestart,
      terminalWatchFile, terminalGetLogs, terminalGetErrors, terminalListWatchers, terminalStopWatcher, terminalWatchPipe, terminalClearBuffer,
      diagnosePage, diagnoseElement, diagnoseNetwork, diagnoseAuth, diagnoseFullstack, diagnosePerformance,
    ];

    for (const tool of tools) {
      this.toolRegistry.register(tool);
    }
  }

  private getToolContext(): ToolContext {
    return {
      sessionManager: this.sessionManager,
      responseBuilder: this.responseBuilder,
      config: this.config,
      logger: getLogger(),
      processManager: this.processManager,
      logWatcher: this.logWatcher,
      sessionStore: this.sessionStore,
    };
  }

  private setupHandlers(): void {
    const logger = getLogger();

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.toolRegistry.getAll();
      return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = this.toolRegistry.get(name);

      if (!tool) {
        logger.warn({ tool: name }, "Unknown tool called");
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}. Available tools: ${this.toolRegistry.getAll().map(t => t.name).join(", ")}` }],
          isError: true,
        };
      }

      logger.info({ tool: name, args }, "Tool called");

      try {
        const parsed = tool.inputSchema.parse(args ?? {});
        const context = this.getToolContext();
        const result = await tool.handler(parsed, context);

        // Per MCP spec: if handler returns success: false, mark as isError
        const isError = result && typeof result === "object" && "success" in result && result.success === false;
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: isError === true ? true : undefined,
        };
      } catch (error) {
        if (error instanceof ZodError) {
          logger.warn({ tool: name, error }, "Input validation failed");
          return {
            content: [{ type: "text", text: `Invalid parameters for ${name}: ${error.message}` }],
            isError: true,
          };
        }
        logger.error({ tool: name, error }, "Tool execution failed");

        // Enrich error with browser context (screenshot, URL, console logs)
        let enrichedContext: Record<string, unknown> = {};
        try {
          const session = this.sessionManager.getOrDefault();
          const enricher = new ErrorEnricher();
          enrichedContext = (await enricher.enrich(session)) as unknown as Record<string, unknown>;
        } catch {
          // Enrichment is best-effort; don't let it mask the original error
        }

        const errorResponse = this.responseBuilder.error(error, {
          code: "TOOL_EXECUTION_FAILED",
          suggestions: ["Check if the browser session is still active", "Verify the page hasn't been closed or navigated away"],
          context: enrichedContext,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(errorResponse) }],
          isError: true,
        };
      }
    });
  }

  async start(): Promise<void> {
    const logger = getLogger();
    await this.sessionManager.initialize();

    if (this.config.transport.type === "sse") {
      logger.error("SSE transport not yet implemented");
      process.exit(1);
    } else {
      const transport = new StdioServerTransport();
      logger.info("Starting Fennec MCP server (stdio transport)...");
      await this.server.connect(transport);

      process.on("SIGINT", async () => {
        logger.info("Shutting down Fennec...");
        this.processManager.cleanup();
        this.logWatcher.cleanup();
        await this.sessionManager.close();
        process.exit(0);
      });

      process.on("SIGTERM", async () => {
        logger.info("Shutting down Fennec...");
        this.processManager.cleanup();
        this.logWatcher.cleanup();
        await this.sessionManager.close();
        process.exit(0);
      });
    }
  }
}
