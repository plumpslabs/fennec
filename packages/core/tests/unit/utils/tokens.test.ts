import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateValueTokens, setTokenizer } from '../../../src/utils/tokens.js';

describe('token estimator (#146)', () => {
  it('estimates prose near 4 chars/token by default', () => {
    const text = 'hello world '.repeat(100); // 1200 chars
    const est = estimateTokens(text);
    expect(est).toBeGreaterThan(200);
    expect(est).toBeLessThan(400);
  });

  it('tunes by model family', () => {
    const text = 'hello world '.repeat(100);
    expect(estimateTokens(text, 'claude-3')).toBeGreaterThan(estimateTokens(text, 'gpt-4o'));
  });

  it('uses an injected real tokenizer when provided', () => {
    setTokenizer(() => 42);
    try {
      expect(estimateTokens('anything')).toBe(42);
      expect(estimateValueTokens({ a: 1 })).toBe(42);
    } finally {
      setTokenizer(null);
    }
  });

  it('falls back to heuristic when the injected tokenizer throws', () => {
    setTokenizer(() => {
      throw new Error('nope');
    });
    try {
      expect(estimateTokens('hello world')).toBeGreaterThan(0);
    } finally {
      setTokenizer(null);
    }
  });
});
