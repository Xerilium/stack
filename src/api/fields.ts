import { invalid } from './errors';

/** Parses `fields` against an allow-list; null means defaults. @req FR:api/compact.fields @req FR:api/compact.json (JSON.stringify drops undefined) */
export function parseFields(raw: string | null, allowed: readonly string[]): string[] | null {
  if (raw === null) return null;
  const list = raw.split(',').map((s) => s.trim());
  const bad = list.filter((f) => !allowed.includes(f));
  if (list.length === 0 || bad.length) {
    throw invalid([{ field: 'fields', message: `Allowed: ${allowed.join(', ')}${bad.length ? `; unknown: ${bad.join(', ')}` : ''}` }]);
  }
  return [...new Set(list)];
}

export function pick<T extends object>(item: T, fields: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = (item as Record<string, unknown>)[f];
    if (v !== undefined) out[f] = v;
  }
  return out as Partial<T>;
}
