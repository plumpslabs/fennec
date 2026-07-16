# Configuration Reference

Fennec can be configured via a YAML configuration file or environment variables.

## Config File

Generate a config file with:

```bash
fennec init
```

This creates `./fennec.config.yaml` with all default values.

## Full Reference

```yaml
# fennec.config.yaml

browser:
  adapter: auto # auto | cdp | playwright
  type: chromium # chromium | firefox | webkit
  headless: true
  slowMo: 0 # ms delay between actions (useful for debugging)
  defaultTimeout: 30000 # ms
  viewport:
    width: 1280
    height: 720
  userAgent: null # null = browser default
  locale: 'en-US'
  timezone: 'Asia/Jakarta'
  ignoreHTTPSErrors: false

session:
  maxSessions: 10
  idleTimeoutSecs: 1800 # auto-cleanup after idle
  rotationIntervalSecs: 0 # 0 = off; periodic context recycling to prevent DOM/listener bloat
  persistPath: './.fennec/sessions'

process:
  maxProcesses: 10
  logBufferLines: 2000
  spawnAllowlist:
    - 'npm'
    - 'node'
    - 'pnpm'
    - 'yarn'
    - 'bun'
    - 'python'
    - 'python3'

terminal:
  logBufferLines: 2000
  watchDebounceMs: 50

network:
  bufferSize: 1000
  captureRequestBody: true
  captureResponseBody: true
  captureHeaders: true
  slowRequestThresholdMs: 1000

console:
  bufferSize: 500
  levels:
    - log
    - info
    - warn
    - error
    - debug
  # Messages matching any pattern are dropped before they reach the console
  # buffer, pulse status, or incident engine. Defaults already ignore common
  # dev-server HMR websocket noise (e.g. Vite). Strings are case-insensitive
  # substring matches; wrap in /regex/flags for full regex.
  ignorePatterns:
    - 'failed to connect to websocket'
    - 'insecure websocket connection'
    - 'websocket connection to'
    - 'hot update failed'
    - 'hmr update failed'

correlation:
  windowMs: 500
  enableRootCauseInference: true
  minConfidence: 0.7

lazyContext:
  level1: true # Auto-attach summary on errors
  level2: false # Attach detail on expand
  level3: false # Attach raw data on request

debug:
  allowDebug: false # Enable debug features globally
  allowDebugEval: false # Expression evaluation (high risk)
  allowedDirs: [] # Restrict breakpoints to these dirs
  allowDependencies: false # Allow breakpoints in dependencies

security:
  sandbox: true
  allowProcessSpawn: true
  allowProcessKill: false
  allowJSEvaluation: true
  allowFileRead: false
  allowFileWrite: false
  allowedDomains: []
  blockedDomains: []
  allowFileProtocol: false
  allowCDPRawAccess: false
  exportPath: './.fennec/exports'
  maxExportSizeMB: 10

transport:
  type: stdio # stdio | sse
  port: 3333 # SSE only
  host: '127.0.0.1' # SSE only

logging:
  level: info
  format: pretty # pretty | json
  file: null # null = stdout only
```

## Environment Variables

All configuration values can be overridden via environment variables:

| Variable                 | Description                                |
| ------------------------ | ------------------------------------------ |
| `FENNEC_BROWSER_TYPE`    | Browser engine (chromium, firefox, webkit) |
| `FENNEC_HEADLESS`        | Run browser headless (true/false)          |
| `FENNEC_DEFAULT_TIMEOUT` | Default timeout in ms                      |
| `FENNEC_VIEWPORT_WIDTH`  | Viewport width                             |
| `FENNEC_VIEWPORT_HEIGHT` | Viewport height                            |
| `FENNEC_TRANSPORT_TYPE`  | Transport type (stdio/sse)                 |
| `FENNEC_PORT`            | SSE port                                   |
| `FENNEC_LOG_LEVEL`       | Log level (debug/info/warn/error)          |
| `FENNEC_SANDBOX`         | Enable sandbox mode (true/false)           |
| `FENNEC_SECURITY_ALLOW_PROCESS_SPAWN` | Allow AI to spawn processes    |
| `FENNEC_SECURITY_ALLOW_PROCESS_KILL`  | Allow AI to kill processes      |
| `FENNEC_SECURITY_ALLOW_JS_EVALUATION` | Allow in-page JS evaluation     |
| `FENNEC_SECURITY_ALLOW_FILE_READ`     | Allow file read operations       |
| `FENNEC_SECURITY_ALLOW_FILE_WRITE`    | Allow file write operations      |
| `FENNEC_SECURITY_ALLOW_CDP_RAW_ACCESS`| Allow direct CDP raw access      |
| `FENNEC_SECURITY_DEBUG_ALLOWED_DIRS`  | Restrict debug to these dirs     |
| `FENNEC_DEBUG_ALLOW_DEPENDENCIES`     | Allow breakpoints in dependencies|
| `FENNEC_BROWSER_ADAPTER`  | Browser adapter (auto/cdp/playwright)       |
| `FENNEC_SESSION_ROTATION_INTERVAL_SECS` | Context rotation interval (secs) |
| `FENNEC_TOKEN_BUDGET_LEVEL1` | Token budget for Lazy Context L1         |
| `FENNEC_TOKEN_BUDGET_LEVEL2` | Token budget for Lazy Context L2         |
| `FENNEC_TOKEN_BUDGET_LEVEL3` | Token budget for Lazy Context L3         |
| `FENNEC_CONFIG`          | Path to config file                        |
