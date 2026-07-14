import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer, type Server as HttpServer } from 'node:http';
import { ZodError } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolRegistry, type ToolContext } from './tools/_registry.js';
import { ModuleRegistry, type FennecModule, type ModuleContext } from './module/index.js';
import { browserModule } from './modules/browser/index.js';
import { processModule } from './modules/process/index.js';
import { mobileModule } from './modules/mobile/index.js';
import { SessionManager } from './session/SessionManager.js';
import type { FennecSession } from './session/types.js';
import { SessionStore } from './session/SessionStore.js';
import { ResponseBuilder } from './response/ResponseBuilder.js';
import { ConfigLoader } from './config/ConfigLoader.js';
import { ErrorEnricher } from './response/ErrorEnricher.js';
import { createLogger, getLogger } from './utils/logger.js';
import { ProcessManager } from './process/ProcessManager.js';
import { LogWatcher } from './process/LogWatcher.js';
import type { FennecConfig } from './config/defaults.js';
import { DEFAULT_CONSOLE_IGNORE_PATTERNS } from './config/defaults.js';
import {
  Pipeline,
  createPermissionGuard,
  createRetryHandler,
  createTelemetryMiddleware,
  createSmartHook,
  createAuditLog,
  createStateMachineMiddleware,
  createPulseContext,
  createEventBusMiddleware,
  LazyContext,
  createLazyLevel1,
  createLazyLevel2,
  createLazyLevel3,
  createStabilityMiddleware,
} from './middleware/index.js';
import { ResourceManager } from './resource/ResourceManager.js';
import { StateManager } from './state/index.js';
import { PerformanceMetrics } from './utils/PerformanceMetrics.js';
import { CapabilityDetector } from './capability/Detector.js';
import { Planner } from './planner/Planner.js';
import { WorkflowEngine } from './workflow/WorkflowEngine.js';
import { Recorder } from './recorder/Recorder.js';
import { WorkflowScheduler } from './scheduler/WorkflowScheduler.js';
import { EventBus } from './correlation/EventBus.js';
import { IncidentEngine } from './incident/index.js';
import { ConsoleCollector } from './cdp/ConsoleCollector.js';
import { NetworkCollector } from './cdp/NetworkCollector.js';
import { selectAdapter, createEngine } from './browser/index.js';
import { ProgressReporter } from './utils/ProgressReporter.js';

// Import all tools
import {
  browserNavigate,
  browserGoBack,
  browserGoForward,
  browserReload,
  browserGetCurrentUrl,
  browserWaitForNavigation,
} from './tools/navigation/index.js';
import {
  browserClick,
  browserType,
  browserSelect,
  browserHover,
  browserScroll,
  browserPressKey,
  browserFocus,
  browserClear,
  browserUploadFile,
  browserDragDrop,
} from './tools/interaction/index.js';
import {
  browserScreenshot,
  browserGetDomSnapshot,
  browserGetAccessibilityTree,
  browserFindElements,
  browserGetElementInfo,
  browserWaitForElement,
  browserGetPageText,
  browserGetPageTitle,
  browserGetMeta,
} from './tools/dom/index.js';
import {
  devtoolsGetConsoleLogs,
  devtoolsClearConsole,
  devtoolsEvaluate,
  devtoolsGetJsErrors,
  devtoolsWatchConsole,
} from './tools/devtools/console.js';
import {
  networkGetLogs,
  networkGetFailedRequests,
  networkGetCorsIssues,
  networkClearLogs,
  networkIntercept,
  networkRemoveIntercept,
  networkMockResponse,
  networkWaitForRequest,
  networkGetRequestDetail,
  networkApiCall,
} from './tools/devtools/network.js';
import {
  devtoolsGetPerformanceMetrics,
  devtoolsGetMemoryUsage,
  devtoolsGetDomCounters,
  devtoolsStartProfiling,
  devtoolsStopProfiling,
  devtoolsSimulateNetwork,
} from './tools/devtools/performance.js';
import {
  storageGetLocal,
  storageSetLocal,
  storageRemoveLocal,
  storageClearLocal,
  storageGetSession,
  storageSetSession,
  storageGetCookies,
  storageSetCookie,
  storageDeleteCookie,
  storageGetIndexedDB,
  storageExportState,
  storageImportState,
} from './tools/storage/index.js';
import {
  authFillLoginForm,
  authSaveSession,
  authLoadSession,
  authListSessions,
  authDeleteSession,
  authCheckLoggedIn,
} from './tools/auth/index.js';
import {
  tabNew,
  tabClose,
  tabList,
  tabSwitch,
  tabGetCurrent,
  contextNew,
  contextClose,
} from './tools/tabs/index.js';
import {
  processSpawn,
  processList,
  processGetLogs,
  processGetStatus,
  processSendInput,
  processKill,
  processWaitForReady,
  processAttachPid,
  processAttachPort,
  processRestart,
  processGetTracked,
  processStopTracked,
  processSpawnTracked,
  processRenameTracked,
  processCleanupTracked,
  processClearLogs,
} from './tools/process/index.js';
import { inspect, supervisorControl, persistControl, doctor } from './tools/process/supervisor.js';
import {
  terminalWatchFile,
  terminalGetLogs,
  terminalGetErrors,
  terminalListWatchers,
  terminalStopWatcher,
  terminalWatchPipe,
  terminalClearBuffer,
} from './tools/terminal/index.js';
import {
  diagnosePage,
  diagnoseElement,
  diagnoseNetwork,
  diagnoseAuth,
  diagnoseFullstack,
  diagnosePerformance,
} from './tools/diagnostic/index.js';
// ─── Mobile Tools ────────────────────────────────────────────
import {
  mobileListDevices,
  mobileTap,
  mobileType,
  mobileSwipe,
  mobileKeyevent,
  mobileScreenshot,
  mobileLogcat,
  mobileInstallApk,
  mobileLaunchApp,
  mobileStopApp,
  mobileDeviceInfo,
  mobileGetUiHierarchy,
  mobileLongPress,
  mobilePinch,
  mobileGetCurrentActivity,
  mobileInspectWebview,
  mobileGetWebviewContent,
  mobileCaptureWebviewConsole,
} from './modules/mobile/index.js';
import {
  schedulerGetStats,
  schedulerGetLastResult,
  schedulerTriggerRule,
  schedulerListRules,
  schedulerDisableRule,
  schedulerEnableRule,
  schedulerClearHistory,
} from './tools/scheduler/index.js';
import {
  smartWait,
  smartWaitForSpa,
  smartNavigate,
  smartFillForm,
  smartValidateForm,
  browserScreenshotAnnotated,
  browserScreenshotExport,
  browserScreenshotDiff,
} from './tools/smart/index.js';
import {
  plannerExecuteGoal,
  plannerCreatePlan,
  plannerListPlans,
  plannerGetPlan,
  plannerCancelPlan,
} from './tools/planner/index.js';
import {
  observe,
  aiDiagnose,
  correlate,
  summarize,
  explain,
  investigate,
  predict,
} from './tools/ai/index.js';
import { toolsHelp } from './tools/help/index.js';
import { budgetCheckPage, budgetGetSummary } from './tools/budget/index.js';
import {
  recorderStart,
  recorderStop,
  recorderExport,
  recorderList,
  recorderCapture,
} from './tools/recorder/index.js';
import { browserAssert } from './tools/assert/index.js';

export class FennecServer {
  private server: Server;
  private toolRegistry: ToolRegistry;
  private moduleRegistry: ModuleRegistry;
  private sessionManager: SessionManager;
  private responseBuilder: ResponseBuilder;
  private processManager: ProcessManager;
  private logWatcher: LogWatcher;
  private sessionStore: SessionStore;
  private config: FennecConfig;
  private pipeline: Pipeline;
  private resourceManager: ResourceManager;
  private stateManager: StateManager;
  private capabilityDetector: CapabilityDetector;
  private planner: Planner;
  private workflowEngine: WorkflowEngine;
  private recorder: Recorder;
  private workflowScheduler: WorkflowScheduler;
  private eventBus: EventBus;
  private incidentEngine: IncidentEngine;
  private performanceMetrics: PerformanceMetrics;
  private auditLog: ReturnType<typeof createAuditLog>;
  private lazyContext: LazyContext;

  // SSE transport fields
  private sseTransport: SSEServerTransport | null = null;
  private httpServer: HttpServer | null = null;

  constructor(configPath?: string) {
    const configLoader = new ConfigLoader(configPath);
    this.config = configLoader.getConfig();

    createLogger(this.config.logging);
    const logger = getLogger();

    this.toolRegistry = new ToolRegistry();
    this.moduleRegistry = new ModuleRegistry();
    this.responseBuilder = new ResponseBuilder();
    this.sessionManager = new SessionManager(this.config);
    this.processManager = new ProcessManager(this.config.process);
    this.logWatcher = new LogWatcher(this.config.terminal.logBufferLines);
    this.sessionStore = new SessionStore(this.config.session.persistPath);

    this.resourceManager = new ResourceManager(this.config.process);
    this.stateManager = new StateManager();
    this.capabilityDetector = new CapabilityDetector();
    this.planner = new Planner();
    this.workflowEngine = new WorkflowEngine(
      this.config.session.persistPath.replace('sessions', 'workflows'),
    );
    this.recorder = new Recorder();
    this.eventBus = new EventBus();
    this.workflowScheduler = new WorkflowScheduler(this.eventBus, this.workflowEngine);
    this.incidentEngine = new IncidentEngine(this.eventBus);
    this.performanceMetrics = new PerformanceMetrics();
    this.auditLog = createAuditLog({ logToConsole: true });
    this.lazyContext = new LazyContext(this.incidentEngine, this.eventBus);

    // Wire EventBus to modules for auto-trigger events
    this.sessionManager.setEventBus(this.eventBus);
    this.processManager.setEventBus(this.eventBus);
    this.logWatcher.setEventBus(this.eventBus);

    // Wire a shared tool executor that both the WorkflowScheduler and WorkflowEngine can use
    const pipelineExecutor = async (toolName: string, input: Record<string, unknown>) => {
      const tool = this.toolRegistry.get(toolName);
      if (!tool) throw new Error(`Tool not found: ${toolName}`);
      const parsed = tool.inputSchema.parse(input);
      const context = this.getToolContext();
      return this.pipeline.execute(tool, parsed, context);
    };

    this.workflowScheduler.setToolExecutor(pipelineExecutor);
    this.workflowEngine.setToolExecutor(pipelineExecutor);

    this.pipeline = new Pipeline();
    this.setupPipeline();

    // Start self-monitoring
    this.performanceMetrics.startMemoryMonitoring();

    this.server = new Server(
      { name: 'fennec', version: '1.11.2' },
      { capabilities: { tools: {} } },
    );

    this.registerModules();
    this.registerAllTools();
    this.setupHandlers();
    logger.info({ config: this.config }, 'Fennec server initialized');
  }

  private registerModules(): void {
    this.moduleRegistry.register(browserModule);
    this.moduleRegistry.register(processModule);
    this.moduleRegistry.register(mobileModule);

    const logger = getLogger();
    logger.info(
      { modules: this.moduleRegistry.getAll().map((m) => `${m.name} (${m.tools.length} tools)`) },
      'Fennec modules registered',
    );
  }

  private registerAllTools(): void {
    const tools = [
      browserNavigate,
      browserGoBack,
      browserGoForward,
      browserReload,
      browserGetCurrentUrl,
      browserWaitForNavigation,
      browserClick,
      browserType,
      browserSelect,
      browserHover,
      browserScroll,
      browserPressKey,
      browserFocus,
      browserClear,
      browserUploadFile,
      browserDragDrop,
      browserScreenshot,
      browserGetDomSnapshot,
      browserGetAccessibilityTree,
      browserFindElements,
      browserGetElementInfo,
      browserWaitForElement,
      browserGetPageText,
      browserGetPageTitle,
      browserGetMeta,
      devtoolsGetConsoleLogs,
      devtoolsClearConsole,
      devtoolsEvaluate,
      devtoolsGetJsErrors,
      devtoolsWatchConsole,
      networkGetLogs,
      networkGetFailedRequests,
      networkGetCorsIssues,
      networkClearLogs,
      networkIntercept,
      networkRemoveIntercept,
      networkMockResponse,
      networkWaitForRequest,
      networkGetRequestDetail,
      networkApiCall,
      devtoolsGetPerformanceMetrics,
      devtoolsGetMemoryUsage,
      devtoolsGetDomCounters,
      devtoolsStartProfiling,
      devtoolsStopProfiling,
      devtoolsSimulateNetwork,
      storageGetLocal,
      storageSetLocal,
      storageRemoveLocal,
      storageClearLocal,
      storageGetSession,
      storageSetSession,
      storageGetCookies,
      storageSetCookie,
      storageDeleteCookie,
      storageGetIndexedDB,
      storageExportState,
      storageImportState,
      authFillLoginForm,
      authSaveSession,
      authLoadSession,
      authListSessions,
      authDeleteSession,
      authCheckLoggedIn,
      tabNew,
      tabClose,
      tabList,
      tabSwitch,
      tabGetCurrent,
      contextNew,
      contextClose,
      processSpawn,
      processList,
      processGetLogs,
      processGetStatus,
      processSendInput,
      processKill,
      processWaitForReady,
      processAttachPid,
      processAttachPort,
      processRestart,
      processGetTracked,
      processStopTracked,
      processSpawnTracked,
      processRenameTracked,
      processCleanupTracked,
      processClearLogs,
      inspect,
      supervisorControl,
      persistControl,
      doctor,
      terminalWatchFile,
      terminalGetLogs,
      terminalGetErrors,
      terminalListWatchers,
      terminalStopWatcher,
      terminalWatchPipe,
      terminalClearBuffer,
      diagnosePage,
      diagnoseElement,
      diagnoseNetwork,
      diagnoseAuth,
      diagnoseFullstack,
      diagnosePerformance,
      schedulerGetStats,
      schedulerGetLastResult,
      schedulerTriggerRule,
      schedulerListRules,
      schedulerDisableRule,
      schedulerEnableRule,
      schedulerClearHistory,
      smartWait,
      smartWaitForSpa,
      smartNavigate,
      smartFillForm,
      smartValidateForm,
      browserScreenshotAnnotated,
      browserScreenshotExport,
      browserScreenshotDiff,
      plannerExecuteGoal,
      plannerCreatePlan,
      plannerListPlans,
      plannerGetPlan,
      plannerCancelPlan,
      // AI-Native API
      observe,
      aiDiagnose,
      correlate,
      summarize,
      explain,
      investigate,
      predict,
      toolsHelp,
      // Performance Budget
      budgetCheckPage,
      budgetGetSummary,
      // Mobile
      mobileListDevices,
      mobileTap,
      mobileType,
      mobileSwipe,
      mobileKeyevent,
      mobileScreenshot,
      mobileLogcat,
      mobileInstallApk,
      mobileLaunchApp,
      mobileStopApp,
      mobileDeviceInfo,
      mobileGetUiHierarchy,
      mobileLongPress,
      mobilePinch,
      mobileGetCurrentActivity,
      mobileInspectWebview,
      mobileGetWebviewContent,
      mobileCaptureWebviewConsole,
      // Test authoring
      recorderStart,
      recorderStop,
      recorderExport,
      recorderList,
      recorderCapture,
      browserAssert,
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
      resourceManager: this.resourceManager,
      stateManager: this.stateManager,
      capabilityDetector: this.capabilityDetector,
      planner: this.planner,
      workflowEngine: this.workflowEngine,
      recorder: this.recorder,
      workflowScheduler: this.workflowScheduler,
      eventBus: this.eventBus,
      lazyContext: this.lazyContext,
      incidentEngine: this.incidentEngine,
      toolRegistry: this.toolRegistry,
      tokenBudget: { maxResponseTokens: this.config.tokenBudget.maxResponseTokens ?? 8000 },
    };
  }

  /** Expose config for CLI flags like --sse */
  getConfig(): FennecConfig {
    return this.config;
  }

  private async setupSessionCDPMonitoring(session?: FennecSession): Promise<void> {
    const logger = getLogger();
    try {
      const target = session ?? this.sessionManager.getOrDefault();
      if (!target) {
        logger.warn('No session available for CDP monitoring');
        return;
      }

      // (Re)create collectors and enable them on the session's CURRENT cdp.
      // After a context rotation the cdp is a fresh object, so we re-enable
      // here to keep capturing console/network on the recycled context.
      const consoleCollector = new ConsoleCollector();
      const networkCollector = new NetworkCollector();

      consoleCollector.on('smart-hook', (event) => {
        this.sessionManager.addConsoleEvent(target.id, event);
      });

      networkCollector.on('smart-hook', (event) => {
        this.sessionManager.addNetworkEvent(target.id, event);
      });

      await consoleCollector.enable(target.browser.cdp(), {
        ignorePatterns: [
          ...DEFAULT_CONSOLE_IGNORE_PATTERNS,
          ...(this.config.console.ignorePatterns ?? []),
        ],
      });
      await networkCollector.enable(target.browser.cdp());

      logger.info(`CDP monitoring enabled for session ${target.id}`);
    } catch (error) {
      logger.warn({ error }, 'Failed to setup CDP monitoring (non-fatal)');
    }
  }

  private setupHandlers(): void {
    const logger = getLogger();

    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const categories = (request.params as Record<string, unknown>)?.categories as
        string[] | undefined;

      // Default categories when client doesn't specify: only load essential tool groups
      // This saves ~1000+ tokens vs loading all 90+ tools
      // Default categories: essential tool groups for AI agents
      // Includes process + terminal so agents can check running apps & logs without extra queries
      const defaultCategories = [
        'navigation',
        'interaction',
        'dom',
        'smart',
        'ai',
        'diagnostic',
        'process',
        'terminal',
        'auth',
        'tabs',
        'devtools',
      ];
      const selectedCategories = categories?.length ? categories : defaultCategories;
      const tools = this.toolRegistry.getByCategories(selectedCategories);

      // Token tier per tool helps the agent prefer cheap tools before expensive ones.
      // Single source of truth: declare any exceptions in TIER_OVERRIDE, otherwise
      // the name-based heuristic below decides. Category is used as a secondary
      // signal so a high-cost tool can't silently get a "low" tier.
      const TIER_OVERRIDE: Record<string, 'low' | 'medium' | 'high'> = {
        // "tool_name": "high",
      };
      const HIGH_BANDWIDTH =
        /(screenshot|dom_snapshot|screenshot_diff|screenshot_export|screenshot_annotated|screenshot_baseline)/;
      const MED_BANDWIDTH =
        /(network_get_logs|storage_export|console|performance|get_dom|get_accessibility)/;
      const HIGH_CATEGORY = new Set(['dom', 'smart']);
      const MED_CATEGORY = new Set(['devtools', 'storage', 'diagnostic']);
      const tokenTier = (name: string, category?: string): 'low' | 'medium' | 'high' =>
        TIER_OVERRIDE[name] ??
        (HIGH_BANDWIDTH.test(name)
          ? 'high'
          : MED_BANDWIDTH.test(name)
            ? 'medium'
            : HIGH_CATEGORY.has(category ?? '')
              ? 'high'
              : MED_CATEGORY.has(category ?? '')
                ? 'medium'
                : 'low');

      const maxTokens = this.config.tokenBudget.maxResponseTokens ?? 8000;
      return {
        tools: tools.map((t) => {
          const { $schema, ...schema } = zodToJsonSchema(t.inputSchema) as any;
          return {
            name: t.name,
            description: t.description,
            inputSchema: schema,
            _category: t.category,
            _tokenTier: tokenTier(t.name, t.category),
          };
        }),
        _categories: this.toolRegistry.getCategories(),
        _hint:
          'Use ?categories=[...] to load specific tool groups. Available categories: ' +
          this.toolRegistry.getCategories().join(', ') +
          `. Prefer _tokenTier:"low" tools (text/state-based) before "high" ones (screenshots / DOM dumps). ` +
          `Each tool response is truncated at ~${maxTokens} tokens.`,
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const meta = (request.params as Record<string, unknown>)?._meta as
        Record<string, unknown> | undefined;
      const progressToken = meta?.progressToken as string | number | undefined;
      const tool = this.toolRegistry.get(name);

      if (!tool) {
        logger.warn({ tool: name }, 'Unknown tool called');
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}. Available tools: ${this.toolRegistry
                .getAll()
                .map((t) => t.name)
                .join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const parsed = tool.inputSchema.parse(args ?? {});
        const context = this.getToolContext();
        if (progressToken) {
          context.progressReporter = new ProgressReporter({
            server: this.server,
            progressToken,
            toolName: name,
          });
        }

        // Recover dead browser sessions (issue #4): if the page/CDP target
        // died (e.g. cross-scheme navigation), recreate it before the call
        // so the agent never sees a wall of "Unable to connect" errors.
        try {
          await this.sessionManager.ensureAlive(
            (parsed as Record<string, unknown>).sessionId as string | undefined,
          );
        } catch {
          // best-effort — the tool call itself will surface any real error
        }
        const result = await this.pipeline.execute(tool, parsed, context);

        const isError =
          result && typeof result === 'object' && 'success' in result && result.success === false;
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: isError === true ? true : undefined,
        };
      } catch (error) {
        if (error instanceof ZodError) {
          logger.warn({ tool: name, error }, 'Input validation failed');
          return {
            content: [{ type: 'text', text: `Invalid parameters for ${name}: ${error.message}` }],
            isError: true,
          };
        }
        logger.error({ tool: name, error }, 'Tool execution failed');

        let enrichedContext: Record<string, unknown> = {};
        try {
          const session = this.sessionManager.getOrDefault();
          const enricher = new ErrorEnricher();
          enrichedContext = (await enricher.enrich(session)) as unknown as Record<string, unknown>;
        } catch (err) {
          logger.warn(
            { tool: name, error: err },
            'Tool execution error enrichment failed (non-fatal)',
          );
        }

        const errorResponse = this.responseBuilder.error(error, {
          code: 'TOOL_EXECUTION_FAILED',
          suggestions: [
            'Check if the browser session is still active',
            "Verify the page hasn't been closed or navigated away",
          ],
          context: enrichedContext,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(errorResponse) }],
          isError: true,
        };
      }
    });
  }

  private setupPipeline(): void {
    this.pipeline.use(createTelemetryMiddleware(this.performanceMetrics));
    this.pipeline.use(this.auditLog.middleware);
    this.pipeline.use(createPermissionGuard());
    this.pipeline.use(createStateMachineMiddleware());
    // Lazy Context levels: registered in reverse order (outer→inner) so post-processing runs 0→1→2→3
    // PulseContext (L0) must be registered AFTER L1-L3 so its post-processing (adding meta.pulse)
    // runs BEFORE L1-L3's post-processing (reading meta.pulse).
    const tb = this.config.tokenBudget;
    this.pipeline.use(
      createLazyLevel1(this.lazyContext, {
        enabled: this.config.lazyContext.level1,
        maxTokens: tb.level1MaxTokens,
      }),
    ); // ← Lazy Context Level 1
    this.pipeline.use(
      createLazyLevel2(this.lazyContext, {
        enabled: this.config.lazyContext.level2,
        maxTokens: tb.level2MaxTokens,
      }),
    ); // ← Lazy Context Level 2
    this.pipeline.use(
      createLazyLevel3(this.lazyContext, {
        enabled: this.config.lazyContext.level3,
        maxTokens: tb.level3MaxTokens,
      }),
    ); // ← Lazy Context Level 3
    this.pipeline.use(createPulseContext()); // ← Lazy Context Level 0 (registers LAST so post-processing runs FIRST)
    this.pipeline.use(createEventBusMiddleware(this.eventBus)); // ← Route tools through EventBus
    this.pipeline.use(createStabilityMiddleware());
    this.pipeline.use(createSmartHook());
    this.pipeline.use(createRetryHandler({ maxRetries: 2 }));
  }

  /**
   * Start the MCP server with SSE transport.
   * Creates an HTTP server that accepts SSE connections and message posts.
   *
   * Endpoints:
   *   GET  /sse        — SSE stream (client connects here)
   *   POST /messages   — Message endpoint (client sends tool calls here)
   */
  private async startSSE(): Promise<void> {
    const logger = getLogger();
    const port = this.config.transport.port;
    const host = this.config.transport.host;

    logger.info({ port, host }, 'Starting Fennec MCP server (SSE transport)...');

    return new Promise((resolve, reject) => {
      this.httpServer = createServer(async (req, res) => {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          });
          res.end();
          return;
        }

        // Add CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');

        const url = new URL(req.url ?? '/', `http://${host}:${port}`);

        if (req.method === 'GET' && url.pathname === '/sse') {
          // SSE endpoint: create a new SSEServerTransport for this connection
          logger.info('SSE client connected');

          // Close any existing transport connection to avoid "Already connected" error
          await this.server.close().catch(() => {});

          const transport = new SSEServerTransport('/messages', res);
          this.sseTransport = transport;

          try {
            await this.server.connect(transport);
            logger.info('MCP server connected via SSE transport');
            resolve();
          } catch (error) {
            logger.error({ error }, 'Failed to connect MCP server via SSE');
            reject(error);
          }

          // Handle client disconnect
          req.on('close', async () => {
            logger.info('SSE client disconnected');
            if (this.sseTransport === transport) {
              this.sseTransport = null;
              await this.server.close().catch(() => {});
            }
          });
        } else if (req.method === 'POST' && url.pathname === '/messages') {
          // Message endpoint: forward POST data to existing SSE transport
          if (this.sseTransport) {
            try {
              await this.sseTransport.handlePostMessage(req, res);
            } catch (error) {
              logger.error({ error }, 'Failed to handle SSE message');
              res.writeHead(500).end('Internal server error');
            }
          } else {
            res.writeHead(400).end('No active SSE connection');
          }
        } else {
          // Health check endpoint
          if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', transport: 'sse' }));
            return;
          }
          res.writeHead(404).end('Not found');
        }
      });

      this.httpServer.listen(port, host, () => {
        logger.info({ port, host }, 'Fennec SSE transport listening');
        resolve();
      });

      this.httpServer.on('error', (error) => {
        logger.error({ error }, 'SSE HTTP server error');
        reject(error);
      });
    });
  }

  async start(): Promise<void> {
    const logger = getLogger();

    // Auto-detect browser adapter and inject the right engine
    try {
      const adapter = await selectAdapter(this.config.browser.adapter);
      logger.info({ adapter: adapter.adapter, reason: adapter.reason }, 'Browser adapter selected');

      // Create the selected engine and inject it into SessionManager
      const engine = await createEngine(adapter.adapter, this.config.browser.type);
      this.sessionManager.setEngine(engine);
      logger.info({ engine: adapter.adapter }, 'Engine injected into SessionManager');
    } catch {
      logger.warn('Browser adapter detection failed — using default Playwright');
    }

    await this.sessionManager.initialize();

    // After a context rotation the underlying CDPSession is replaced, so
    // re-enable the console/network collectors on the fresh context.
    this.sessionManager.setOnRotate(async (id: string) => {
      try {
        const session = this.sessionManager.getSession(id);
        await this.setupSessionCDPMonitoring(session);
      } catch {
        // session may already be gone — ignore
      }
    });

    await this.setupSessionCDPMonitoring();

    this.workflowEngine.createDebugWorkflow('auto-diagnose');
    this.workflowEngine.createLoginWorkflow('auto-login');

    const debugWf = this.workflowEngine.findByTag('diagnostic')[0];
    if (debugWf) {
      const defaultRules = WorkflowScheduler.createDefaultRules(debugWf.id);
      this.workflowScheduler.addRules(defaultRules);
      this.workflowScheduler.start();
      logger.info(
        { rules: defaultRules.length },
        'WorkflowScheduler: auto-trigger rules registered',
      );
    }

    this.resourceManager.startAutoCleanup();
    this.resourceManager.startHealthChecks();

    if (this.config.transport.type === 'sse') {
      await this.startSSE();
    } else {
      const transport = new StdioServerTransport();
      logger.info('Starting Fennec MCP server (stdio transport)...');
      await this.server.connect(transport);

      const shutdown = async () => {
        logger.info('Shutting down Fennec...');
        this.workflowScheduler.stop();
        this.resourceManager.stopAutoCleanup();
        this.resourceManager.stopHealthChecks();
        await this.resourceManager.releaseAll();
        this.processManager.cleanup();
        this.logWatcher.cleanup();
        await this.sessionManager.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    }
  }
}
