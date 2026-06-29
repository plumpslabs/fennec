import { z } from "zod";
import { createTool } from "../_registry.js";

const LOGIN_INDICATORS = {
  usernameFields: ['input[type="email"]', 'input[type="text"][name*="user"]', 'input[type="text"][name*="email"]', 'input[type="text"][name*="login"]', 'input#email', 'input#username', 'input#login'],
  passwordFields: ['input[type="password"]'],
  submitButtons: ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Sign in")', 'button:has-text("Login")', 'button:has-text("Log in")', 'button:has-text("Continue")'],
};

export const authFillLoginForm = createTool({
  name: "auth_fill_login_form",
  description: "`<use_case>Authentication</use_case> Auto-detect and fill login form (username/email + password). Optionally submit after filling. When saveAfterLogin is true, automatically saves session on successful login detection. formFound, fieldsDetected, submitted (bool), sessionSaved (bool), sessionName (str).`",
  inputSchema: z.object({
    username: z.string().describe("Username or email to fill"),
    password: z.string().describe("Password to fill"),
    submitAfter: z.boolean().optional().default(false).describe("Submit the form after filling"),
    saveAfterLogin: z.boolean().optional().default(false).describe("Auto-save session after successful login detection"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, sessionStore }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.page;

    try {
      let usernameField: string | null = null;
      let passwordField: string | null = null;
      let submitButton: string | null = null;

      for (const sel of LOGIN_INDICATORS.usernameFields) {
        const el = await page.$(sel);
        if (el) { usernameField = sel; break; }
      }

      for (const sel of LOGIN_INDICATORS.passwordFields) {
        const el = await page.$(sel);
        if (el) { passwordField = sel; break; }
      }

      for (const sel of LOGIN_INDICATORS.submitButtons) {
        const el = await page.$(sel);
        if (el) { submitButton = sel; break; }
      }

      if (!usernameField || !passwordField) {
        return responseBuilder.error(
          new Error("Could not detect login form fields"),
          {
            code: "ELEMENT_NOT_FOUND",
            suggestions: [
              "Use browser_get_dom_snapshot to see the page structure",
              "Manually use browser_type to fill in the fields",
            ],
          },
        );
      }

      await page.locator(usernameField).fill(input.username);
      await page.locator(passwordField).fill(input.password);

      let submitted = false;
      if (input.submitAfter && submitButton) {
        if (input.saveAfterLogin) {
          await Promise.all([
            page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
            page.locator(submitButton).click(),
          ]);
        } else {
          await page.locator(submitButton).click();
        }
        submitted = true;
      }

      // Auto-save session if requested
      let sessionSaved = false;
      let sessionName = "";

      if (input.saveAfterLogin) {
        // Wait a bit for any post-login redirect to settle
        if (submitted) {
          await page.waitForTimeout(2000);
        }

        const cookies = await session.context.cookies();
        const hasAuthCookie = cookies.some((c) => /token|session|auth|jwt|sid|connect/i.test(c.name));

        if (hasAuthCookie) {
          const origin = new URL(page.url()).origin;
          const domain = new URL(page.url()).hostname;
          sessionName = `auto-${domain}`;

          const localStorage = await page.evaluate(() => {
            const items: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key) items[key] = localStorage.getItem(key) ?? "";
            }
            return items;
          }).catch(() => ({}));

          sessionStore.save(sessionName, {
            cookies: cookies.map((c) => ({
              name: c.name, value: c.value, domain: c.domain, path: c.path,
              httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
            })),
            localStorage,
            sessionStorage: {},
            origin,
          });

          sessionSaved = true;
        }
      }

      return responseBuilder.success({
        formFound: true,
        fieldsDetected: {
          usernameField: usernameField !== null,
          passwordField: passwordField !== null,
          submitButton: submitButton !== null,
        },
        submitted,
        sessionSaved,
        ...(sessionSaved ? { sessionName } : {}),
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const authSaveSession = createTool({
  name: "auth_save_session",
  description: "`<use_case>Authentication</use_case> Save current auth state (cookies + localStorage) to a named session for later reuse. sessionId, savedAt.`",
  inputSchema: z.object({
    name: z.string().describe("Session name to save as"),
    sessionId: z.string().optional().describe("Browser session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, sessionStore }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cookies = await session.context.cookies();
      const origin = new URL(session.page.url()).origin;

      const localStorage = await session.page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) items[key] = localStorage.getItem(key) ?? "";
        }
        return items;
      }).catch(() => ({}));

      sessionStore.save(input.name, {
        cookies: cookies.map((c) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
        })),
        localStorage,
        sessionStorage: {},
        origin,
      });

      return responseBuilder.success({
        sessionId: session.id,
        savedAt: new Date().toISOString(),
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const authLoadSession = createTool({
  name: "auth_load_session",
  description: "`<use_case>Authentication</use_case> Load a saved auth session (cookies + localStorage) into the browser. cookiesLoaded (int), storageLoaded (int).`",
  inputSchema: z.object({
    name: z.string().describe("Session name to load"),
    sessionId: z.string().optional().describe("Browser session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder, sessionStore }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const saved = sessionStore.load(input.name);
      if (!saved) {
        return responseBuilder.error(
          new Error(`Session not found: ${input.name}`),
          { code: "SESSION_NOT_FOUND", suggestions: ["Use auth_list_sessions to see available sessions"] },
        );
      }

      await session.context.addCookies(saved.cookies.map((c: Record<string, unknown>) => ({
        name: c.name as string, value: c.value as string,
        domain: c.domain as string | undefined, path: (c.path as string) ?? "/",
        httpOnly: c.httpOnly as boolean | undefined, secure: c.secure as boolean | undefined,
        sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
      })));

      await session.page.goto(saved.origin).catch(() => {});
      for (const [key, value] of Object.entries(saved.localStorage)) {
        await session.page.evaluate((k, v) => localStorage.setItem(k, v), key, value).catch(() => {});
      }

      return responseBuilder.success({
        cookiesLoaded: saved.cookies.length,
        storageLoaded: Object.keys(saved.localStorage).length,
      }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const authListSessions = createTool({
  name: "auth_list_sessions",
  description: "`<use_case>Authentication</use_case> List all saved authentication sessions. sessions[], count.`",
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder, sessionStore }) => {
    const sessions = sessionStore.list();
    return responseBuilder.success({
      sessions: sessions.map((s) => ({ name: s.name, savedAt: s.savedAt, origin: s.origin })),
      count: sessions.length,
    });
  },
});

export const authDeleteSession = createTool({
  name: "auth_delete_session",
  description: "`<use_case>Authentication</use_case> Delete a saved auth session by name. deleted (bool).`",
  inputSchema: z.object({
    name: z.string().describe("Session name to delete"),
  }),
  handler: async (input, { responseBuilder, sessionStore }) => {
    const deleted = sessionStore.delete(input.name);
    return responseBuilder.success({ deleted }, { elapsed: 0, sessionId: "", timestamp: new Date().toISOString() });
  },
});

export const authCheckLoggedIn = createTool({
  name: "auth_check_logged_in",
  description: "`<use_case>Authentication</use_case> Check login state via auth indicators (cookies, logout/profile links). Custom indicators supported. loggedIn (bool), confidence (0-1), detectedIndicators[].`",
  inputSchema: z.object({
    indicators: z.array(z.string()).optional().describe("Custom CSS selectors to check for login state"),
    sessionId: z.string().optional().describe("Session ID"),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const loggedOutIndicators = [
        'a[href*="login"]', 'a[href*="sign-in"]', 'a[href*="signin"]',
        'button:has-text("Log in")', 'button:has-text("Sign in")',
      ];
      const loggedInIndicators = input.indicators ?? [
        'a[href*="logout"]', 'a[href*="sign-out"]', 'a[href*="profile"]',
        'a[href*="/account"]', 'button:has-text("Log out")', 'button:has-text("Sign out")',
      ];

      const [hasLoggedOutLink, hasLoggedInLink] = await Promise.all([
        Promise.any(loggedOutIndicators.map((sel) => session.page.$(sel).then((el) => el !== null))).catch(() => false),
        Promise.any(loggedInIndicators.map((sel) => session.page.$(sel).then((el) => el !== null))).catch(() => false),
      ]);

      const cookies = await session.context.cookies();
      const hasAuthCookie = cookies.some((c) => /token|session|auth|jwt|sid|connect/i.test(c.name));

      const detectedIndicators: string[] = [];
      if (hasLoggedInLink) detectedIndicators.push("Logout/profile link found");
      if (hasAuthCookie) detectedIndicators.push("Auth cookie found");
      if (hasLoggedOutLink) detectedIndicators.push("Login link found (not logged in)");

      const loggedIn = (hasLoggedInLink || hasAuthCookie) && !hasLoggedOutLink;
      const confidence = hasLoggedInLink && hasAuthCookie ? 0.95 : hasLoggedInLink || hasAuthCookie ? 0.7 : 0.3;

      return responseBuilder.success({ loggedIn, confidence, detectedIndicators }, sessionManager.buildMeta(session));
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});
