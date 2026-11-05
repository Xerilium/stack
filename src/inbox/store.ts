/** Inbox items persisted as one JSON file in the owner's data repo. Written by the email and chat runners. @req FR:inbox-page/api.read */
import type { AuxFiles, Storage } from '../core/storage';
import { ACTION_IDS, type InboxItem } from './types';

export const INBOX_PATH = '.stack/inbox-items.json';
const SOURCES = ['email', 'teams', 'slack'];
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Keeps only well formed items; a bad file reads as empty rather than failing the page. */
export function parseItems(raw: unknown): InboxItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InboxItem[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || !SOURCES.includes(r.source as string) || !ACTION_IDS.includes(r.suggested as never) || !/^(mail|chat)-[0-9a-f]{12}$/.test(s(r.id, 40))) continue;
    const link = s(r.link, 2000);
    out.push({
      id: s(r.id, 40), source: r.source as InboxItem['source'], account: s(r.account, 200), from: s(r.from, 120), subject: s(r.subject, 300), receivedAt: s(r.receivedAt, 40),
      unread: r.unread !== false, urgency: typeof r.urgency === 'number' ? r.urgency : 0, summary: s(r.summary, 400), suggested: r.suggested as InboxItem['suggested'],
      actions: Array.isArray(r.actions) ? (r.actions.filter((a) => ACTION_IDS.includes(a as never)) as InboxItem['actions']) : [], ...(/^https:\/\/\S+$/.test(link) ? { link } : {}),
      ...(s(r.messageId, 512) ? { messageId: s(r.messageId, 512) } : {}), ...(s(r.kind, 40) ? { kind: s(r.kind, 40) } : {}),
    });
  }
  return out;
}

const aux = (s: Storage): AuxFiles | null => (typeof (s as Partial<AuxFiles>).readAux === 'function' && typeof (s as Partial<AuxFiles>).writeAux === 'function' ? (s as unknown as AuxFiles) : null);

/** Reads the items; a host without aux files, a missing file or a bad file reads as empty. */
export async function readInbox(st: Storage): Promise<InboxItem[]> {
  const a = aux(st);
  const f = a ? await a.readAux(INBOX_PATH).catch(() => null) : null;
  if (!f) return [];
  try { return parseItems(JSON.parse(f.content)); } catch { return []; }
}
export async function writeInbox(st: Storage, items: InboxItem[]): Promise<void> {
  const a = aux(st);
  if (!a) throw new Error('This host cannot store inbox items');
  const f = await a.readAux(INBOX_PATH).catch(() => null);
  await a.writeAux(INBOX_PATH, `${JSON.stringify(items, null, 2)}\n`, { expectedVersion: f?.version ?? null });
}
