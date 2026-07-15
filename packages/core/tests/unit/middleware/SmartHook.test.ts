import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSmartHook } from '../../../src/middleware/SmartHook.js';
import type { MiddlewareFn, MiddlewareContext, ToolResult } from '../../../src/middleware/Pipeline.js';

// ─── Helpers ───────────────────────────────────────────────────

function createMockBrowser(): any {
  const locatorObj: Record<string, any> = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue([]),
    setChecked: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    inputValue: vi.fn().mockResolvedValue(''),
    boundingBox: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn(),
    count: vi.fn().mockResolvedValue(1),
    isVisible: vi.fn().mockResolvedValue(true),
    isEnabled: vi.fn().mockResolvedValue(true),
    textContent: vi.fn().mockResolvedValue(''),
    first: vi.fn().mockReturnThis(),
    allTextContents: vi.fn().mockResolvedValue([]),
    elementHandle: vi.fn().mockResolvedValue(null),
  };

  return {
    locator: vi.fn().mockReturnValue(locatorObj),
    $: vi.fn().mockResolvedValue(null),
    url: vi.fn().mockResolvedValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Test Page'),
    evaluate: vi.fn(),
    waitForSelector: vi.fn(),
    waitForLoadState: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    isClosed: vi.fn().mockReturnValue(false),
    context: {
      cookies: vi.fn().mockResolvedValue([]),
      addCookies: vi.fn(),
    },
  };
}

function createFailureResult(errorCode: string, message?: string): ToolResult {
  return {
    success: false,
    error: {
      code: errorCode,
      message: message ?? `Error: ${errorCode}`,
      suggestions: [],
      context: {},
    },
    meta: { elapsed: 0, sessionId: 'test', timestamp: new Date().toISOString() },
  };
}

function createSuccessResult(data?: Record<string, unknown>): ToolResult {
  return {
    success: true,
    data: data ?? { result: 'ok' },
    meta: { elapsed: 0, sessionId: 'test', timestamp: new Date().toISOString() },
  };
}

describe('SmartHook ELEMENT_NOT_INTERACTABLE recovery', () => {
  let smartHook: MiddlewareFn;
  let browser: any;

  beforeEach(() => {
    vi.clearAllMocks();
    smartHook = createSmartHook();
    browser = createMockBrowser();
  });

  it('should pass through success results unchanged', async () => {
    const ctx = {
      toolName: 'browser_click',
      input: { selector: 'text=Submit' },
      session: { browser },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createSuccessResult({ result: 'ok' }));

    const result = await smartHook(ctx, next);

    expect(result.success).toBe(true);
    expect((result as any).data).toEqual({ result: 'ok' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should pass through non-ELEMENT_NOT_INTERACTABLE errors while enriching context', async () => {
    const ctx = {
      toolName: 'browser_click',
      input: { selector: 'text=Submit' },
      session: { browser,
        consoleBuffer: [],
        networkBuffer: [],
      },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_FOUND'));

    const result = await smartHook(ctx, next);

    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('ELEMENT_NOT_FOUND');
    // SmartHook enriches context with session info even for non-target errors
    expect((result as any).error.context).toBeDefined();
  });

  it('should not trigger ELEMENT_NOT_INTERACTABLE recovery for non-browser_click tools', async () => {
    const loc = browser.locator();
    // If recovery were triggered, evaluate would be called
    loc.evaluate.mockResolvedValue({
      tagName: 'option',
      optionValue: 'test',
      optionText: 'Test',
      selectName: 'test',
      selectId: '',
      allOptions: [],
    });

    const ctx = {
      toolName: 'browser_type',
      input: { selector: 'text=Input' },
      session: { browser,
        consoleBuffer: [],
        networkBuffer: [],
      },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_INTERACTABLE'));

    const result = await smartHook(ctx, next);

    // Should pass through original error without triggering recovery
    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('ELEMENT_NOT_INTERACTABLE');
    // Recovery should NOT have been attempted (only for browser_click)
    expect(loc.evaluate).not.toHaveBeenCalled();
  });

  it('should auto-recover when element is an <option> with select#id', async () => {
    // Mock locator.evaluate to return option info
    const loc = browser.locator();
    loc.evaluate.mockResolvedValue({
      tagName: 'option',
      optionValue: 'week',
      optionText: 'Mingguan',
      selectName: 'period',
      selectId: 'period-select',
      allOptions: [
        { value: 'day', text: 'Harian' },
        { value: 'week', text: 'Mingguan' },
        { value: 'month', text: 'Bulanan' },
      ],
    });

    // Mock selectOption to succeed
    loc.selectOption.mockResolvedValue(['week']);

    // Mock count to return > 0 (parent select exists)
    loc.count.mockResolvedValue(1);

    const ctx = {
      toolName: 'browser_click',
      input: { selector: 'text=Mingguan' },
      session: { browser },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(
      createFailureResult('ELEMENT_NOT_INTERACTABLE', 'locator.click: Timeout 30000ms exceeded.'),
    );

    const result = await smartHook(ctx, next);

    // Should have been auto-recovered via browser_select
    expect(result.success).toBe(true);
    expect((result as any).data).toMatchObject({
      recovered: true,
      actionSuggested: 'browser_select',
      selectSelector: '#period-select',
      selectedValue: 'week',
      recoveryStrategy: 'auto_select',
    });
    expect((result as any).data.allOptions).toHaveLength(3);
    expect((result as any).data.message).toContain('Auto-recovered');

    // Verify the recovery flow: evaluate → count → selectOption
    expect(loc.evaluate).toHaveBeenCalled();
    expect(loc.count).toHaveBeenCalled();
    expect(loc.selectOption).toHaveBeenCalledWith('week');
  });

  it('should auto-recover when element is an <option> with select[name=]', async () => {
    const loc = browser.locator();
    loc.evaluate.mockResolvedValue({
      tagName: 'option',
      optionValue: 'admin',
      optionText: 'Admin',
      selectName: 'role',
      selectId: '',
      allOptions: [
        { value: 'user', text: 'User' },
        { value: 'admin', text: 'Admin' },
      ],
    });
    loc.selectOption.mockResolvedValue(['admin']);
    loc.count.mockResolvedValue(1);

    const ctx = {
      toolName: 'browser_click',
      input: { selector: 'text=Admin' },
      session: { browser },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_INTERACTABLE'));

    const result = await smartHook(ctx, next);

    expect(result.success).toBe(true);
    expect((result as any).data.selectSelector).toBe('select[name="role"]');
    expect(loc.selectOption).toHaveBeenCalledWith('admin');
  });

  it('should inject enriched context when auto-recovery selectOption fails', async () => {
    const loc = browser.locator();
    loc.evaluate.mockResolvedValue({
      tagName: 'option',
      optionValue: 'week',
      optionText: 'Mingguan',
      selectName: 'period',
      selectId: 'period-select',
      allOptions: [
        { value: 'day', text: 'Harian' },
        { value: 'week', text: 'Mingguan' },
      ],
    });
    loc.count.mockResolvedValue(1);
    loc.selectOption.mockRejectedValue(new Error('select failed'));

    const ctx = {
      toolName: 'browser_click',
      input: { selector: 'text=Mingguan' },
      session: { browser },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_INTERACTABLE'));

    const result = await smartHook(ctx, next);

    // Should still return the original error, but with enriched context
    expect(result.success).toBe(false);
    const error = (result as any).error;
    expect(error.context.recovery).toBeDefined();
    expect(error.context.recovery.status).toBe('option_detected');
    expect(error.context.recovery.actionSuggested).toBe('browser_select');
    expect(error.context.recovery.optionValue).toBe('week');
    expect(error.context.recovery.selectSelector).toBe('#period-select');
  });

  it('should detect <select> element and suggest browser_select', async () => {
    const loc = browser.locator();
    loc.evaluate.mockResolvedValue({
      tagName: 'select',
      optionValue: null,
      optionText: null,
      selectName: null,
      selectId: null,
      allOptions: [],
    });

    const ctx = {
      toolName: 'browser_click',
      input: { selector: '#role-select' },
      session: { browser },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_INTERACTABLE'));

    const result = await smartHook(ctx, next);

    expect(result.success).toBe(false);
    const error = (result as any).error;
    expect(error.context.recovery).toBeDefined();
    expect(error.context.recovery.status).toBe('select_detected');
    expect(error.context.recovery.actionSuggested).toBe('browser_select');
    expect(error.context.recovery.elementType).toBe('select');
  });

  it('should handle unknown non-interactable elements gracefully', async () => {
    const loc = browser.locator();
    loc.evaluate.mockResolvedValue({
      tagName: 'div',
      optionValue: null,
      optionText: null,
      selectName: null,
      selectId: null,
      allOptions: [],
    });

    const ctx = {
      toolName: 'browser_click',
      input: { selector: '.hidden-overlay' },
      session: { browser },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_INTERACTABLE'));

    const result = await smartHook(ctx, next);

    expect(result.success).toBe(false);
    const error = (result as any).error;
    expect(error.context.recovery).toBeDefined();
    expect(error.context.recovery.status).toBe('not_interactable');
    expect(error.context.recovery.elementType).toBe('div');
  });

  it('should handle locator.evaluate rejection gracefully', async () => {
    const loc = browser.locator();
    loc.evaluate.mockRejectedValue(new Error('evaluate failed'));

    const ctx = {
      toolName: 'browser_click',
      input: { selector: 'text=Something' },
      session: { browser },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_INTERACTABLE'));

    const result = await smartHook(ctx, next);

    // Should pass through original error unchanged when recovery detection fails
    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('ELEMENT_NOT_INTERACTABLE');
  });

  it('should handle missing session gracefully (no crash)', async () => {
    const ctx = {
      toolName: 'browser_click',
      input: { selector: 'text=Submit' },
      // No session
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_INTERACTABLE'));

    const result = await smartHook(ctx, next);

    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('ELEMENT_NOT_INTERACTABLE');
  });

  it('should handle missing selector in input gracefully', async () => {
    const ctx = {
      toolName: 'browser_click',
      input: {},
      session: { browser },
    } as unknown as MiddlewareContext;

    const next = vi.fn().mockResolvedValue(createFailureResult('ELEMENT_NOT_INTERACTABLE'));

    const result = await smartHook(ctx, next);

    expect(result.success).toBe(false);
    expect((result as any).error.code).toBe('ELEMENT_NOT_INTERACTABLE');
  });
});
