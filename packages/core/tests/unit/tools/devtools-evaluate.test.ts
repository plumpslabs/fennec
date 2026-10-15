import { describe, it, expect } from 'vitest';
import { normalizeForEvaluate } from '../../../src/tools/devtools/console.js';

describe('normalizeForEvaluate', () => {
  it('passes pure expressions through untouched', () => {
    for (const expr of [
      'document.title',
      'document.querySelectorAll("a").length',
      'location.href',
      '(a + b)',
    ]) {
      expect(normalizeForEvaluate(expr)).toEqual({ source: expr, wrapped: false });
    }
  });

  it('wraps a lone function declaration and invokes it', () => {
    const r = normalizeForEvaluate('function hello(){ return 1; }');
    expect(r.wrapped).toBe(true);
    expect(r.source).toBe('(function hello(){ return 1; })()');
  });

  it('leaves an already-invoked declaration alone', () => {
    const expr = 'function f(){ return 1; }()';
    expect(normalizeForEvaluate(expr).wrapped).toBe(false);
  });

  it('wraps multi-statement scripts in an IIFE', () => {
    const r = normalizeForEvaluate('const x = 1; x + 2');
    expect(r.wrapped).toBe(true);
    expect(r.source).toContain('(() =>');
  });

  it('uses an async IIFE when the body awaits', () => {
    const r = normalizeForEvaluate('const r = await fetch("/a"); return r.status;');
    expect(r.wrapped).toBe(true);
    expect(r.source.startsWith('(async () =>')).toBe(true);
  });

  it('leaves existing IIFEs alone', () => {
    const expr = '(() => { return 5; })()';
    expect(normalizeForEvaluate(expr)).toEqual({ source: expr, wrapped: false });
  });

  it('wraps control-flow statements', () => {
    const r = normalizeForEvaluate('for (const a of [1,2]) { console.log(a); }');
    expect(r.wrapped).toBe(true);
  });
});
