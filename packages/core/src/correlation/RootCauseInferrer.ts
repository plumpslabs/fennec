import type { BusEvent } from "./EventBus.js";

interface InferenceRule {
  pattern: string;
  rootCause: string;
  confidence: number;
  fix: string;
}

const INFERENCE_RULES: InferenceRule[] = [
  {
    pattern: "browser:network:500 + process:stderr:Error",
    rootCause: "Server error caused network failure",
    confidence: 0.9,
    fix: "Check server logs for unhandled exceptions or misconfigurations",
  },
  {
    pattern: "browser:network:401 + process:stderr:JWT",
    rootCause: "Authentication token issue",
    confidence: 0.92,
    fix: "Verify JWT_SECRET is set and the auth token is valid",
  },
  {
    pattern: "browser:console:TypeError + browser:network:failed",
    rootCause: "Network failure caused JavaScript error",
    confidence: 0.85,
    fix: "Ensure the API endpoint is reachable and returning valid data",
  },
  {
    pattern: "process:stderr:ENOENT",
    rootCause: "Missing file or environment variable",
    confidence: 0.88,
    fix: "Check if required files exist and environment variables are set",
  },
  {
    pattern: "browser:network:404",
    rootCause: "API route or resource not found",
    confidence: 0.9,
    fix: "Verify the URL path matches the server's defined routes",
  },
  {
    pattern: "browser:console:error + process:stderr:Error",
    rootCause: "Server-side error reflected in browser",
    confidence: 0.87,
    fix: "Check server error logs for the root cause of the issue",
  },
];

export class RootCauseInferrer {
  infer(
    trigger: BusEvent,
    relatedEvents: BusEvent[],
  ): { rootCause: string | null; confidence: number; fix: string | null } {
    for (const rule of INFERENCE_RULES) {
      if (this.matchesPattern(rule.pattern, trigger, relatedEvents)) {
        return {
          rootCause: rule.rootCause,
          confidence: rule.confidence,
          fix: rule.fix,
        };
      }
    }

    return { rootCause: null, confidence: 0, fix: null };
  }

  private matchesPattern(
    pattern: string,
    trigger: BusEvent,
    related: BusEvent[],
  ): boolean {
    const parts = pattern.split(" + ");
    const allEvents = [trigger, ...related];

    for (const part of parts) {
      const layer = this.extractLayer(part);
      const keyword = this.extractKeyword(part);

      const found = allEvents.some((e) => {
        const matchesLayer = e.type.startsWith(layer);
        const eventStr = JSON.stringify(e.data).toLowerCase();
        const matchesKeyword = keyword ? eventStr.includes(keyword.toLowerCase()) : true;
        return matchesLayer && matchesKeyword;
      });

      if (!found) return false;
    }

    return true;
  }

  private extractLayer(pattern: string): string {
    return pattern.split(":")[0] ?? "";
  }

  private extractKeyword(pattern: string): string | null {
    const match = pattern.match(/:(\w+)$/);
    return match?.[1] ?? null;
  }
}
