import { describe, it, expect } from "vitest";
import { ResponseBuilder } from "../../../src/response/ResponseBuilder.js";

describe("ResponseBuilder", () => {
  const builder = new ResponseBuilder();
  const testMeta = { elapsed: 100, sessionId: "sess_test", timestamp: "2024-01-01T00:00:00.000Z" };

  describe("success", () => {
    it("should create a success response with data and meta", () => {
      const response = builder.success({ foo: "bar" }, testMeta);
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ foo: "bar" });
      expect(response.meta).toEqual(testMeta);
    });

    it("should auto-generate meta when not provided", () => {
      const response = builder.success({ result: "ok" });
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ result: "ok" });
      expect(response.meta.sessionId).toBe("");
      expect(response.meta.elapsed).toBe(0);
      expect(response.meta.timestamp).toBeDefined();
    });

    it("should handle empty data object", () => {
      const response = builder.success({}, testMeta);
      expect(response.success).toBe(true);
      expect(response.data).toEqual({});
    });

    it("should handle complex nested data", () => {
      const data = {
        user: { name: "John", roles: ["admin"] },
        count: 42,
        tags: ["a", "b", "c"],
      };
      const response = builder.success(data, testMeta);
      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
    });
  });

  describe("error", () => {
    it("should create an error response with default code", () => {
      const response = builder.error(new Error("Something broke"));
      expect(response.success).toBe(false);
      expect(response.error.code).toBe("UNKNOWN");
      expect(response.error.message).toBe("Something broke");
      expect(response.error.suggestions).toEqual([]);
      expect(response.error.context).toEqual({});
    });

    it("should create an error response with custom code and suggestions", () => {
      const response = builder.error(new Error("Element not found"), {
        code: "ELEMENT_NOT_FOUND",
        suggestions: ["Try a different selector", "Check page content"],
        meta: testMeta,
      });
      expect(response.success).toBe(false);
      expect(response.error.code).toBe("ELEMENT_NOT_FOUND");
      expect(response.error.suggestions).toHaveLength(2);
      expect(response.error.suggestions[0]).toBe("Try a different selector");
    });

    it("should include error context", () => {
      const response = builder.error(new Error("Timeout"), {
        code: "TIMEOUT",
        context: { timeoutMs: 5000, currentUrl: "https://example.com" },
      });
      expect(response.success).toBe(false);
      expect(response.error.context).toEqual({ timeoutMs: 5000, currentUrl: "https://example.com" });
    });

    it("should convert non-Error to Error", () => {
      const response = builder.error("string error");
      expect(response.success).toBe(false);
      expect(response.error.message).toBe("string error");
    });

    it("should handle null/undefined error", () => {
      const response = builder.error(null);
      expect(response.success).toBe(false);
      expect(response.error.message).toBe("null");
    });
  });
});
