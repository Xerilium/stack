import type { TaskRef } from '../core/lifecycle';
import { ApiError, invalid, type Issue } from './errors';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_STR = 2000;

/** Reads at most MAX_BODY_BYTES from the stream; stops pulling as soon as the cap is passed. */
async function readCapped(req: Request): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      // Not awaited: the authorize clone is a tee branch, and cancel settles only when both branches cancel.
      void reader.cancel().catch(() => undefined);
      throw new ApiError('payload_too_large', 'Body too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** @req FR:api/input.json */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length'));
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) throw new ApiError('payload_too_large', 'Body too large');
  const text = await readCapped(req);
  if (text === '') return {};
  if (!/^application\/json\s*(;|$)/i.test(req.headers.get('content-type') ?? '')) {
    throw new ApiError('unsupported_media_type', 'Content-Type must be application/json');
  }
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new ApiError('bad_request', 'Body is not valid JSON'); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ApiError('bad_request', 'Body must be a JSON object');
  return v as Record<string, unknown>;
}

/** Allowed values for enum fields; mirrored in docs/api/openapi.yaml. @req FR:api/input.enums */
export const ENUMS = {
  status: ['🚧', '⏸️', '👀', '⏳', '⛔️', 'None'],
  priority: ['🚨', '‼️', '🔺', '🔻', 'None'],
  effort: ['🟢', '🟡', '🟠', '🔴', '⚫️', 'None'],
  impact: ['⬆️', '↔️', '⬇️', 'None'],
  checkbox: ['Complete', 'Incomplete'],
} as const;

export type Spec =
  | { t: 'str'; required?: boolean; max?: number; line?: boolean; pattern?: RegExp; noReadme?: boolean }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'int'; min: number; max: number }
  | { t: 'num'; min: number; max: number }
  | { t: 'bool' }
  | { t: 'ref'; required?: boolean }
  | { t: 'strs'; max?: number; commas?: boolean }
  | { t: 'caps' };

export const REF_RE = /^(?![Rr][Ee][Aa][Dd][Mm][Ee]:)([^/\\:\0.][^/\\:\0]*):(\d{1,9})$/;
const isReadme = (name: string) => name.toLowerCase() === 'readme';

/** @req FR:api/input.ref */
export function parseRef(v: unknown): TaskRef | null {
  if (typeof v !== 'string') return null;
  const m = REF_RE.exec(v);
  return m && !isReadme(m[1]) ? { path: `tasks/${m[1]}.md`, line: Number(m[2]) } : null;
}

/** @req FR:api/input.ref */
export const formatRef = (r: TaskRef): string => `${r.path.replace(/^.*\//, '').replace(/\.md$/, '')}:${r.line}`;

/** CR, LF, NEL, LS, PS: anything that can start a new markdown line. @req FR:api/input.line */
const oneLine = (s: string) => !/[\r\n\u0085\u2028\u2029]/.test(s);
function check(spec: Spec, v: unknown): string | null {
  switch (spec.t) {
    case 'str':
      if (typeof v !== 'string') return 'Must be a string';
      if (spec.required && v.trim() === '') return 'Required';
      if (v.length > (spec.max ?? MAX_STR)) return `At most ${spec.max ?? MAX_STR} characters`;
      if (spec.line && !oneLine(v)) return 'Must be a single line';
      if (spec.pattern && !spec.pattern.test(v)) return 'Invalid format';
      if (spec.noReadme && isReadme(v.replace(/\.md$/i, ''))) return 'Reserved name';
      return null;
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v) ? null : 'Must be one of: ' + spec.values.join(' ');
    case 'int':
      return Number.isInteger(v) && (v as number) >= spec.min && (v as number) <= spec.max ? null : `Must be an integer from ${spec.min} to ${spec.max}`;
    case 'num':
      return typeof v === 'number' && Number.isFinite(v) && v >= spec.min && v <= spec.max ? null : `Must be a number from ${spec.min} to ${spec.max}`;
    case 'bool':
      return typeof v === 'boolean' ? null : 'Must be true or false';
    case 'ref':
      return parseRef(v) ? null : 'Must be project:line';
    case 'strs':
      if (!Array.isArray(v) || v.length > (spec.max ?? 20)) return 'Must be an array of strings';
      return v.every((s) => typeof s === 'string' && s.trim() !== '' && s.length <= 200 && oneLine(s) && (spec.commas || !s.includes(','))) ? null : 'Entries must be short single-line strings without commas';
    case 'caps': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'Must be an object of hours';
      const e = Object.entries(v);
      return e.length <= 20 && e.every(([k, h]) => k.length <= 200 && oneLine(k) && typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 168) ? null : 'Must map names to hours (0-168)';
    }
  }
}

/**
 * Validates a body against a schema; unknown fields and every bad field are reported together.
 * @req FR:api/input.strict @req FR:api/input.types @req FR:api/errors.validation
 */
export function validate<T>(body: Record<string, unknown>, schema: Record<string, Spec>, required: string[] = []): T {
  const issues: Issue[] = [];
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(body)) if (!Object.prototype.hasOwnProperty.call(schema, k)) issues.push({ field: k, message: 'Unknown field' });
  for (const [k, spec] of Object.entries(schema)) {
    const v = body[k];
    if (v === undefined) {
      if (required.includes(k)) issues.push({ field: k, message: 'Required' });
      continue;
    }
    const bad = check(spec, v);
    if (bad) issues.push({ field: k, message: bad });
    else out[k] = spec.t === 'ref' ? parseRef(v) : v;
  }
  if (issues.length) throw invalid(issues);
  return out as T;
}

/** Query params: only `allowed` names; returns the raw values. @req FR:api/input.strict */
export function readQuery(url: URL, allowed: string[]): URLSearchParams {
  const bad = [...new Set(url.searchParams.keys())].filter((k) => !allowed.includes(k));
  if (bad.length) throw invalid(bad.map((field) => ({ field, message: 'Unknown parameter' })));
  return url.searchParams;
}

export function intParam(q: URLSearchParams, name: string, def: number, min: number, max: number): number {
  const raw = q.get(name);
  if (raw === null) return def;
  const n = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= min && n <= max)) throw invalid([{ field: name, message: `Must be an integer from ${min} to ${max}` }]);
  return n;
}
