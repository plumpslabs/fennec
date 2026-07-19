import pc from 'picocolors';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { renderError, renderKV, renderTable, renderSection, confirmPrompt, symbols, createSpinner } from '../utils/format.js';
import { DbTuiManager, getDbManager, credentialStore, addConnection, removeConnection, getConnection, readConnections, getFennecDir } from '@plumpslabs/fennec-core';

const AGENT_PID_FILE = 'db-agent.json';

function agentPidPath(): string {
  return join(getFennecDir(), AGENT_PID_FILE);
}

function readAgentPid(): { pid: number; startedAt: string } | null {
  try {
    const path = agentPidPath();
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch { return null; }
}

function writeAgentPid(pid: number): void {
  writeFileSync(agentPidPath(), JSON.stringify({ pid, startedAt: new Date().toISOString() }));
}

function clearAgentPid(): void {
  try { unlinkSync(agentPidPath()); } catch {}
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

async function spawnPersistent(): Promise<number> {
  const binPath = join(getFennecDir(), 'bin', process.platform === 'win32' ? 'dbTui.exe' : 'dbTui');
  const proc = spawn(binPath, ['--agent', '--persist'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  proc.unref();
  writeAgentPid(proc.pid!);
  return proc.pid!;
}

function manager(): DbTuiManager {
  return getDbManager();
}

async function ensureConnected(mgr: DbTuiManager, name: string): Promise<void> {
  if (mgr.connectedNames.includes(name)) return;
  const url = await credentialStore.get(name);
  if (url) {
    await mgr.connect(name, url);
    return;
  }
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    await mgr.connect(name, envUrl);
    return;
  }
  throw new Error(`No saved connection for ${name}. Use: fennec db connect ${name} --url <url>`);
}

export async function dbCommand(args: string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('--') && a !== '-y' && a !== '--yes');
  const flags = args.filter(a => a.startsWith('--') || a === '-y' || a === '--yes');
  const action = positional[0] || 'help';
  const name = positional[1];
  const rest = positional.slice(2);

  switch (action) {
    case 'connect':   return handleConnect(name, rest, flags);
    case 'disconnect': return handleDisconnect(name);
    case 'rm':
    case 'remove':    return handleRemove(name);
    case 'ps':
    case 'list':      return handlePs();
    case 'query':     return handleQuery(name, rest, flags);
    case 'schema':    return handleSchema(name, rest, flags);
    case 'tables':    return handleTables(name, rest, flags);
    case 'ping':      return handlePing(name);
    case 'stats':     return handleStats(name);
    case 'explain':   return handleExplain(name, rest);
    case 'start':     return handleStart(name, rest, flags);
    case 'stop':      return handleStop();
    case 'restart':   return handleRestart();
    case 'update':    return handleUpdate();
    case 'doctor':    return handleDoctor();
    default:
      showDbHelp();
  }
}

async function handleConnect(nameRaw: string | undefined, rest: string[], flags: string[]): Promise<void> {
  // Support --name flag or positional
  const nameIdx = flags.indexOf('--name');
  const name = (nameIdx !== -1 ? flags[nameIdx + 1] : undefined) ?? nameRaw;
  if (!name) { console.error(renderError('Missing name', 'Usage: fennec db connect <name> [--url <url>]')); process.exit(1); }

  const noSave = flags.includes('--no-save');
  const urlFlagIndex = flags.indexOf('--url');
  const urlFromFlag = urlFlagIndex !== -1 ? flags[urlFlagIndex + 1] ?? rest[0] : undefined;
  const url = urlFromFlag ?? process.env.DATABASE_URL;

  // If no URL provided, try saved credential for reconnect
  if (!url) {
    const saved = await credentialStore.get(name);
    if (saved) {
      try {
        // Auto-spawn persistent agent if not running
        const agentInfo = readAgentPid();
        if (!agentInfo || !isPidAlive(agentInfo.pid)) {
          if (agentInfo) clearAgentPid();
          await spawnPersistent();
        }
        const mgr = manager();
        await mgr.connect(name, saved);
        console.error(`\n  ${pc.green('✓')} ${pc.bold(`Reconnected to ${name}`)}\n`);
        mgr.kill();
        return;
      } catch (err: any) {
        console.error(renderError('Reconnect failed', `Saved credential expired or invalid. Provide --url <url>`));
        process.exit(1);
      }
    }
    console.error(renderError('Missing URL', 'Provide --url <url> or set DATABASE_URL env var'));
    process.exit(1);
  }

  try {
    // Auto-spawn persistent agent if not running
    const agentInfo = readAgentPid();
    if (!agentInfo || !isPidAlive(agentInfo.pid)) {
      if (agentInfo) clearAgentPid();
      await spawnPersistent();
    }

    const mgr = manager();
    const result = await mgr.connect(name, url);
    console.error(`\n  ${pc.green('✓')} ${pc.bold(`Connected to ${name}`)} ${pc.dim(`(${result.type} ${result.version || ''})`)}\n`);

    if (!noSave) {
      await credentialStore.save(name, url);
      try {
        addConnection({
          name,
          type: result.type as any,
          host: '', port: 0,
          database: result.database || '',
          user: '', ssl: '',
          keychainRef: `fennec-db-${name}`,
          createdAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
        });
      } catch {}
    }
    mgr.kill();
  } catch (err: any) {
    clearAgentPid();
    console.error(renderError('Connection failed', err.message));
    process.exit(1);
  }
}

async function handleDisconnect(name: string | undefined): Promise<void> {
  if (!name) { console.error(renderError('Missing name', 'Usage: fennec db disconnect <name>')); process.exit(1); }
  try {
    const mgr = manager();
    await ensureConnected(mgr, name);
    await mgr.disconnect(name);
    console.error(`\n  ${pc.green('✓')} ${pc.bold(`Disconnected ${name}`)}\n`);
    mgr.kill();
  } catch (err: any) {
    console.error(renderError('Disconnect failed', err.message));
    process.exit(1);
  }
}

async function handleRemove(name: string | undefined): Promise<void> {
  if (!name) { console.error(renderError('Missing name', 'Usage: fennec db rm <name>')); process.exit(1); }
  credentialStore.delete(name).catch(() => {});
  removeConnection(name);
  console.error(`\n  ${pc.green('✓')} ${pc.bold(`Removed ${name}`)}\n`);
}

async function handlePs(): Promise<void> {
  const agentInfo = readAgentPid();
  const isAlive = agentInfo ? isPidAlive(agentInfo.pid) : false;
  const mgr = manager();

  console.error(`\n  ${symbols.fox} ${pc.bold('Database Agent')}\n`);

  if (isAlive) {
    console.error(`  ${symbols.active} ${pc.bold('dbTui')} ${pc.dim(`pid=${agentInfo!.pid}`)}`);
    console.error(`  ${renderKV('Binary', mgr.getBinaryPath())}`);
    try {
      await mgr.ensureRunning();
      const ping = await mgr.ping();
      console.error(`  ${renderKV('Version', ping.version)}`);
      mgr.kill();
    } catch {
      console.error(`  ${renderKV('Version', pc.dim('unreachable'))}`);
    }
  } else {
    if (agentInfo) clearAgentPid();
    console.error(`  ${symbols.inactive} ${pc.dim('Agent not running.')}`);
    console.error(`  ${pc.dim('  Will auto-start on connect.')}`);
  }

  const saved = readConnections();
  if (saved.length > 0) {
    console.error(`\n  ${pc.bold('Connections')}`);
    for (const info of saved) {
      console.error(`  ${pc.cyan('└─')} ${pc.bold(info.name)} ${pc.dim(`(${info.type || '?'})`)}`);
    }
  } else {
    console.error(`\n  ${pc.dim('  No saved connections.')}`);
  }
  console.error();
}

async function handleQuery(name: string | undefined, rest: string[], flags: string[]): Promise<void> {
  if (!name || rest.length === 0) {
    console.error(renderError('Missing arguments', 'Usage: fennec db query <name> <sql> [--json] [--csv] [--max-rows N] [--no-strict]'));
    process.exit(1);
  }
  const sql = rest.join(' ');
  const jsonOut = flags.includes('--json');
  const csvOut = flags.includes('--csv');
  const noStrict = flags.includes('--no-strict');
  const maxRowsIdx = flags.findIndex(f => f === '--max-rows');
  const maxRowStr = maxRowsIdx !== -1 ? flags[maxRowsIdx + 1] : undefined;
  const maxRows = maxRowStr ? parseInt(maxRowStr, 10) : 1000;

  try {
    const mgr = manager();
    await ensureConnected(mgr, name);
    const result = await mgr.query(name, sql, { maxRows, strict: !noStrict });
    mgr.kill();

    if (jsonOut) {
      console.log(JSON.stringify(result, null, 2));
    } else if (csvOut && result.columns.length > 0) {
      console.log(result.columns.join(','));
      for (const row of result.rows) {
        console.log(row.map((v: string | null) => v === null ? '' : `"${v.replace(/"/g, '""')}"`).join(','));
      }
    } else {
      console.error(`\n  ${pc.dim(`(${result.duration}, ${result.rowCount} rows${result.truncated ? ', truncated' : ''})`)}\n`);
      if (result.columns.length > 0) {
        const rows: string[][] = [result.columns.map(pc.bold), ...result.rows.map((r: (string | null)[]) => r.map((v: string | null) => v ?? pc.dim('NULL')))];
        const colWidths: number[] = result.columns.map((_: string, ci: number) =>
          Math.max(result.columns[ci]!.length, ...result.rows.map((r: (string | null)[]) => (r[ci] ?? 'NULL').length))
        );
        for (const row of rows) {
          console.error('  ' + row.map((v, ci) => (v ?? '').padEnd(colWidths[ci]!)).join('  '));
        }
        if (result.truncated) console.error(`\n  ${pc.yellow('!')} Results truncated at ${maxRows} rows. Use --max-rows to increase.`);
      } else if (!result.isSelect) {
        console.error(`  ${pc.green('✓')} Query OK`);
      }
      console.error();
    }
  } catch (err: any) {
    console.error(renderError('Query failed', err.message));
    process.exit(1);
  }
}

async function handleSchema(name: string | undefined, rest: string[], flags: string[]): Promise<void> {
  if (!name) { console.error(renderError('Missing name', 'Usage: fennec db schema <name> [--database <db>]')); process.exit(1); }
  const dbIndex = flags.indexOf('--database');
  const database = dbIndex !== -1 ? flags[dbIndex + 1] : undefined;

  try {
    const mgr = manager();
    await ensureConnected(mgr, name);
    const result = await mgr.schema(name, database);

    for (const db of result.databases) {
      console.error(`\n  ${pc.bold(db.name)}`);
      for (const table of db.tables) {
        console.error(`  ${pc.cyan('└─')} ${pc.bold(table.name)} ${pc.dim(`(${table.rowCount} rows)`)}`);
        for (const col of table.columns) {
          const key = col.key === 'PRI' ? pc.yellow(' PK') : '';
          console.error(`     ${pc.dim('├─')} ${col.name} ${pc.dim(col.type)}${key}`);
        }
      }
    }
    console.error();
    mgr.kill();
  } catch (err: any) {
    console.error(renderError('Schema fetch failed', err.message));
  }
}

async function handleTables(name: string | undefined, rest: string[], flags: string[]): Promise<void> {
  if (!name) { console.error(renderError('Missing name', 'Usage: fennec db tables <name> [--database <db>]')); process.exit(1); }
  try {
    const mgr = manager();
    await ensureConnected(mgr, name);
    const dbIndex = flags.indexOf('--database');
    let database = dbIndex !== -1 ? flags[dbIndex + 1] : undefined;
    if (!database) {
      const schemaResult = await mgr.schema(name);
      database = schemaResult.databases[0]?.name;
    }
    if (!database) {
      console.error(renderError('Failed to list tables', 'Could not detect database. Use --database <db>'));
      return;
    }
    const result = await mgr.tables(name, database);
    console.error(`\n  ${pc.bold(`Tables (${database})`)}\n`);
    for (const t of result.tables) {
      console.error(`  ${pc.cyan('└─')} ${pc.bold(t.name)} ${pc.dim(`(${t.rowCount} rows)`)}`);
    }
    console.error();
    mgr.kill();
  } catch (err: any) {
    console.error(renderError('Failed to list tables', err.message));
  }
}

async function handlePing(name: string | undefined): Promise<void> {
  if (!name) { console.error(renderError('Missing name', 'Usage: fennec db ping <name>')); process.exit(1); }
  try {
    const mgr = manager();
    await ensureConnected(mgr, name);
    const result = await mgr.query(name, 'SELECT 1');
    console.error(`\n  ${pc.green('✓')} ${pc.bold(name)} ${pc.dim(`(${result.duration})`)}\n`);
    mgr.kill();
  } catch (err: any) {
    console.error(renderError('Ping failed', err.message));
    process.exit(1);
  }
}

async function handleStats(name: string | undefined): Promise<void> {
  if (!name) { console.error(renderError('Missing name', 'Usage: fennec db stats <name>')); process.exit(1); }
  try {
    const mgr = manager();
    await ensureConnected(mgr, name);
    const result = await mgr.stats(name);
    console.error(`\n  ${pc.bold(`Stats: ${result.database}`)}\n`);
    console.error(`  ${renderKV('Size', `${result.sizeMB.toFixed(1)} MB`)}`);
    console.error(`  ${renderKV('Tables', `${result.tableCount}`)}`);
    console.error(`  ${renderKV('Connections', `${result.activeConnections}`)}`);
    console.error();
    mgr.kill();
  } catch (err: any) {
    console.error(renderError('Stats failed', err.message));
  }
}

async function handleExplain(name: string | undefined, rest: string[]): Promise<void> {
  if (!name || rest.length === 0) {
    console.error(renderError('Missing arguments', 'Usage: fennec db explain <name> <sql>'));
    process.exit(1);
  }
  const sql = rest.join(' ');
  try {
    const mgr = manager();
    await ensureConnected(mgr, name);
    const result = await mgr.explain(name, sql);
    console.error(`\n  ${pc.bold('Query Plan')} ${pc.dim(`(${result.duration})`)}\n`);
    console.error(`  ${result.plan}\n`);
    mgr.kill();
  } catch (err: any) {
    console.error(renderError('Explain failed', err.message));
  }
}

async function handleUpdate(): Promise<void> {
  const spinner = createSpinner('Downloading dbTui binary...');
  try {
    const mgr = manager();
    const path = await mgr.download(true);
    spinner.stop();
    console.error(`\n  ${pc.green('✓')} dbTui updated at ${pc.dim(path)}\n`);
  } catch (err: any) {
    spinner.stop();
    console.error(renderError('Update failed', err.message));
    process.exit(1);
  }
}

async function handleDoctor(): Promise<void> {
  const mgr = manager();
  const binPath = mgr.getBinaryPath();
  const fs = await import('fs');
  const exists = fs.existsSync(binPath);
  const agentInfo = readAgentPid();
  const persistentAlive = agentInfo && isPidAlive(agentInfo.pid);

  console.error(`\n  ${symbols.fox} ${pc.bold('Database Agent Doctor')}\n`);
  console.error(`  ${renderKV('Binary', binPath)}`);
  console.error(`  ${renderKV('Binary exists', exists ? pc.green('Yes') : pc.red('No'))}`);
  if (exists) {
    const stats = fs.statSync(binPath);
    console.error(`  ${renderKV('Size', `${(stats.size / 1024 / 1024).toFixed(1)} MB`)}`);
    if (persistentAlive) {
      console.error(`  ${renderKV('Agent status', pc.green('Running (persistent)'))}`);
      console.error(`  ${renderKV('PID', `${agentInfo!.pid}`)}`);
      try {
        await mgr.ensureRunning();
        const ping = await mgr.ping();
        console.error(`  ${renderKV('Version', ping.version)}`);
        mgr.kill();
      } catch {}
    } else {
      if (agentInfo) clearAgentPid();
      console.error(`  ${renderKV('Agent status', pc.yellow('Not running'))}`);
    }
  }
  console.error();
}

async function handleStart(name: string | undefined, rest: string[], flags: string[]): Promise<void> {
  const existing = readAgentPid();
  if (existing && isPidAlive(existing.pid)) {
    console.error(`\n  ${pc.yellow('!')} Agent already running (pid=${existing.pid}). Use ${pc.dim('fennec db restart')} or ${pc.dim('fennec db stop')} first.\n`);
    return;
  }
  if (existing) clearAgentPid();

  await spawnPersistent();
  console.error(`\n  ${symbols.fox} ${pc.bold('Database Agent Started')}\n`);
  console.error(`  ${symbols.active} ${pc.bold('dbTui')} ${pc.dim(`pid=${readAgentPid()?.pid ?? ''}`)}`);
  console.error(`  ${renderKV('Binary', join(getFennecDir(), 'bin', process.platform === 'win32' ? 'dbTui.exe' : 'dbTui'))}`);
  console.error();
}

async function handleStop(): Promise<void> {
  const agentInfo = readAgentPid();
  if (!agentInfo) {
    console.error(`\n  ${pc.dim('Agent not running.\n')}`);
    return;
  }
  if (isPidAlive(agentInfo.pid)) {
    try { process.kill(agentInfo.pid, 'SIGTERM'); } catch {}
    // Give it a moment, then force kill
    await new Promise(r => setTimeout(r, 300));
    if (isPidAlive(agentInfo.pid)) {
      try { process.kill(agentInfo.pid, 'SIGKILL'); } catch {}
    }
  }
  clearAgentPid();
  console.error(`\n  ${symbols.success} Agent stopped.\n`);
}

async function handleRestart(): Promise<void> {
  await handleStop();
  await new Promise(r => setTimeout(r, 500));
  // start without name/url (user reconnects manually)
  await handleStart(undefined, [], []);
}

function showDbHelp(): void {
  console.error(`\n  ${symbols.fox} ${pc.bold('Database Commands')}\n`);
  console.error(`  ${pc.bold('Agent:')}`);
  console.error(`    ${pc.cyan('start')}                            Start database agent`);
  console.error(`    ${pc.cyan('stop')}                             Stop agent`);
  console.error(`    ${pc.cyan('restart')}                          Restart agent`);
  console.error(`    ${pc.cyan('ps')}                               Agent status + all connections`);
  console.error(`    ${pc.cyan('doctor')}                           Check agent health`);
  console.error(`    ${pc.cyan('update')}                           Download/update dbTui binary`);
  console.error();
  console.error(`  ${pc.bold('Connections:')}`);
  console.error(`    ${pc.cyan('connect')}   <name> [--url <url>]   Connect/reconnect (auto-starts agent)`);
  console.error(`    ${pc.cyan('disconnect')}<name>                 Disconnect (keeps credential)`);
  console.error(`    ${pc.cyan('rm')}        <name>                 Remove credential entirely`);
  console.error(`    ${pc.cyan('list')}                              Alias for ps`);
  console.error();
  console.error(`  ${pc.bold('Query:')}`);
  console.error(`    ${pc.cyan('query')}    <name> <sql>            Run a SQL query`);
  console.error(`    ${pc.cyan('schema')}   <name>                  Show database schema`);
  console.error(`    ${pc.cyan('tables')}   <name>                  List tables`);
  console.error(`    ${pc.cyan('ping')}     <name>                  Health check`);
  console.error(`    ${pc.cyan('stats')}    <name>                  Database statistics`);
  console.error(`    ${pc.cyan('explain')}  <name> <sql>            Query execution plan`);
  console.error();
  console.error(`  ${pc.bold('Examples:')}`);
  console.error(`    ${pc.dim('fennec db connect mypg --url "mysql://..."')}`);
  console.error(`    ${pc.dim('fennec db connect mypg          # reconnect from saved')}`);
  console.error(`    ${pc.dim('fennec db query mypg "SELECT 1"')}`);
  console.error(`    ${pc.dim('fennec db disconnect mypg       # keep credential')}`);
  console.error(`    ${pc.dim('fennec db rm mypg               # remove credential')}`);
  console.error();
}
