/**
 * The PR live check file that sweepers write: `<home>/pr/<owner>/<repo>/<number>.md`. Pure parse, no I/O. Format: docs/pr-check.md.
 * @req FR:pr-page/check.file @req FR:pr-page/check.parse
 */
import { join } from 'path';

export interface LiveCheck { ask?: string; server?: string; at?: string; steps: string[]; pass: string[]; fail: string[] }

const MAX_ITEMS = 20;
const MAX_TEXT = 200;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const cut = (s: string) => { const t = s.trim(); return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1).trimEnd()}…` : t; };

/** The file path for one PR, or null when a part is not a GitHub name. @req FR:pr-page/check.file */
export function checkPath(home: string, repo: string, number: number): string | null {
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts.every((p) => NAME.test(p) && p !== '.' && p !== '..' && !/^\.+$/.test(p)) || !Number.isInteger(number) || number < 1) return null;
  return join(home, 'pr', parts[0], parts[1], `${number}.md`);
}

/** Ask, Server, As of, then the Steps, Pass, and Fail lists. Null when none is found. @req FR:pr-page/check.parse */
export function parseCheck(text: string): LiveCheck | null {
  const c: LiveCheck = { steps: [], pass: [], fail: [] };
  let list: 'steps' | 'pass' | 'fail' | null = null;
  let found = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^#{2,}\s*(steps|pass|fail)\s*$/i.exec(line);
    if (h) { list = h[1].toLowerCase() as 'steps' | 'pass' | 'fail'; continue; }
    if (/^#/.test(line)) { list = null; continue; }
    const kv = /^[-*]\s*(ask|server|as of)\s*:\s*(.+)$/i.exec(line);
    if (kv) {
      const v = cut(kv[2]);
      const k = kv[1].toLowerCase();
      if (k === 'ask') c.ask = v; else if (k === 'server') c.server = cut(v.replace(/^`+|`+$/g, '')); else c.at = v;
      found = true;
      continue;
    }
    const item = /^(?:\d+[.)]|[-*])\s+(.+)$/.exec(line);
    if (item && list) { if (c[list].length < MAX_ITEMS) c[list].push(cut(item[1])); found = true; }
  }
  return found ? c : null;
}
