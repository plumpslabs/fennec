import { describe, it, expect, vi } from 'vitest';
import { sessionGetActive } from '../../../src/tools/session/index.js';
import { authLoadSession } from '../../../src/tools/auth/index.js';
import { devtoolsApiFetch, devtoolsEvaluate } from '../../../src/tools/devtools/console.js';
import { browserScreenshotAnnotated } from '../../../src/tools/smart/index.js';

// ─── Helpers ───────────────────────────────────────────────────

function makeResponseBuilder() {
  return {
    success: vi.fn((data: unknown) => ({ ok: true, ...(data as object) })),
    error: vi.fn((err: unknown, extra?: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...(extra as object),
    })),
  };
}

function makeSessionManager(overrides: Partial<any> = {}) {
  const session = {
    id: 'sess_active',
    name: 'default',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastUsedAt: new Date('2026-01-01T00:00:00Z'),
    browser: {
      url: vi.fn().mockReturnValue('https://app.example.com/dashboard'),
      title: vi.fn().mockResolvedValue('Dashboard'),
      evaluate: vi.fn(),
    },
    consoleBuffer: [],
    networkBuffer: [],
    metadata: {},
  };
  return {
    getDefaultSessionId: vi.fn().mockReturnValue('sess_active'),
    getSession: vi.fn().mockReturnValue(session),
    getOrDefault: vi.fn().mockReturnValue(session),
    listSessions: vi.fn().mockReturnValue([session]),
    buildMeta: vi.fn().mockReturnValue({}),
    ...overrides,
  };
}

// ─── #87 session_get_active ────────────────────────────────────

describe('session_get_active (#87)', () => {
  it('returns the active session id and metadata', async () => {
    const rb = makeResponseBuilder();
    const sm = makeSessionManager();
    const res = (await sessionGetActive.handler({}, {
      sessionManager: sm,
      responseBuilder: rb,
    } as any)) as any;
    expect(rb.success).toHaveBeenCalled();
    expect(res.id).toBe('sess_active');
    expect(res.isDefault).toBe(true);
    expect(res.url).toContain('app.example.com');
    expect(res.totalSessions).toBe(1);
  });

  it('errors when no active session exists', async () => {
    const rb = makeResponseBuilder();
    const sm = makeSessionManager({ getDefaultSessionId: vi.fn().mockReturnValue(null) });
    const res = (await sessionGetActive.handler({}, {
      sessionManager: sm,
      responseBuilder: rb,
    } as any)) as any;
    expect(rb.error).toHaveBeenCalled();
    expect(res.code).toBe('NO_ACTIVE_SESSION');
  });
});

// ─── #80 auth_load_session not-found hint ─────────────────────

describe('auth_load_session not-found hint (#80)', () => {
  it('includes a login URL suggestion when session is missing', async () => {
    const rb = makeResponseBuilder();
    const sessionStore = {
      load: vi.fn().mockReturnValue(null),
      loadFromPath: vi.fn().mockReturnValue(null),
      loadFromDir: vi.fn().mockReturnValue(null),
    };
    const sessionManager = makeSessionManager();
    const res = (await authLoadSession.handler({ name: 'does-not-exist' }, {
      sessionManager,
      responseBuilder: rb,
      sessionStore,
    } as any)) as any;
    expect(rb.error).toHaveBeenCalled();
    expect(res.code).toBe('SESSION_NOT_FOUND');
    const errCall = rb.error.mock.calls[0];
    const extra = errCall[1] as any;
    expect(extra.context.loginUrl).toContain('/login');
    expect(extra.suggestions.join(' ')).toContain('/login');
  });
});

// ─── #84 / #86 devtools_api_fetch (in-browser fetch) ─────────

describe('devtools_api_fetch (#84 #86)', () => {
  function makeFetchPage(impl: (opts: any) => Promise<any>) {
    const sm = makeSessionManager();
    sm.getOrDefault = vi.fn().mockReturnValue({
      browser: { evaluate: vi.fn().mockImplementation(impl) },
    });
    return sm;
  }

  it('returns parsed JSON body on success with ok:true', async () => {
    const rb = makeResponseBuilder();
    const sm = makeFetchPage(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: { token: 'abc' },
      bodyRaw: '{"token":"abc"}',
      size: 15,
    }));
    const res = (await devtoolsApiFetch.handler(
      { url: 'https://api.example.com/me', method: 'GET' },
      { sessionManager: sm, responseBuilder: rb } as any,
    )) as any;
    expect(rb.success).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.body.token).toBe('abc');
    expect(res.hint).toBeUndefined();
  });

  it('returns raw body on non-2xx WITHOUT throwing (surfaces real API error)', async () => {
    const rb = makeResponseBuilder();
    const sm = makeFetchPage(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'content-type': 'application/json' },
      body: { status: 401, message: 'token expired' },
      bodyRaw: '{"status":401,"message":"token expired"}',
      size: 40,
    }));
    const res = (await devtoolsApiFetch.handler({ url: 'https://api.example.com/me' }, {
      sessionManager: sm,
      responseBuilder: rb,
    } as any)) as any;
    expect(rb.success).toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('token expired');
    expect(res.hint).toContain('raw body');
  });

  it('devtools_evaluate suggests devtools_api_fetch for fetch-like errors (#84)', async () => {
    const rb = makeResponseBuilder();
    const sessionManager = makeSessionManager();
    sessionManager.getOrDefault = vi.fn().mockReturnValue({
      browser: {
        evaluate: vi
          .fn()
          .mockRejectedValue(
            new Error('TypeError: Cannot read properties of undefined (reading "map")'),
          ),
      },
    });
    const res = (await devtoolsEvaluate.handler(
      { expression: 'fetch("/x").then(r=>r.json()).then(d=>d.data.map())' },
      {
        sessionManager,
        responseBuilder: rb,
        config: { security: { allowJSEvaluation: true } },
      } as any,
    )) as any;
    expect(res.ok).toBe(false);
    expect(res.suggestions.join(' ')).toContain('devtools_api_fetch');
  });
});

// ─── #82 annotated screenshot roleSelector ────────────────────

describe('browser_screenshot_annotated roleSelector (#82)', () => {
  it('emits a role= selector using the element role + accessible name', async () => {
    const rb = makeResponseBuilder();
    const fakeElements = [
      {
        index: 0,
        tag: 'button',
        text: 'Submit Form',
        selector: 'Submit',
        roleSelector: 'role=button[name="Submit Form"]',
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      },
    ];
    const sessionManager = makeSessionManager();
    sessionManager.getOrDefault = vi.fn().mockReturnValue({
      browser: {
        evaluate: vi.fn().mockResolvedValue(fakeElements),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('img')),
        viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
      },
    });
    const res = (await browserScreenshotAnnotated.handler({ output: 'compact' }, {
      sessionManager,
      responseBuilder: rb,
    } as any)) as any;
    expect(rb.success).toHaveBeenCalled();
    expect(res.elements[0].roleSelector).toBe('role=button[name="Submit Form"]');
  });
});
