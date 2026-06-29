import type { NetworkEvent } from "../session/types.js";
import { writeFileSync } from "node:fs";

export interface HarLog {
  log: {
    version: string;
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    cookies: unknown[];
    headers: { name: string; value: string }[];
    queryString: { name: string; value: string }[];
    postData?: { mimeType: string; text: string };
    headersSize: number;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    cookies: unknown[];
    headers: { name: string; value: string }[];
    content: {
      size: number;
      mimeType: string;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, unknown>;
  timings: {
    send: number;
    wait: number;
    receive: number;
    dns: number;
    connect: number;
    ssl: number;
  };
}

/**
 * Export a list of NetworkEvents to HAR format (HTTP Archive v1.2).
 */
export function exportAsHar(events: NetworkEvent[]): HarLog {
  const entries: HarEntry[] = events.map((event) => {
    const url = new URL(event.url);

    // Build request headers array
    const requestHeaders = event.requestHeaders
      ? Object.entries(event.requestHeaders).map(([name, value]) => ({ name, value }))
      : [];

    const responseHeaders = event.responseHeaders
      ? Object.entries(event.responseHeaders).map(([name, value]) => ({ name, value }))
      : [];

    // Guess content type from response headers
    const contentType =
      responseHeaders.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "application/octet-stream";

    return {
      startedDateTime: event.timestamp,
      time: event.duration,
      request: {
        method: event.method,
        url: event.url,
        httpVersion: "HTTP/2",
        cookies: [],
        headers: requestHeaders,
        queryString: Array.from(url.searchParams.entries()).map(([name, value]) => ({ name, value })),
        postData: event.requestBody
          ? { mimeType: "application/x-www-form-urlencoded", text: event.requestBody }
          : undefined,
        headersSize: -1,
        bodySize: event.requestBody?.length ?? -1,
      },
      response: {
        status: event.status,
        statusText: event.statusText,
        httpVersion: "HTTP/2",
        cookies: [],
        headers: responseHeaders,
        content: {
          size: -1,
          mimeType: contentType,
        },
        redirectURL: event.status >= 300 && event.status < 400 ? event.responseHeaders?.location ?? "" : "",
        headersSize: -1,
        bodySize: -1,
      },
      cache: {},
      timings: {
        send: 0,
        wait: event.duration,
        receive: 0,
        dns: -1,
        connect: -1,
        ssl: -1,
      },
    };
  });

  return {
    log: {
      version: "1.2",
      creator: { name: "Fennec", version: "1.8.0" },
      entries,
    },
  };
}

/**
 * Export NetworkEvents to HAR and save to a file.
 */
export function exportHarToFile(
  events: NetworkEvent[],
  filePath: string,
): void {
  const har = exportAsHar(events);
  writeFileSync(filePath, JSON.stringify(har, null, 2), "utf-8");
}
