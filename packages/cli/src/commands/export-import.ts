/**
 * Commands: export, import — Backup and restore tracked.json configuration.
 */
import pc from 'picocolors';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderError, confirmPrompt, symbols, renderKVColor } from '../utils/format.js';
import { readTracked, saveTracked } from './tracker.js';

/**
 * fennec export [--file path]
 * Export tracked.json to stdout or a file.
 */
export async function exportCommand(args: string[]): Promise<void> {
  const tracked = readTracked();
  const fileIndex = args.indexOf('--file');
  const filePath = fileIndex !== -1 ? args[fileIndex + 1] : undefined;

  if (fileIndex !== -1 && !filePath) {
    console.error(renderError('Missing file path', 'Usage: fennec export --file <path>'));
    process.exit(1);
  }

  if (tracked.length === 0) {
    console.error(`\n  ${pc.dim('No tracked processes to export.')}\n`);
    return;
  }

  const json = JSON.stringify(tracked, null, 2);

  if (filePath) {
    try {
      writeFileSync(resolve(filePath), json, 'utf-8');
      console.error(
        `\n  ${pc.green('✓')} ${pc.bold(`Exported ${tracked.length} process(es)`)} ${pc.dim(`→ ${filePath}`)}\n`,
      );
    } catch (err) {
      console.error(renderError('Export failed', String(err)));
      process.exit(1);
    }
  } else {
    // Write to stdout as JSON
    console.log(json);
  }
}

/**
 * fennec import <file>
 * Import processes from a JSON file and merge into tracked.json.
 */
export async function importCommand(args: string[]): Promise<void> {
  const filePath = args[0];

  if (!filePath) {
    console.error(renderError('Missing file', 'Usage: fennec import <file>'));
    process.exit(1);
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    console.error(renderError('File not found', `"${filePath}" does not exist.`));
    process.exit(1);
  }

  let imported: {
    name: string;
    pid: number;
    command: string;
    port?: number;
    cwd?: string;
    startedAt: string;
  }[];
  try {
    imported = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
    if (!Array.isArray(imported) || imported.length === 0) {
      console.error(
        renderError('Invalid file', 'File must contain a non-empty JSON array of process objects.'),
      );
      process.exit(1);
    }
  } catch (err) {
    console.error(renderError('Invalid JSON', String(err)));
    process.exit(1);
  }

  const existing = readTracked();
  console.error(`\n  ${symbols.fox} ${pc.bold('Import Processes')}\n`);
  console.error(`  ${renderKVColor('File', resolvedPath)}`);
  console.error(`  ${renderKVColor('Importing', `${imported.length} process(es)`)}`);
  console.error(`  ${renderKVColor('Existing', `${existing.length} process(es)`)}`);

  // Show what will be imported
  console.error(`\n  ${pc.bold('Processes to import:')}`);
  for (const p of imported) {
    console.error(`  ${pc.green('+')} ${pc.bold(p.name)} ${pc.dim(`(${p.command})`)}`);
  }
  console.error();

  const confirmed = await confirmPrompt(
    'Merge into tracked.json? Existing processes with the same name will be overwritten.',
    true,
  );
  if (!confirmed) {
    console.error(`  ${pc.dim('Cancelled')}\n`);
    return;
  }

  // Merge: overwrite existing by name, add new
  const merged = [...existing];
  for (const proc of imported) {
    const idx = merged.findIndex((t) => t.name === proc.name);
    if (idx !== -1) {
      merged[idx] = { ...merged[idx], ...proc };
    } else {
      merged.push(proc as any);
    }
  }

  saveTracked(merged);
  console.error(
    `  ${pc.green('✓')} ${pc.bold(`Imported ${imported.length} process(es)`)} ${pc.dim(`(${merged.length} total)`)}\n`,
  );
}
