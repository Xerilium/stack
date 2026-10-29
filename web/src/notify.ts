import { deadline, type AskItem } from './asks';

/** Opt-in notifications for new asks. Pure helpers plus a thin browser layer. @req FR:pwa/notify.optin @req FR:pwa/notify.new @req FR:pwa/notify.quiet @req FR:pwa/notify.none */
export const NOTIFY_KEY = 'stack.notify';
export const TAG = 'stack-asks';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const loadNotify = (s: Store | undefined): boolean => { try { return s?.getItem(NOTIFY_KEY) === 'on'; } catch { return false; } };
export function saveNotify(s: Store | undefined, on: boolean): void {
  try { if (on) s?.setItem(NOTIFY_KEY, 'on'); else s?.removeItem(NOTIFY_KEY); } catch { /* storage is a convenience */ }
}

/** Night hours (21:00-07:59) mute everything except crit asks or ones due within 2 h. */
export const quiet = (now: Date) => now.getHours() >= 21 || now.getHours() < 8;
const urgent = (a: Pick<AskItem, 'priority' | 'by'>, now: Date) => a.priority === 'crit' || (!!a.by && new Date(a.by).getTime() - now.getTime() <= 2 * 3600_000);

export interface Note { title: string; body: string; tag: string }

/** What to show for asks that just appeared; null when nothing should be raised. */
export function noteFor(added: Pick<AskItem, 'ask' | 'project' | 'by' | 'priority'>[], now: Date): Note | null {
  const show = quiet(now) ? added.filter((a) => urgent(a, now)) : added;
  if (show.length === 0) return null;
  const top = show[0];
  if (show.length > 1) return { title: `${show.length} new asks`, body: top.ask, tag: TAG };
  const due = deadline(top.by, now);
  return { title: top.ask, body: [top.project, due ? `${due.label} · ${due.rel}` : ''].filter(Boolean).join(' · ') || 'New ask', tag: TAG };
}

/** Notifications need both the Notifications API and service workers (a page-only Notification is not reliable on phones). */
export const notifySupported = (w: Partial<Window> & { navigator?: Partial<Navigator> } = globalThis as never): boolean =>
  typeof w === 'object' && 'Notification' in w && !!w.navigator && 'serviceWorker' in w.navigator;

/** Raises the note through the service worker. @req FR:pwa/notify.new */
export async function raise(note: Note): Promise<void> {
  if (!notifySupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) await reg.showNotification(note.title, { body: note.body, tag: note.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: '/#/asks' } });
}
