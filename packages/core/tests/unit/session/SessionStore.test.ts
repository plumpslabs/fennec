import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionStore } from "../../../src/session/SessionStore.js";
import type { SavedSession } from "../../../src/session/SessionStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const TEST_PERSIST_PATH = join(__dirname, "../../_test_sessions");

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    if (existsSync(TEST_PERSIST_PATH)) {
      rmSync(TEST_PERSIST_PATH, { recursive: true, force: true });
    }
    store = new SessionStore(TEST_PERSIST_PATH);
  });

  afterEach(() => {
    if (existsSync(TEST_PERSIST_PATH)) {
      rmSync(TEST_PERSIST_PATH, { recursive: true, force: true });
    }
  });

  it("should create persist directory on instantiation", () => {
    expect(existsSync(TEST_PERSIST_PATH)).toBe(true);
  });

  it("should save a session to disk", () => {
    store.save("test-session", {
      cookies: [{ name: "token", value: "abc123", domain: "example.com", path: "/", httpOnly: true, secure: true, sameSite: "Lax" as const }],
      localStorage: { user: "john" },
      sessionStorage: {},
      origin: "https://example.com",
    });

    const loaded = store.load("test-session");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("test-session");
    expect(loaded!.cookies).toHaveLength(1);
    expect(loaded!.cookies[0]!.name).toBe("token");
    expect(loaded!.localStorage).toEqual({ user: "john" });
    expect(loaded!.origin).toBe("https://example.com");
  });

  it("should load null for non-existent session", () => {
    const loaded = store.load("nonexistent");
    expect(loaded).toBeNull();
  });

  it("should list all saved sessions", () => {
    store.save("session-1", { cookies: [], localStorage: {}, sessionStorage: {}, origin: "https://a.com" });
    store.save("session-2", { cookies: [], localStorage: {}, sessionStorage: {}, origin: "https://b.com" });

    const sessions = store.list();
    expect(sessions).toHaveLength(2);
  });

  it("should list empty when no sessions saved", () => {
    const sessions = store.list();
    expect(sessions).toHaveLength(0);
  });

  it("should delete a session", () => {
    store.save("delete-me", { cookies: [], localStorage: {}, sessionStorage: {}, origin: "https://x.com" });
    expect(store.load("delete-me")).not.toBeNull();

    const deleted = store.delete("delete-me");
    expect(deleted).toBe(true);
    expect(store.load("delete-me")).toBeNull();
  });

  it("should return false when deleting non-existent session", () => {
    const deleted = store.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  it("should persist session data correctly", () => {
    const testData = {
      cookies: [
        { name: "session", value: "xyz", domain: ".example.com", path: "/app", httpOnly: false, secure: true, sameSite: "Strict" as const },
        { name: "csrf", value: "token123", domain: ".example.com", path: "/", httpOnly: true, secure: true, sameSite: "Lax" as const },
      ],
      localStorage: { theme: "dark", lang: "en" },
      sessionStorage: { temp: "data" },
      origin: "https://app.example.com",
    };

    store.save("persist-test", testData);

    const loaded = store.load("persist-test");
    expect(loaded!.cookies).toHaveLength(2);
    expect(loaded!.localStorage).toEqual({ theme: "dark", lang: "en" });
    expect(loaded!.sessionStorage).toEqual({ temp: "data" });
    expect(loaded!.origin).toBe("https://app.example.com");
    expect(loaded!.savedAt).toBeDefined();
  });
});
