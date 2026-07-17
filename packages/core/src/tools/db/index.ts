import { z } from 'zod';
import { createTool } from '../_registry.js';
import { getDbManager } from '../../db/dbTuiManager.js';
import { getConnection, addConnection, removeConnection, credentialStore } from '../../db/credentials.js';
import type { ConnectionMetadata } from '../../db/types.js';

function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some(h => host === h || host === `[${h}]` || host.startsWith(`${h}:`));
}

function parseDbUrl(url: string): { host: string; port: number; database: string; user: string } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: parseInt(u.port, 10) || 0,
      database: u.pathname.replace(/^\//, ''),
      user: decodeURIComponent(u.username),
    };
  } catch {
    return { host: '', port: 0, database: '', user: '' };
  }
}

export const dbConnect = createTool({
  name: 'db_connect',
  category: 'db',
  description: '`<use_case>Database</use_case> 🔌 Connect to a database. Credentials saved to OS keychain.',
  inputSchema: z.object({
    name: z.string().describe('Connection name for later reference'),
    url: z.string().describe('Database URL (postgres://, mysql://, sqlite://)'),
    save: z.boolean().optional().default(true).describe('Save credential to keychain'),
  }),
  handler: async (input, { responseBuilder, logger, config }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);

      const parsed = parseDbUrl(input.url);
      if (parsed.host && !isHostAllowed(parsed.host, config?.db?.allowedHosts ?? ['localhost', '127.0.0.1', '::1'])) {
        return responseBuilder.error(new Error(`Host "${parsed.host}" not allowed. Allowed: localhost, 127.0.0.1, ::1`), {
          code: 'DB_HOST_NOT_ALLOWED',
          suggestions: ['Use a local database', 'Update allowedHosts in config'],
        });
      }

      const result = await mgr.connect(input.name, input.url);

      if (input.save) {
        await credentialStore.save(input.name, input.url);
        addConnection({
          name: input.name,
          type: result.type as any,
          host: parsed.host,
          port: parsed.port,
          database: parsed.database,
          user: parsed.user,
          ssl: '',
          keychainRef: `fennec-db-${input.name}`,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
        });
      }

      mgr.afterRequest();
      return responseBuilder.success(result);
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_CONNECT_ERROR', suggestions: ['Check the database URL', 'Ensure dbTui is installed (run fennec db update)'] });
    }
  },
});

export const dbDisconnect = createTool({
  name: 'db_disconnect',
  category: 'db',
  description: '`<use_case>Database</use_case> 🔌 Disconnect from a database.',
  inputSchema: z.object({
    name: z.string().describe('Connection name to disconnect'),
  }),
  handler: async (input, { responseBuilder, logger }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);
      await mgr.disconnect(input.name);
      mgr.afterRequest();
      return responseBuilder.success({ disconnected: true });
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_DISCONNECT_ERROR' });
    }
  },
});

export const dbList = createTool({
  name: 'db_list',
  category: 'db',
  description: '`<use_case>Database</use_case> 📋 List active database connections.',
  inputSchema: z.object({}),
  handler: async (input, { responseBuilder, logger }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);
      const connections = await mgr.listConnections();
      mgr.afterRequest();
      return responseBuilder.success({ connections });
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_LIST_ERROR' });
    }
  },
});

export const dbQuery = createTool({
  name: 'db_query',
  category: 'db',
  description: '`<use_case>Database</use_case> ⚡ Execute a SQL query. Read-only by default.',
  inputSchema: z.object({
    name: z.string().describe('Connection name'),
    sql: z.string().describe('SQL query to execute'),
    maxRows: z.number().optional().default(1000).describe('Maximum rows to return'),
    strict: z.boolean().optional().default(true).describe('Block write queries'),
  }),
  handler: async (input, { responseBuilder, logger }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);
      const result = await mgr.query(input.name, input.sql, { maxRows: input.maxRows, strict: input.strict });
      mgr.afterRequest();
      return responseBuilder.success(result);
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_QUERY_ERROR', suggestions: ['Check the SQL syntax', 'Ensure the connection is active'] });
    }
  },
});

export const dbSchema = createTool({
  name: 'db_schema',
  category: 'db',
  description: '`<use_case>Database</use_case> 📊 Inspect database schema — tables, columns, indexes, foreign keys.',
  inputSchema: z.object({
    name: z.string().describe('Connection name'),
    database: z.string().optional().describe('Specific database to inspect'),
  }),
  handler: async (input, { responseBuilder, logger }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);
      const result = await mgr.schema(input.name, input.database);
      mgr.afterRequest();
      return responseBuilder.success(result);
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_SCHEMA_ERROR' });
    }
  },
});

export const dbTables = createTool({
  name: 'db_tables',
  category: 'db',
  description: '`<use_case>Database</use_case> 📋 List tables in a database.',
  inputSchema: z.object({
    name: z.string().describe('Connection name'),
    database: z.string().optional().describe('Specific database'),
  }),
  handler: async (input, { responseBuilder, logger }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);
      const result = await mgr.tables(input.name, input.database);
      mgr.afterRequest();
      return responseBuilder.success(result);
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_TABLES_ERROR' });
    }
  },
});

export const dbPing = createTool({
  name: 'db_ping',
  category: 'db',
  description: '`<use_case>Database</use_case> 🏓 Ping a database connection to check health.',
  inputSchema: z.object({
    name: z.string().describe('Connection name'),
  }),
  handler: async (input, { responseBuilder, logger }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);
      const result = await mgr.query(input.name, 'SELECT 1');
      mgr.afterRequest();
      return responseBuilder.success({ connected: true, latency: result.duration });
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_PING_ERROR' });
    }
  },
});

export const dbExplain = createTool({
  name: 'db_explain',
  category: 'db',
  description: '`<use_case>Database</use_case> 🔍 Get query execution plan.',
  inputSchema: z.object({
    name: z.string().describe('Connection name'),
    sql: z.string().describe('SQL query to explain'),
  }),
  handler: async (input, { responseBuilder, logger }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);
      const result = await mgr.explain(input.name, input.sql);
      mgr.afterRequest();
      return responseBuilder.success(result);
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_EXPLAIN_ERROR' });
    }
  },
});

export const dbStats = createTool({
  name: 'db_stats',
  category: 'db',
  description: '`<use_case>Database</use_case> 📊 Get database statistics (size, table count, connections).',
  inputSchema: z.object({
    name: z.string().describe('Connection name'),
  }),
  handler: async (input, { responseBuilder, logger }) => {
    try {
      const mgr = getDbManager();
      mgr.setLogger(logger);
      const result = await mgr.stats(input.name);
      mgr.afterRequest();
      return responseBuilder.success(result);
    } catch (err: any) {
      return responseBuilder.error(err, { code: 'DB_STATS_ERROR' });
    }
  },
});
