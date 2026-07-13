import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { browserUploadFile, browserDragDrop } from '../../../src/tools/interaction/index.js';

describe('browser_upload_file tool', () => {
  it('should have correct name and description', () => {
    expect(browserUploadFile.name).toBe('browser_upload_file');
    expect(browserUploadFile.description).toContain('<use_case>');
    expect(browserUploadFile.description).toContain('fileName');
  });

  it('should require selector', () => {
    const result = browserUploadFile.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should require filePaths array', () => {
    const result = browserUploadFile.inputSchema.safeParse({
      selector: "input[type='file']",
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid input with single file', () => {
    const result = browserUploadFile.inputSchema.safeParse({
      selector: "input[type='file']",
      filePaths: ['/path/to/file.txt'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid input with multiple files', () => {
    const result = browserUploadFile.inputSchema.safeParse({
      selector: "input[type='file']",
      filePaths: ['/path/to/file1.txt', '/path/to/file2.txt'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filePaths).toHaveLength(2);
    }
  });

  it('should reject non-array filePaths', () => {
    const result = browserUploadFile.inputSchema.safeParse({
      selector: "input[type='file']",
      filePaths: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });

  it('should reject array with non-string elements', () => {
    const result = browserUploadFile.inputSchema.safeParse({
      selector: "input[type='file']",
      filePaths: [123, 456],
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional sessionId', () => {
    const result = browserUploadFile.inputSchema.safeParse({
      selector: "input[type='file']",
      filePaths: ['file.txt'],
      sessionId: 'sess_test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('sess_test');
    }
  });

  it('should have inputSchema property', () => {
    expect(browserUploadFile.inputSchema).toBeInstanceOf(z.ZodType);
  });
});

describe('browser_drag_drop tool', () => {
  it('should have correct name and description', () => {
    expect(browserDragDrop.name).toBe('browser_drag_drop');
    expect(browserDragDrop.description).toContain('<use_case>');
    expect(browserDragDrop.description).toContain('dragTo');
  });

  it('should require sourceSelector', () => {
    const result = browserDragDrop.inputSchema.safeParse({
      targetSelector: '#target',
    });
    expect(result.success).toBe(false);
  });

  it('should require targetSelector', () => {
    const result = browserDragDrop.inputSchema.safeParse({
      sourceSelector: '#source',
    });
    expect(result.success).toBe(false);
  });

  it('should require both selectors', () => {
    const result = browserDragDrop.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept valid input', () => {
    const result = browserDragDrop.inputSchema.safeParse({
      sourceSelector: '#drag-item',
      targetSelector: '#drop-zone',
    });
    expect(result.success).toBe(true);
  });

  it('should accept optional sessionId', () => {
    const result = browserDragDrop.inputSchema.safeParse({
      sourceSelector: '#source',
      targetSelector: '#target',
      sessionId: 'sess_test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('sess_test');
    }
  });

  it('should reject non-string selectors', () => {
    const result = browserDragDrop.inputSchema.safeParse({
      sourceSelector: 123,
      targetSelector: '#target',
    });
    expect(result.success).toBe(false);
  });

  it('should have inputSchema property', () => {
    expect(browserDragDrop.inputSchema).toBeInstanceOf(z.ZodType);
  });

  it('should strip unknown fields not in schema', () => {
    const result = browserDragDrop.inputSchema.safeParse({
      sourceSelector: '#source',
      targetSelector: '#target',
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknownField).toBeUndefined();
    }
  });
});
