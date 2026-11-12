/**
 * The Chief of Staff's escalations: `.stack/needs-you.json`. The CoS writes it; Stack only adds or clears `answer`.
 * @req FR:ask-queue/needs.@json
 */
import { checkBrief, type AskBrief } from './ask-brief';
import { ConflictError, NotFoundError, StorageError, type AuxFiles, type Storage } from './storage';

export const NEEDS_PATH = '.stack/needs-you.json';

/** `context`: the owner asked the agent for a brief. @req FR:ask-briefs/context.need */
export interface NeedAnswer { choice: 'go' | 'defer' | 'reply' | 'context'; text?: string; until?: string; at: string }
/** One escalation. @req FR:ask-queue/$need */
export interface Need {
  id: string; title: string; recommendation: string; default?: string; by?: string; link: string;
  project?: string; ref?: string; answer?: NeedAnswer;
  /** A decision item (PR priority recommendation): the UI shows `actions` and posts them to `decide`. @req FR:pr-priority/needs.list */
  kind?: 'decision'; actions?: string[]; decide?: string;
  /** The asking agent, the ask kind, and the brief. @req FR:ask-briefs/brief.needs */
  from?: string; askKind?: string; brief?: AskBrief;
}
export interface NeedAnswerInput { choice: 'go' | 'defer' | 'reply' | 'context' | 'undo'; text?: string; until?: string }

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined);
/** An https url or a repo-relative path; never a script or data url. */
const safeLink = (v: unknown): string | undefined => {
  const s = str(v, 500);
  if (!s) return undefined;
  if (/^https:\/\//i.test(s)) return s;
  // A repo path: no scheme, no leading slash or backslash (a browser reads `/\\host` as another site), no backslashes at all.
  return /^[a-z][a-z0-9+.-]*:/i.test(s) || /^[/\\]/.test(s) || s.includes('\\') ? undefined : s;
};

function parseAnswer(v: unknown): NeedAnswer | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const a = v as Record<string, unknown>;
  if (a.choice !== 'go' && a.choice !== 'defer' && a.choice !== 'reply' && a.choice !== 'context') return undefined;
  const at = str(a.at, 40);
  return at ? { choice: a.choice, at, ...(str(a.text, 2000) ? { text: str(a.text, 2000) } : {}), ...(str(a.until, 40) ? { until: str(a.until, 40) } : {}) } : undefined;
}

function parseItem(raw: unknown): Need | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && ID.test(r.id) ? r.id : undefined;
  const title = str(r.title, 200); const recommendation = str(r.recommendation, 300); const link = safeLink(r.link);
  if (!id || !title || !recommendation || !link) return undefined;
  const answer = parseAnswer(r.answer);
  // A brief that fails the check is left out; the item still shows. @req FR:ask-briefs/brief.needs
  const brief = r.brief === undefined ? undefined : checkBrief(r.brief).brief;
  return {
    id, title, recommendation, link,
    ...(str(r.default, 200) ? { default: str(r.default, 200) } : {}), ...(str(r.by, 40) ? { by: str(r.by, 40) } : {}),
    ...(str(r.project, 80) ? { project: str(r.project, 80) } : {}), ...(str(r.ref, 120) ? { ref: str(r.ref, 120) } : {}),
    ...(answer ? { answer } : {}), ...(brief ? { brief } : {}), ...(str(r.from, 80) ? { from: str(r.from, 80) } : {}),
    // The kind of ask (default approve): a go-do or answer item needs no brief. @req FR:ask-briefs/brief.needs
    ...(typeof r.askKind === 'string' && ['approve', 'decide', 'review', 'go-do', 'answer'].includes(r.askKind) ? { askKind: r.askKind } : {}),
  };
}

const aux = (s: Storage): AuxFiles | null => (typeof (s as Partial<AuxFiles>).readAux === 'function' && typeof (s as Partial<AuxFiles>).writeAux === 'function' ? s as unknown as AuxFiles : null);

/** The valid items in file order; no file or a broken file has none. @req FR:ask-queue/needs.read */
export async function readNeeds(storage: Storage): Promise<Need[]> {
  const a = aux(storage);
  const f = a ? await a.readAux(NEEDS_PATH).catch(() => null) : null;
  if (!f) return [];
  try {
    const list = (JSON.parse(f.content.replace(/^﻿/, '')) as { items?: unknown }).items;
    return Array.isArray(list) ? list.map(parseItem).filter((n): n is Need => !!n) : [];
  } catch { return []; }
}

/**
 * Records the owner's answer on one item (or clears it), keeping the rest of the file as written.
 * @req FR:ask-queue/needs.answer @req FR:ask-queue/needs.answer.missing
 */
export async function answerNeed(storage: Storage, id: string, input: NeedAnswerInput, now: Date): Promise<void> {
  // The CoS edits the same file: one lost race is retried on the fresh content, a second is a conflict.
  try { await answerOnce(storage, id, input, now); } catch (e) { if (!(e instanceof ConflictError)) throw e; await answerOnce(storage, id, input, now); }
}

async function answerOnce(storage: Storage, id: string, input: NeedAnswerInput, now: Date): Promise<void> {
  const a = aux(storage);
  const f = a ? await a.readAux(NEEDS_PATH) : null;
  if (!a || !f) throw new NotFoundError(`No needs-you file: ${id}`);
  let raw: { items?: unknown[] } & Record<string, unknown>;
  try { raw = JSON.parse(f.content.replace(/^﻿/, '')); } catch { throw new StorageError('needs-you.json is not valid JSON'); }
  const item = Array.isArray(raw.items) ? raw.items.find((x) => parseItem(x)?.id === id) as Record<string, unknown> | undefined : undefined;
  if (!item) throw new NotFoundError(`Unknown need: ${id}`);
  if (input.choice === 'undo') delete item.answer;
  else {
    if (input.choice === 'defer' && !(str(input.until, 40) && !Number.isNaN(Date.parse(input.until!)))) throw new StorageError('A deferred need needs a valid until time');
    if (input.choice === 'reply' && !str(input.text, 2000)) throw new StorageError('A reply needs text');
    item.answer = { choice: input.choice, at: now.toISOString(), ...(input.choice === 'reply' ? { text: str(input.text, 2000) } : {}), ...(input.choice === 'defer' ? { until: str(input.until, 40) } : {}) };
  }
  await a.writeAux(NEEDS_PATH, `${JSON.stringify(raw, null, 2)}\n`, { expectedVersion: f.version });
}
