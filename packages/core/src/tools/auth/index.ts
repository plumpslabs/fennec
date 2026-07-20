import { z } from 'zod';
import { join } from 'node:path';
import { createTool } from '../_registry.js';
import { detectFormFields, matchField, fillField, findSubmitButton } from '../smart/index.js';
import { StoreManager } from '../../store/StoreManager.js';

// Fallback selectors when smart field detection returns no results
const LOGIN_SELECTORS = {
  usernameFields: [
    'input[type="email"]',
    'input[type="text"][name*="user"]',
    'input[type="text"][name*="email"]',
    'input[type="text"][name*="login"]',
    'input#email',
    'input#username',
    'input#login',
  ],
  passwordFields: ['input[type="password"]'],
  submitButtons: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
    'button:has-text("Log in")',
    'button:has-text("Continue")',
  ],
};

export const authFillLoginForm = createTool({
  name: 'auth_fill_login_form',
  category: 'auth',
  description:
    "`<use_case>Auth</use_case> 🔑 Auto-detect and fill a login form (username/email + password). Smart field detection matches by label, name, id, placeholder, aria-label, data-testid. Options: submitAfter (submit form after filling), saveAfterLogin (auto-save auth session on success — DEFAULT ON), sessionName (name for the saved session, e.g. 'demo-app-prod'). Returns formFound, fieldsDetected, submitted, sessionSaved. Use as the PRIMARY way to log into sites — smarter than manually finding fields with browser_type. For non-login forms, use smart_fill_form instead. For checking auth state, use auth_check_logged_in or diagnose_auth.`",
  inputSchema: z.object({
    username: z.string().describe('Username or email to fill'),
    password: z.string().describe('Password to fill'),
    submitAfter: z.boolean().optional().default(false).describe('Submit the form after filling'),
    saveAfterLogin: z
      .boolean()
      .optional()
      .default(true)
      .describe('Auto-save session after successful login (DEFAULT ON). Set false to skip.'),
    sessionName: z
      .string()
      .optional()
      .describe("Name to save the session as (e.g. 'demo-app-prod'). Defaults to auto-<domain>."),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, sessionStore }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    const page = session.browser;

    try {
      // Phase 1: Smart-detect all form fields
      const formFields = await detectFormFields(page);

      // Phase 2: Smart-match username and password fields
      const usernameField =
        formFields.length > 0
          ? matchField(formFields, 'email') ||
            matchField(formFields, 'username') ||
            matchField(formFields, 'login') ||
            matchField(formFields, 'user')
          : null;

      const passwordField = formFields.length > 0 ? matchField(formFields, 'password') : null;

      let submitted = false;

      let usernameSelector: string | null = null;
      let passwordSelector: string | null = null;

      // Phase 3: Fill fields (two paths: smart vs legacy fallback)
      if (usernameField && passwordField) {
        // Path A: Smart fill via fillField — handles label/name/id/placeholder/aria-label
        await fillField(page, usernameField, input.username);
        await fillField(page, passwordField, input.password);

        if (input.submitAfter) {
          const submitBtn = await findSubmitButton(page);
          if (submitBtn) {
            if (input.saveAfterLogin) {
              await Promise.all([
                page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
                submitBtn.click(),
              ]);
            } else {
              await submitBtn.click();
            }
            submitted = true;
          }
        }
      } else {
        // Path B: Legacy fallback using hardcoded selectors
        let submitSelector: string | null = null;

        for (const sel of LOGIN_SELECTORS.usernameFields) {
          const el = await page.$(sel);
          if (el) {
            usernameSelector = sel;
            break;
          }
        }
        for (const sel of LOGIN_SELECTORS.passwordFields) {
          const el = await page.$(sel);
          if (el) {
            passwordSelector = sel;
            break;
          }
        }
        for (const sel of LOGIN_SELECTORS.submitButtons) {
          const el = await page.$(sel);
          if (el) {
            submitSelector = sel;
            break;
          }
        }

        if (!usernameSelector || !passwordSelector) {
          return responseBuilder.error(new Error('Could not detect login form fields'), {
            code: 'ELEMENT_NOT_FOUND',
            suggestions: [
              'Use browser_get_dom_snapshot to see the page structure',
              'Manually use browser_type to fill in the fields',
            ],
          });
        }

        await page.locator(usernameSelector).fill(input.username);
        await page.locator(passwordSelector).fill(input.password);

        if (input.submitAfter && submitSelector) {
          if (input.saveAfterLogin) {
            await Promise.all([
              page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
              page.locator(submitSelector).click(),
            ]);
          } else {
            await page.locator(submitSelector).click();
          }
          submitted = true;
        }
      }

      // Phase 4: Auto-save session after login (DEFAULT ON)
      let sessionSaved = false;
      let sessionName = '';

      if (input.saveAfterLogin) {
        if (submitted) {
          await page.waitForTimeout(2000);
        }

        const cookies = await session.browser.contextCookies();
        const storage = await page
          .evaluate(() => {
            const items: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key) items[key] = localStorage.getItem(key) ?? '';
            }
            return items;
          })
          .catch(() => ({}) as Record<string, string>);

        const hasAuthCookie = cookies.some((c) =>
          /token|session|auth|jwt|sid|connect/i.test(c.name),
        );
        const hasAuthLocalStorage = Object.keys(storage).some((k) =>
          /token|session|auth|jwt|sid|connect|usr|user/i.test(k),
        );

        // Check for logged-in indicators in DOM (same as authCheckLoggedIn)
        const loggedInIndicators = [
          'a[href*="logout"]',
          'a[href*="sign-out"]',
          'a[href*="profile"]',
          'a[href*="/account"]',
          'button:has-text("Log out")',
          'button:has-text("Sign out")',
        ];
        let hasLoggedInIndicator = false;
        for (const selector of loggedInIndicators) {
          try {
            const el = await page.$(selector);
            if (el) {
              hasLoggedInIndicator = true;
              break;
            }
          } catch {
            // ignore selector/detachment errors
          }
        }

        if (hasAuthCookie || hasAuthLocalStorage || hasLoggedInIndicator || input.sessionName) {
          const origin = new URL(page.url()).origin;
          sessionName = input.sessionName || `auto-${new URL(page.url()).hostname}`;

          sessionStore.save(sessionName, {
            cookies: cookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: c.sameSite,
            })),
            localStorage: storage,
            sessionStorage: {},
            origin,
          });

          sessionSaved = true;
        }
      }

      return responseBuilder.success(
        {
          formFound: true,
          fieldsDetected: {
            usernameField: usernameField !== null || usernameSelector !== null,
            passwordField: passwordField !== null || passwordSelector !== null,
          },
          submitted,
          sessionSaved,
          ...(sessionSaved ? { sessionName } : {}),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const authSaveSession = createTool({
  name: 'auth_save_session',
  category: 'auth',
  description:
    '`<use_case>Auth</use_case> 💾 Save the current auth state (cookies + localStorage) to a named session for later reuse. Returns sessionId, savedAt, filePath, and metadata. Use AFTER successful login to persist the session — next time you can use auth_load_session to restore auth instantly. Capture context with `metadata` (e.g. { user, role, workspace, notes }) so you can tell sessions apart later — auth_list_sessions shows it. Pass filePath to write to a custom location.`',
  inputSchema: z.object({
    name: z.string().describe('Session name to save as'),
    metadata: z
      .record(z.unknown())
      .optional()
      .describe(
        'Free-form context to remember with this session: user, role, workspace, notes, etc. Shown by auth_list_sessions.',
      ),
    filePath: z
      .string()
      .optional()
      .describe(
        'Custom path to save the session JSON (defaults to the global Fennec store ~/.fennec/sessions/<origin>/<name>.json)',
      ),
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, sessionStore }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const cookies = await session.browser.contextCookies();
      const origin = new URL(session.browser.url()).origin;

      const storage = await session.browser
        .evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) items[key] = localStorage.getItem(key) ?? '';
          }
          return items;
        })
        .catch(() => ({}) as Record<string, string>);

      const payload = {
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        })),
        localStorage: storage,
        sessionStorage: {},
        origin,
        metadata: input.metadata,
      };

      let filePath: string;
      if (input.filePath) {
        sessionStore.saveToPath(input.name, payload, input.filePath);
        filePath = input.filePath;
      } else {
        filePath = sessionStore.save(input.name, payload);
      }

      return responseBuilder.success(
        {
          sessionId: session.id,
          savedAt: new Date().toISOString(),
          filePath,
          metadata: input.metadata ?? null,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const authLoadSession = createTool({
  name: 'auth_load_session',
  category: 'auth',
  description:
    '`<use_case>Auth</use_case> 🔓 Load a previously saved auth session (from auth_save_session) into the browser. Restores cookies + localStorage + navigates to origin. Returns cookiesLoaded and storageLoaded counts. Use to quickly restore authenticated state without re-logging in. Pass filePath to load from a specific .json, or name to load from the global store ~/.fennec/sessions/<origin>/<name>.json (auto-discovered, including cwd ./.fennec/sessions). Get available session names from auth_list_sessions. For one-off cookie setting, use storage_set_cookie instead.`',
  inputSchema: z.object({
    name: z
      .string()
      .describe(
        'Session name to load (resolved from the global Fennec store ~/.fennec/sessions/<origin>/<name>.json, or cwd ./.fennec/sessions)',
      ),
    filePath: z
      .string()
      .optional()
      .describe('Explicit path to the saved session .json file (overrides name)'),
    url: z
      .string()
      .optional()
      .describe(
        'Optional URL to navigate to after restoring the session (overrides the saved origin)',
      ),
    createIfMissing: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true and no saved session is found, surface the domain login URL so the agent can navigate there and run auth_fill_login_form instead of failing outright.',
      ),
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, sessionStore }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      let saved = null as ReturnType<typeof sessionStore.load>;
      if (input.filePath) {
        saved = sessionStore.loadFromPath(input.filePath);
      } else {
        saved = sessionStore.load(input.name);
        if (!saved) {
          // Auto-discover in the cwd .fennec/sessions (recursive: namespaced + legacy)
          saved = sessionStore.loadFromDir(join(process.cwd(), '.fennec', 'sessions'), input.name);
        }
      }
      if (!saved) {
        // Build an actionable hint: the current page origin's login URL so the
        // agent can navigate there directly instead of guessing.
        let loginUrl: string | undefined;
        try {
          const origin = new URL(session.browser.url()).origin;
          loginUrl = `${origin}/login`;
        } catch {
          /* ignore — url may be invalid/empty */
        }
        const suggestions = [
          'Use auth_list_sessions to see available sessions',
          'Pass filePath to load a specific .json',
        ];
        if (loginUrl) {
          suggestions.push(`No session found — try navigating to the login page: ${loginUrl}`);
          suggestions.push(
            'Then log in with auth_fill_login_form (saveAfterLogin defaults ON) and retry with this name.',
          );
        }
        return responseBuilder.error(new Error(`Session not found: ${input.name}`), {
          code: 'SESSION_NOT_FOUND',
          context: loginUrl ? { loginUrl } : undefined,
          suggestions,
        });
      }

      await session.browser.contextAddCookies(
        saved.cookies.map((c) => ({
          name: (c as Record<string, unknown>).name as string,
          value: (c as Record<string, unknown>).value as string,
          domain: (c as Record<string, unknown>).domain as string | undefined,
          path: ((c as Record<string, unknown>).path as string) ?? '/',
          httpOnly: (c as Record<string, unknown>).httpOnly as boolean | undefined,
          secure: (c as Record<string, unknown>).secure as boolean | undefined,
          sameSite: (c as Record<string, unknown>).sameSite as
            'Strict' | 'Lax' | 'None' | undefined,
        })),
      );

      const targetUrl = input.url || saved.origin;
      await session.browser.navigate(targetUrl).catch(() => {});
      for (const [key, value] of Object.entries(saved.localStorage)) {
        await session.browser
          .evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key, v: value })
          .catch(() => {});
      }

      return responseBuilder.success(
        {
          cookiesLoaded: saved.cookies.length,
          storageLoaded: Object.keys(saved.localStorage).length,
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const authListSessions = createTool({
  name: 'auth_list_sessions',
  category: 'auth',
  description:
    '`<use_case>Auth</use_case> 📋 List all saved auth sessions with their names, origins, save dates, and filePath. Also auto-discovers sessions in the cwd ./.fennec/sessions directory. Returns sessions[] and count. Use to discover available sessions before loading one with auth_load_session or deleting with auth_delete_session. Sessions are persisted on disk, so they survive browser restarts.`',
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder, sessionStore }) => {
    const byName = new Map<
      string,
      {
        name: string;
        savedAt: string;
        origin: string;
        filePath: string;
        metadata?: Record<string, unknown>;
      }
    >();
    const add = (
      s: { name: string; savedAt: string; origin: string; metadata?: Record<string, unknown> },
      filePath: string,
    ) => {
      if (!byName.has(s.name))
        byName.set(s.name, {
          name: s.name,
          savedAt: s.savedAt,
          origin: s.origin,
          filePath,
          metadata: s.metadata,
        });
    };
    for (const s of sessionStore.list()) add(s, sessionStore.pathFor(s.name, s.origin));
    for (const s of sessionStore.listFromDir(join(process.cwd(), '.fennec', 'sessions'))) {
      add(s, sessionStore.pathFor(s.name, s.origin));
    }
    const sessions = Array.from(byName.values());
    return responseBuilder.success({
      sessions,
      count: sessions.length,
    });
  },
});

export const authDeleteSession = createTool({
  name: 'auth_delete_session',
  category: 'auth',
  description:
    "`<use_case>Auth</use_case> 🗑️ Delete a saved auth session by name. Returns deleted=true/false. Use to clean up old or expired sessions. Get session names from auth_list_sessions. Deleting doesn't affect the current browser state — only removes the saved snapshot.`",
  inputSchema: z.object({
    name: z.string().describe('Session name to delete'),
  }),
  handler: async (input, { responseBuilder, sessionStore }) => {
    const deleted = sessionStore.delete(input.name);
    return responseBuilder.success(
      { deleted },
      { elapsed: 0, sessionId: '', timestamp: new Date().toISOString() },
    );
  },
});

export const authCheckLoggedIn = createTool({
  name: 'auth_check_logged_in',
  category: 'auth',
  description:
    '`<use_case>Auth</use_case> ✅ Check login state by detecting auth indicators: auth cookies (token/session/jwt/sid/connect), logout/profile links, and login links. Returns loggedIn, confidence (0-1), detectedIndicators[]. Supports custom CSS selectors for site-specific indicators. Use to verify login succeeded, check auth state before performing actions, or detect unexpected logouts. More comprehensive than diagnose_auth which only checks cookies.`',
  inputSchema: z.object({
    indicators: z
      .array(z.string())
      .optional()
      .describe('Custom CSS selectors to check for login state'),
    sessionId: z.string().optional().describe('Session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const loggedOutIndicators = [
        'a[href*="login"]',
        'a[href*="sign-in"]',
        'a[href*="signin"]',
        'button:has-text("Log in")',
        'button:has-text("Sign in")',
      ];
      const loggedInIndicators = input.indicators ?? [
        'a[href*="logout"]',
        'a[href*="sign-out"]',
        'a[href*="profile"]',
        'a[href*="/account"]',
        'button:has-text("Log out")',
        'button:has-text("Sign out")',
      ];

      const [hasLoggedOutLink, hasLoggedInLink] = await Promise.all([
        Promise.any(
          loggedOutIndicators.map((sel) => session.browser.$(sel).then((el) => el !== null)),
        ).catch(() => false),
        Promise.any(
          loggedInIndicators.map((sel) => session.browser.$(sel).then((el) => el !== null)),
        ).catch(() => false),
      ]);

      const cookies = await session.browser.contextCookies();
      const hasAuthCookie = cookies.some((c) => /token|session|auth|jwt|sid|connect/i.test(c.name));

      const detectedIndicators: string[] = [];
      if (hasLoggedInLink) detectedIndicators.push('Logout/profile link found');
      if (hasAuthCookie) detectedIndicators.push('Auth cookie found');
      if (hasLoggedOutLink) detectedIndicators.push('Login link found (not logged in)');

      const loggedIn = (hasLoggedInLink || hasAuthCookie) && !hasLoggedOutLink;
      const confidence =
        hasLoggedInLink && hasAuthCookie ? 0.95 : hasLoggedInLink || hasAuthCookie ? 0.7 : 0.3;

      return responseBuilder.success(
        { loggedIn, confidence, detectedIndicators },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});
