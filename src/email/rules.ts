/**
 * Deterministic prefilter: settles most mail before any model sees it. Rules are plain data.
 * @req FR:email-triage/rules.order @req FR:email-triage/rules.vip
 */
import type { Message } from './types';

/** JSON-serializable rules. Address lists take `user@host` (exact) or a domain (that domain and its subdomains); patterns are case-insensitive regex sources. */
export interface RulesConfig {
  /** The mailbox owner's addresses. */
  owner: string[];
  vip: string[];
  /** Denylist: never sent to a model. */
  sensitive: string[];
  /** Regexes tested on the sender address. */
  sensitivePatterns: string[];
  receiptSenderPatterns: string[];
  receiptSubjectPatterns: string[];
}

export type SettledClass = 'skip' | 'calendar' | 'sensitive' | 'newsletter' | 'receipt';
/** `class: null` means a VIP the rules left for the model; `vip` floors its urgency. */
export interface PrefilterResult { class: SettledClass | null; rule: string; vip?: true }

export const DEFAULT_RULES: RulesConfig = {
  owner: [],
  vip: [],
  sensitive: [],
  sensitivePatterns: ['\\b(bank|payroll|legal|law|attorney|medical|clinic|health|hr)\\b'],
  receiptSenderPatterns: ['^(no-?reply|do-?not-?reply|notifications?|alerts?|receipts?|billing|invoices?|orders?|statements?)@'],
  receiptSubjectPatterns: ['\\b(receipt|invoice|statement|order confirmation|your order|payment (received|confirmation)|shipped|security alert)\\b'],
};

const norm = (s: string) => s.trim().toLowerCase();
function inList(address: string | undefined, list: string[]): boolean {
  const a = norm(address ?? '');
  if (!a) return false;
  const domain = a.slice(a.lastIndexOf('@') + 1);
  return list.some((raw) => {
    const e = norm(raw).replace(/^@/, '');
    return e.includes('@') ? a === e : domain === e || domain.endsWith(`.${e}`);
  });
}
const anyMatch = (patterns: string[], text: string) => patterns.some((p) => new RegExp(p, 'i').test(text));

function bulk(m: Message): boolean {
  const h = new Map(Object.entries(m.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).trim().toLowerCase()]));
  return h.has('list-unsubscribe') || h.has('list-id') || /^(bulk|list)\b/.test(h.get('precedence') ?? '') || /^auto-/.test(h.get('auto-submitted') ?? '');
}

/** First match wins: skip, calendar, sensitive, (VIP passes to the model), newsletter, receipt; otherwise null. */
export function prefilter(m: Message, config: RulesConfig): PrefilterResult | null {
  const vip = inList(m.from.address, config.vip) ? (true as const) : undefined;
  const hit = (cls: SettledClass, rule: string): PrefilterResult => ({ class: cls, rule, ...(vip ? { vip } : {}) });
  if (inList(m.from.address, config.owner) || inList(m.threadLastFrom, config.owner)) return hit('skip', 'owner-answered');
  if (/eventMessage/i.test(m.odataType ?? '')) return hit('calendar', 'calendar');
  if (inList(m.from.address, config.sensitive) || anyMatch(config.sensitivePatterns, m.from.address)) return hit('sensitive', 'sensitive-sender');
  if (vip) return { class: null, rule: 'vip', vip };
  if (bulk(m)) return hit('newsletter', 'bulk-headers');
  if ((anyMatch(config.receiptSenderPatterns, m.from.address) || anyMatch(config.receiptSubjectPatterns, m.subject)) && !m.bodyPreview.includes('?')) return hit('receipt', 'receipt');
  return null;
}
