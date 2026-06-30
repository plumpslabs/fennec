import { getLogger } from "../utils/logger.js";
import type { FennecSession } from "../session/types.js";

export type AppState = 
  | "initial"
  | "navigating"
  | "page_loaded"
  | "login_form"
  | "authenticated"
  | "dashboard"
  | "form_filling"
  | "submitting"
  | "error"
  | "idle"
  | "context_switched";

export interface StateTransition {
  from: AppState[];
  to: AppState;
  action: string;
  description: string;
}

export interface ContextSwitchEvent {
  fromSessionId: string;
  toSessionId: string;
  timestamp: number;
  fromSessionInfo?: { url?: string; title?: string };
  toSessionInfo?: { url?: string; title?: string };
}

export interface StateHistoryEntry {
  state: AppState;
  url: string;
  timestamp: number;
  action: string;
  metadata?: Record<string, unknown>;
}

const APP_TRANSITIONS: StateTransition[] = [
  { from: ["initial"], to: "navigating", action: "browser_navigate", description: "Navigating to URL" },
  { from: ["navigating"], to: "page_loaded", action: "page_loaded", description: "Page finished loading" },
  { from: ["navigating", "page_loaded"], to: "login_form", action: "login_detected", description: "Login form detected" },
  { from: ["login_form"], to: "authenticated", action: "authenticated", description: "Authentication successful (detected by cookies)" },
  { from: ["authenticated", "page_loaded"], to: "dashboard", action: "dashboard_detected", description: "Dashboard or main page detected" },
  { from: ["page_loaded", "dashboard"], to: "form_filling", action: "browser_type", description: "Filling form fields" },
  { from: ["form_filling", "page_loaded", "dashboard"], to: "submitting", action: "browser_click", description: "Submitting form" },
  { from: ["submitting", "navigating"], to: "page_loaded", action: "navigation_complete", description: "Post-submit navigation complete" },
  { from: ["initial", "navigating", "page_loaded", "login_form", "authenticated", "dashboard", "form_filling", "submitting", "error", "idle"], to: "error", action: "error", description: "Error state" },
  { from: ["initial", "navigating", "page_loaded", "login_form", "authenticated", "dashboard", "form_filling", "submitting", "error", "idle", "context_switched"], to: "idle", action: "idle", description: "Session idle" },
  // Context switch transitions (any state → context_switched and back)
  { from: ["initial", "navigating", "page_loaded", "login_form", "authenticated", "dashboard", "form_filling", "submitting", "error", "idle"], to: "context_switched", action: "context_switch", description: "User switched to a different browser context/session" },
  { from: ["context_switched"], to: "page_loaded", action: "resume_context", description: "Resumed original context after context switch" },
];

export class StateMachine {
  private currentState: AppState = "initial";
  private history: StateHistoryEntry[] = [];
  private transitions: StateTransition[] = APP_TRANSITIONS;
  private maxHistory = 100;
  private lastActionTime = Date.now();

  get state(): AppState {
    return this.currentState;
  }

  get lastActiveTime(): number {
    return this.lastActionTime;
  }

  /**
   * Get the full state history.
   */
  getHistory(limit = 20): StateHistoryEntry[] {
    return this.history.slice(-limit);
  }

  /**
   * Get current state summary.
   */
  getSummary(): { state: AppState; historyLength: number; lastAction: string; idleMs: number } {
    return {
      state: this.currentState,
      historyLength: this.history.length,
      lastAction: this.history.length > 0 ? this.history[this.history.length - 1]!.action : "none",
      idleMs: Date.now() - this.lastActionTime,
    };
  }

  /**
   * Attempt a state transition based on action and context.
   */
  async transition(
    action: string,
    session: FennecSession | null,
    metadata?: Record<string, unknown>,
  ): Promise<{ success: boolean; from: AppState; to: AppState; transition?: StateTransition }> {
    this.lastActionTime = Date.now();

    // Find matching transition
    const possibleTransitions = this.transitions.filter((t) => {
      if (t.action !== action) return false;
      return t.from.includes(this.currentState);
    });

    if (possibleTransitions.length === 0) {
      // No matching transition, this is normal for tools that don't change state
      return { success: false, from: this.currentState, to: this.currentState };
    }

    // If multiple, try to find best match
    const transition = possibleTransitions.find((t) => t.from.includes(this.currentState))
      ?? possibleTransitions[0]!;

    const fromState = this.currentState;
    this.currentState = transition.to;

    const url = session?.browser?.url() ?? "unknown";

    this.history.push({
      state: this.currentState,
      url,
      timestamp: Date.now(),
      action,
      metadata,
    });

    // Trim history
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    getLogger().debug(
      { from: fromState, to: this.currentState, action },
      "StateMachine: transition",
    );

    return { success: true, from: fromState, to: this.currentState, transition };
  }

  /**
   * Smart state detection based on current page content.
   */
  /**
   * Record a context switch event (user moved to different browser context/session).
   */
  recordContextSwitch(switchEvent: ContextSwitchEvent): void {
    this.transition("context_switch", null, {
      switchEvent,
      from: switchEvent.fromSessionId,
      to: switchEvent.toSessionId,
    });
  }

  /**
   * Record resume of original context.
   */
  recordContextResume(): void {
    this.transition("resume_context", null, {});
  }

  async detectState(session: FennecSession): Promise<AppState> {
    if (!session?.browser) return this.currentState;
    try {
      if (session.browser.isClosed()) return this.currentState;
    } catch {
      // isClosed might not be available on all implementations
      return this.currentState;
    }

    try {
      const url = session.browser.url();
      const title = await session.browser.title().catch(() => "");

      // Check for login indicators
      const hasLoginForm = await session.browser.$(
        'input[type="password"], button[type="submit"]:has-text("Login"), button[type="submit"]:has-text("Sign in")',
      ).catch(() => null);

      // Check for auth cookies
      const cookies = await session.browser.contextCookies().catch(() => []);
      const hasAuthCookie = cookies.some(
        (c) => /token|session|auth|jwt|sid|connect/i.test(c.name),
      );

      // Check for dashboard indicators
      const hasLogoutLink = await session.browser.$(
        'a[href*="logout"], a[href*="sign-out"], a[href*="profile"], a[href*="/account"]',
      ).catch(() => null);

      if (hasLoginForm && !hasAuthCookie) {
        return "login_form";
      }

      if (hasAuthCookie || hasLogoutLink) {
        if (
          url.includes("/dashboard") ||
          url.includes("/app") ||
          url.includes("/home") ||
          title.toLowerCase().includes("dashboard")
        ) {
          return "dashboard";
        }
        return "authenticated";
      }

      if (url !== "about:blank") {
        return "page_loaded";
      }

      return this.currentState;
    } catch {
      return this.currentState;
    }
  }

  /**
   * Reset state machine to initial state.
   */
  reset(): void {
    this.currentState = "initial";
    this.history = [];
    this.lastActionTime = Date.now();
  }

  /**
   * Register custom transitions for specific workflows.
   */
  registerTransitions(transitions: StateTransition[]): void {
    this.transitions.push(...transitions);
  }

  /**
   * Check if a transition is valid (without executing it).
   */
  canTransition(action: string): boolean {
    return this.transitions.some(
      (t) => t.action === action && t.from.includes(this.currentState),
    );
  }
}
