/**
 * The weekly QM (quota-maxxing) plan: per project, the lead agent, its top 5 autonomous tasks, and token and human-time
 * estimates. One JSON file under ~/.stack (live state, never git); agents write it, the page and CLI read it.
 * @req FR:qm-plan/store.path @req FR:qm-plan/store.schema @req FR:qm-plan/store.put @req FR:qm-plan/store.read @req FR:qm-plan/live.event
 */
import { mkdirSync, readFileSync, unwatchFile, watchFile } from 'fs';
import { join } from 'path';
import { writeAtomic } from './file-lock';

export interface QmTask { title: string; url?: string }
export interface QmAgent { name: string; sessionId?: string; url?: string }
export interface QmProject { project: string; agent: QmAgent; tasks: QmTask[]; weeklyTokens: number | null; preAckMin: number | null; postReviewMin: number | null }
export interface QmPlan { version: 1; asOf: string; projects: QmProject[] }
export interface QmIssue { field: string; message: string }

/** A plan that fails the schema; `issues` lists every problem. */
export class QmInvalid extends Error {
  constructor(readonly issues: QmIssue[]) { super(`invalid QM plan: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`); }
}

const MAX_PROJECTS = 50;
const MAX_TASKS = 5;
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const SESSION = /^[A-Za-z0-9_.-]{1,100}$/;
const CTRL = new RegExp('[\\p{Cc}\\u2028\\u2029]', 'u');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHttps = (v: unknown) => { if (typeof v !== 'string' || v.length > 2000) return false; try { return new URL(v).protocol === 'https:'; } catch { return false; } };

/** Checks a plan against the schema and returns it, or throws one `QmInvalid` with every issue. @req FR:qm-plan/store.schema */
export function parseQmPlan(body: unknown): QmPlan {
  const issues: QmIssue[] = [];
  const bad = (field: string, message: string) => { issues.push({ field, message }); };
  if (!isObj(body)) throw new QmInvalid([{ field: 'body', message: 'Must be a JSON object' }]);
  const only = (f: string, o: Record<string, unknown>, keys: string[]) => { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(f ? `${f}.${k}` : k, 'Unknown field'); };
  const text = (f: string, v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > max || CTRL.test(v)) { bad(f, `Must be one line of 1-${max} characters`); return undefined; }
    return v.trim();
  };
  const num = (f: string, v: unknown): number | null => {
    if (v === null) return null;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) bad(f, 'Must be a non-negative integer or null');
    return v as number;
  };
  const url = (f: string, v: unknown) => { if (v !== undefined && !isHttps(v)) bad(f, 'Must be an https url'); };

  only('', body, ['version', 'asOf', 'projects']);
  if (body.version !== 1) bad('version', 'Must be 1');
  if (typeof body.asOf !== 'string' || !ISO_DT.test(body.asOf) || Number.isNaN(Date.parse(body.asOf))) bad('asOf', 'Must be an ISO date-time with a zone');
  if (!Array.isArray(body.projects) || body.projects.length > MAX_PROJECTS) { bad('projects', `Must be an array of at most ${MAX_PROJECTS}`); throw new QmInvalid(issues); }
  const seen = new Set<string>();
  const projects = body.projects.map((p, i): QmProject | undefined => {
    const f = `projects[${i}]`;
    if (!isObj(p)) { bad(f, 'Must be an object'); return undefined; }
    only(f, p, ['project', 'agent', 'tasks', 'weeklyTokens', 'preAckMin', 'postReviewMin']);
    const project = text(`${f}.project`, p.project, 80);
    if (project && seen.has(project.toLowerCase())) bad(`${f}.project`, 'Must be unique in the plan');
    if (project) seen.add(project.toLowerCase());
    let agent: QmAgent | undefined;
    if (!isObj(p.agent)) bad(`${f}.agent`, 'Must be an object {name, sessionId?, url?}');
    else {
      only(`${f}.agent`, p.agent, ['name', 'sessionId', 'url']);
      const name = text(`${f}.agent.name`, p.agent.name, 80);
      if (p.agent.sessionId !== undefined && (typeof p.agent.sessionId !== 'string' || !SESSION.test(p.agent.sessionId))) bad(`${f}.agent.sessionId`, 'Must match [A-Za-z0-9_.-]{1,100}');
      url(`${f}.agent.url`, p.agent.url);
      if (name) agent = { name, ...(p.agent.sessionId !== undefined ? { sessionId: p.agent.sessionId as string } : {}), ...(p.agent.url !== undefined ? { url: p.agent.url as string } : {}) };
    }
    let tasks: QmTask[] = [];
    if (!Array.isArray(p.tasks) || p.tasks.length > MAX_TASKS) bad(`${f}.tasks`, `Must be an array of at most ${MAX_TASKS}`);
    else tasks = p.tasks.flatMap((t, j): QmTask[] => {
      const g = `${f}.tasks[${j}]`;
      if (!isObj(t)) { bad(g, 'Must be an object {title, url?}'); return []; }
      only(g, t, ['title', 'url']);
      const title = text(`${g}.title`, t.title, 200);
      url(`${g}.url`, t.url);
      return title ? [{ title, ...(t.url !== undefined ? { url: t.url as string } : {}) }] : [];
    });
    const weeklyTokens = num(`${f}.weeklyTokens`, p.weeklyTokens);
    const preAckMin = num(`${f}.preAckMin`, p.preAckMin);
    const postReviewMin = num(`${f}.postReviewMin`, p.postReviewMin);
    return project && agent ? { project, agent, tasks, weeklyTokens, preAckMin, postReviewMin } : undefined;
  });
  if (issues.length) throw new QmInvalid(issues);
  return { version: 1, asOf: body.asOf as string, projects: projects as QmProject[] };
}

/** The plan file `<dir>/qm-plan.json`. A put replaces it whole, so no lock: an atomic write is enough. */
export class QmStore {
  readonly file: string;
  private readonly listeners = new Set<() => void>();
  constructor(readonly dir: string) { this.file = join(dir, 'qm-plan.json'); }

  /** The stored plan; `null` when missing, plus `broken` when the file is not a valid plan. @req FR:qm-plan/store.read */
  read(): { plan: QmPlan | null; broken?: true } {
    let t: string;
    try { t = readFileSync(this.file, 'utf8'); } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { plan: null } : { plan: null, broken: true }; }
    try { return { plan: parseQmPlan(JSON.parse(t.replace(/^﻿/, ''))) }; } catch { return { plan: null, broken: true }; }
  }

  /** Validates and replaces the plan. @req FR:qm-plan/store.put */
  put(body: unknown): QmPlan {
    const plan = parseQmPlan(body);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeAtomic(this.file, `${JSON.stringify(plan, null, 2)}\n`);
    for (const fn of this.listeners) { try { fn(); } catch { /* a listener never fails a write */ } }
    return plan;
  }

  /** Hears each successful put in this process; returns an unhook. @req FR:qm-plan/live.event */
  onWrite(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Hears writes by other processes (`stack qm put`) by polling the file mtime; returns a stop function. @req FR:qm-plan/live.event */
  watch(fn: (mtimeMs: number) => void, intervalMs = 2000): () => void {
    // A missing file reports zeroed stats on the first poll: only a changed mtime (a write, or a delete) is news.
    const h = (cur: { mtimeMs: number }, prev: { mtimeMs: number }) => { if (cur.mtimeMs !== prev.mtimeMs) fn(cur.mtimeMs); };
    watchFile(this.file, { persistent: false, interval: intervalMs }, h);
    return () => unwatchFile(this.file, h);
  }
}
