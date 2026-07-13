import { describe, it, expect } from 'vitest';
import { Recorder } from '../../../src/recorder/Recorder.js';

describe('Recorder — exportAsScript', () => {
  it('exports a Playwright script for recorded actions', () => {
    const r = new Recorder();
    const id = r.startRecording('login-flow');
    r.recordAction(
      'navigate',
      'go to app',
      { url: 'http://app.local/' },
      { url: 'about:blank', duration: 12 },
    );
    r.recordAction(
      'click',
      'click login',
      { selector: '#login' },
      { url: 'http://app.local/', duration: 30 },
    );
    r.recordAction(
      'type',
      'enter email',
      { selector: '#email', text: 'a@b.co' },
      { url: 'http://app.local/', duration: 40 },
    );
    r.stopRecording();

    const script = r.exportAsScript(id, 'playwright')!;
    expect(script).toContain("import { chromium } from 'playwright'");
    expect(script).toContain('await page.goto("http://app.local/")');
    expect(script).toContain('await page.click("#login")');
    expect(script).toContain('await page.fill("#email", "a@b.co")');
    expect(script).toContain('await browser.close();');
  });

  it('exports a Puppeteer script when requested', () => {
    const r = new Recorder();
    const id = r.startRecording('flow');
    r.recordAction('navigate', 'go', { url: 'http://x/' }, { url: 'about:blank', duration: 1 });
    r.stopRecording();

    const script = r.exportAsScript(id, 'puppeteer')!;
    expect(script).toContain("require('puppeteer')");
    expect(script).toContain('await page.goto("http://x/")');
  });

  it('returns null for an unknown recording', () => {
    const r = new Recorder();
    expect(r.exportAsScript('nope')).toBeNull();
  });
});
