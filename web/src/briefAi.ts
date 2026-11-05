/**
 * AI daily brief rows: the server's lines joined to open asks, with one-tap labels. Pure.
 * @req FR:cos-view/brief.ai.web
 */
import type { AskItem, Send } from './asks';

export type AiAction = 'go' | 'no' | 'done' | 'none';
export interface AiSummary { configured: boolean; date?: string; headline?: string; lines?: { key: string; text: string; action: AiAction }[]; cached?: boolean; error?: string }
export interface AiRow { key: string; text: string; ask: AskItem; label?: string; send?: Send; sent?: string }
export interface AiView { headline: string; rows: AiRow[] }

const TAP: Record<Exclude<AiAction, 'none'>, { label: string; sent: string }> = { go: { label: 'Approve', sent: 'Approved' }, no: { label: 'Reject', sent: 'Rejected' }, done: { label: 'Done', sent: 'Marked done' } };

/** Null (section hidden) when the summary is off or failed; lines whose ask is no longer open are dropped. */
export function aiRows(s: AiSummary | null, open: AskItem[]): AiView | null {
  if (!s || !s.configured || s.error || !s.headline) return null;
  const rows: AiRow[] = [];
  for (const l of s.lines ?? []) {
    const ask = open.find((a) => a.key === l.key && a.state === 'open');
    if (!ask) continue;
    const t = l.action === 'none' ? undefined : TAP[l.action];
    rows.push({ key: l.key, text: l.text, ask, ...(t ? { label: t.label, send: { answer: l.action as 'go' | 'no' | 'done' }, sent: t.sent } : {}) });
  }
  return { headline: s.headline, rows };
}
