import type { BrowserCDPSession } from "../browser/types.js";
import type { NetworkEvent } from "../session/types.js";
import { getLogger } from "../utils/logger.js";
import { exportAsHar, type HarLog } from "./HarExporter.js";

type NetworkCallback = (event: NetworkEvent) => void;

interface CDPRequest {
  requestId: string;
  url: string;
  method: string;
  type?: string;
  headers?: Record<string, string>;
  postData?: string;
}

interface CDPResponse {
  requestId: string;
  url: string;
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  fromDiskCache?: boolean;
  timing?: {
    requestTime: number;
    receiveHeadersEnd: number;
    sendStart: number;
  };
}

interface CDPRequestWillBeSent {
  requestId: string;
  request: CDPRequest;
  type?: string;
  timestamp: number;
}

interface CDPResponseReceived {
  requestId: string;
  response: CDPResponse;
  timestamp: number;
}

interface CDPLoadingFinished {
  requestId: string;
  encodedDataLength: number;
  timestamp: number;
}

export class NetworkCollector {
  private listeners: Map<string, NetworkCallback> = new Map();
  private pendingRequests: Map<string, { request: CDPRequest; method: string; url: string; timestamp: string; type: string }> = new Map();
  private collectedEvents: NetworkEvent[] = [];
  private maxCollectedEvents = 1000;
  private enabled = false;

  async enable(cdpSession: BrowserCDPSession): Promise<void> {
    if (this.enabled) return;

    try {
      await cdpSession.send("Network.enable");

      cdpSession.on("Network.requestWillBeSent", (msg: unknown) => {
        this.handleRequestSent(msg as CDPRequestWillBeSent);
      });

      cdpSession.on("Network.responseReceived", (msg: unknown) => {
        this.handleResponseReceived(msg as CDPResponseReceived);
      });

      cdpSession.on("Network.loadingFinished", (msg: unknown) => {
        this.handleLoadingFinished(msg as CDPLoadingFinished);
      });

      this.enabled = true;
    } catch (error) {
      getLogger().error({ error }, "Failed to enable network collector");
    }
  }

  private handleRequestSent(msg: CDPRequestWillBeSent): void {
    this.pendingRequests.set(msg.requestId, {
      request: msg.request,
      method: msg.request.method,
      url: msg.request.url,
      timestamp: new Date(msg.timestamp * 1000).toISOString(),
      type: msg.type ?? "other",
    });
  }

  private handleResponseReceived(msg: CDPResponseReceived): void {
    const pending = this.pendingRequests.get(msg.requestId);
    if (!pending) return;

    const event: NetworkEvent = {
      requestId: msg.requestId,
      method: pending.method,
      url: pending.url,
      status: msg.response.status,
      statusText: msg.response.statusText,
      duration: 0, // Will be updated on loadingFinished
      requestHeaders: msg.response.fromDiskCache ? undefined : msg.response.headers,
      responseHeaders: msg.response.headers,
      requestBody: pending.request.postData,
      timestamp: pending.timestamp,
      type: pending.type as NetworkEvent["type"],
    };

    this.emit(event);
  }

  private handleLoadingFinished(msg: CDPLoadingFinished): void {
    this.pendingRequests.delete(msg.requestId);
  }

  on(id: string, callback: NetworkCallback): void {
    this.listeners.set(id, callback);
  }

  off(id: string): void {
    this.listeners.delete(id);
  }

  private emit(event: NetworkEvent): void {
    // Store for HAR export
    this.collectedEvents.push(event);
    if (this.collectedEvents.length > this.maxCollectedEvents) {
      this.collectedEvents.shift();
    }

    for (const [, callback] of this.listeners) {
      try {
        callback(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Export collected network events as a HAR (HTTP Archive) log.
   */
  getHar(): HarLog {
    return exportAsHar(this.collectedEvents);
  }

  /**
   * Get all collected events.
   */
  getEvents(): NetworkEvent[] {
    return [...this.collectedEvents];
  }

  /**
   * Clear collected events.
   */
  clearEvents(): void {
    this.collectedEvents = [];
  }

  /**
   * Disable the network collector.
   */
  async disable(): Promise<void> {
    this.enabled = false;
    this.listeners.clear();
  }

  /**
   * Get pending request count (for monitoring).
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }
}
