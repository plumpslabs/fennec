/**
 * CLI E2E Test Suite
 *
 * Exercises the REAL built CLI binary (`dist/index.js`) with an isolated
 * FENNEC_DATA_DIR, covering every feature we built:
 *   - daemon start / stop / spawn lifecycle
 *   - idempotent adopt-by-port (no double-starts)
 *   - supervisor auto-restart (respawn after kill)
 *   - dev up idempotency + dev restart + dev down
 *   - log / inspect / ps (json + system)
 *   - supervisor / persist / health commands don't crash
 *
 * These run the actual cross-platform process code paths (findPidOnPort,
 * getProcessCmdline, getProcessCwd, getSystemProcesses), so they double as a
 * regression guard for the Linux/macOS/Windows refactor.
 *
 * Requires a build first:  pnpm --filter @plumpslabs/fennec-cli build
 * Run:                     pnpm --filter @plumpslabs/fennec-cli test:e2e
 */
import { execFileSync, spawnSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const CLI = resolve(__dirname, "../../dist/index.js");
const BUILT = existsSync(CLI);

const DATA_DIR = mkdtempSync(join(tmpdir(), "fennec-e2e-"));
// Random base port so leftover daemons from a previous (crashed) run can never
// collide with this run's ports.
const BASE = 20000 + Math.floor(Math.random() * 400) * 10;
const P = (n: number) => BASE + n;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  out: string;
}

function run(args: string[], extra: Record<string, string> = {}): RunResult {
  // NOTE: the CLI prints human-readable output to stderr and JSON to stdout.
  // Capture BOTH streams so assertions see the real output.
  const res = spawnSync("node", [CLI, ...args], {
    encoding: "utf-8",
    timeout: 30000,
    env: { ...process.env, FENNEC_DATA_DIR: DATA_DIR, HOME: DATA_DIR, ...extra },
  });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { code: res.status ?? (res.error ? 1 : 0), stdout, stderr, out: stdout + stderr };
}

function psJson(): any[] {
  const { stdout } = run(["ps", "--json"]);
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : parsed.apps ?? [];
  } catch {
    return [];
  }
}

function findApp(name: string): any | undefined {
  return psJson().find((a) => a.name === name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll until `fn` returns a truthy value or timeout. */
async function waitFor(fn: () => any, timeoutMs = 10000, intervalMs = 200): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = fn();
    if (v) return v;
    await sleep(intervalMs);
  }
  return fn();
}

interface Bg {
  pid: number;
  kill: () => void;
}
const backgrounds: Bg[] = [];

function bgNode(code: string): Bg {
  const child: ChildProcess = spawn("node", ["-e", code], { detached: true, stdio: "ignore" });
  const pid = child.pid!;
  const bg: Bg = {
    pid,
    kill: () => {
      try {
        process.kill(-pid);
      } catch {
        /* already gone */
      }
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    },
  };
  backgrounds.push(bg);
  return bg;
}

const HTTP = (port: number, extra = "") =>
  `require('http').createServer((q,s)=>s.end('ok')).listen(${port},()=>console.log('BOOT ${port}'))${extra}`;

describe.skipIf(!BUILT)("CLI E2E: process control plane", () => {
  beforeAll(() => {
    expect(BUILT, "dist/index.js missing — run `pnpm --filter @plumpslabs/fennec-cli build` first").toBe(true);
  });

  afterAll(() => {
    // Kill every tracked process directly (stop/kill are interactive; this is
    // the reliable non-interactive teardown). Also kills any orphan adopted
    // from a prior run that landed in this run's tracked.json.
    try {
      const raw = readFileSync(join(DATA_DIR, "tracked.json"), "utf-8");
      const tracked = JSON.parse(raw) as any[];
      for (const t of tracked) {
        if (t?.pid) {
          try {
            process.kill(t.pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
      }
    } catch {
      /* no tracked file */
    }
    for (const b of backgrounds) b.kill();
    try {
      rmSync(DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("start spawns a supervised daemon (does NOT start the MCP server)", () => {
    const port = P(0);
    const r = run(["start", "node", "-e", HTTP(port), "--name", "web", "--port", String(port)]);
    expect(r.code).toBe(0);
    const app = findApp("web");
    expect(app, "web should be tracked").toBeDefined();
    expect(app.status).toBe("running");
    expect(app.pid).toBeGreaterThan(0);

    // log file lives under FENNEC_DATA_DIR/logs (parity fix)
    expect(existsSync(join(DATA_DIR, "logs", "web.log"))).toBe(true);
  });

  it("log and inspect read the daemon's output", async () => {
    // Read the log FILE directly (robust against ANSI formatting in CLI output).
    const logPath = join(DATA_DIR, "logs", "web.log");
    expect(await waitFor(() => existsSync(logPath) && readFileSync(logPath, "utf-8").includes(`BOOT ${P(0)}`))).toBeTruthy();

    const json = run(["log", "web", "--json"]);
    expect(() => JSON.parse(json.out)).not.toThrow();

    const inspect = run(["inspect", "web", "--plain"]);
    expect(inspect.out.toLowerCase()).toContain("running");
  });

  it("stop pauses and spawn resumes a tracked app", async () => {
    expect(run(["stop", "web", "-y"]).code).toBe(0);
    expect(await waitFor(() => findApp("web")?.status === "stopped")).toBe(true);

    expect(run(["spawn", "web"]).code).toBe(0);
    expect(await waitFor(() => findApp("web")?.status === "running")).toBe(true);
  });

  it("adopt-by-port reuses an external process instead of double-starting", async () => {
    const port = P(1);
    const ext = bgNode(HTTP(port));
    // Wait until the external server is actually bound.
    const bound = await waitFor(() => {
      try {
        execFileSync("node", ["-e", `require('http').get('http://127.0.0.1:${port}',r=>process.exit(0)).on('error',()=>process.exit(1))`], {
          stdio: "ignore",
          timeout: 3000,
        });
        return true;
      } catch {
        return false;
      }
    });
    expect(bound, "external server should bind").toBe(true);

    // This start should ADOPT the external server (same pid), not spawn a new one.
    const r = run(["start", "node", "-e", "process.exit(0)", "--name", "svc", "--port", String(port)]);
    expect(r.code).toBe(0);

    const apps = psJson().filter((a) => a.name === "svc");
    expect(apps.length, "exactly one svc tracked").toBe(1);
    expect(apps[0].status).toBe("running");
    expect(apps[0].pid).toBe(ext.pid); // adopted the external pid
  });

  it("supervisor auto-restarts a --restart app after it is killed", async () => {
    const port = P(2);
    const r = run(["start", "node", "-e", HTTP(port), "--name", "api", "--port", String(port), "--restart"]);
    expect(r.code).toBe(0);
    const before = findApp("api");
    expect(before?.status).toBe("running");
    const pid1 = before!.pid;

    // Kill the managed process out from under it.
    try {
      process.kill(pid1, "SIGKILL");
    } catch {
      /* ignore */
    }

    // Supervisor should respawn it with a new pid.
    const respawned = await waitFor(() => {
      const a = findApp("api");
      return a && a.status === "running" && a.pid !== pid1 ? a : false;
    }, 15000);
    expect(respawned, "api should respawn and be running").toBeTruthy();
    expect((respawned as any).pid, "should have a new pid after respawn").not.toBe(pid1);
    expect((respawned as any).pid).toBeGreaterThan(0);
  });

  it("dev up is idempotent (skips already-running apps), restart + down work", async () => {
    const port = P(3);
    const cfg = `apps:\n  - name: be\n    command: node\n    args: ["-e", "${HTTP(port)}"]\n    port: ${port}\n    restart: true\n`;
    const cfgPath = join(DATA_DIR, "fennec.config.yaml");
    writeFileSync(cfgPath, cfg);

    expect(run(["dev", "up", "--config", cfgPath]).code).toBe(0);
    expect(await waitFor(() => findApp("be")?.status === "running")).toBe(true);
    const pid1 = findApp("be")!.pid;

    // Second `dev up` must NOT restart it (same pid — idempotent).
    expect(run(["dev", "up", "--config", cfgPath]).code).toBe(0);
    expect(findApp("be")?.pid, "dev up should skip already-running app").toBe(pid1);

    // dev restart should bring it back (pid may change).
    expect(run(["dev", "restart", "be"]).code).toBe(0);
    expect(await waitFor(() => findApp("be")?.status === "running")).toBe(true);

    // dev down stops the stack (keeps registry).
    expect(run(["dev", "down"]).code).toBe(0);
    expect(await waitFor(() => findApp("be")?.status === "stopped")).toBe(true);
  });

  it("ps --system, supervisor, persist, and health commands run without error", () => {
    expect(run(["ps", "--system"]).code).toBe(0);
    expect(run(["ps", "--json"]).code).toBe(0);
    expect(run(["supervisor", "status"]).code).toBe(0);
    const persist = run(["persist", "status"]);
    expect(persist.code).toBe(0);
    const health = run(["health"]);
    expect(health.code).toBe(0);
  });

  it("routing guard: `start <cmd>` spawns (does not launch the MCP server)", () => {
    const port = P(4);
    const r = run(["start", "node", "-e", HTTP(port), "--name", "guard", "--port", String(port)]);
    expect(r.code).toBe(0);
    expect(r.out.toLowerCase()).not.toContain("starting fennec mcp server");
    expect(findApp("guard")?.status).toBe("running");
  });

  it("kill all only stops Fennec-tracked apps — never other user processes", async () => {
    const port = P(5);
    expect(run(["start", "node", "-e", HTTP(port), "--name", "killme", "--port", String(port)]).code).toBe(0);
    expect(await waitFor(() => findApp("killme")?.status === "running", 5000)).toBe(true);

    // An external, UNtracked process that MUST survive `kill all`.
    const extPort = P(6);
    const ext = bgNode(HTTP(extPort));
    const bound = await waitFor(() => {
      try {
        execFileSync("node", ["-e", `require('http').get('http://127.0.0.1:${extPort}',r=>process.exit(0)).on('error',()=>process.exit(1))`], { stdio: "ignore", timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    }, 5000);
    expect(bound, "external server should bind before kill all").toBe(true);

    // The critical regression guard: kill all must only target tracked apps.
    expect(run(["kill", "all", "-y"]).code).toBe(0);

    // Tracked app is gone.
    expect(await waitFor(() => !findApp("killme"), 5000)).toBe(true);

    // External untracked process is STILL alive (proves it was never scoped-in).
    const stillUp = await waitFor(() => {
      try {
        execFileSync("node", ["-e", `require('http').get('http://127.0.0.1:${extPort}',r=>process.exit(0)).on('error',()=>process.exit(1))`], { stdio: "ignore", timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    }, 5000);
    expect(stillUp, "external untracked process must survive `kill all`").toBe(true);
    ext.kill();
  }, 30000);
});
