/**
 * Command: group — Tag existing tracked entries with a logical group, or
 * list group membership. Groups let bulk ops (kill/spawn/stop/ps) target a
 * subset instead of everything (--all).
 *
 *   fennec group                 → list all entries with their group
 *   fennec group <name> <grp>   → assign group <grp> to <name>
 *   fennec group <name> --unset → clear the group on <name>
 */
import pc from "picocolors";
import { renderError, renderTable, type Column, type Row } from "../utils/format.js";
import { readTracked, setGroup, getGroups } from "./tracker.js";

export async function groupCommand(args: string[]): Promise<void> {
  const positional = args.filter((a) => !a.startsWith("-") && !a.includes("="));
  const unset = args.includes("--unset");

  // No args → list every entry with its group
  if (positional.length === 0) {
    const tracked = readTracked();
    if (tracked.length === 0) {
      console.error(`\n  ${pc.dim("No tracked processes.")}\n`);
      return;
    }
    const columns: Column[] = [
      { key: "name", label: "App", format: (v) => pc.bold(String(v)) },
      { key: "group", label: "Group", format: (v) => { const g = String(v); return g === "-" ? pc.dim("-") : pc.cyan(g); } },
      { key: "command", label: "Command", format: (v) => { const c = String(v); return c.length > 50 ? c.slice(0, 50) + "…" : c; } },
    ];
    const rows: Row[] = tracked.map((t) => ({ name: t.name, group: t.group ?? "-", command: t.command }));
    console.error(`\n  ${pc.bold("Fennec Apps by Group")} ${pc.dim(`(${getGroups().length} group(s))`)}\n`);
    console.error(renderTable(columns, rows));
    console.error(`  ${pc.dim("Assign:")} ${pc.cyan("fennec group <name> <group>")}  ${pc.dim("Clear:")} ${pc.cyan("fennec group <name> --unset")}`);
    console.error();
    return;
  }

  const name = positional[0]!;
  const newGroup = positional[1];

  if (!newGroup && !unset) {
    console.error(renderError("Missing group", "Usage: fennec group <name> <group>   (or: fennec group <name> --unset)"));
    process.exit(1);
  }

  const ok = setGroup(name, unset ? undefined : newGroup);
  if (!ok) {
    console.error(renderError("Not found", `No tracked process named "${name}".`));
    process.exit(1);
  }

  if (unset) {
    console.error(`\n  ${pc.green("✓")} ${pc.bold(name)} ${pc.dim("removed from its group")}\n`);
  } else {
    console.error(`\n  ${pc.green("✓")} ${pc.bold(name)} ${pc.dim("assigned to group")} ${pc.cyan(newGroup!)}\n`);
  }
}
