# Database Tools

Fennec provides 9 MCP tools for database observation via the **dbTui** sidecar binary. dbTui is a Go binary that communicates with Fennec over JSON-RPC via stdin/stdout.

## Supported Databases

- **PostgreSQL** — via `pgx/v5`
- **MySQL** — via `go-sql-driver/mysql`
- **SQLite** — via `modernc.org/sqlite` (pure Go, CGO-free)

## Tools

| Tool            | Description                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| `db_connect`    | Connect to a database. Credentials saved to OS keychain by default.                       |
| `db_disconnect` | Disconnect from a database.                                                               |
| `db_list`       | List active database connections.                                                         |
| `db_query`      | Execute a SQL query. Read-only by default (`strict: true` blocks writes).                 |
| `db_schema`     | Inspect database schema — tables, columns, indexes, foreign keys. Results cached for 30s. |
| `db_tables`     | List tables and row counts.                                                               |
| `db_ping`       | Ping a database and return latency.                                                       |
| `db_explain`    | Get query execution plan.                                                                 |
| `db_stats`      | Get database statistics (size, table count, active connections, uptime).                  |

## Credential Management

Credentials are stored in the OS keychain (`@aspect-build/aspect-keytar`) with fallbacks:

1. `--url` flag (session only)
2. `DATABASE_URL` env var (session only)
3. OS Keychain via keytar (persistent)
4. CLI fallback (`security` on macOS, `secret-tool` on Linux, `wincred` on Windows)
5. Encrypted file (`~/.fennec/.credentials.json`, mode 0600)

## Security

- **Strict mode**: `allowedHosts` defaults to `localhost`, `127.0.0.1`, `::1` — blocks non-local connections
- **Read-only**: Write queries (INSERT/UPDATE/DELETE/DROP/ALTER) blocked by default; use `strict: false` to allow
- **Binary integrity**: SHA256 checksum verification on download
- **Query timeout**: 30s default, configurable
- **Idle timeout**: Agent killed after 5 minutes of inactivity
- **Persistent agent**: dbTui can run as detached process with PID file tracking

## CLI

```bash
# First time connection (auto-starts persistent agent)
fennec db connect mypg --url "postgres://user:pass@localhost/mydb"

# Reconnect from saved credential (no --url needed)
fennec db connect mypg

# Queries
fennec db query mypg "SELECT * FROM users"
fennec db query mypg "SELECT * FROM users" --json

# Schema inspection
fennec db schema mypg
fennec db tables mypg

# Health
fennec db ping mypg
fennec db ps
fennec db doctor

# Disconnect (keeps credential)
fennec db disconnect mypg

# Remove credential entirely
fennec db rm mypg

# Agent lifecycle
fennec db start
fennec db stop
fennec db restart
fennec db update
```
