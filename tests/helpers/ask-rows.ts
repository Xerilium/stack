/**
 * Test helpers for asks stored as nested 🙋 task rows (`FR:task-asks/*`): what used to be one file per ask.
 */
import { formatAskRow, readAskRows, type Ask } from '../../src/core/asks';
import type { Storage } from '../../src/core/storage';

type Readable = Pick<Storage, 'list' | 'read'>;

/** Every ask row, with the task file that holds it and the row's own lines. */
export async function askRows(storage: Readable): Promise<{ key: string; path: string; ask: Ask; text: string }[]> {
  const out: { key: string; path: string; ask: Ask; text: string }[] = [];
  for (const path of await storage.list()) {
    const content = (await storage.read(path)).content;
    const lines = content.split('\n');
    for (const r of readAskRows(content)) out.push({ key: r.ask.key, path, ask: r.ask, text: lines.slice(r.line, r.end + 1).join('\n') });
  }
  return out;
}

/** Keys of every ask row, sorted (the old `listAsks()` of ask files). */
export async function askKeys(storage: Readable): Promise<string[]> {
  return (await askRows(storage)).map((r) => r.key).sort();
}

/** The row lines of one ask (the old ask file content); throws when the key has no row. */
export async function askText(storage: Readable, key: string): Promise<string> {
  const r = (await askRows(storage)).find((x) => x.key === key);
  if (!r) throw new Error(`No ask row: ${key}`);
  return r.text;
}

/** A task file holding these asks as rows (the old seeded ask files). */
export function asksFile(asks: Ask[]): string {
  return ['# Asks', '', '## Open', '', ...asks.flatMap((a) => formatAskRow(a)), ''].join('\n');
}
