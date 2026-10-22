import type { TaskRef } from '../core/lifecycle';
import { ApiError, invalid, type Issue } from './errors';

export const MAX_BODY_BYTES = 64 * 1024;
const MAX_STR = 2000;

/** @req FR:api/input.json */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length'));
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) throw new ApiError('payload_too_large', 'Body too large');
  const text = await req.text();
  if (text === '') return {};
  if (!/^application\/json\s*(;|$)/i.test(req.headers.get('content-type') ?? '')) {
    throw new ApiError('unsupported_media_type', 'Content-Type must be application/json');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new ApiError('payload_too_large', 'Body too large');
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new ApiError('bad_request', 'Body is not valid JSON'); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ApiError('bad_request', 'Body must be a JSON object');
  return v as Record<string, unknown>;
}

export type Spec =
  | { t: 'str'; required?: boolean; max?: number; line?: boolean; pattern?: RegExp }
  | { t: 'int'; min: number; max: number }
  | { t: 'num'; min: number; max: number }
  | { t: 'bool' }
  | { t: 'ref'; required?: boolean }
  | { t: 'strs'; max?: number }
  | { t: 'caps' };

const REF = /^([^/\\:\0.][^/\\:\0]*):(\d{1,9})$/;

/** @req FR:api/input.ref */
export function parseRef(v: unknown): TaskRef | null {
  if (typeof v !== 'string') return null;
  const m = REF.exec(v);
  return m ? { path: `tasks/${m[1]}.md`, line: Number(m[2]) } : null;
}

/** @req FR:api/input.ref */
export const formatRef = (r: TaskRef): string => `${r.path.replace(/^.*\//, '').replace(/\.md$/, '')}:${r.line}`;

const oneLine = (s: string) => !/[\r\n]/.test(s);

function check(spec: Spec, v: unknown): string | null {
  switch (spec.t) {
    case 'str':
      if (typeof v !== 'string') return 'Must be a string';
      if (spec.required && v.trim() === '') return 'Required';
      if (v.length > (spec.max ?? MAX_STR)) return `At most ${spec.max ?? MAX_STR} characters`;
      if (spec.line && !oneLine(v)) return 'Must be a single line';
      if (spec.pattern && !spec.pattern.test(v)) return 'Invalid format';
      return null;
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
      return v.every((s) => typeof s === 'string' && s.trim() !== '' && s.length <= 200 && oneLine(s) && !s.includes(',')) ? null : 'Entries must be short single-line strings without commas';
    case 'caps': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'Must be an object of hours';
      const e = Object.entries(v);
      return e.length <= 20 && e.every(([, h]) => typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 168) ? null : 'Must map names to hours (0-168)';
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
