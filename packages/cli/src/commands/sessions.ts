/**
 * Command: sessions — List saved auth sessions.
 */
import { SessionStore } from "@plumpslabs/fennec-core";
import pc from "picocolors";
import { symbols, renderTable, type Column, type Row } from "../utils/format.js";

export async function sessionsCommand(): Promise<void> {
  const store = new SessionStore("./.fennec/sessions");
  const sessions = store.list();
  if (sessions.length === 0) { console.error(`\n  ${pc.dim("No saved sessions found.")}\n`); return; }

  const columns: Column[] = [
    { key: "name", label: "Name", format: (v) => pc.bold(String(v)) },
    { key: "origin", label: "Origin" },
    { key: "savedAt", label: "Saved", format: (v) => pc.dim(String(v)) },
  ];
  const rows: Row[] = sessions.map((s) => ({ name: s.name, origin: s.origin, savedAt: new Date(s.savedAt).toLocaleString() }));

  console.error(`\n  ${symbols.fox} ${pc.bold("Saved Sessions")}\n`);
  console.error(renderTable(columns, rows));
  console.error(`  ${pc.dim(`${sessions.length} session(s)`)}\n`);
}
