/**
 * Command: doctor — health + secret-surface checks for the Fennec store.
 *
 *   fennec doctor
 *
 * Warns when:
 *   - the global store dir is group/other readable (perms)
 *   - the store lives under a synced dir (chezmoi/yadm/Dropbox/...) ->
 *     auth cookies/tokens could leak across machines
 *   - other tools' launch commands (tracked.json) embed secrets (KEY=val)
 *   - a local ./.fennec exists in this repo but is NOT gitignored
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { StoreManager } from "@plumpslabs/fennec-core";
import pc from "picocolors";
import { renderError } from "../utils/format.js";

export async function doctorCommand(): Promise<void> {
  const mgr = new StoreManager(false);
  const base = mgr.base;
  const problems: string[] = [];
  const notes: string[] = [];

  // 1. permissions
  if (!mgr.permsSafe()) {
    problems.push(`Store dir is group/other readable: ${base}\n      Fix: chmod 700 ${base}`);
  }

  // 2. synced-home leakage
  if (StoreManager.isSynced(base)) {
    problems.push(
      `Store lives under a synced directory: ${base}\n` +
        `      Auth cookies/tokens in sessions + process launch commands could leak across machines.\n` +
        `      Prefer a non-synced location (FENNEC_HOME=/non-synced/fennec) or use --local with care.`,
    );
  }

  // 3. secret surface
  const scan = mgr.scan();
  const sess = scan.find((s) => s.kind === "session");
  if (sess && sess.count > 0) {
    notes.push(
      `${sess.count} auth session(s) with cookies/localStorage stored on disk.\n` +
        `      Values are masked by default in 'fennec store session info'; use --show-secrets to reveal.`,
    );
  }
  const proc = scan.find((s) => s.kind === "process");
  if (proc && proc.count > 0) {
    const tracked = mgr.fileFor("process", "");
    const cmds = existsSync(tracked) ? (JSON.parse(readFileSync(tracked, "utf-8")) as Array<{ command?: string }>) : [];
    // Flag bareword env assignments (KEY=value), not `--flag=val` or `x=1` in quotes.
    const secretCmds = cmds.filter(
      (c) => c.command && /(?:^|[\s;|&])([A-Za-z_][A-Za-z0-9_]*)=/.test(c.command),
    ).length;
    if (secretCmds > 0) {
      notes.push(
        `${secretCmds} tracked process launch command(s) may embed secrets (KEY=value).\n` +
          `      Stored in ${tracked} — keep the store out of synced/committed locations.`,
      );
    }
  }

  // 4. local .fennec not gitignored
  const localFen = join(process.cwd(), ".fennec");
  if (existsSync(localFen)) {
    let ignored = false;
    try {
      execSync("git check-ignore -q .fennec", { cwd: process.cwd(), stdio: "ignore" });
      ignored = true;
    } catch (err) {
      // git absent (ENOENT) -> can't determine; skip the warning rather than false-alarm.
      ignored = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    }
    if (!ignored) {
      problems.push(
        `Local ./.fennec exists here and is NOT gitignored.\n` +
          `      It can hold sessions + tracked processes — add '.fennec/' to .gitignore or remove it.`,
      );
    }
  }

  console.error(`\n  ${pc.bold("Fennec Doctor")}\n`);
  console.error(`  ${pc.dim("Store:")} ${base}\n`);

  if (problems.length === 0 && notes.length === 0) {
    console.error(`  ${pc.green("✓")} No issues found.\n`);
    return;
  }
  for (const p of problems) console.error(`  ${pc.red("✗")} ${p}\n`);
  for (const n of notes) console.error(`  ${pc.yellow("!")} ${n}\n`);
}
