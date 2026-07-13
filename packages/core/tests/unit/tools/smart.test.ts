import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// Use vi.hoisted() to create the mock BEFORE vi.mock() is hoisted to the top
const { mockResolveSelector } = vi.hoisted(() => ({
  mockResolveSelector: vi.fn(),
}));

vi.mock('../../../src/utils/selector.js', () => ({
  resolveSelector: mockResolveSelector,
}));

// Now import the functions under test
import { findSubmitButton, fillField, type DetectedField } from '../../../src/tools/smart/index.js';

// ─── Helpers ───────────────────────────────────────────────────

function createMockPage(): any {
  const locatorObj = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue([]),
    setChecked: vi.fn().mockResolvedValue(undefined),
    first: vi.fn().mockReturnThis(),
    inputValue: vi.fn().mockResolvedValue(''),
    boundingBox: vi.fn().mockResolvedValue(null),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
    count: vi.fn().mockResolvedValue(1),
  };

  return {
    locator: vi.fn().mockReturnValue(locatorObj),
    $: vi.fn().mockResolvedValue(null),
    $$: vi.fn().mockResolvedValue([]),
    url: vi.fn().mockResolvedValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Test Page'),
    evaluate: vi.fn(),
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    waitForLoadState: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    keyboard: { press: vi.fn() },
    isClosed: vi.fn().mockReturnValue(false),
    context: {
      cookies: vi.fn().mockResolvedValue([]),
      addCookies: vi.fn(),
    },
  };
}

function makeField(overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    index: 0,
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    placeholder: '',
    label: '',
    ariaLabel: '',
    dataTestid: '',
    required: false,
    currentValue: '',
    minLength: null,
    maxLength: null,
    pattern: null,
    min: null,
    max: null,
    step: null,
    ...overrides,
  };
}

// ─── findSubmitButton ──────────────────────────────────────────

describe('findSubmitButton', () => {
  let page: any;

  beforeEach(() => {
    vi.clearAllMocks();
    page = createMockPage();
  });

  it('should return clickable when resolveSelector matches a button text', async () => {
    mockResolveSelector.mockResolvedValue({
      found: true,
      selector: 'text=Submit',
      strategy: 'text',
    });

    const result = await findSubmitButton(page);

    expect(result).not.toBeNull();
    expect(typeof result!.click).toBe('function');
    expect(mockResolveSelector).toHaveBeenCalledWith(page, 'Submit');
  });

  it('should try multiple button texts until one matches', async () => {
    mockResolveSelector
      .mockResolvedValueOnce({ found: false, selector: '', strategy: 'text' })
      .mockResolvedValueOnce({ found: false, selector: '', strategy: 'text' })
      .mockResolvedValueOnce({ found: false, selector: '', strategy: 'text' })
      .mockResolvedValueOnce({ found: false, selector: '', strategy: 'text' })
      .mockResolvedValueOnce({ found: false, selector: '', strategy: 'text' })
      .mockResolvedValueOnce({ found: false, selector: '', strategy: 'text' })
      .mockResolvedValueOnce({ found: false, selector: '', strategy: 'text' })
      .mockResolvedValueOnce({ found: false, selector: '', strategy: 'text' })
      .mockResolvedValueOnce({ found: true, selector: 'text=Login', strategy: 'text' });

    const result = await findSubmitButton(page);

    expect(result).not.toBeNull();
    // Should have tried "Submit", "Save", ... "Sign up" (8 failures), then "Log in" succeeds
    const calls = mockResolveSelector.mock.calls;
    expect(calls.length).toBe(9);
    expect(calls[8]![1]).toBe('Log in');
  });

  it('should fall back to CSS selectors when resolveSelector finds nothing', async () => {
    mockResolveSelector.mockResolvedValue({
      found: false,
      selector: '',
      strategy: 'css',
    });

    page.$.mockImplementation((sel: string) => {
      if (sel === 'button[type="submit"]') return Promise.resolve({});
      return Promise.resolve(null);
    });

    const result = await findSubmitButton(page);

    expect(result).not.toBeNull();
    expect(typeof result!.click).toBe('function');
    expect(page.$).toHaveBeenCalledWith('button[type="submit"]');
  });

  it('should return null when nothing matches', async () => {
    mockResolveSelector.mockResolvedValue({
      found: false,
      selector: '',
      strategy: 'css',
    });
    page.$.mockResolvedValue(null);

    const result = await findSubmitButton(page);

    expect(result).toBeNull();
  });

  it('should return a working click handler', async () => {
    mockResolveSelector.mockResolvedValue({
      found: true,
      selector: 'text=Submit',
      strategy: 'text',
    });

    const result = await findSubmitButton(page);
    expect(result).not.toBeNull();

    await result!.click();

    expect(page.locator).toHaveBeenCalledWith('text=Submit');
    expect(page.locator().first().click).toHaveBeenCalled();
  });
});

// ─── fillField ──────────────────────────────────────────────────

describe('fillField', () => {
  let page: any;

  beforeEach(() => {
    vi.clearAllMocks();
    page = createMockPage();
  });

  describe('Strategy 1: resolveSelector', () => {
    it('should use resolveSelector with field label', async () => {
      mockResolveSelector.mockResolvedValue({
        found: true,
        selector: 'text=Email',
        strategy: 'text',
      });

      const field = makeField({ label: 'Email' });
      const result = await fillField(page, field, 'test@test.com');

      expect(result).toBe(true);
      expect(mockResolveSelector).toHaveBeenCalledWith(page, 'Email');
      expect(page.locator).toHaveBeenCalledWith('text=Email');
      expect(page.locator().first().fill).toHaveBeenCalledWith('test@test.com');
    });

    it('should use resolveSelector with ariaLabel when label is empty', async () => {
      mockResolveSelector.mockResolvedValue({
        found: true,
        selector: '[aria-label=Password]',
        strategy: 'aria-label',
      });

      const field = makeField({ label: '', ariaLabel: 'Password' });
      const result = await fillField(page, field, 'secret');

      expect(result).toBe(true);
      expect(mockResolveSelector).toHaveBeenCalledWith(page, 'Password');
    });

    it('should fall through to attribute selector when resolveSelector not found', async () => {
      mockResolveSelector.mockResolvedValue({
        found: false,
        selector: '',
        strategy: 'css',
      });

      const field = makeField({ id: 'email-input', label: 'Email' });
      const result = await fillField(page, field, 'test@test.com');

      expect(result).toBe(true);
      expect(page.locator).toHaveBeenCalledWith('[id="email-input"]');
      expect(page.locator().first().fill).toHaveBeenCalledWith('test@test.com');
    });

    it('should return false when no identifier resolves and no id/name/placeholder', async () => {
      mockResolveSelector.mockResolvedValue({
        found: false,
        selector: '',
        strategy: 'css',
      });

      const field = makeField({ id: '', name: '', placeholder: '' });
      const result = await fillField(page, field, 'value');

      expect(result).toBe(false);
    });

    it('should handle resolveSelector rejection gracefully', async () => {
      mockResolveSelector.mockRejectedValue(new Error('network error'));

      const field = makeField({ id: 'email', label: 'Email' });
      const result = await fillField(page, field, 'test@test.com');

      expect(result).toBe(true);
      expect(page.locator).toHaveBeenCalledWith('[id="email"]');
    });
  });

  describe('Strategy 2: attribute selectors', () => {
    it('should use [id=...] when field has id', async () => {
      mockResolveSelector.mockResolvedValue({
        found: false,
        selector: '',
        strategy: 'css',
      });

      const field = makeField({ id: 'user-email' });
      const result = await fillField(page, field, 'a@b.com');

      expect(result).toBe(true);
      expect(page.locator).toHaveBeenCalledWith('[id="user-email"]');
    });

    it('should use tag[name=...] when field has name but no id', async () => {
      mockResolveSelector.mockResolvedValue({
        found: false,
        selector: '',
        strategy: 'css',
      });

      const field = makeField({ id: '', name: 'password', tag: 'input' });
      const result = await fillField(page, field, 'secret');

      expect(result).toBe(true);
      expect(page.locator).toHaveBeenCalledWith('input[name="password"]');
    });

    it('should use tag[placeholder=...] when only placeholder available', async () => {
      mockResolveSelector.mockResolvedValue({
        found: false,
        selector: '',
        strategy: 'css',
      });

      const field = makeField({ id: '', name: '', placeholder: 'Enter your name', tag: 'input' });
      const result = await fillField(page, field, 'John');

      expect(result).toBe(true);
      expect(page.locator).toHaveBeenCalledWith('input[placeholder="Enter your name"]');
    });

    it('should escape quotes in attribute values', async () => {
      mockResolveSelector.mockResolvedValue({
        found: false,
        selector: '',
        strategy: 'css',
      });

      const field = makeField({ id: 'he"llo' });
      const result = await fillField(page, field, 'test');

      expect(result).toBe(true);
      expect(page.locator).toHaveBeenCalledWith('[id="he\\"llo"]');
    });
  });

  describe('Field interaction types', () => {
    it('should call setChecked(true) for checkbox', async () => {
      mockResolveSelector.mockResolvedValue({
        found: true,
        selector: 'text=Remember',
        strategy: 'text',
      });

      const field = makeField({ label: 'Remember me', type: 'checkbox' });
      const result = await fillField(page, field, 'true');

      expect(result).toBe(true);
      expect(page.locator().first().setChecked).toHaveBeenCalledWith(true);
    });

    it("should call setChecked(false) for checkbox with 'false'", async () => {
      mockResolveSelector.mockResolvedValue({
        found: true,
        selector: '[id=remember]',
        strategy: 'css',
      });

      const field = makeField({ id: 'remember', type: 'checkbox' });
      const result = await fillField(page, field, 'false');

      expect(result).toBe(true);
      expect(page.locator().first().setChecked).toHaveBeenCalledWith(false);
    });

    it('should call selectOption for select fields', async () => {
      mockResolveSelector.mockResolvedValue({
        found: true,
        selector: '[name=country]',
        strategy: 'css',
      });

      const field = makeField({ name: 'country', tag: 'select', type: 'select' });
      const result = await fillField(page, field, 'US');

      expect(result).toBe(true);
      expect(page.locator().first().selectOption).toHaveBeenCalledWith('US');
    });

    it('should call fill for regular input fields', async () => {
      mockResolveSelector.mockResolvedValue({
        found: true,
        selector: '[id=name]',
        strategy: 'css',
      });

      const field = makeField({ id: 'name' });
      const result = await fillField(page, field, 'John');

      expect(result).toBe(true);
      expect(page.locator().first().fill).toHaveBeenCalledWith('John');
    });
  });
});
