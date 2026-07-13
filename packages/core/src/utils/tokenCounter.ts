/**
 * Token Counter — Lightweight token estimation for budget enforcement.
 *
 * Uses a simple heuristic: ~4 characters per token (GPT/Claude average).
 * This is NOT a full tokenizer, but good enough for budget enforcement.
 * Actual token usage depends on the model, so we use a conservative estimate.
 */

const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens in a string.
 * Uses character count / 4 as a rough approximation.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate a string to fit within a token budget.
 * Preserves the most important parts (beginning) and optionally the end.
 */
export function truncateByTokens(
  text: string,
  maxTokens: number,
  options?: { preserveEnd?: boolean },
): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;

  if (options?.preserveEnd) {
    // Keep beginning (80%) and end (20%)
    const headChars = Math.floor(maxChars * 0.8);
    const tailChars = maxChars - headChars - 20; // 20 chars for "...\n[...]\n"
    return (
      text.slice(0, headChars) +
      `\n... [truncated: ${estimateTokens(text.slice(headChars, -tailChars || undefined))} tokens hidden] ...\n` +
      text.slice(-tailChars)
    );
  }

  return (
    text.slice(0, maxChars) +
    `\n... [truncated: ${estimateTokens(text.slice(maxChars))} tokens hidden]`
  );
}

/**
 * Estimate tokens in a JSON-serializable object.
 */
export function estimateObjectTokens(obj: unknown): number {
  try {
    return estimateTokens(JSON.stringify(obj));
  } catch {
    return 0;
  }
}

/**
 * Truncate a JSON-serializable object's string fields to fit within a token budget.
 * Modifies the object in-place to truncate long string fields.
 */
export function truncateObjectByTokens<T extends Record<string, unknown>>(
  obj: T,
  maxTokens: number,
): T {
  const currentTokens = estimateObjectTokens(obj);
  if (currentTokens <= maxTokens) return obj;

  // Truncate the longest string fields first
  const stringFields: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      stringFields.push({ key, value });
    } else if (Array.isArray(value)) {
      // Truncate arrays (keep first N items)
      const maxItems = Math.max(5, Math.floor(value.length * (maxTokens / currentTokens)));
      if (value.length > maxItems) {
        (obj as Record<string, unknown>)[key] = value.slice(0, maxItems);
        stringFields.push({
          key,
          value: `[${value.length - maxItems} more items truncated]`,
        });
      }
    }
  }

  // Sort by length (longest first) and truncate
  stringFields.sort((a, b) => b.value.length - a.value.length);
  let remainingBudget = maxTokens;

  for (const field of stringFields) {
    const fieldTokens = estimateTokens(field.value);
    if (fieldTokens > remainingBudget / stringFields.length) {
      const maxFieldTokens = Math.max(20, Math.floor(remainingBudget / stringFields.length));
      (obj as Record<string, unknown>)[field.key] = truncateByTokens(field.value, maxFieldTokens, {
        preserveEnd: true,
      });
    }
    remainingBudget -= estimateTokens(String((obj as Record<string, unknown>)[field.key]));
  }

  return obj;
}
