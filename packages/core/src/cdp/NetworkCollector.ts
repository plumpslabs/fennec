import type { BrowserCDPSession } from '../browser/types.js';
import type { NetworkEvent } from '../session/types.js';
import { getLogger } from '../utils/logger.js';
import { exportAsHar, type HarLog } from './HarExporter.js';

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
    dnsStart?: number;
    dnsEnd?: number;
    connectStart?: number;
    connectEnd?: number;
    sslStart?: number;
    sslEnd?: number;
    sendStart: number;
    sendEnd: number;
    receiveHeadersEnd: number;
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

/**
 * Parse CDP timing data into a NetworkTiming breakdown (waterfall).
 * All CDP timing values are relative to `requestTime` in seconds.
 */
function parseTimingWaterfall(
  requestTime: number,
  timing: CDPResponse['timing'],
): import('../session/types.js').NetworkTiming | undefined {
  if (!timing) return undefined;

  // Convert seconds to ms, relative to request start
  const dnsStart = timing.dnsStart != null ? (timing.dnsStart - requestTime) * 1000 : 0;
  const dnsEnd = timing.dnsEnd != null ? (timing.dnsEnd - requestTime) * 1000 : 0;
  const connectStart = timing.connectStart != null ? (timing.connectStart - requestTime) * 1000 : 0;
  const connectEnd = timing.connectEnd != null ? (timing.connectEnd - requestTime) * 1000 : 0;
  const sslStart = timing.sslStart != null ? (timing.sslStart - requestTime) * 1000 : 0;
  const sslEnd = timing.sslEnd != null ? (timing.sslEnd - requestTime) * 1000 : 0;
  const sendStart = (timing.sendStart - requestTime) * 1000;
  const sendEnd = (timing.sendEnd - requestTime) * 1000;
  const receiveEnd = (timing.receiveHeadersEnd - requestTime) * 1000;

  return {
    requestTime, // Store for precise total calculation in handleLoadingFinished
    dns: Math.max(0, dnsEnd - dnsStart),
    tcp: Math.max(0, connectEnd - connectStart - (sslEnd - sslStart)),
    ssl: Math.max(0, sslEnd - sslStart),
    ttfb: Math.max(0, receiveEnd - sendStart),
    contentDownload: 0, // Updated on loadingFinished
    total: 0, // Updated on loadingFinished
    queuing: Math.max(0, dnsStart),
    sending: Math.max(0, sendEnd - sendStart),
  };
}

export class NetworkCollector {
  private listeners: Map<string, NetworkCallback> = new Map();
  private pendingRequests: Map<
    string,
    { request: CDPRequest; method: string; url: string; timestamp: string; type: string }
  > = new Map();
  private collectedEvents: NetworkEvent[] = [];
  private maxCollectedEvents = 1000;
  private enabled = false;

  async enable(cdpSession: BrowserCDPSession): Promise<void> {
    if (this.enabled) return;

    try {
      await cdpSession.send('Network.enable');

      cdpSession.on('Network.requestWillBeSent', (msg: unknown) => {
        this.handleRequestSent(msg as CDPRequestWillBeSent);
      });

      cdpSession.on('Network.responseReceived', (msg: unknown) => {
        this.handleResponseReceived(msg as CDPResponseReceived);
      });

      cdpSession.on('Network.loadingFinished', (msg: unknown) => {
        this.handleLoadingFinished(msg as CDPLoadingFinished);
      });

      this.enabled = true;
    } catch (error) {
      getLogger().error({ error }, 'Failed to enable network collector');
    }
  }

  private handleRequestSent(msg: CDPRequestWillBeSent): void {
    this.pendingRequests.set(msg.requestId, {
      request: msg.request,
      method: msg.request.method,
      url: msg.request.url,
      timestamp: new Date(msg.timestamp * 1000).toISOString(),
      type: msg.type ?? 'other',
    });
  }

  private handleResponseReceived(msg: CDPResponseReceived): void {
    const pending = this.pendingRequests.get(msg.requestId);
    if (!pending) return;

    // Parse timing waterfall from CDP timing data
    const timingBreakdown =
      msg.response.timing && msg.response.timing.requestTime != null
        ? parseTimingWaterfall(msg.response.timing.requestTime, msg.response.timing)
        : undefined;

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
      type: pending.type as NetworkEvent['type'],
      timing: timingBreakdown, // 🔥 NEW: timing waterfall data
    };

    this.emit(event);
  }

  private handleLoadingFinished(msg: CDPLoadingFinished): void {
    this.pendingRequests.delete(msg.requestId);

    const existing = this.collectedEvents.find((e) => e.requestId === msg.requestId);
    if (existing?.timing?.requestTime != null) {
      // Precise total: both msg.timestamp and requestTime are in CDP's timebase (seconds since epoch)
      const totalMs = Math.max(0, (msg.timestamp - existing.timing.requestTime) * 1000);
      existing.duration = totalMs;
      existing.timing.total = totalMs;

      // Content download = total - everything before headers received
      // Everything before headers = queuing + dns + tcp + ssl + ttfb + sending
      const beforeContent =
        existing.timing.queuing +
        existing.timing.dns +
        existing.timing.tcp +
        existing.timing.ssl +
        existing.timing.ttfb +
        existing.timing.sending;
      existing.timing.contentDownload = Math.max(0, totalMs - beforeContent);
    }
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
