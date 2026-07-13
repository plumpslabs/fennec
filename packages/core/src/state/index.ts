import { StateMachine, type ContextSwitchEvent } from './StateMachine.js';
export type {
  AppState,
  StateTransition,
  StateHistoryEntry,
  ContextSwitchEvent,
} from './StateMachine.js';
export { StateMachine };

export interface ActiveSessionInfo {
  sessionId: string;
  url?: string;
  title?: string;
}

export class StateManager {
  private machines: Map<string, StateMachine> = new Map();
  private activeSessionId: string | null = null;
  private activeSessionInfo: ActiveSessionInfo | null = null;

  getOrCreate(sessionId: string): StateMachine {
    let machine = this.machines.get(sessionId);
    if (!machine) {
      machine = new StateMachine();
      this.machines.set(sessionId, machine);
    }
    return machine;
  }

  /**
   * Get the state machine for the currently active session.
   */
  getActive(): StateMachine | null {
    if (!this.activeSessionId) return null;
    return this.machines.get(this.activeSessionId) ?? null;
  }

  /**
   * Get current active session info.
   */
  getActiveSessionInfo(): ActiveSessionInfo | null {
    return this.activeSessionInfo;
  }

  /**
   * Set the active session and detect if a context switch occurred.
   * Returns a ContextSwitchEvent if the session changed, null otherwise.
   */
  setActiveSession(
    sessionId: string,
    info?: { url?: string; title?: string },
  ): ContextSwitchEvent | null {
    // Ensure state machine exists for this session
    this.getOrCreate(sessionId);

    const previousId = this.activeSessionId;
    const previousInfo = this.activeSessionInfo;

    // Update active session info
    this.activeSessionId = sessionId;
    this.activeSessionInfo = {
      sessionId,
      url: info?.url,
      title: info?.title,
    };

    // Detect context switch
    if (previousId !== null && previousId !== sessionId) {
      const switchEvent: ContextSwitchEvent = {
        fromSessionId: previousId,
        toSessionId: sessionId,
        timestamp: Date.now(),
        fromSessionInfo: previousInfo ?? undefined,
        toSessionInfo: { url: info?.url, title: info?.title },
      };

      // Record switch on the source session's state machine
      const fromMachine = this.machines.get(previousId);
      if (fromMachine) {
        fromMachine.recordContextSwitch(switchEvent);
      }

      return switchEvent;
    }

    return null;
  }

  /**
   * Resume a previous context (switch back).
   */
  resumeContext(sessionId: string): void {
    const machine = this.machines.get(sessionId);
    if (machine) {
      machine.recordContextResume();
    }
  }

  remove(sessionId: string): boolean {
    const removed = this.machines.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
      this.activeSessionInfo = null;
    }
    return removed;
  }

  getAllStates(): Array<{ sessionId: string; state: string; idleMs: number }> {
    return Array.from(this.machines.entries()).map(([id, machine]) => ({
      sessionId: id,
      state: machine.state,
      idleMs: Date.now() - machine.lastActiveTime,
    }));
  }

  clear(): void {
    this.machines.clear();
    this.activeSessionId = null;
    this.activeSessionInfo = null;
  }
}
