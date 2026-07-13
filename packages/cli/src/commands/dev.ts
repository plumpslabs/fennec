/**
 * Command: dev — Declarative dev environment orchestration.
 *
 * Reads a `fennec.config.yaml` describing the whole stack (BE, FE, DB, workers)
 * and brings it up/down as one unit. Each app is started like `fennec start
 * --restart`, so the supervisor keeps them alive, health-checks their ports,
 * and (with boot persistence) survives reboots. Dependencies are started first
 * and an app can wait for another's port before launching — so `fennec dev up`
 * is a single, AI-friendly command to boot an entire project and observe it.
 *
 *   fennec dev up [--config fennec.config.yaml]
 *   fennec dev down
 *   fennec dev status
 *
 * Config shape (fennec.config.yaml):
 *   apps:
 *     - name: api
 *       command: node
 *       args: [app.js]
 *       cwd: ./backend
 *       port: 3000
 *       env: { NODE_ENV: development }
 *       restart: true          # auto-restart (default true)
 *       jsonl: true            # structured logs (default false)
 *       waitForPort: 3000      # wait for this port before starting dependents
 *     - name: web
 *       command: npm
 *       args: [run, dev]
 *       cwd: ./frontend
 *       port: 5173
 *       dependsOn: [api]       # started after `api` is up
 */
import pc from "picocolors";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { renderError, renderKV, symbols, createSpinner } from "../utils/format.js";
import { readTracked, addTracked, isTrackedRunning, spawnDaemon, buildSpawnEnv, logFilePathFor, respawnTracked, adoptExternalOnPort } from "./tracker.js";
import type { TrackedProcess } from "./tracker.js";
import { ensureSupervisorRunning } from "./supervisor.js";
import { ensurePersistEnabled } from "./persist.js";
import { checkPort, killTree } from "../utils/system-process.js";
import yaml from "js-yaml";

interface AppConfig {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  port?: number;
  env?: Record<string, string>;
  restart?: boolean;
  jsonl?: boolean;
  dependsOn?: string[];
  waitForPort?: number;
  /** HTTP readiness probe. A full URL (http://...) or a path (/health) that's
   *  combined with `port`. When set, the supervisor health-checks this URL
   *  instead of a bare TCP port check. */
  healthCheck?: string;
}

interface DevConfig {
  apps?: AppConfig[];
}

function loadConfig(path: string): DevConfig {
  if (!existsSync(path)) {
    console.error(renderError("Config not found", path));
    process.exit(1);
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = yaml.load(raw) as DevConfig;
    return parsed ?? {};
  } catch (err) {
    console.error(renderError("Failed to parse config", String(err)));
    process.exit(1);
  }
}

function resolveCwd(baseDir: string, cwd?: string): string {
  if (!cwd) return baseDir;
  return resolve(baseDir, cwd);
}

async function waitForPort(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await checkPort(port)) return true;
    } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

type StartResult = "started" | "skipped" | "restarted" | "adopted";

/** Returns true when an existing tracked entry already runs the same app with
 *  an identical spawn config (command, args, cwd, port, env, mode, restart). */
function configMatches(
  existing: TrackedProcess,
  desired: Pick<TrackedProcess, "command" | "args" | "cwd" | "port" | "env" | "logMode" | "autoRestart" | "healthCheck">,
): boolean {
  if (existing.command !== desired.command) return false;
  if (JSON.stringify(existing.args ?? []) !== JSON.stringify(desired.args)) return false;
  if (existing.cwd !== desired.cwd) return false;
  if ((existing.port ?? null) !== (desired.port ?? null)) return false;
  if (existing.logMode !== desired.logMode) return false;
  if ((existing.autoRestart ?? true) !== desired.autoRestart) return false;
  if ((existing.healthCheck ?? null) !== (desired.healthCheck ?? null)) return false;
  if (JSON.stringify(existing.env ?? {}) !== JSON.stringify(desired.env)) return false;
  return true;
}

/** Idempotent start: skip an app that's already running with identical config,
 *  restart only if running but changed, otherwise spawn fresh. */
async function startApp(app: AppConfig, baseDir: string): Promise<StartResult> {
  const cwd = resolveCwd(baseDir, app.cwd);
  const cmdParts = [app.command, ...(app.args ?? [])];
  const logFilePath = logFilePathFor(app.name);
  const env: Record<string, string> = { ...(app.env ?? {}) };
  const port = app.waitForPort ?? app.port;
  const restart = app.restart ?? true;
  const logMode: "text" | "jsonl" = app.jsonl ? "jsonl" : "text";
  const desired = {
    command: cmdParts.join(" "),
    args: cmdParts,
    cwd,
    port,
    env,
    logMode,
    autoRestart: restart,
    healthCheck: app.healthCheck,
  };

  const existing = readTracked().find((t) => t.name === app.name);
  if (existing && isTrackedRunning(existing) && configMatches(existing, desired)) {
    return "skipped"; // already healthy & unchanged — leave it alone
  }

  const wasRunning = !!(existing && isTrackedRunning(existing));
  if (wasRunning) {
    try { killTree(existing!.pid, "SIGTERM"); } catch { /* best-effort */ }
  }

  // Idempotent-by-port: if an EXTERNAL process (e.g. started via raw bash by
  // an agent) is already listening on our port, adopt it instead of spawning
  // a duplicate that fails with EADDRINUSE.
  if (port && !(existing && isTrackedRunning(existing))) {
    const adopted = adoptExternalOnPort(port, app.name);
    if (adopted) {
      return "adopted";
    }
    if (await checkPort(port)) {
      console.error(
        `  ${pc.yellow("⚠")} ${pc.dim(`port :${port} already responding — ${app.name} may fail to bind (EADDRINUSE)`)}`,
      );
    }
  }

  const child = spawnDaemon({
    cmdParts,
    name: app.name,
    cwd,
    logFilePath,
    env: buildSpawnEnv(env),
    logMode,
  });
  addTracked({
    name: app.name,
    pid: child.pid ?? 0,
    command: desired.command,
    args: cmdParts,
    port,
    cwd,
    env,
    startedAt: new Date().toISOString(),
    autoRestart: restart,
    logMode,
    flapping: false,
    healthCheck: app.healthCheck,
  });
  return wasRunning ? "restarted" : "started";
}

export async function devCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? "up";
  const configIndex = args.indexOf("--config");
  const configPath = configIndex !== -1 ? resolve(args[configIndex + 1]!) : resolve(process.cwd(), "fennec.config.yaml");

  if (sub === "down") {
    return devDown();
  }
  if (sub === "status") {
    return devStatus();
  }
  if (sub === "restart") {
    return devRestart(args.slice(1));
  }
  if (sub !== "up") {
    console.error(renderError("Unknown sub-command", `"${sub}" — use: up | down | status | restart`));
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const apps = config.apps ?? [];
  if (apps.length === 0) {
    console.error(renderError("No apps defined", `Add an "apps:" list to ${configPath}`));
    process.exit(1);
  }
  const baseDir = dirname(configPath);

  // Topological-ish start: apps without deps first, then dependents.
  const started = new Set<string>();
  const ordered = topoOrder(apps);

  // Pre-flight: detect apps in this config that declare the same port.
  const portOwner = new Map<number, string>();
  for (const a of apps) {
    const p = a.waitForPort ?? a.port;
    if (p) {
      const prev = portOwner.get(p);
      if (prev) {
        console.error(renderError("Port conflict", `apps "${prev}" and "${a.name}" both declare port :${p}`));
        process.exit(1);
      }
      portOwner.set(p, a.name);
    }
  }

  console.error(`\n  ${symbols.fox} ${pc.bold("fennec dev up")} ${pc.dim(`— ${apps.length} app(s) from ${configPath}`)}`);
  ensureSupervisorRunning();
  ensurePersistEnabled();

  for (const app of ordered) {
    // Wait for declared dependencies' ports.
    for (const dep of app.dependsOn ?? []) {
      const depApp = apps.find((a) => a.name === dep);
      const port = depApp?.waitForPort ?? depApp?.port;
      if (port) {
        const sp = createSpinner(`Waiting for ${dep} :${port}...`);
        const ok = await waitForPort(port);
        sp.stop();
        if (!ok) console.error(`  ${pc.yellow("⚠")} ${pc.dim(`${dep} :${port} not ready in time (continuing)`)}`);
      }
    }
    const res = await startApp(app, baseDir);
    const pid = readTracked().find((t) => t.name === app.name)?.pid ?? "?";
    const tag =
      res === "skipped" ? pc.dim("already running (skipped)")
        : res === "restarted" ? pc.yellow(`restarted (PID ${pid})`)
          : res === "adopted" ? pc.cyan(`adopted external process on :${app.port ?? app.waitForPort}`)
            : pc.dim(`started (PID ${pid})`);
    console.error(`  ${pc.green("✓")} ${pc.bold(app.name)} ${tag}`);
  }

  console.error(`\n  ${pc.green("✓")} Stack up. Observe with ${pc.cyan("fennec observe")} or ${pc.cyan("fennec dev status")}.`);
  console.error(`  ${pc.dim("Apps auto-restart (supervisor) + survive reboot (persist).")}\n`);
}

function devDown(): void {
  const tracked = readTracked().filter((t) => t.autoRestart);
  if (tracked.length === 0) {
    console.error(`\n  ${pc.dim("No supervised apps to stop.")}\n`);
    return;
  }
  console.error(`\n  ${symbols.fox} ${pc.bold("fennec dev down")} ${pc.dim(`— stopping ${tracked.length} app(s)`)}`);
  for (const t of tracked) {
    try {
      if (isTrackedRunning(t)) killTree(t.pid, "SIGTERM");
    } catch { /* best-effort */ }
    // Disable auto-restart so the supervisor doesn't revive them.
    t.autoRestart = false;
    addTracked({ ...t, autoRestart: false });
    console.error(`  ${pc.red("■")} ${pc.bold(t.name)}`);
  }
  console.error(`\n  ${pc.green("✓")} Stack stopped (auto-restart disabled). Use ${pc.cyan("fennec dev up")} to bring it back.\n`);
}

/** Restart one or more tracked apps (or all auto-restart apps if no names
 *  given) in place — the supervisor respawns each from its stored config. */
function devRestart(names: string[]): void {
  ensureSupervisorRunning();
  ensurePersistEnabled();
  const tracked = readTracked();
  const targets = names.length
    ? tracked.filter((t) => names.includes(t.name))
    : tracked.filter((t) => t.autoRestart);
  const missing = names.filter((n) => !tracked.some((t) => t.name === n));
  if (missing.length) {
    console.error(renderError("Not tracked", `No such app(s): ${missing.join(", ")} — run "fennec dev status" to list tracked apps.`));
  }
  if (targets.length === 0) {
    console.error(`\n  ${pc.dim("Nothing to restart.")}\n`);
    return;
  }
  console.error(`\n  ${symbols.fox} ${pc.bold("fennec dev restart")} ${pc.dim(`— ${targets.length} app(s)`)}`);
  for (const t of targets) {
    try {
      const newPid = respawnTracked(t, "manual");
      console.error(`  ${pc.green("✓")} ${pc.bold(t.name)} ${pc.dim(`restarted (PID ${newPid})`)}`);
    } catch (err) {
      console.error(`  ${pc.red("✗")} ${pc.bold(t.name)} ${pc.dim(`restart failed: ${String(err)}`)}`);
    }
  }
  console.error();
}

function devStatus(): void {
  const tracked = readTracked();
  console.error(`\n  ${symbols.fox} ${pc.bold("fennec dev status")}`);
  if (tracked.length === 0) {
    console.error(`  ${pc.dim("Nothing tracked.")}\n`);
    return;
  }
  for (const t of tracked) {
    const running = isTrackedRunning(t);
    const dot = running ? pc.green("●") : pc.red("○");
    const state = running ? pc.green(`running (PID ${t.pid})`) : pc.red("stopped");
    const portStr = t.port ? ` ${pc.yellow(`:${t.port}`)}` : "";
    const cause = t.restartCause ? pc.dim(` · last-restart: ${t.restartCause}`) : "";
    const flap = t.flapping ? pc.red(" · ⚠ flapping") : "";
    console.error(`  ${dot} ${pc.bold(t.name)}${portStr} ${pc.dim("—")} ${state}${cause}${flap}`);
  }
  console.error();
}

/** Order apps so dependencies come before dependents (best-effort, stable). */
function topoOrder(apps: AppConfig[]): AppConfig[] {
  const byName = new Map(apps.map((a) => [a.name, a]));
  const visited = new Set<string>();
  const out: AppConfig[] = [];
  const visit = (app: AppConfig, stack: Set<string>): void => {
    if (visited.has(app.name)) return;
    if (stack.has(app.name)) return; // cycle guard
    stack.add(app.name);
    for (const dep of app.dependsOn ?? []) {
      const d = byName.get(dep);
      if (d) visit(d, stack);
    }
    stack.delete(app.name);
    visited.add(app.name);
    out.push(app);
  };
  for (const app of apps) visit(app, new Set());
  return out;
}
