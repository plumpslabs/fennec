import type { CDPSession } from "playwright";
import { getLogger } from "../utils/logger.js";

export interface CDPMessage {
  method: string;
  params?: Record<string, unknown>;
  id?: number;
}

export class CDPManager {
  private cdpSessions: Map<string, CDPSession> = new Map();
  private messageId = 0;

  register(id: string, session: CDPSession): void {
    this.cdpSessions.set(id, session);
  }

  unregister(id: string): void {
    this.cdpSessions.delete(id);
  }

  get(id: string): CDPSession | undefined {
    return this.cdpSessions.get(id);
  }

  async send(sessionId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const session = this.cdpSessions.get(sessionId);
    if (!session) {
      throw new Error(`CDP session not found: ${sessionId}`);
    }

    const logger = getLogger();
    logger.debug({ method, params }, "CDP send");

    try {
      const result = await session.send(method as never, params as never);
      return result;
    } catch (error) {
      logger.error({ error, method }, "CDP error");
      throw error;
    }
  }

  async evaluate(sessionId: string, expression: string): Promise<unknown> {
    return this.send(sessionId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
  }

  async getConsoleEvents(sessionId: string): Promise<void> {
    await this.send(sessionId, "Console.enable");
  }

  async enableNetworkTracking(sessionId: string): Promise<void> {
    await this.send(sessionId, "Network.enable");
  }

  nextId(): number {
    return ++this.messageId;
  }
}
