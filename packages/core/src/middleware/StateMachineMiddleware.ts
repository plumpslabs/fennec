import type { MiddlewareFn } from "./Pipeline.js";
import { getLogger } from "../utils/logger.js";

/**
 * Mapping of tool categories → primary state action.
 * Tools in these categories trigger a state transition by their own name.
 */
const INTERACTIVE_TOOL_PREFIXES = [
  "browser_navigate",
  "browser_go_back",
  "browser_go_forward",
  "browser_reload",
  "browser_click",
  "browser_type",
  "browser_select",
  "auth_fill_login_form",
  "auth_check_logged_in",
  "smart_fill_form",
  "smart_navigate",
];

/**
 * Tool names that change the page URL/content.
 * After these tools, we should re-detect page state.
 */
const NAVIGATION_TOOLS = new Set([
  "browser_navigate",
  "browser_go_back",
  "browser_go_forward",
  "browser_reload",
  "browser_wait_for_navigation",
  "smart_navigate",
]);

/**
 * Tool names that submit data (form submissions, clicks).
 * After these, the page may navigate to a new URL.
 */
const SUBMIT_TOOLS = new Set([
  "browser_click",
  "browser_type",
  "browser_select",
  "smart_fill_form",
  "auth_fill_login_form",
]);

export function createStateMachineMiddleware(): MiddlewareFn {
  const logger = getLogger();

  return async (ctx, next) => {
    const result = await next();

    if (!ctx.stateManager || !ctx.session) {
      return result;
    }

    try {
      const machine = ctx.stateManager.getOrCreate(ctx.session.id);
      const resultObj = result as Record<string, unknown>;
      const isError =
        resultObj &&
        "success" in resultObj &&
        resultObj.success === false;

      const toolName = ctx.toolName;
      const session = ctx.session;

      // ─── Phase 1: Try direct tool-name transition ───────────
      // Most tools map their name directly to a state transition action.
      // E.g., browser_navigate → "browser_navigate" (initial → navigating)
      //        browser_type → "browser_type" (page_loaded/dashboard → form_filling)
      //        browser_click → "browser_click" (form_filling → submitting)
      if (INTERACTIVE_TOOL_PREFIXES.some((p) => toolName.startsWith(p))) {
        await machine.transition(toolName, session, {
          input: ctx.input,
          success: !isError,
        });
      }

      // ─── Phase 2: On error → error state ────────────────────
      if (isError) {
        const errorObj = resultObj.error as Record<string, unknown> | undefined;
        await machine.transition("error", session, {
          tool: toolName,
          errorCode: errorObj?.code,
          message: errorObj?.message,
        });

        return result;
      }

      // ─── Phase 3: Smart state detection ─────────────────────
      // After navigation tools, the page content changes.
      // We try to auto-detect: page_loaded → login_form → authenticated → dashboard
      if (NAVIGATION_TOOLS.has(toolName)) {
        // First transition: navigating → page_loaded (if applicable)
        await machine.transition("page_loaded", session);

        // Then detect: login form? dashboard? authenticated?
        const detected = await machine.detectState(session);

        if (detected === "login_form") {
          await machine.transition("login_detected", session);
          logger.info("StateMachine: detected login form after navigation");
        } else if (detected === "authenticated") {
          await machine.transition("authenticated", session);
          logger.info("StateMachine: detected authenticated state after navigation");
        } else if (detected === "dashboard") {
          await machine.transition("dashboard_detected", session);
          logger.info("StateMachine: detected dashboard after navigation");
        }
      }

      // After submit tools (click, type, fill form), the page might have navigated.
      // Re-detect login → authenticated → dashboard transitions.
      if (SUBMIT_TOOLS.has(toolName)) {
        const detected = await machine.detectState(session);

        if (detected === "page_loaded") {
          // Form submission caused navigation (e.g., login redirect)
          await machine.transition("navigation_complete", session);
        } else if (detected === "authenticated") {
          // Login successful
          await machine.transition("authenticated", session);
          logger.info("StateMachine: login detected after form submission");
        } else if (detected === "dashboard") {
          // Direct to dashboard after login
          await machine.transition("authenticated", session);
          logger.info("StateMachine: dashboard detected after form submission");
        } else if (detected === "login_form") {
          // Still on login form (e.g., validation error)
          await machine.transition("login_detected", session);
        }
      }

      // After auth_check_logged_in: if logged in, transition
      if (toolName === "auth_check_logged_in") {
        const resultData = (resultObj.data as Record<string, unknown> | undefined) ?? {};
        const isLoggedIn = resultData.isAuthenticated === true || resultData.loggedIn === true;

        if (isLoggedIn) {
          await machine.transition("authenticated", session);
          logger.info("StateMachine: auth_check_logged_in confirmed authenticated");
        }
      }
    } catch (error) {
      // State machine transitions are best-effort — never fail the tool result
      logger.warn({ tool: ctx.toolName, error }, "StateMachineMiddleware: transition failed");
    }

    return result;
  };
}
