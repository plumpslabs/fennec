import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/paths.js', () => ({
  getFennecDir: () => '/tmp/fennec-test-fennec-dir',
}));

const mockFs = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
};

vi.mock('node:fs', () => mockFs);

vi.mock('node:child_process', () => ({ execSync: vi.fn(() => { throw new Error('not available'); }) }));

describe('credentials module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('credentialStore (file fallback)', () => {
    it('should save credentials to file store', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{}');

      const { credentialStore } = await import('../../../src/db/credentials.js');

      await credentialStore.save('testdb', 'postgres://localhost/mydb');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/fennec-test-fennec-dir/.credentials.json',
        expect.stringContaining('testdb'),
        expect.any(Object),
      );
    });

    it('should get credentials from file store', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ testdb: 'postgres://localhost/mydb' }));

      const { credentialStore } = await import('../../../src/db/credentials.js');

      const result = await credentialStore.get('testdb');
      expect(result).toBe('postgres://localhost/mydb');
    });

    it('should return null for missing credential', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{}');

      const { credentialStore } = await import('../../../src/db/credentials.js');

      const result = await credentialStore.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete credentials from file store', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ testdb: 'postgres://localhost/mydb' }));

      const { credentialStore } = await import('../../../src/db/credentials.js');

      await credentialStore.delete('testdb');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.stringContaining('testdb'),
        expect.any(Object),
      );
    });
  });

  describe('connection metadata', () => {
    it('readConnections should return empty array when file missing', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const { readConnections } = await import('../../../src/db/credentials.js');
      expect(readConnections()).toEqual([]);
    });

    it('readConnections should return parsed connections', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ connections: [{ name: 'testdb' }] }));

      const { readConnections } = await import('../../../src/db/credentials.js');
      expect(readConnections()).toEqual([{ name: 'testdb' }]);
    });

    it('addConnection should upsert and update lastUsed', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{}');

      const { addConnection, readConnections } = await import('../../../src/db/credentials.js');

      addConnection({ name: 'testdb', type: 'postgresql', host: 'localhost', port: 5432, database: 'mydb', user: 'admin', ssl: 'disable', keychainRef: 'test', createdAt: '', lastUsed: '' });

      const call = mockFs.writeFileSync.mock.calls[0];
      const written = JSON.parse(call[1]);
      expect(written.connections).toHaveLength(1);
      expect(written.connections[0].name).toBe('testdb');
      expect(written.connections[0].lastUsed).toBeTruthy();
    });

    it('removeConnection should filter out the named connection', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ connections: [{ name: 'keep' }, { name: 'remove' }] }));

      const { removeConnection } = await import('../../../src/db/credentials.js');
      removeConnection('remove');

      const call = mockFs.writeFileSync.mock.calls[0];
      const written = JSON.parse(call[1]);
      expect(written.connections).toHaveLength(1);
      expect(written.connections[0].name).toBe('keep');
    });

    it('getConnection should find by name', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ connections: [{ name: 'testdb', host: 'localhost' }] }));

      const { getConnection } = await import('../../../src/db/credentials.js');
      expect(getConnection('testdb')).toEqual({ name: 'testdb', host: 'localhost' });
      expect(getConnection('nonexistent')).toBeUndefined();
    });
  });
});
