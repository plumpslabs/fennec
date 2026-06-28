import type { CDPSession } from "playwright";
import type { NetworkEvent } from "../session/types.js";
import { getLogger } from "../utils/logger.js";

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
  private enabled = false;

  async enable(cdpSession: CDPSession): Promise<void> {
    if (this.enabled) return;

    try {
      await cdpSession.send("Network.enable" as never);

      cdpSession.on("Network.requestWillBeSent" as never, (msg: unknown) => {
        this.handleRequestSent(msg as CDPRequestWillBeSent);
      });

      cdpSession.on("Network.responseReceived" as never, (msg: unknown) => {
        this.handleResponseReceived(msg as CDPResponseReceived);
      });

      cdpSession.on("Network.loadingFinished" as never, (msg: unknown) => {
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
    for (const [, callback] of this.listeners) {
      try {
        callback(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
