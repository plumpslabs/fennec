// Fennec Core — Main Entry Point
// AI-native developer observability MCP server

export { FennecServer } from './server.js';
export { SessionManager } from './session/SessionManager.js';
export { SessionStore } from './session/SessionStore.js';
export { StoreManager, redactSession } from './store/StoreManager.js';
export type { StoreKind, StoreScanEntry } from './store/StoreManager.js';
export { ToolRegistry, createTool } from './tools/_registry.js';
export { ResponseBuilder } from './response/ResponseBuilder.js';
export { ErrorEnricher } from './response/ErrorEnricher.js';
export { ConfigLoader } from './config/ConfigLoader.js';
export { defaultConfig } from './config/defaults.js';
export type { FennecConfig } from './config/defaults.js';
export {
  EventBus,
  CorrelationEngine,
  RootCauseInferrer,
  EventNormalizer,
} from './correlation/index.js';
export type { NormalizedEvent, EventSource, EventSeverity } from './correlation/index.js';
export { ProcessManager } from './process/ProcessManager.js';
export { LogWatcher } from './process/LogWatcher.js';
export { PipeWatcher } from './process/PipeWatcher.js';
export { PortDetector } from './process/PortDetector.js';
export { ConsoleCollector } from './cdp/ConsoleCollector.js';
export { NetworkCollector } from './cdp/NetworkCollector.js';
export { PerformanceCollector } from './cdp/PerformanceCollector.js';
export { findElement, resolveSelector } from './utils/selector.js';
export { getLogger, createLogger, setLogger } from './utils/logger.js';
export { detectLogLevel, isErrorLine } from './utils/levelDetector.js';
export type { LogLevel } from './utils/levelDetector.js';
export type { FennecSession, ConsoleEvent, NetworkEvent, SessionMeta } from './session/types.js';
export type { ToolDefinition, ToolContext } from './tools/_registry.js';
export type { SavedSession } from './session/SessionStore.js';
export type { ManagedProcess } from './process/ProcessManager.js';
export type { WatcherLogEntry } from './process/LogWatcher.js';

// Incident Engine
export { IncidentEngine } from './incident/index.js';
export type { Incident, IncidentSeverity, IncidentStatus, Alert } from './incident/index.js';

// New Architecture Modules
export {
  Pipeline,
  createPermissionGuard,
  createRetryHandler,
  createTelemetryMiddleware,
  createSmartHook,
  createPulseContext,
} from './middleware/index.js';
export type { MiddlewareFn, MiddlewareContext } from './middleware/index.js';
export { ResourceManager } from './resource/index.js';
export type { Resource, ResourceType, ResourceLimits, HealthReport } from './resource/index.js';
export { StateManager, StateMachine } from './state/index.js';
export type { AppState, StateTransition, StateHistoryEntry } from './state/index.js';
export { CapabilityDetector } from './capability/index.js';
export type {
  CapabilityReport,
  FrameworkCapability,
  EnvironmentCapability,
} from './capability/index.js';
export { Planner } from './planner/index.js';
export type { Plan, PlanStep, PlanStatus, PlanExecutor } from './planner/index.js';
export { WorkflowEngine } from './workflow/index.js';
export type {
  Workflow,
  WorkflowStep,
  WorkflowStepType,
  WorkflowExecution,
} from './workflow/index.js';
export { Recorder } from './recorder/index.js';
export type { RecordedAction, Recording, ReplayResult } from './recorder/index.js';
export { PluginSystem } from './plugin/index.js';
export type {
  PluginManifest,
  PluginInstance,
  PluginAPI,
  PluginHookType,
  HookHandler,
} from './plugin/index.js';
export { KnowledgeGraph } from './knowledge/index.js';
export type { GraphNode, GraphEdge, KnowledgeReport } from './knowledge/index.js';
export { WorkflowScheduler } from './scheduler/index.js';
export type {
  TriggerRule,
  TriggerCondition,
  TriggerPriority,
  TriggerEvent,
  SchedulerStats,
} from './scheduler/index.js';

// Mobile Module
export { AdbClient } from './modules/mobile/adb-client.js';
export type { AdbDevice, AdbScreenshotResult, LogcatEntry } from './modules/mobile/adb-client.js';
