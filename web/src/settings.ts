/**
 * Settings, the pure part: which section a hash opens, account badges for the calendar, and the agents delivery words.
 * @req FR:settings/view.route @req FR:settings/agents.state @req FR:settings/agents.off @req FR:connect-accounts/web.label
 */

export type SettingsSection = 'accounts' | 'agents' | 'updates';
const SECTIONS: readonly SettingsSection[] = ['accounts', 'agents', 'updates'];

/** The section `#/settings/<section>` names, or null. @req FR:settings/view.route */
export function settingsSection(hash: string): SettingsSection | null {
  const m = /^#\/settings\/([a-z]+)/.exec(hash);
  return m && (SECTIONS as readonly string[]).includes(m[1]) ? (m[1] as SettingsSection) : null;
}

/** Six tones, defined in settings.css for light and dark. */
const TONES = 6;
/** The calendar badge for an account: its first letter and a tone fixed by the address. @req FR:connect-accounts/web.label */
export function accountBadge(account: string): { letter: string; tone: string } {
  const a = account.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  return { letter: (a.match(/[a-z0-9]/)?.[0] ?? '?').toUpperCase(), tone: `t${h % TONES}` };
}

/** Badges show only when the events come from more than one account. @req FR:connect-accounts/web.label */
export const multiAccount = (events: { account?: string }[]): boolean => new Set(events.map((e) => e.account?.toLowerCase()).filter(Boolean)).size > 1;

/** `GET /inbox/delivery` with no ref. @req FR:settings/agents.api */
export interface DeliverySummary { mode: 'claude' | 'off'; login: 'ok' | 'expired' | 'unknown' }

/** The agents row in plain words. @req FR:settings/agents.state @req FR:settings/agents.off */
export function agentsLines(s: DeliverySummary): { delivery: string; login: string; signIn: boolean; note: string | null } {
  return {
    delivery: s.mode === 'claude' ? 'On' : 'Off',
    login: s.login === 'ok' ? 'Signed in' : s.login === 'expired' ? 'Sign-in expired' : 'Unknown',
    signIn: s.login !== 'ok',
    note: s.mode === 'off' ? 'Turn it on in Stack settings on your Mac.' : null,
  };
}
