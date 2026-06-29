import type { MiddlewareFn, MiddlewareContext } from "./Pipeline.js";
import { getLogger } from "../utils/logger.js";

const DANGEROUS_TOOLS = new Set([
  "process_kill",
  "process_spawn",
  "devtools_evaluate",
  "storage_clear_local",
  "storage_delete_cookie",
  "storage_remove_local",
]);

const SPAWN_RELATED_TOOLS = new Set([
  "process_spawn",
  "process_restart",
  "browser_upload_file",
  "network_intercept",
  "network_mock_response",
]);

export function createPermissionGuard(): MiddlewareFn {
  const logger = getLogger();

  return async (ctx: MiddlewareContext, next) => {
    const { config, toolName } = ctx;

    // Sandbox mode: block dangerous tools unless explicitly allowed
    if (config.security.sandbox) {
      if (DANGEROUS_TOOLS.has(toolName)) {
        // Check specific permissions
        if (toolName === "process_kill" && !config.security.allowProcessKill) {
          logger.warn({ tool: toolName }, "Permission denied: process kill not allowed");
          return {
            success: false,
            error: {
              code: "PERMISSION_DENIED",
              message: `Tool '${toolName}' is not allowed in sandbox mode`,
              suggestions: [
                "Set security.allowProcessKill to true in config",
                "Disable sandbox mode with security.sandbox: false",
              ],
              context: {},
            },
            meta: { elapsed: Date.now() - ctx.startTime, sessionId: ctx.session?.id ?? "", timestamp: new Date().toISOString() },
          };
        }

        if (toolName === "process_spawn" && !config.security.allowProcessSpawn) {
          logger.warn({ tool: toolName }, "Permission denied: process spawn not allowed");
          return {
            success: false,
            error: {
              code: "PERMISSION_DENIED",
              message: "Process spawning is disabled by security settings",
              suggestions: ["Set security.allowProcessSpawn to true in config"],
              context: {},
            },
            meta: { elapsed: Date.now() - ctx.startTime, sessionId: ctx.session?.id ?? "", timestamp: new Date().toISOString() },
          };
        }

        if (toolName === "devtools_evaluate" && !config.security.allowJSEvaluation) {
          logger.warn({ tool: toolName }, "Permission denied: JS evaluation not allowed");
          return {
            success: false,
            error: {
              code: "PERMISSION_DENIED",
              message: "JavaScript evaluation is disabled in security settings",
              suggestions: ["Set security.allowJSEvaluation to true in config"],
              context: {},
            },
            meta: { elapsed: Date.now() - ctx.startTime, sessionId: ctx.session?.id ?? "", timestamp: new Date().toISOString() },
          };
        }
      }

      // Domain restrictions for browser navigation
      if (toolName === "browser_navigate") {
        const url = (ctx.input as Record<string, string | undefined>).url;
        if (url) {
          try {
            const parsedUrl = new URL(url);

            if (config.security.blockedDomains.length > 0) {
              const isBlocked = config.security.blockedDomains.some(
                (d) => parsedUrl.hostname.includes(d),
              );
              if (isBlocked) {
                logger.warn({ tool: toolName, url }, "Permission denied: blocked domain");
                return {
                  success: false,
                  error: {
                    code: "PERMISSION_DENIED",
                    message: `Domain ${parsedUrl.hostname} is blocked`,
                    suggestions: ["Remove the domain from security.blockedDomains in config"],
                    context: {},
                  },
                  meta: { elapsed: Date.now() - ctx.startTime, sessionId: ctx.session?.id ?? "", timestamp: new Date().toISOString() },
                };
              }
            }

            if (config.security.allowedDomains.length > 0) {
              const isAllowed = config.security.allowedDomains.some(
                (d) => parsedUrl.hostname.includes(d),
              );
              if (!isAllowed) {
                logger.warn({ tool: toolName, url }, "Permission denied: domain not in allowlist");
                return {
                  success: false,
                  error: {
                    code: "PERMISSION_DENIED",
                    message: `Domain ${parsedUrl.hostname} is not in allowed domains`,
                    suggestions: ["Add the domain to security.allowedDomains in config"],
                    context: {},
                  },
                  meta: { elapsed: Date.now() - ctx.startTime, sessionId: ctx.session?.id ?? "", timestamp: new Date().toISOString() },
                };
              }
            }

            if (parsedUrl.protocol === "file:" && !config.security.allowFileProtocol) {
              logger.warn({ tool: toolName, url }, "Permission denied: file protocol blocked");
              return {
                success: false,
                error: {
                  code: "PERMISSION_DENIED",
                  message: "file:// protocol is not allowed",
                  suggestions: ["Set security.allowFileProtocol to true in config"],
                  context: {},
                },
                meta: { elapsed: Date.now() - ctx.startTime, sessionId: ctx.session?.id ?? "", timestamp: new Date().toISOString() },
              };
            }
          } catch {
            // Invalid URL, let the tool handler deal with it
          }
        }
      }
    }

    // Check spawn allowlist for process spawn
    if (SPAWN_RELATED_TOOLS.has(toolName) && config.process.spawnAllowlist.length > 0) {
      const command = (ctx.input as Record<string, string | undefined>).command;
      if (command && !config.process.spawnAllowlist.includes(command)) {
        logger.warn({ tool: toolName, command }, "Permission denied: command not in allowlist");
        return {
          success: false,
          error: {
            code: "PERMISSION_DENIED",
            message: `Command '${command}' is not in the spawn allowlist`,
            suggestions: [
              `Add '${command}' to process.spawnAllowlist in config`,
              `Allowed: ${config.process.spawnAllowlist.join(", ")}`,
            ],
            context: {},
          },
          meta: { elapsed: Date.now() - ctx.startTime, sessionId: ctx.session?.id ?? "", timestamp: new Date().toISOString() },
        };
      }
    }

    return next();
  };
}
