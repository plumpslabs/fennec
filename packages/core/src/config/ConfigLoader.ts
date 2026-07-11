import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { defaultConfig, type FennecConfig } from "./defaults.js";
import { load as parseYaml } from "js-yaml";

export class ConfigLoader {
  private config: FennecConfig;

  constructor(configPath?: string) {
    this.config = this.load(configPath);
  }

  private load(configPath?: string): FennecConfig {
    const merged = structuredClone(defaultConfig);

    if (configPath) {
      const resolvedPath = resolve(configPath);
      if (existsSync(resolvedPath)) {
        try {
          const content = readFileSync(resolvedPath, "utf-8");
          const ext = extname(configPath).toLowerCase();
          
          if (ext === ".json") {
            const partial = JSON.parse(content) as Partial<FennecConfig>;
            return this.deepMerge(merged, partial);
          }
          
          if (ext === ".yaml" || ext === ".yml") {
            const partial = parseYaml(content) as Partial<FennecConfig>;
            return this.deepMerge(merged, partial);
          }
        } catch {
          // Silently fall back to defaults + env vars
        }
      }
    }

    // Override with environment variables
    if (process.env.FENNEC_BROWSER_TYPE) {
      merged.browser.type = process.env.FENNEC_BROWSER_TYPE as FennecConfig["browser"]["type"];
    }
    if (process.env.FENNEC_HEADLESS) {
      merged.browser.headless = process.env.FENNEC_HEADLESS !== "false";
    }
    if (process.env.FENNEC_DEFAULT_TIMEOUT) {
      merged.browser.defaultTimeout = parseInt(process.env.FENNEC_DEFAULT_TIMEOUT, 10);
    }
    if (process.env.FENNEC_VIEWPORT_WIDTH) {
      merged.browser.viewport.width = parseInt(process.env.FENNEC_VIEWPORT_WIDTH, 10);
    }
    if (process.env.FENNEC_VIEWPORT_HEIGHT) {
      merged.browser.viewport.height = parseInt(process.env.FENNEC_VIEWPORT_HEIGHT, 10);
    }
    if (process.env.FENNEC_TRANSPORT_TYPE) {
      merged.transport.type = process.env.FENNEC_TRANSPORT_TYPE as "stdio" | "sse";
    }
    if (process.env.FENNEC_PORT) {
      merged.transport.port = parseInt(process.env.FENNEC_PORT, 10);
    }
    if (process.env.FENNEC_LOG_LEVEL) {
      merged.logging.level = process.env.FENNEC_LOG_LEVEL as FennecConfig["logging"]["level"];
    }
    if (process.env.FENNEC_SANDBOX) {
      merged.security.sandbox = process.env.FENNEC_SANDBOX !== "false";
    }
    if (process.env.FENNEC_SECURITY_ALLOW_PROCESS_SPAWN) {
      merged.security.allowProcessSpawn = process.env.FENNEC_SECURITY_ALLOW_PROCESS_SPAWN !== "false";
    }
    if (process.env.FENNEC_SECURITY_ALLOW_PROCESS_KILL) {
      merged.security.allowProcessKill = process.env.FENNEC_SECURITY_ALLOW_PROCESS_KILL !== "false";
    }
    if (process.env.FENNEC_SECURITY_ALLOW_JS_EVALUATION) {
      merged.security.allowJSEvaluation = process.env.FENNEC_SECURITY_ALLOW_JS_EVALUATION !== "false";
    }

    return merged;
  }

  private deepMerge(base: FennecConfig, partial: Partial<FennecConfig>): FennecConfig {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = structuredClone(base) as any;
    for (const key of Object.keys(partial) as (keyof FennecConfig)[]) {
      const val = partial[key];
      if (val !== undefined) {
        if (typeof val === "object" && !Array.isArray(val) && val !== null) {
          result[key] = { ...result[key], ...val };
        } else {
          result[key] = val;
        }
      }
    }
    return result as FennecConfig;
  }

  getConfig(): FennecConfig {
    return this.config;
  }

  get<K extends keyof FennecConfig>(key: K): FennecConfig[K] {
    return this.config[key];
  }
}
