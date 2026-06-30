import { describe, it, expect, beforeEach } from "vitest";
import { StateMachine } from "../../../src/state/StateMachine.js";
import type { FennecSession } from "../../../src/session/types.js";
import type { BrowserSession } from "../../../src/browser/types.js";

function createMockSession(overrides?: Partial<FennecSession>): FennecSession {
  return {
    id: "test-session",
    createdAt: new Date(),
    lastUsedAt: new Date(),
    consoleBuffer: [],
    networkBuffer: [],
    metadata: {},
    browser: {
      url: () => "https://example.com",
      title: async () => "Test Page",
      isClosed: () => false,
      $: async (_selector: string) => null,
      evaluate: async (_fn: unknown, ..._args: unknown[]) => "",
      contextCookies: async () => [],
    } as unknown as BrowserSession,
    ...overrides,
  };
}

describe("StateMachine", () => {
  let machine: StateMachine;

  beforeEach(() => {
    machine = new StateMachine();
  });

  describe("initial state", () => {
    it("should start in initial state", () => {
      expect(machine.state).toBe("initial");
    });

    it("should have empty history", () => {
      expect(machine.getHistory()).toHaveLength(0);
    });

    it("should report idle time", () => {
      const summary = machine.getSummary();
      expect(summary.state).toBe("initial");
      expect(summary.lastAction).toBe("none");
    });
  });

  describe("state transitions", () => {
    it("should transition from initial to navigating on browser_navigate", async () => {
      const result = await machine.transition("browser_navigate", null);
      expect(result.success).toBe(true);
      expect(result.from).toBe("initial");
      expect(result.to).toBe("navigating");
      expect(machine.state).toBe("navigating");
    });

    it("should return success false for unrecognized actions", async () => {
      const result = await machine.transition("unknown_action", null);
      expect(result.success).toBe(false);
      expect(result.from).toBe("initial");
      expect(result.to).toBe("initial");
    });

    it("should follow full login flow: initial → navigating → page_loaded → login_form → authenticated", async () => {
      await machine.transition("browser_navigate", null);
      expect(machine.state).toBe("navigating");

      await machine.transition("page_loaded", null);
      expect(machine.state).toBe("page_loaded");

      await machine.transition("login_detected", null);
      expect(machine.state).toBe("login_form");

      await machine.transition("authenticated", null);
      expect(machine.state).toBe("authenticated");
    });

    it("should transition to error state from any state", async () => {
      await machine.transition("browser_navigate", null);
      await machine.transition("error", null);
      expect(machine.state).toBe("error");
    });
  });

  describe("history tracking", () => {
    it("should record transitions in history", async () => {
      await machine.transition("browser_navigate", null, { url: "https://test.com" });
      await machine.transition("page_loaded", null);

      const history = machine.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.action).toBe("browser_navigate");
      expect(history[1]!.action).toBe("page_loaded");
    });

    it("should store metadata in history", async () => {
      await machine.transition("browser_navigate", null, { url: "https://example.com" });

      const history = machine.getHistory();
      expect(history[0]!.metadata).toEqual({ url: "https://example.com" });
    });

    it("should limit history to 100 entries", async () => {
      for (let i = 0; i < 150; i++) {
        await machine.transition("browser_navigate", null);
        await machine.transition("page_loaded", null);
      }

      expect(machine.getHistory().length).toBeLessThanOrEqual(100);
    });
  });

  describe("canTransition", () => {
    it("should return true for valid transitions", () => {
      expect(machine.canTransition("browser_navigate")).toBe(true);
    });

    it("should return false for invalid transitions", () => {
      expect(machine.canTransition("nonexistent")).toBe(false);
    });

    it("should return false for transitions from wrong state", async () => {
      await machine.transition("browser_navigate", null);
      expect(machine.state).toBe("navigating");
      // login_detected only valid from navigating or page_loaded
      expect(machine.canTransition("login_detected")).toBe(true);
    });
  });

  describe("registerTransitions", () => {
    it("should allow custom transitions", () => {
      machine.registerTransitions([
        { from: ["initial"], to: "dashboard", action: "custom_action", description: "Custom" },
      ]);
      expect(machine.canTransition("custom_action")).toBe(true);
    });
  });

  describe("detectState", () => {
    it("should return current state for closed page", async () => {
      const session = createMockSession({
        browser: { isClosed: () => true } as unknown as BrowserSession,
      });
      const state = await machine.detectState(session);
      expect(state).toBe("initial");
    });

    it("should detect login form when password input present", async () => {
      const session = createMockSession({
        browser: {
          url: () => "https://example.com/login",
          title: async () => "Login",
          isClosed: () => false,
          $: async (selector: string) =>
            selector.includes('input[type="password"]') ? ({} as never) : null,
          evaluate: async (_fn: unknown, ..._args: unknown[]) => "",
          contextCookies: async () => [],
        } as unknown as BrowserSession,
      });
      const state = await machine.detectState(session);
      expect(state).toBe("login_form");
    });

    it("should return current state on error", async () => {
      const session = createMockSession({
        browser: {
          url: () => { throw new Error("fail"); },
          isClosed: () => false,
          $: async () => { throw new Error("fail"); },
          evaluate: async () => { throw new Error("fail"); },
          contextCookies: async () => { throw new Error("fail"); },
        } as unknown as BrowserSession,
      });
      const state = await machine.detectState(session);
      expect(state).toBe("initial");
    });
  });

  describe("reset", () => {
    it("should reset to initial state", async () => {
      await machine.transition("browser_navigate", null);
      expect(machine.state).toBe("navigating");

      machine.reset();
      expect(machine.state).toBe("initial");
      expect(machine.getHistory()).toHaveLength(0);
    });
  });
});
