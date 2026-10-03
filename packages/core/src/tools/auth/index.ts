import { z } from 'zod';
import { join } from 'node:path';
import { createTool } from '../_registry.js';
import { detectFormFields, matchField, fillField, findSubmitButton } from '../smart/index.js';
import { StoreManager } from '../../store/StoreManager.js';

// Fallback selectors when smart field detection returns no results
const LOGIN_SELECTORS = {
  usernameFields: [
    'input[type="email"]',
    'input[type="text"][autocomplete="email"]',
    'input[type="text"][autocomplete="username"]',
    'input[type="text"][inputmode="email"]',
    'input[type="text"][name*="email" i]',
    'input[type="text"][name*="user" i]',
    'input[type="text"][name*="login" i]',
    'input[type="text"][aria-label*="email" i]',
    'input[type="text"][aria-label*="user" i]',
    'input[type="text"][placeholder*="email" i]',
    'input[type="text"][placeholder*="user" i]',
    'input#email',
    'input#username',
    'input#login',
    'input:not([type])',
  ],
  passwordFields: ['input[type="password"]'],
  submitButtons: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
    'button:has-text("Log in")',
    'button:has-text("Continue")',
    'button:has-text("Sign up")',
    'button:has-text("Masuk")',
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
      // Phase 0: Brief wait for common login field patterns (SPA rendering delay)
      await page
        .waitForSelector(
          'input[type="email"],input[type="password"],input[autocomplete="email"],input[autocomplete="current-password"]',
          { timeout: 3000 },
        )
        .catch(() => {
          /* page may use non-standard selectors — continue anyway */
        });

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
        // Clear stale console/network buffers so post-login verify checks
        // only see errors from the authenticated state (issue #134 P0).
        session.consoleBuffer = [];
        session.networkBuffer = [];
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
          ...(sessionSaved
            ? { sessionName }
            : {
                sessionSavedReason:
                  'no auth cookie/storage/DOM indicator found — session not saved',
              }),
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
    '`<use_case>Auth</use_case> 🔓 Load a previously saved auth session (from auth_save_session) into the browser. Restores cookies + localStorage WITHOUT navigating by default (except on about:blank — auto-navigates to the saved origin). Pass navigate:true, url, or autoReload:true to trigger a page reload for SPA state re-sync. Returns cookiesLoaded, storageLoaded, originMatched, autoNavigated, and a warning if the current origin differs. Use to quickly restore authenticated state without re-logging in. Pass filePath to load from a specific .json, or name to load from the global store. Get available session names from auth_list_sessions.`',
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
    navigate: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, navigate to the saved origin (or the url override) after restoring cookies. Default false — restores cookies in-place without navigating (unless current page is about:blank, which auto-navigates to the saved origin).',
      ),
    url: z
      .string()
      .optional()
      .describe(
        'Optional URL to navigate to after restoring the session (overrides the saved origin; implies navigate=true)',
      ),
    autoReload: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, reload the page after restoring session data so SPA frameworks (React, Vue, etc.) pick up the auth state from localStorage/cookies. For SPAs that listen to storage events, dispatches a synthetic event before reload.',
      ),
    createIfMissing: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true and no saved session is found, surface the domain login URL so the agent can navigate there and run auth_fill_login_form instead of failing outright.',
      ),
    autoRelogin: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'When true and the restored session looks expired (login page / no auth cookie), auto re-login from the encrypted dev vault (auth_save_credentials) or password env var, then re-save the session. Set false to only report needsAuth.',
      ),
    account: z
      .string()
      .optional()
      .default('default')
      .describe('Vault account to use for auto-relogin (multiple accounts per origin).'),
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

      // ── Check current origin vs session origin ──────────────
      const currentOrigin = (() => {
        try {
          return new URL(session.browser.url()).origin;
        } catch {
          return null;
        }
      })();
      // #127: infer origin from session metadata when saved.origin is missing
      // (legacy files / metadata-only saves). Fall back to metadata.origin,
      // cookie domain, then explicit url override.
      const inferOrigin = (): string | undefined => {
        const s = saved as unknown as Record<string, unknown>;
        if (typeof s.origin === 'string' && s.origin) return s.origin as string;
        const md = (s.metadata ?? s.meta) as Record<string, unknown> | undefined;
        if (md && typeof md.origin === 'string' && md.origin) return md.origin as string;
        const cookies = (Array.isArray(s.cookies) ? s.cookies : []) as Array<
          Record<string, unknown>
        >;
        const dom = cookies.find((c) => typeof c.domain === 'string' && c.domain)?.domain as
          string | undefined;
        if (dom) {
          const host = String(dom).replace(/^\./, '');
          return `https://${host}`;
        }
        return undefined;
      };
      const sessionOrigin = inferOrigin() ?? input.url;
      const originMatched = !!sessionOrigin && currentOrigin === sessionOrigin;

      // ── Step 0: #127 — if on about:blank, navigate FIRST then restore ──
      // Cookies can be set cross-origin, but localStorage needs the origin
      // active. Navigating first avoids a double-restore and guarantees
      // both are applied on the right origin in one call.
      let didNavigate = false;
      const isAboutBlank =
        !currentOrigin || currentOrigin === 'null' || session.browser.url() === 'about:blank';
      const shouldNavigate = input.navigate || !!input.url || isAboutBlank;

      if (shouldNavigate && isAboutBlank && sessionOrigin) {
        const targetUrl = input.url || sessionOrigin;
        await session.browser.navigate(targetUrl).catch(() => {});
        didNavigate = true;
      }

      // ── Step 1: Restore cookies (domain-scoped, works cross-origin) ──
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

      // ── Step 2: Restore localStorage — only possible on matching origin ──
      let storageLoaded = 0;
      let storageWarning: string | undefined;

      if (originMatched || didNavigate) {
        // Same origin (or just navigated to it in Step 0) — restore in place
        for (const [key, value] of Object.entries(saved.localStorage)) {
          await session.browser
            .evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key, v: value })
            .catch(() => {});
        }
        storageLoaded = Object.keys(saved.localStorage).length;
      } else {
        // Different origin — localStorage can't be restored without navigating
        storageWarning =
          `Cannot restore localStorage: origin mismatch (current: ${currentOrigin}, session: ${sessionOrigin}). ` +
          `Cookies loaded (${saved.cookies.length}). To fully restore, call with navigate:true or url="${sessionOrigin}".`;
      }

      // ── Step 3: Navigate if explicitly requested (non-blank case) ──
      // (about:blank case already navigated in Step 0)
      if (shouldNavigate && !didNavigate && (input.url || sessionOrigin)) {
        const targetUrl = (input.url || sessionOrigin) as string;
        await session.browser.navigate(targetUrl).catch(() => {});
        didNavigate = true;

        // After navigation, restore localStorage on the new origin
        if (!originMatched) {
          for (const [key, value] of Object.entries(saved.localStorage)) {
            await session.browser
              .evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key, v: value })
              .catch(() => {});
          }
          storageLoaded = Object.keys(saved.localStorage).length;
          storageWarning = undefined;
        }
      }

      // ── Step 4: Auto-reload for SPA state re-sync ──
      // SPAs (React, Vue, etc.) typically read auth state on mount and don't
      // pick up localStorage changes made while the app is already running.
      // autoReload triggers a page reload so the SPA re-initializes with the
      // restored session. Also dispatches a synthetic storage event first so
      // any storage event listeners also fire before the reload.
      let didAutoReload = false;
      if (input.autoReload && !didNavigate) {
        await session.browser
          .evaluate(() => {
            // Dispatch storage event so React/Vue storage listeners fire
            window.dispatchEvent(new Event('storage'));
          })
          .catch(() => {});
        await session.browser.reload().catch(() => {});
        didAutoReload = true;
      } else if (input.autoReload && didNavigate) {
        // Already navigated — no need for a separate reload
        didAutoReload = true;
      }

      // ── Step 5: Expiry check + auto-relogin from dev vault ──
      // If the page shows a login form / no auth cookie after restore, the
      // saved session is stale. With autoRelogin (default ON) try the vault
      // once; otherwise report needsAuth with an actionable recipe.
      let relogin: Record<string, unknown> | undefined;
      let needsAuth = false;
      try {
        const cookies = await session.browser.contextCookies().catch(() => []);
        const hasAuthCookie = cookies.some((c) =>
          /token|session|auth|jwt|sid|connect/i.test(c.name),
        );
        const loginLink = await session.browser
          .$(
            'a[href*="login"],a[href*="sign-in"],button:has-text("Log in"),button:has-text("Sign in")',
          )
          .catch(() => null);
        const expired = !hasAuthCookie || !!loginLink;
        if (expired) {
          needsAuth = true;
          if (input.autoRelogin !== false && sessionOrigin) {
            const { getDevCredential, resolvePassword } = await import('../../auth/dev-vault.js');
            const cred = getDevCredential(sessionOrigin, input.account ?? 'default');
            const password = cred ? resolvePassword(cred) : null;
            if (cred && password) {
              const loginUrl =
                cred.loginUrl ??
                (cred.loginPath ? `${sessionOrigin}${cred.loginPath}` : `${sessionOrigin}/login`);
              await session.browser.navigate(loginUrl).catch(() => {});
              let filled = false;
              try {
                const fields = await detectFormFields(session.browser);
                const u =
                  matchField(fields, 'email') ||
                  matchField(fields, 'username') ||
                  matchField(fields, 'login') ||
                  matchField(fields, 'user');
                const p = matchField(fields, 'password');
                if (u && p) {
                  await fillField(session.browser, u, cred.username);
                  await fillField(session.browser, p, password);
                  const btn = await findSubmitButton(session.browser);
                  if (btn) {
                    await Promise.all([
                      session.browser
                        .waitForLoadState?.('networkidle', { timeout: 15000 })
                        .catch(() => {}),
                      btn.click(),
                    ]);
                  }
                  filled = true;
                }
              } catch {
                filled = false;
              }
              if (filled) {
                try {
                  const rc = await session.browser.contextCookies().catch(() => []);
                  const ro = new URL(session.browser.url()).origin;
                  const rs = await session.browser
                    .evaluate(() => {
                      const items: Record<string, string> = {};
                      for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key) items[key] = localStorage.getItem(key) ?? '';
                      }
                      return items;
                    })
                    .catch(() => ({}) as Record<string, string>);
                  sessionStore.save(input.name, {
                    cookies: rc as never,
                    localStorage: rs,
                    sessionStorage: {},
                    origin: ro,
                  });
                } catch {}
                relogin = {
                  attempted: true,
                  ok: true,
                  loginUrl,
                  username: cred.username,
                  account: cred.account ?? 'default',
                };
                needsAuth = false;
              } else {
                relogin = { attempted: true, loginUrl, ok: false, reason: 'login form not found' };
              }
            } else if (cred && !password) {
              relogin = {
                attempted: false,
                reason: `vault entry exists but password unavailable (env ${cred.passwordEnv} unset and no literal stored)`,
              };
            }
          }
        }
      } catch {
        /* best-effort — never fail the load on the expiry probe */
      }

      return responseBuilder.success(
        {
          cookiesLoaded: saved.cookies.length,
          storageLoaded,
          originMatched,
          didNavigate,
          autoNavigated: isAboutBlank ? true : undefined,
          didAutoReload: didAutoReload || undefined,
          needsAuth,
          ...(relogin ? { relogin } : {}),
          ...(!needsAuth
            ? {}
            : {
                loginHint: 'Session expired — run auth_relogin or log in via auth_fill_login_form',
              }),
          ...(storageWarning ? { warning: storageWarning } : {}),
          ...(didNavigate ? { navigatedTo: input.url || sessionOrigin } : {}),
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

export const authSaveCredentials = createTool({
  name: 'auth_save_credentials',
  category: 'auth',
  description:
    '`<use_case>Auth</use_case> 🔐 Save DEV-ONLY login credentials to an encrypted local vault (AES-256-GCM, mode 0600, never committed). Preferred: pass passwordEnv (env var name) so no secret touches disk; or a literal password for local dev machines. Requires devOnly:true as an explicit acknowledgment. Use with auth_relogin / auth_load_session(autoRelogin) for automatic re-login when a saved session expires. Passwords are never returned in responses or logs.`',
  inputSchema: z.object({
    origin: z.string().describe('Site origin, e.g. https://staging.example.com'),
    username: z.string().describe('Dev username / email'),
    password: z
      .string()
      .optional()
      .describe('Literal dev password (encrypted at rest). Prefer passwordEnv.'),
    passwordEnv: z
      .string()
      .optional()
      .describe('Env var holding the password (nothing secret on disk). Checked first.'),
    loginUrl: z.string().optional().describe('Full login URL'),
    loginPath: z.string().optional().describe('Login path appended to origin, e.g. /login'),
    account: z
      .string()
      .optional()
      .default('default')
      .describe('Account label (multiple accounts per origin)'),
    devOnly: z
      .boolean()
      .describe('Must be true — acknowledges these are dev/test credentials only'),
  }),
  handler: async (input, { responseBuilder }) => {
    if (input.devOnly !== true) {
      return responseBuilder.error(
        new Error(
          'Refusing to store credentials without devOnly:true (dev/test only, never prod).',
        ),
        {
          code: 'NOT_DEV_ONLY',
        } as never,
      );
    }
    if (!input.password && !input.passwordEnv) {
      return responseBuilder.error(new Error('Provide password or passwordEnv.'), {
        code: 'NO_SECRET',
      } as never);
    }
    const { saveDevCredential, getVaultPath } = await import('../../auth/dev-vault.js');
    let origin = input.origin;
    try {
      origin = new URL(input.origin).origin;
    } catch {}
    saveDevCredential({
      origin,
      username: input.username,
      ...(input.password ? { password: input.password } : {}),
      ...(input.passwordEnv ? { passwordEnv: input.passwordEnv } : {}),
      ...(input.loginUrl ? { loginUrl: input.loginUrl } : {}),
      ...(input.loginPath ? { loginPath: input.loginPath } : {}),
      account: input.account ?? 'default',
    });
    return responseBuilder.success(
      {
        saved: true,
        origin,
        account: input.account ?? 'default',
        usesEnv: !!input.passwordEnv,
        vault: getVaultPath(),
      },
      { elapsed: 0, sessionId: '', timestamp: new Date().toISOString() },
    );
  },
});

export const authRelogin = createTool({
  name: 'auth_relogin',
  category: 'auth',
  description:
    '`<use_case>Auth</use_case> 🔄 Re-login using the encrypted dev vault (or password env var) and re-save the session. Provide origin or an existing sessionName to infer the origin. Navigates to the login URL, fills username+password, submits, and saves the session. Never echoes the password.`',
  inputSchema: z.object({
    origin: z.string().optional().describe('Site origin (inferred from sessionName when omitted)'),
    sessionName: z.string().optional().describe('Existing saved session name to refresh'),
    account: z.string().optional().default('default').describe('Vault account label'),
    sessionId: z.string().optional().describe('Browser session ID'),
  }),
  handler: async (input, { sessionManager, responseBuilder, sessionStore }) => {
    const session = sessionManager.getOrDefault(input.sessionId);
    try {
      const { getDevCredential, resolvePassword } = await import('../../auth/dev-vault.js');
      let origin = input.origin;
      if (!origin && input.sessionName) {
        const saved = sessionStore.load(input.sessionName);
        const s = saved as unknown as Record<string, unknown> | null;
        origin =
          (s?.origin as string) ??
          ((s?.metadata as Record<string, unknown> | undefined)?.origin as string) ??
          undefined;
      }
      if (!origin) {
        try {
          origin = new URL(session.browser.url()).origin;
        } catch {}
      }
      if (!origin || origin === 'null') {
        return responseBuilder.error(new Error('Cannot infer origin — pass origin explicitly.'), {
          code: 'NO_ORIGIN',
        } as never);
      }
      const cred = getDevCredential(origin, input.account ?? 'default');
      if (!cred) {
        return responseBuilder.error(
          new Error(
            `No vault credential for ${origin} (account ${input.account ?? 'default'}). Save one with auth_save_credentials(devOnly:true).`,
          ),
          {
            code: 'NO_CREDENTIAL',
          } as never,
        );
      }
      const password = resolvePassword(cred);
      if (!password) {
        return responseBuilder.error(
          new Error(
            `Vault entry exists but password unavailable (env ${cred.passwordEnv} unset and no literal stored).`,
          ),
          {
            code: 'NO_PASSWORD',
          } as never,
        );
      }
      const loginUrl =
        cred.loginUrl ?? (cred.loginPath ? `${origin}${cred.loginPath}` : `${origin}/login`);
      await session.browser.navigate(loginUrl).catch(() => {});
      const fields = await detectFormFields(session.browser);
      const u =
        matchField(fields, 'email') ||
        matchField(fields, 'username') ||
        matchField(fields, 'login') ||
        matchField(fields, 'user');
      const p = matchField(fields, 'password');
      if (!u || !p) {
        return responseBuilder.error(new Error('Login form not found at ' + loginUrl), {
          code: 'NO_FORM',
        } as never);
      }
      await fillField(session.browser, u, cred.username);
      await fillField(session.browser, p, password);
      const btn = await findSubmitButton(session.browser);
      if (btn) {
        await Promise.all([
          session.browser.waitForLoadState?.('networkidle', { timeout: 15000 }).catch(() => {}),
          btn.click(),
        ]);
      }
      if (input.sessionName) {
        try {
          const rc2 = await session.browser.contextCookies().catch(() => []);
          const ro2 = new URL(session.browser.url()).origin;
          const rs2 = await session.browser
            .evaluate(() => {
              const items: Record<string, string> = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) items[key] = localStorage.getItem(key) ?? '';
              }
              return items;
            })
            .catch(() => ({}) as Record<string, string>);
          sessionStore.save(input.sessionName, {
            cookies: rc2 as never,
            localStorage: rs2,
            sessionStorage: {},
            origin: ro2,
          });
        } catch {}
      }
      return responseBuilder.success(
        {
          ok: true,
          origin,
          account: cred.account ?? 'default',
          loginUrl,
          ...(input.sessionName ? { sessionSaved: input.sessionName } : {}),
        },
        sessionManager.buildMeta(session),
      );
    } catch (error) {
      return responseBuilder.error(error);
    }
  },
});

export const authListCredentials = createTool({
  name: 'auth_list_credentials',
  category: 'auth',
  description:
    '`<use_case>Auth</use_case> 📋 List dev vault credential entries (origins, usernames, accounts — never passwords).`',
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder }) => {
    const { listDevCredentials } = await import('../../auth/dev-vault.js');
    const entries = listDevCredentials();
    return responseBuilder.success({ entries, count: entries.length });
  },
});

export const authDeleteCredentials = createTool({
  name: 'auth_delete_credentials',
  category: 'auth',
  description:
    '`<use_case>Auth</use_case> 🗑️ Delete a dev vault credential entry by origin + account.`',
  inputSchema: z.object({
    origin: z.string().describe('Site origin'),
    account: z.string().optional().default('default').describe('Account label'),
  }),
  handler: async (input, { responseBuilder }) => {
    const { deleteDevCredential } = await import('../../auth/dev-vault.js');
    let origin = input.origin;
    try {
      origin = new URL(input.origin).origin;
    } catch {}
    const deleted = deleteDevCredential(origin, input.account ?? 'default');
    return responseBuilder.success(
      { deleted },
      { elapsed: 0, sessionId: '', timestamp: new Date().toISOString() },
    );
  },
});
