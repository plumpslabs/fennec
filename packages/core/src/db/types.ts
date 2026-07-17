export interface DBConfig {
  strict: boolean;
  allowedHosts: string[];
  maxRows: number;
  queryTimeout: number;
  allowWrite: boolean;
  binaryPath: string;
}

export const DEFAULT_DB_CONFIG: DBConfig = {
  strict: true,
  allowedHosts: ['localhost', '127.0.0.1', '::1'],
  maxRows: 1000,
  queryTimeout: 30000,
  allowWrite: false,
  binaryPath: '',
};

export interface ConnectionMetadata {
  name: string;
  type: 'postgres' | 'mysql' | 'sqlite';
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: string;
  keychainRef: string;
  createdAt: string;
  lastUsed: string;
}

export interface ConnectionInfo {
  name: string;
  type: string;
  host: string;
  port: number;
  database: string;
  connected: boolean;
}

export interface DbQueryResult {
  columns: string[];
  rows: (string | null)[][];
  duration: string;
  rowCount: number;
  isSelect: boolean;
  truncated: boolean;
}

export interface DbSchemaResult {
  databases: {
    name: string;
    tables: {
      name: string;
      columns: {
        name: string;
        type: string;
        nullable: string;
        key: string;
        default: string | null;
        extra: string;
      }[];
      indexes: {
        name: string;
        columns: string[];
        unique: boolean;
        primary: boolean;
      }[];
      foreignKeys: {
        name: string;
        column: string;
        refTable: string;
        refColumn: string;
        onDelete: string;
        onUpdate: string;
      }[];
      rowCount: number;
    }[];
  }[];
}

export interface DbTableInfo {
  tables: { name: string; rowCount: number }[];
}

export interface DbExplainResult {
  plan: string;
  duration: string;
}

export interface DbStatsResult {
  database: string;
  sizeMB: number;
  tableCount: number;
  activeConnections: number;
  uptime: string;
}

export interface DbConnectInfo {
  connected: boolean;
  type: string;
  version?: string;
  database?: string;
  defaultSchema?: string;
}

export interface CredentialEntry {
  name: string;
  url: string;
}
