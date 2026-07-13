/**
 * Browser Module
 *
 * Provides browser automation tools: navigation, interaction, DOM inspection,
 * DevTools (console, network, performance), storage, auth, tabs, and screenshots.
 *
 * Uses the BrowserEngine abstraction to support multiple browser backends
 * (Playwright, Puppeteer, CDP Direct, etc.).
 */

import type { FennecModule, ModuleContext } from "../../module/index.js";
import type { ToolDefinition } from "../../tools/_registry.js";

// Import all browser tools
import {
  browserNavigate,
  browserGoBack,
  browserGoForward,
  browserReload,
  browserGetCurrentUrl,
  browserWaitForNavigation,
} from "../../tools/navigation/index.js";
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
} from "../../tools/interaction/index.js";
import {
  browserScreenshot,
  browserGetElementText,
  browserGetDomSnapshot,
  browserGetAccessibilityTree,
  browserFindElements,
  browserGetElementInfo,
  browserWaitForElement,
  browserGetPageText,
  browserGetPageTitle,
  browserGetMeta,
} from "../../tools/dom/index.js";
import {
  devtoolsGetConsoleLogs,
  devtoolsClearConsole,
  devtoolsEvaluate,
  devtoolsGetJsErrors,
  devtoolsWatchConsole,
} from "../../tools/devtools/console.js";
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
  networkWaitForApiResponse,
} from "../../tools/devtools/network.js";
import {
  devtoolsGetPerformanceMetrics,
  devtoolsGetMemoryUsage,
  devtoolsGetDomCounters,
  devtoolsStartProfiling,
  devtoolsStopProfiling,
  devtoolsSimulateNetwork,
} from "../../tools/devtools/performance.js";
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
} from "../../tools/storage/index.js";
import {
  authFillLoginForm,
  authSaveSession,
  authLoadSession,
  authListSessions,
  authDeleteSession,
  authCheckLoggedIn,
} from "../../tools/auth/index.js";
import {
  tabNew,
  tabClose,
  tabList,
  tabSwitch,
  tabGetCurrent,
  contextNew,
  contextClose,
  contextRotate,
} from "../../tools/tabs/index.js";
import {
  smartWait,
  smartNavigate,
  smartFillForm,
  smartValidateForm,
  browserScreenshotAnnotated,
  browserScreenshotExport,
  browserScreenshotDiff,
  browserScreenshotBaseline,
  compareSessions,
  testWithState,
  browserGetElementComponent,
} from "../../tools/smart/index.js";
import {
  diagnosePage,
  diagnoseElement,
  diagnoseNetwork,
  diagnoseAuth,
  diagnosePerformance,
} from "../../tools/diagnostic/index.js";

export const browserModule: FennecModule = {
  name: "browser",
  description: "Browser automation and DevTools — navigation, interaction, DOM, console, network, storage, auth, tabs, diagnostic",

  tools: [
    // Navigation
    browserNavigate,
    browserGoBack,
    browserGoForward,
    browserReload,
    browserGetCurrentUrl,
    browserWaitForNavigation,
    // Interaction
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
    // DOM
    browserScreenshot,
    browserGetElementText,
    browserGetDomSnapshot,
    browserGetAccessibilityTree,
    browserFindElements,
    browserGetElementInfo,
    browserWaitForElement,
    browserGetPageText,
    browserGetPageTitle,
    browserGetMeta,
    // DevTools Console
    devtoolsGetConsoleLogs,
    devtoolsClearConsole,
    devtoolsEvaluate,
    devtoolsGetJsErrors,
    devtoolsWatchConsole,
    // DevTools Network
    networkGetLogs,
    networkGetFailedRequests,
    networkGetCorsIssues,
    networkClearLogs,
    networkIntercept,
    networkRemoveIntercept,
    networkMockResponse,
    networkWaitForRequest,
    networkGetRequestDetail,
    networkWaitForApiResponse,
    // DevTools Performance
    devtoolsGetPerformanceMetrics,
    devtoolsGetMemoryUsage,
    devtoolsGetDomCounters,
    devtoolsStartProfiling,
    devtoolsStopProfiling,
    devtoolsSimulateNetwork,
    // Storage
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
    // Auth
    authFillLoginForm,
    authSaveSession,
    authLoadSession,
    authListSessions,
    authDeleteSession,
    authCheckLoggedIn,
    // Tabs
    tabNew,
    tabClose,
    tabList,
    tabSwitch,
    tabGetCurrent,
    contextNew,
    contextClose,
    contextRotate,
    // Smart
    smartWait,
    smartNavigate,
    smartFillForm,
    smartValidateForm,
    browserScreenshotAnnotated,
    browserScreenshotExport,
    browserScreenshotDiff,
    browserScreenshotBaseline,
    compareSessions,
    testWithState,
    browserGetElementComponent,
    // Diagnostic
    diagnosePage,
    diagnoseElement,
    diagnoseNetwork,
    diagnoseAuth,
    diagnosePerformance,
  ] as ToolDefinition[],

  capabilities: ["browser-automation", "cdp"],

  initialize: async (context: ModuleContext) => {
    context.logger.info("Browser module initialized");
  },
};
