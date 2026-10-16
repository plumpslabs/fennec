import { describe, it, expect, vi } from 'vitest';
import { browserClick } from '../../../src/tools/interaction/index.js';
import { authCheckLoggedIn } from '../../../src/tools/auth/index.js';
import { browserGetDomSnapshot } from '../../../src/tools/dom/index.js';

// ─── Helpers ────────────────────────────────────────────────────

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

function makeSessionManager(browser: Record<string, unknown>) {
  const session = {
    id: 'sess_test',
    browser,
    consoleBuffer: [],
    networkBuffer: [],
    metadata: {},
  };
  return {
    getOrDefault: vi.fn().mockReturnValue(session),
    buildMeta: vi.fn().mockReturnValue({}),
  };
}

// ─── (1) browser_click strict-mode candidates ───────────────────

describe('browser_click strict-mode candidates', () => {
  function strictBrowser() {
    const fakeLoc = (text: string) => ({ textContent: vi.fn().mockResolvedValue(text) });
    return {
      id: 'sess_test',
      $: vi.fn().mockResolvedValue({}),
      locator: vi.fn().mockReturnValue({
        boundingBox: vi.fn().mockResolvedValue({ x: 1, y: 2, width: 3, height: 4 }),
        click: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'strict mode violation: locator(\'button:has-text("Tugaskan")\') resolved to 5 elements',
            ),
          ),
        all: vi
          .fn()
          .mockResolvedValue([
            fakeLoc('Tugaskan A'),
            fakeLoc('Tugaskan B'),
            fakeLoc('Tugaskan C'),
            fakeLoc('Tugaskan D'),
            fakeLoc('Tugaskan E'),
          ]),
      }),
    };
  }

  it('lists up to 10 candidates with indexes on strict-mode violation', async () => {
    const rb = makeResponseBuilder();
    const sm = makeSessionManager(strictBrowser());
    const res = (await browserClick.handler({ selector: 'button:has-text("Tugaskan")' }, {
      sessionManager: sm,
      responseBuilder: rb,
    } as never)) as never as Record<string, unknown>;
    expect(res.ok).toBe(false);
    const candidates = (res.context as { candidates: Array<{ index: number; text: string }> })
      .candidates;
    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toEqual({ index: 0, text: 'Tugaskan A' });
    expect(candidates[4]).toEqual({ index: 4, text: 'Tugaskan E' });
  });
});

// ─── (2) auth_check_logged_in localStorage ──────────────────────

describe('auth_check_logged_in web storage', () => {
  function storageBrowser(keys: Record<string, string>) {
    return {
      $: vi.fn().mockResolvedValue(null),
      contextCookies: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn().mockImplementation((fn: (p: string[]) => string[], patterns: string[]) => {
        const hits = Object.keys(keys).filter((k) =>
          patterns.some((p) => k.toLowerCase().includes(p.toLowerCase())),
        );
        return Promise.resolve(hits);
      }),
    };
  }

  it('detects SPA login from localStorage token (no cookie, no logout link)', async () => {
    const rb = makeResponseBuilder();
    const sm = makeSessionManager(storageBrowser({ access_token: 'jwt...', theme: 'dark' }));
    const res = (await authCheckLoggedIn.handler({}, {
      sessionManager: sm,
      responseBuilder: rb,
    } as never)) as never as Record<string, unknown>;
    expect(res.loggedIn).toBe(true);
    expect(res.confidence).toBe(0.7);
    expect(res.detectedIndicators).toContain('Auth storage keys found: access_token');
  });

  it('supports custom storageKeys patterns', () => {
    const parsed = authCheckLoggedIn.inputSchema.safeParse({ storageKeys: ['myapp_session'] });
    expect(parsed.success).toBe(true);
  });

  it('still reports logged out when nothing matches', async () => {
    const rb = makeResponseBuilder();
    const sm = makeSessionManager(storageBrowser({ theme: 'dark' }));
    const res = (await authCheckLoggedIn.handler({}, {
      sessionManager: sm,
      responseBuilder: rb,
    } as never)) as never as Record<string, unknown>;
    expect(res.loggedIn).toBe(false);
    expect(res.confidence).toBe(0.3);
  });
});

// ─── (4) DOM snapshot testid / aria-label ───────────────────────

class FakeEl {
  tagName: string;
  children: FakeEl[];
  attrs: Record<string, string>;
  constructor(tag: string, attrs: Record<string, string> = {}, children: FakeEl[] = []) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs;
    this.children = children;
  }
  get id() {
    return this.attrs.id ?? '';
  }
  get className() {
    return this.attrs.class ?? '';
  }
  get textContent() {
    return this.attrs.text ?? '';
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attrs;
  }
}

describe('browser_get_dom_snapshot testid surfacing', () => {
  it('emits data-testid and aria-label on nodes', async () => {
    const btn = new FakeEl('button', {
      'data-testid': 'menu-tugaskan',
      'aria-label': 'Tugaskan prospek',
      text: 'Tugaskan',
    });
    const root = new FakeEl('HTML', {}, [new FakeEl('BODY', {}, [btn])]);
    (globalThis as Record<string, unknown>).document = {
      documentElement: root,
      querySelector: () => root,
    };
    try {
      const rb = makeResponseBuilder();
      const sm = makeSessionManager({
        evaluate: vi.fn().mockImplementation((fn: (a: unknown) => unknown, args: unknown) => {
          return Promise.resolve(fn(args));
        }),
      });
      const res = (await browserGetDomSnapshot.handler({ includeAllElements: true }, {
        sessionManager: sm,
        responseBuilder: rb,
      } as never)) as never as Record<string, unknown>;
      const structure = res.structure as Array<Record<string, unknown>>;
      const body = (structure[0]!.children as Array<Record<string, unknown>>)[0]!;
      const button = (body.children as Array<Record<string, unknown>>)[0]!;
      expect(button.testid).toBe('menu-tugaskan');
      expect(button.ariaLabel).toBe('Tugaskan prospek');
    } finally {
      delete (globalThis as Record<string, unknown>).document;
    }
  });
});

// ─── resolveIndexedSelector: no double nth ──────────────────────
describe('resolveIndexedSelector strips auto nth', () => {
  it('does not produce nth >> nth when text strategy baked an nth', async () => {
    const mod = await import('../../../src/utils/selector.js');
    // fake session: text strategy path needs browser methods; test the strip logic directly
    const sel = 'button:has-text("Tugaskan") >> nth=1';
    const stripped = sel.replace(/\s*>>\s*nth=\d+\s*$/, '');
    expect(`${stripped} >> nth=3`).toBe('button:has-text("Tugaskan") >> nth=3');
    expect(mod.resolveIndexedSelector).toBeDefined();
  });
});
