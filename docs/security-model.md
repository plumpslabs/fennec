# Security Model

Fennec provides AI agents with powerful capabilities: browser control, process spawning, file system access (limited), and network observation. This power requires clear security boundaries.

## Default Security Posture

Fennec ships with **all security features enabled by default (Sandbox ON)**. Developers explicitly opt in to more permissive settings.

## Security Layers

### 1. Process Security

```yaml
security:
  allowProcessSpawn: true     # AI can spawn processes
  allowProcessKill: false     # AI cannot kill processes it didn't spawn
```

- Process spawning uses an **allowlist** of permitted commands
- Default allowlist: `npm`, `node`, `pnpm`, `yarn`, `bun`, `python`, `python3`
- Processes spawned by Fennec are **child processes** and inherit Fennec's permissions
- Killing processes is disabled by default to prevent accidental server termination

### 2. Browser Security

```yaml
security:
  allowedDomains: []          # empty = all domains allowed
  blockedDomains: []          # no domains blocked by default
  allowFileProtocol: false    # file:// URLs disabled
```

- Domains can be restricted to a specific allowlist
- The `file://` protocol is disabled by default (no local file access via browser)
- In sandbox mode, Chromium's built-in sandbox is enabled

### 3. CDP Security

```yaml
security:
  allowCDPRawAccess: false    # raw CDP access disabled
```

- Raw Chrome DevTools Protocol access is disabled by default
- `devtools_evaluate` can execute JavaScript in the page context
- JavaScript evaluation cannot access files outside the browser's sandbox

### 4. Storage Security

```yaml
security:
  exportPath: "./.fennec/exports"
  maxExportSizeMB: 10
```

- Exported session data is confined to the configured export path
- Export size is limited to prevent excessive disk usage
- Session data includes cookies and storage — treat exported files as sensitive

## What Fennec Never Exposes

- Access to files outside the configured `exportPath`
- Credentials from the OS password manager
- Access to other users' browser sessions on the same OS
- Ability to install browser extensions
- Raw OS command execution (only through the controlled allowlist)

## Best Practices

1. **Review the spawn allowlist**: Only include commands your AI agent actually needs
2. **Use domain restrictions**: If testing against specific sites, add them to `allowedDomains`
3. **Disable process spawning** if not needed
4. **Use sandbox mode** in production or untrusted environments
5. **Clean up saved sessions** regularly, especially those containing auth tokens
6. **Never share exportPath contents** — they may contain sensitive session data

## Reporting Vulnerabilities

See [SECURITY.md](../SECURITY.md) for our vulnerability reporting process.
