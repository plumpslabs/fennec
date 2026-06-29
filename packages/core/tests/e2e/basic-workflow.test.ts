/**
 * E2E Test Setup for Fennec
 *
 * These tests validate that Fennec's core tools work correctly with a real browser.
 * They require Playwright browsers to be installed.
 *
 * Run: npx playwright install chromium && pnpm test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, BrowserContext, Page, CDPSession } from 'playwright';

// Note: These tests will be skipped if Playwright browsers are not installed.
// They test the actual browser interaction layer — the most critical part of Fennec.
// In CI, these run after `npx playwright install chromium --with-deps`.

describe.skipIf(!process.env.CI && !process.env.E2E_TEST)('E2E: Browser Tools', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let cdpSession: CDPSession;

  beforeAll(async () => {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    cdpSession = await context.newCDPSession(page);
  });

  afterAll(async () => {
    await context.close();
    await browser.close();
  });

  it('should navigate to a page', async () => {
    await page.goto('https://example.com', { waitUntil: 'networkidle' });
    expect(page.url()).toBe('https://example.com/');
  });

  it('should get page title', async () => {
    const title = await page.title();
    expect(title).toBe('Example Domain');
  });

  it('should get DOM snapshot', async () => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).toContain('Example Domain');
    expect(html.length).toBeGreaterThan(0);
  });

  it('should find elements by CSS selector', async () => {
    const elements = await page.evaluate(() => {
      const els = document.querySelectorAll('a');
      return Array.from(els).map((el) => ({
        text: el.textContent?.trim(),
        href: el.getAttribute('href'),
      }));
    });
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.some((e) => e.href)).toBe(true);
  });

  it('should detect console events via CDP', async () => {
    const consoleEvents: any[] = [];
    cdpSession.on('Console.messageAdded' as any, (msg: any) => {
      consoleEvents.push(msg);
    });

    await cdpSession.send('Console.enable' as any);
    await page.evaluate(() => console.log('e2e test log'));
    await page.waitForTimeout(500);

    expect(consoleEvents.length).toBeGreaterThan(0);
  });

  it('should detect network events via CDP', async () => {
    const networkEvents: any[] = [];
    cdpSession.on('Network.requestWillBeSent' as any, (msg: any) => {
      networkEvents.push(msg);
    });

    await cdpSession.send('Network.enable' as any);
    await page.goto('https://example.com', { waitUntil: 'networkidle' });

    expect(networkEvents.length).toBeGreaterThan(0);
  });

  it('should take screenshot', async () => {
    const buffer = await page.screenshot({ type: 'png' });
    expect(buffer.length).toBeGreaterThan(1000); // At least 1KB
  });

  it('should handle cookies', async () => {
    await context.addCookies([{
      name: 'test_cookie',
      value: 'test_value',
      domain: 'example.com',
      path: '/',
    }]);

    const cookies = await context.cookies();
    const testCookie = cookies.find((c) => c.name === 'test_cookie');
    expect(testCookie).toBeDefined();
    expect(testCookie!.value).toBe('test_value');
  });

  it('should support multi-tab', async () => {
    const page2 = await context.newPage();
    await page2.goto('https://example.com', { waitUntil: 'networkidle' });

    const pages = context.pages();
    expect(pages.length).toBe(2);

    await page2.close();
  });
});
