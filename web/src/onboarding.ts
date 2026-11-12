/**
 * First-run setup, client side: read `/setup` on a local host, post a step, wait for the host after a restart.
 * Pure helpers; `Onboarding.tsx` draws them.
 * @req FR:first-run-onboarding/web.gate @req FR:first-run-onboarding/state.status
 */
export const STEP_IDS = ['repo', 'mode', 'calendar', 'email', 'phone'] as const;
export type StepId = (typeof STEP_IDS)[number];
export interface SetupStatus {
  needed: boolean; reason: 'no-repo' | 'empty' | 'resume' | 'broken' | null; step: StepId; steps: StepId[];
  repo: string | null; repoLock: string | null; modeLock: string | null; mode: 'demo' | 'live'; calendar: boolean; email: boolean; signIn: string; error?: string;
}
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Screen titles: short, plain, one per step. @req FR:first-run-onboarding/step.max */
export const TITLES: Record<StepId, string> = {
  repo: 'Where do your tasks live?',
  mode: 'Demo or live?',
  calendar: 'Add your calendar',
  email: 'Connect email',
  phone: 'Get pings on your iPhone',
};

/** The setup flow exists only on the local hosts (`stack web`, desktop). */
export const isLocalHost = (hostname: string): boolean => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const isStep = (s: unknown): s is StepId => typeof s === 'string' && (STEP_IDS as readonly string[]).includes(s);

/** A `/setup` reply, or null when it is not one (an html fallback, a 404 body, anything else). */
export function parseSetup(j: unknown): SetupStatus | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (typeof o.needed !== 'boolean' || !isStep(o.step)) return null;
  return {
    needed: o.needed, reason: (['no-repo', 'empty', 'resume', 'broken'] as const).find((r) => r === o.reason) ?? null, step: o.step,
    steps: Array.isArray(o.steps) && o.steps.every(isStep) ? o.steps : [...STEP_IDS],
    repo: typeof o.repo === 'string' ? o.repo : null, repoLock: typeof o.repoLock === 'string' ? o.repoLock : null, modeLock: typeof o.modeLock === 'string' ? o.modeLock : null, mode: o.mode === 'live' ? 'live' : 'demo',
    calendar: o.calendar === true, email: o.email === true, signIn: typeof o.signIn === 'string' ? o.signIn : '',
    ...(typeof o.error === 'string' && o.error ? { error: o.error } : {}),
  };
}

/**
 * The gate: a local host marks the page with `<meta name="stack-setup">` only while the flow is needed.
 * No tag, no request: a normal start pays nothing. @req FR:first-run-onboarding/web.gate
 */
export const wantsSetup = (doc: Pick<Document, 'querySelector'>, hostname: string): boolean => isLocalHost(hostname) && !!doc.querySelector('meta[name="stack-setup"]');

/**
 * The second gate signal: `/.auth/me` (network first in the service worker) says `setup: true`.
 * Catches a stale cached page that lacks the meta tag. @req FR:first-run-onboarding/web.gate
 */
export async function authSaysSetup(f: Fetch): Promise<boolean> {
  try { const j = (await (await f('/.auth/me', { credentials: 'same-origin' })).json()) as { setup?: unknown } | null; return j?.setup === true; } catch { return false; }
}

/** Reads `/setup`; null on any failure, so the app shows. @req FR:first-run-onboarding/web.gate */
export async function loadSetup(f: Fetch, timeoutMs = 3000): Promise<SetupStatus | null> {
  const ctl = typeof AbortController === 'undefined' ? undefined : new AbortController();
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : undefined;
  try {
    const r = await f('/setup', { credentials: 'same-origin', headers: { accept: 'application/json' }, ...(ctl ? { signal: ctl.signal } : {}) });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('application/json')) return null;
    return parseSetup(await r.json());
  } catch { return null; } finally { if (t) clearTimeout(t); }
}

export type PostResult = { ok: true; restart: boolean; status: SetupStatus | null } | { ok: false; error: string };

/** Posts one step. @req FR:first-run-onboarding/host.apply */
export async function postStep(f: Fetch, body: Record<string, unknown>): Promise<PostResult> {
  try {
    const r = await f('/setup', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => null)) as { restart?: boolean; status?: unknown; error?: { message?: string } } | null;
    if (!r.ok) return { ok: false, error: j?.error?.message ?? 'Could not save. Try again.' };
    return { ok: true, restart: j?.restart === true, status: parseSetup(j?.status) };
  } catch { return { ok: false, error: 'Stack is not answering. Is it still running?' }; }
}

/** After a restart: poll `/setup` until the host answers again (bounded). */
export async function waitForHost(f: Fetch, o: { tries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<SetupStatus | null> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  for (let i = 0; i < (o.tries ?? 60); i++) {
    await sleep(o.delayMs ?? 250);
    const s = await loadSetup(f, 1500);
    if (s) return s;
  }
  return null;
}

/** `Step 2 of 5`. */
export const stepLine = (step: StepId, steps: readonly StepId[] = STEP_IDS): string => `Step ${Math.max(0, steps.indexOf(step)) + 1} of ${steps.length}`;
/** The step before, for Back; null on the first. */
export const prevStep = (step: StepId, steps: readonly StepId[] = STEP_IDS): StepId | null => { const i = steps.indexOf(step); return i > 0 ? steps[i - 1] : null; };
/** Client-side check before posting a calendar link (the host checks again). */
export const icsOk = (s: string): boolean => { try { const u = new URL(s.trim()); return (u.protocol === 'https:' || u.protocol === 'webcal:') && !!u.hostname; } catch { return false; } };
