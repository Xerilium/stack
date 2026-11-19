/**
 * Reply drafts on this machine: one JSON file per mailbox in the owner's data directory, readable by the owner only.
 * Keyed by inbox item id. Never in the repository.
 * @req FR:email-send/draft.store @req FR:email-send/draft.store.mode @req FR:email-send/draft.store.keep @req FR:email-send/$draft
 */
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { writeAtomic } from '../core/file-lock';
import { DRAFT_MARKER } from './draft';
import { mailKey } from './to-ask';
import type { TriageResult } from './types';
import { voicePath } from './voice';

export interface StoredDraft { /** The Graph message the reply answers. */ messageId: string; text: string; /** ISO time. */ at: string; /** Outlook link of the mailbox draft, when there is one. */ link?: string }
export const MAX_DRAFTS = 500;
export const DRAFT_CHARS = 20_000;
export const draftsPath = (account: string, base?: string): string => join(dirname(voicePath(account, base)), 'drafts.json');

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
/** The stored drafts; a missing or bad file reads as none. */
export function readDrafts(path: string): Record<string, StoredDraft> {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
  const out: Record<string, StoredDraft> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    if (!/^mail-[0-9a-f]{12}$/.test(k) || !v || typeof v !== 'object' || !str(v.messageId, 512) || typeof v.text !== 'string') continue;
    const link = str(v.link, 2000);
    out[k] = { messageId: str(v.messageId, 512), text: str(v.text, DRAFT_CHARS), at: str(v.at, 40), ...(/^https:\/\/\S+$/.test(link) ? { link } : {}) };
  }
  return out;
}
/** Atomic write, mode 0600, in a 0700 directory; the newest `MAX_DRAFTS` stay. @req FR:email-send/draft.store.mode */
function writeDrafts(path: string, d: Record<string, StoredDraft>): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const kept = Object.fromEntries(Object.entries(d).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_DRAFTS));
  writeAtomic(path, `${JSON.stringify(kept)}\n`);
}
export function putDraft(path: string, key: string, d: StoredDraft): void { writeDrafts(path, { ...readDrafts(path), [key]: { ...d, text: d.text.slice(0, DRAFT_CHARS) } }); }
export function removeDraft(path: string, key: string): void {
  const all = readDrafts(path);
  if (!(key in all)) return;
  delete all[key];
  writeDrafts(path, all);
}
/** Stores each new draft of a pass without its marker. A reused draft is left alone: it may hold the owner's edits. @req FR:email-send/draft.store @req FR:email-send/draft.store.keep */
export function saveDrafts(path: string, results: TriageResult[], now: Date): number {
  const fresh = results.filter((r) => r.draft && !r.draft.reused);
  if (!fresh.length) return 0;
  const all = readDrafts(path);
  for (const r of fresh) all[mailKey(r.message.conversationId)] = { messageId: r.message.id, text: r.draft!.text.split(DRAFT_MARKER).join('').trim().slice(0, DRAFT_CHARS), at: now.toISOString(), ...(r.draft!.webLink ? { link: r.draft!.webLink } : {}) };
  writeDrafts(path, all);
  return fresh.length;
}
