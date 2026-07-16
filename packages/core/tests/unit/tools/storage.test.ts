import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { storageExportState, storageImportState } from '../../../src/tools/storage/index.js';

describe('storage_export_state tool', () => {
  it('should have correct name and description', () => {
    expect(storageExportState.name).toBe('storage_export_state');
    expect(storageExportState.description).toContain('<use_case>');
    expect(storageExportState.description).toContain('cookies');
    expect(storageExportState.description).toContain('localStorage');
  });

  it('should accept empty input (no required params)', () => {
    const result = storageExportState.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept optional filePath', () => {
    const result = storageExportState.inputSchema.safeParse({
      filePath: 'demo-state.json',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filePath).toBe('demo-state.json');
    }
  });

  it('should accept optional sessionId', () => {
    const result = storageExportState.inputSchema.safeParse({
      sessionId: 'sess_test',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('sess_test');
    }
  });

  it('should reject non-string filePath', () => {
    const result = storageExportState.inputSchema.safeParse({
      filePath: 123,
    });
    expect(result.success).toBe(false);
  });

  it('should have inputSchema property', () => {
    expect(storageExportState.inputSchema).toBeInstanceOf(z.ZodType);
  });
});

describe('storage_import_state tool', () => {
  it('should have correct name and description', () => {
    expect(storageImportState.name).toBe('storage_import_state');
    expect(storageImportState.description).toContain('<use_case>');
    expect(storageImportState.description).toContain('cookiesRestored');
    expect(storageImportState.description).toContain('itemsRestored');
  });

  it('should accept optional filePath', () => {
    const result = storageImportState.inputSchema.safeParse({
      filePath: 'demo-state.json',
    });
    expect(result.success).toBe(true);
  });

  it('should accept optional stateObject (JSON string)', () => {
    const result = storageImportState.inputSchema.safeParse({
      stateObject: JSON.stringify({ cookies: [], localStorage: {} }),
    });
    expect(result.success).toBe(true);
  });

  it('should accept optional sessionId', () => {
    const result = storageImportState.inputSchema.safeParse({
      filePath: 'state.json',
      sessionId: 'sess_test',
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty input (both filePath and stateObject optional)', () => {
    // Both are optional in schema, validation happens in handler
    const result = storageImportState.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should reject non-string filePath', () => {
    const result = storageImportState.inputSchema.safeParse({
      filePath: 123,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-string stateObject', () => {
    const result = storageImportState.inputSchema.safeParse({
      stateObject: { invalid: 'object' },
    });
    expect(result.success).toBe(false);
  });

  it('should have distinct input schemas for export vs import', () => {
    // Guarded cast to avoid ZodObject type assumption
    const exportSchema = storageExportState.inputSchema as any;
    const importSchema = storageImportState.inputSchema as any;
    if (exportSchema.shape && importSchema.shape) {
      const exportKeys = Object.keys(exportSchema.shape);
      const importKeys = Object.keys(importSchema.shape);
      expect(importKeys).toContain('stateObject');
      expect(exportKeys).not.toContain('stateObject');
    }
  });

  it('should strip unknown fields not in schema', () => {
    const result = storageExportState.inputSchema.safeParse({
      filePath: 'state.json',
      unknownField: 'should be stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknownField).toBeUndefined();
    }
  });

  it('should have inputSchema property', () => {
    expect(storageImportState.inputSchema).toBeInstanceOf(z.ZodType);
  });
});
