import type { TaskRef } from '../core/lifecycle';

export class UsageError extends Error {}

export interface Parsed {
  command?: string;
  positionals: string[];
  flags: Record<string, string | true>;
}

/** Flags that never take a value. */
export const BOOLEAN_FLAGS = new Set(['json', 'force', 'remove', 'sweep', 'no-commit', 'remove-emojis', 'help', 'version']);

/**
 * Splits argv into the command, positionals, and flags. `--name value` and `--name=value` both work;
 * everything after `--` is positional.
 * @req FR:cli/run.@function
 */
export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { positionals: [], flags: {} };
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--') || a.length === 2) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (BOOLEAN_FLAGS.has(name)) {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`);
      out.flags[name] = true;
    } else if (eq !== -1) {
      out.flags[name] = a.slice(eq + 1);
    } else {
      if (i + 1 >= argv.length) throw new UsageError(`--${name} needs a value`);
      out.flags[name] = argv[++i];
    }
  }
  out.command = pos.shift();
  out.positionals = pos;
  return out;
}

/** `tasks/x.md:12` (1-based line) to the core's 0-based ref. @req FR:cli/ref.format @req FR:cli/ref.invalid */
export function parseRef(text: string): TaskRef {
  const m = /^(.+):(\d+)$/.exec(text);
  if (!m || Number(m[2]) < 1) throw new UsageError(`Bad task ref (expected tasks/<file>.md:<line>): ${text}`);
  return { path: m[1], line: Number(m[2]) - 1 };
}

export const formatRef = (r: TaskRef): string => `${r.path}:${r.line + 1}`;
