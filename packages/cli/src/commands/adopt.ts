/**
 * Command: adopt — Register an already-running process (started via raw bash,
 * another tool, or a previous session) into fennec's tracked registry WITHOUT
 * restarting it. The human counterpart to the agent's `process_adopt`: it
 * stops an externally-launched server from being an untracked orphan and
 * prevents `start`/`spawn` from creating a duplicate that fails with
 * EADDRINUSE.
 *
 * Usage: fennec adopt <pid> [--name <name>] [--port <port>]
 */
import pc from "picocolors";
import { renderError, symbols } from "../utils/format.js";
import { adoptProcess, logFilePathFor } from "./tracker.js";

export function adoptCommand(args: string[]): void {
  const pidArg = args.find((a) => /^\d+$/.test(a));
  if (!pidArg) {
    console.error(renderError("Missing PID", `Usage: fennec adopt <pid> [--name <name>] [--port <port>]`));
    process.exit(1);
  }
  const pid = parseInt(pidArg, 10);

  const nameIdx = args.indexOf("--name");
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
  const portIdx = args.indexOf("--port");
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1] ?? "", 10) : undefined;

  const entry = adoptProcess(pid, { name, port: Number.isNaN(port) ? undefined : port });
  if (!entry) {
    console.error(renderError("Cannot adopt", `No running process with PID ${pid}`));
    process.exit(1);
  }

  console.error(`\n  ${symbols.fox} ${pc.green("✓")} ${pc.bold("Adopted")} ${pc.bold(entry.name)} ${pc.dim(`(PID ${pid})`)}`);
  if (entry.port) console.error(`  ${pc.dim("port")}     ${pc.yellow(`:${entry.port}`)}`);
  if (entry.command) console.error(`  ${pc.dim("command")}  ${entry.command}`);
  console.error(`  ${pc.dim("status")}   now tracked + supervised by the supervisor`);
  console.error(`  ${pc.dim("logs")}     ${pc.cyan(logFilePathFor(entry.name))}\n`);
}
