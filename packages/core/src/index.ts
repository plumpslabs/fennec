// Fennec Core — Main Entry Point
// AI-native developer observability MCP server

export { FennecServer } from "./server.js";
export { SessionManager } from "./session/SessionManager.js";
export { SessionStore } from "./session/SessionStore.js";
export { ToolRegistry, createTool } from "./tools/_registry.js";
export { ResponseBuilder } from "./response/ResponseBuilder.js";
export { ErrorEnricher } from "./response/ErrorEnricher.js";
export { ConfigLoader } from "./config/ConfigLoader.js";
export { defaultConfig } from "./config/defaults.js";
export type { FennecConfig } from "./config/defaults.js";
export { EventBus } from "./correlation/EventBus.js";
export { CorrelationEngine } from "./correlation/CorrelationEngine.js";
export { RootCauseInferrer } from "./correlation/RootCauseInferrer.js";
export { ProcessManager } from "./process/ProcessManager.js";
export { LogWatcher } from "./process/LogWatcher.js";
export { PipeWatcher } from "./process/PipeWatcher.js";
export { PortDetector } from "./process/PortDetector.js";
export { ConsoleCollector } from "./cdp/ConsoleCollector.js";
export { NetworkCollector } from "./cdp/NetworkCollector.js";
export { PerformanceCollector } from "./cdp/PerformanceCollector.js";
export { findElement, resolveSelector } from "./utils/selector.js";
export { getLogger, createLogger, setLogger } from "./utils/logger.js";
export { detectLogLevel, isErrorLine } from "./utils/levelDetector.js";
export type { LogLevel } from "./utils/levelDetector.js";
export type { FennecSession, ConsoleEvent, NetworkEvent, SessionMeta } from "./session/types.js";
export type { ToolDefinition, ToolContext } from "./tools/_registry.js";
export type { SavedSession } from "./session/SessionStore.js";
export type { ManagedProcess } from "./process/ProcessManager.js";
export type { WatcherLogEntry } from "./process/LogWatcher.js";
