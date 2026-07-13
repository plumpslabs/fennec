import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../../src/session/SessionManager.js';
import type { FennecConfig } from '../../../src/config/defaults.js';
import { defaultConfig } from '../../../src/config/defaults.js';

// Mock EventBus first (not affected by playwright mock issues)
vi.mock('../../../src/correlation/EventBus.js', () => ({
  EventBus: vi.fn().mockImplementation(() => ({
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
  })),
}));

// Use vi.hoisted to define shared mock objects before vi.mock is evaluated
const playwrightMock = vi.hoisted(() => {
  const mockPage = {
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    evaluate: vi.fn().mockResolvedValue('test'),
    goto: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
    $: vi.fn().mockResolvedValue(null),
    locator: vi.fn().mockReturnValue({
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      pressSequentially: vi.fn().mockResolvedValue(undefined),
      selectOption: vi.fn().mockResolvedValue([]),
      boundingBox: vi.fn().mockResolvedValue(null),
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
      elementHandle: vi.fn().mockResolvedValue(null),
      first: vi.fn().mockReturnThis(),
      inputValue: vi.fn().mockResolvedValue(''),
      textContent: vi.fn().mockResolvedValue(''),
      focus: vi.fn().mockResolvedValue(undefined),
      setInputFiles: vi.fn().mockResolvedValue(undefined),
      dragTo: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({}),
      innerText: vi.fn().mockResolvedValue(''),
      allTextContents: vi.fn().mockResolvedValue([]),
      setChecked: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([]),
      waitFor: vi.fn().mockResolvedValue(undefined),
      href: vi.fn().mockResolvedValue(''),
    }),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    $eval: vi.fn().mockResolvedValue(undefined),
  };

  const mockCDPSession = {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    newCDPSession: vi.fn().mockResolvedValue(mockCDPSession),
    close: vi.fn().mockResolvedValue(undefined),
    cookies: vi.fn().mockResolvedValue([]),
    addCookies: vi.fn().mockResolvedValue(undefined),
    clearCookies: vi.fn().mockResolvedValue(undefined),
    pages: vi.fn().mockReturnValue([mockPage]),
  };

  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { mockPage, mockCDPSession, mockContext, mockBrowser };
});

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn().mockResolvedValue(playwrightMock.mockBrowser) },
  firefox: { launch: vi.fn().mockResolvedValue(playwrightMock.mockBrowser) },
  webkit: { launch: vi.fn().mockResolvedValue(playwrightMock.mockBrowser) },
}));

function makeConfig(overrides?: Partial<FennecConfig>): FennecConfig {
  return {
    ...defaultConfig,
    ...overrides,
    session: { ...defaultConfig.session, ...overrides?.session },
    browser: { ...defaultConfig.browser, ...overrides?.browser },
    console: { ...defaultConfig.console, ...overrides?.console },
    network: { ...defaultConfig.network, ...overrides?.network },
  } as FennecConfig;
}

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new SessionManager(makeConfig());
  });

  describe('initialization', () => {
    it('should create instance with config', () => {
      expect(sessionManager).toBeInstanceOf(SessionManager);
    });

    it('should initialize default session with Chromium browser', async () => {
      await sessionManager.initialize();
      const session = sessionManager.getOrDefault();
      expect(session).toBeDefined();
      expect(session.id).toMatch(/^sess_/);
    });

    it('should support all three browser types', async () => {
      const { chromium, firefox, webkit } = await import('playwright');

      const sm1 = new SessionManager(
        makeConfig({ browser: { ...defaultConfig.browser, type: 'chromium' } }),
      );
      await sm1.initialize();
      expect(chromium.launch).toHaveBeenCalled();
      await sm1.close();

      const sm2 = new SessionManager(
        makeConfig({ browser: { ...defaultConfig.browser, type: 'firefox' } }),
      );
      await sm2.initialize();
      expect(firefox.launch).toHaveBeenCalled();
      await sm2.close();

      const sm3 = new SessionManager(
        makeConfig({ browser: { ...defaultConfig.browser, type: 'webkit' } }),
      );
      await sm3.initialize();
      expect(webkit.launch).toHaveBeenCalled();
      await sm3.close();
    });
  });

  describe('session lifecycle', () => {
    beforeEach(async () => {
      await sessionManager.initialize();
    });

    it('should create additional sessions', async () => {
      const session = await sessionManager.createSession('test-session');
      expect(session.name).toBe('test-session');
      expect(session.id).toMatch(/^sess_/);
    });

    it('should get default session by id', () => {
      const defaultSession = sessionManager.getOrDefault();
      const byId = sessionManager.getSession(defaultSession.id);
      expect(byId.id).toBe(defaultSession.id);
    });

    it('should fall back to default session on getOrDefault with unknown id', () => {
      const result = sessionManager.getOrDefault('non_existent');
      expect(result).toBeDefined();
    });

    it('should list all sessions', async () => {
      await sessionManager.createSession('session-1');
      await sessionManager.createSession('session-2');
      const sessions = sessionManager.listSessions();
      expect(sessions.length).toBe(3);
    });

    it('should destroy a session', async () => {
      const session = await sessionManager.createSession('to-destroy');
      await sessionManager.destroySession(session.id);
      const sessions = sessionManager.listSessions();
      expect(sessions.find((s) => s.id === session.id)).toBeUndefined();
    });

    it('should destroy all sessions', async () => {
      await sessionManager.destroyAll();
      expect(sessionManager.listSessions().length).toBe(0);
    });

    it('should close browser on close', async () => {
      await sessionManager.close();
      expect(sessionManager.listSessions().length).toBe(0);
    });
  });

  describe('console buffer management', () => {
    beforeEach(async () => {
      await sessionManager.initialize();
    });

    it('should add console events', () => {
      const session = sessionManager.getOrDefault();
      sessionManager.addConsoleEvent(session.id, {
        level: 'error',
        message: 'test error',
        source: 'test.js',
        timestamp: new Date().toISOString(),
      });

      const logs = sessionManager.getConsoleBuffer(session.id);
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe('test error');
    });

    it('should filter console logs by level', () => {
      const session = sessionManager.getOrDefault();
      sessionManager.addConsoleEvent(session.id, {
        level: 'error',
        message: 'err',
        source: 'test.js',
        timestamp: new Date().toISOString(),
      });
      sessionManager.addConsoleEvent(session.id, {
        level: 'info',
        message: 'info msg',
        source: 'test.js',
        timestamp: new Date().toISOString(),
      });

      const errors = sessionManager.getConsoleBuffer(session.id, { level: 'error' });
      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('err');
    });

    it('should filter console logs by keyword', () => {
      const session = sessionManager.getOrDefault();
      sessionManager.addConsoleEvent(session.id, {
        level: 'warn',
        message: 'deprecation warning',
        source: 'test.js',
        timestamp: new Date().toISOString(),
      });
      sessionManager.addConsoleEvent(session.id, {
        level: 'info',
        message: 'all good',
        source: 'test.js',
        timestamp: new Date().toISOString(),
      });

      const filtered = sessionManager.getConsoleBuffer(session.id, { keyword: 'deprecation' });
      expect(filtered.length).toBe(1);
    });

    it('should clear console buffer', () => {
      const session = sessionManager.getOrDefault();
      sessionManager.addConsoleEvent(session.id, {
        level: 'error',
        message: 'test',
        source: 'test.js',
        timestamp: new Date().toISOString(),
      });
      const cleared = sessionManager.clearConsoleBuffer(session.id);
      expect(cleared).toBe(1);
      expect(sessionManager.getConsoleBuffer(session.id).length).toBe(0);
    });
  });

  describe('network buffer management', () => {
    beforeEach(async () => {
      await sessionManager.initialize();
    });

    it('should add network events', () => {
      const session = sessionManager.getOrDefault();
      sessionManager.addNetworkEvent(session.id, {
        requestId: 'req1',
        method: 'GET',
        url: 'https://example.com/api',
        status: 200,
        statusText: 'OK',
        duration: 100,
        timestamp: new Date().toISOString(),
        type: 'fetch',
      });

      expect(session.networkBuffer.length).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should build error response with session context', () => {
      const error = new Error('Something broke');
      const result = sessionManager.buildError(error);
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Something broke');
    });

    it('should build meta from session', () => {
      const meta = sessionManager.buildMeta({ id: 'test-session' });
      expect(meta.sessionId).toBe('test-session');
      expect(meta.timestamp).toBeDefined();
    });
  });
});
