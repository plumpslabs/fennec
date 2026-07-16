/**
 * Adapter Types — Shared types for the multi-language debug adapter layer.
 *
 * All adapters (V8/CDP, Python debugpy, PHP Xdebug, Go Delve, JVM JDWP,
 * .NET NetCoreDbg, Ruby ruby/debug, Rust/C lldb-dap, Dart) implement the
 * DebugAdapter interface so BreakpointSessionManager can work with any runtime.
 */

// ─── Runtime Identification ──────────────────────────────────────

export type RuntimeType =
  | 'node' // Node.js / V8 (CDP)
  | 'python' // Python (debugpy — DAP)
  | 'php' // PHP (Xdebug — DBGp)
  | 'go' // Go (Delve — DAP)
  | 'java' // JVM languages (JDWP → DAP)
  | 'dotnet' // .NET (NetCoreDbg — DAP)
  | 'ruby' // Ruby (ruby/debug — DAP)
  | 'rust' // Rust (lldb-dap — DAP)
  | 'cpp' // C/C++ (lldb-dap — DAP)
  | 'swift' // Swift (lldb-dap — DAP)
  | 'zig' // Zig (lldb-dap — DAP)
  | 'dart' // Dart/Flutter (DAP)
  | 'unknown';

// ─── Adapter Interface ───────────────────────────────────────────

export interface BreakpointResult {
  breakpointId: string;
  locations: Array<{ scriptId: string; lineNumber: number; columnNumber: number }>;
}

export interface RemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
  preview?: any;
}

export interface PropertyDescriptor {
  name: string;
  value?: RemoteObject;
  get?: RemoteObject;
  set?: RemoteObject;
  writable?: boolean;
  configurable?: boolean;
  enumerable?: boolean;
  isOwn?: boolean;
}

export interface CallFrame {
  callFrameId: string;
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  scopeChain: Array<{
    type: string;
    object: RemoteObject;
    name?: string;
  }>;
  this: RemoteObject;
  returnValue?: RemoteObject;
}

export interface PausedEvent {
  callFrames: CallFrame[];
  reason: string;
  data?: any;
  hitBreakpoints?: string[];
  asyncStackTrace?: any;
}

export interface EvaluateResult {
  result: RemoteObject;
  exceptionDetails?: { text: string; stackTrace?: any };
}

export interface PropertiesResult {
  result: PropertyDescriptor[];
  internalProperties?: PropertyDescriptor[];
  exceptionDetails?: any;
}

/**
 * Common interface all debug adapters must implement.
 * BreakpointSessionManager works with any adapter implementing this.
 */
export interface DebugAdapter {
  /** Whether the debugger is currently enabled. */
  readonly isEnabled: boolean;
  /** Identifies the runtime language. */
  readonly runtime: RuntimeType;

  /** Enable debugging. Returns a debugger ID. */
  enable(): Promise<string>;
  /** Disable debugging and release resources. */
  disable(): Promise<void>;

  // ── Breakpoint Management ──
  setBreakpointByUrl(
    file: string,
    line: number,
    options?: {
      column?: number;
      condition?: string;
      logMessage?: string;
    },
  ): Promise<BreakpointResult>;
  removeBreakpoint(breakpointId: string): Promise<void>;

  // ── Execution Control ──
  resume(): Promise<void>;
  stepOver(): Promise<void>;
  stepInto(): Promise<void>;
  stepOut(): Promise<void>;

  // ── Evaluation & Inspection ──
  evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
    options?: {
      returnByValue?: boolean;
      generatePreview?: boolean;
    },
  ): Promise<EvaluateResult>;
  getProperties(
    objectId: string,
    options?: {
      ownProperties?: boolean;
      generatePreview?: boolean;
    },
  ): Promise<PropertiesResult>;

  // ── Event Handlers ──
  onPaused(handler: (event: PausedEvent) => void): void;
  onResumed(handler: () => void): void;
  onScriptParsed(handler: (script: any) => void): void;
}

// ─── Runtime detection helpers ───────────────────────────────────

export interface RuntimeDetector {
  runtime: RuntimeType;
  /** Check if a process command string matches this runtime. */
  matchesCommand(command: string): boolean;
  /** Check if the required debug tool is installed on the system. */
  isToolInstalled(): Promise<boolean>;
}

/**
 * Standard runtime detectors used by the adapter registry.
 */
export const RUNTIME_DETECTORS: RuntimeDetector[] = [
  {
    runtime: 'node',
    matchesCommand: (cmd: string) => /node|nodejs|tsx|ts-node/.test(cmd),
    isToolInstalled: () => Promise.resolve(true), // V8 inspector is built-in
  },
  {
    runtime: 'python',
    matchesCommand: (cmd: string) =>
      /python|python3|uv run|poetry run|flask|django|fastapi|uvicorn|gunicorn/.test(cmd),
    isToolInstalled: async () => {
      try {
        const { execSync } = await import('child_process');
        execSync(
          'python3 -c "import debugpy" 2>/dev/null || python -c "import debugpy" 2>/dev/null',
          {
            timeout: 5000,
          },
        );
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    runtime: 'php',
    matchesCommand: (cmd: string) => /php|php-fpm|artisan|symfony|composer/.test(cmd),
    isToolInstalled: async () => {
      try {
        const { execSync } = await import('child_process');
        execSync('php -m 2>/dev/null | grep -i xdebug', { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    runtime: 'go',
    matchesCommand: (cmd: string) => /\bgo\b|air|gowatch/.test(cmd),
    isToolInstalled: async () => {
      try {
        const { execSync } = await import('child_process');
        execSync('dlv version 2>/dev/null', { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    runtime: 'java',
    matchesCommand: (cmd: string) =>
      /java|java -jar|mvn|gradle|spring-boot|spring boot|kotlin/.test(cmd),
    isToolInstalled: async () => {
      try {
        const { execSync } = await import('child_process');
        execSync('java -version 2>&1', { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    runtime: 'dotnet',
    matchesCommand: (cmd: string) => /dotnet\b|dotnet run|dotnet watch/.test(cmd),
    isToolInstalled: async () => {
      try {
        const { execSync } = await import('child_process');
        execSync('dotnet --version 2>/dev/null', { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    runtime: 'ruby',
    matchesCommand: (cmd: string) => /ruby|ruby |rails|rake|rspec|bundle/.test(cmd),
    isToolInstalled: async () => {
      try {
        const { execSync } = await import('child_process');
        execSync('ruby -e "require \\\"debug\\\"" 2>/dev/null', { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    runtime: 'rust',
    matchesCommand: (cmd: string) => /rust|cargo\b|cargo run|cargo build|rustc/.test(cmd),
    isToolInstalled: async () => {
      try {
        const { execSync } = await import('child_process');
        execSync('lldb-dap --version 2>/dev/null || lldb-dap-18 --version 2>/dev/null', {
          timeout: 5000,
        });
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    runtime: 'dart',
    matchesCommand: (cmd: string) => /dart\b|dart run|flutter\b|flutter run/.test(cmd),
    isToolInstalled: async () => {
      try {
        const { execSync } = await import('child_process');
        execSync('dart --version 2>/dev/null || flutter --version 2>/dev/null', {
          timeout: 5000,
        });
        return true;
      } catch {
        return false;
      }
    },
  },
];
