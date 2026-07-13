import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  authFillLoginForm,
  authSaveSession,
  authLoadSession,
  authListSessions,
  authDeleteSession,
  authCheckLoggedIn,
} from "../../../src/tools/auth/index.js";

describe("auth_fill_login_form tool", () => {
  it("should have correct name", () => {
    expect(authFillLoginForm.name).toBe("auth_fill_login_form");
  });

  it("should have description mentioning saveAfterLogin", () => {
    expect(authFillLoginForm.description).toContain("<use_case>");
    expect(authFillLoginForm.description).toContain("fill a login form");
    expect(authFillLoginForm.description).toContain("saveAfterLogin");
    expect(authFillLoginForm.description).toContain("sessionSaved");
  });

  it("should require username", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      password: "secret123",
    });
    expect(result.success).toBe(false);
  });

  it("should require password", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("should accept minimum valid input (username + password only)", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user@example.com",
      password: "secret123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("user@example.com");
      expect(result.data.password).toBe("secret123");
    }
  });

  it("should default submitAfter to false", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: "pass",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.submitAfter).toBe(false);
    }
  });

  it("should default saveAfterLogin to true", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: "pass",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.saveAfterLogin).toBe(true);
    }
  });

  it("should accept saveAfterLogin: false to opt out", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: "pass",
      saveAfterLogin: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.saveAfterLogin).toBe(false);
    }
  });

  it("should accept a sessionName for the saved session", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: "pass",
      sessionName: "myapp-prod",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionName).toBe("myapp-prod");
    }
  });

  it("should accept submitAfter: true", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: "pass",
      submitAfter: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.submitAfter).toBe(true);
    }
  });

  it("should accept saveAfterLogin: true", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: "pass",
      submitAfter: true,
      saveAfterLogin: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.saveAfterLogin).toBe(true);
    }
  });

  it("should accept optional sessionId", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: "pass",
      sessionId: "sess_test123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe("sess_test123");
    }
  });

  it("should reject non-string username", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: 123,
      password: "pass",
    });
    expect(result.success).toBe(false);
  });

  it("should reject non-string password", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: 456,
    });
    expect(result.success).toBe(false);
  });

  it("should strip unknown fields", () => {
    const result = authFillLoginForm.inputSchema.safeParse({
      username: "user",
      password: "pass",
      unknownField: "should be stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknownField).toBeUndefined();
    }
  });

  it("should have inputSchema property", () => {
    expect(authFillLoginForm.inputSchema).toBeInstanceOf(z.ZodType);
  });
});

describe("auth_save_session tool", () => {
  it("should have correct name", () => {
    expect(authSaveSession.name).toBe("auth_save_session");
  });

  it("should have relevant description", () => {
    expect(authSaveSession.description).toContain("<use_case>");
    expect(authSaveSession.description).toContain("Save");
    expect(authSaveSession.description).toContain("session");
  });

  it("should require name", () => {
    const result = authSaveSession.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should accept valid name", () => {
    const result = authSaveSession.inputSchema.safeParse({
      name: "my-session",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("my-session");
    }
  });

  it("should accept optional sessionId", () => {
    const result = authSaveSession.inputSchema.safeParse({
      name: "my-session",
      sessionId: "sess_test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe("sess_test");
    }
  });

  it("should reject non-string name", () => {
    const result = authSaveSession.inputSchema.safeParse({
      name: 123,
    });
    expect(result.success).toBe(false);
  });

  it("should strip unknown fields", () => {
    const result = authSaveSession.inputSchema.safeParse({
      name: "test",
      unknown: "stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknown).toBeUndefined();
    }
  });

  it("should have inputSchema property", () => {
    expect(authSaveSession.inputSchema).toBeInstanceOf(z.ZodType);
  });
});

describe("auth_load_session tool", () => {
  it("should have correct name", () => {
    expect(authLoadSession.name).toBe("auth_load_session");
  });

  it("should have relevant description", () => {
    expect(authLoadSession.description).toContain("<use_case>");
    expect(authLoadSession.description).toContain("Load");
  });

  it("should require name", () => {
    const result = authLoadSession.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should accept valid input", () => {
    const result = authLoadSession.inputSchema.safeParse({
      name: "my-session",
    });
    expect(result.success).toBe(true);
  });

  it("should accept optional sessionId", () => {
    const result = authLoadSession.inputSchema.safeParse({
      name: "my-session",
      sessionId: "sess_abc",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe("sess_abc");
    }
  });

  it("should reject non-string name", () => {
    const result = authLoadSession.inputSchema.safeParse({
      name: true,
    });
    expect(result.success).toBe(false);
  });

  it("should strip unknown fields", () => {
    const result = authLoadSession.inputSchema.safeParse({
      name: "test",
      extra: "stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).extra).toBeUndefined();
    }
  });

  it("should have inputSchema property", () => {
    expect(authLoadSession.inputSchema).toBeInstanceOf(z.ZodType);
  });
});

describe("auth_list_sessions tool", () => {
  it("should have correct name", () => {
    expect(authListSessions.name).toBe("auth_list_sessions");
  });

  it("should have relevant description", () => {
    expect(authListSessions.description).toContain("<use_case>");
    expect(authListSessions.description).toContain("List");
  });

  it("should accept empty input (no params required)", () => {
    const result = authListSessions.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should strip unknown fields", () => {
    const result = authListSessions.inputSchema.safeParse({
      unknown: "stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknown).toBeUndefined();
    }
  });

  it("should have inputSchema property", () => {
    expect(authListSessions.inputSchema).toBeInstanceOf(z.ZodType);
  });
});

describe("auth_delete_session tool", () => {
  it("should have correct name", () => {
    expect(authDeleteSession.name).toBe("auth_delete_session");
  });

  it("should have relevant description", () => {
    expect(authDeleteSession.description).toContain("<use_case>");
    expect(authDeleteSession.description).toContain("Delete");
  });

  it("should require name", () => {
    const result = authDeleteSession.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should accept valid name", () => {
    const result = authDeleteSession.inputSchema.safeParse({
      name: "old-session",
    });
    expect(result.success).toBe(true);
  });

  it("should reject non-string name", () => {
    const result = authDeleteSession.inputSchema.safeParse({
      name: null,
    });
    expect(result.success).toBe(false);
  });

  it("should strip unknown fields", () => {
    const result = authDeleteSession.inputSchema.safeParse({
      name: "test",
      unknown: "stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknown).toBeUndefined();
    }
  });

  it("should have inputSchema property", () => {
    expect(authDeleteSession.inputSchema).toBeInstanceOf(z.ZodType);
  });
});

describe("auth_check_logged_in tool", () => {
  it("should have correct name", () => {
    expect(authCheckLoggedIn.name).toBe("auth_check_logged_in");
  });

  it("should have relevant description", () => {
    expect(authCheckLoggedIn.description).toContain("<use_case>");
    expect(authCheckLoggedIn.description).toContain("loggedIn");
    expect(authCheckLoggedIn.description).toContain("confidence");
  });

  it("should accept empty input (no params required)", () => {
    const result = authCheckLoggedIn.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should accept optional indicators array", () => {
    const result = authCheckLoggedIn.inputSchema.safeParse({
      indicators: ["a[href*=\"/dashboard\"]", "button:has-text(\"Profile\")"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.indicators).toHaveLength(2);
    }
  });

  it("should accept optional sessionId", () => {
    const result = authCheckLoggedIn.inputSchema.safeParse({
      sessionId: "sess_test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe("sess_test");
    }
  });

  it("should reject non-array indicators", () => {
    const result = authCheckLoggedIn.inputSchema.safeParse({
      indicators: "not-an-array",
    });
    expect(result.success).toBe(false);
  });

  it("should strip unknown fields", () => {
    const result = authCheckLoggedIn.inputSchema.safeParse({
      unknown: "stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknown).toBeUndefined();
    }
  });

  it("should have inputSchema property", () => {
    expect(authCheckLoggedIn.inputSchema).toBeInstanceOf(z.ZodType);
  });
});
