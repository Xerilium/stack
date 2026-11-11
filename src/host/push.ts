/**
 * Host push wiring: VAPID config from env, the due check, and the `/api/push/check` route.
 * @req FR:iphone-access/check.@http
 */
import { ApiError, errorResponse, json, toApiError } from '../api/errors';
import { readBody, validate } from '../api/validate';
import type { Authorize } from '../api/handler';
import type { DeviceService, TokenStore } from '../api/auth';
import { createPushLedger, createPushNotifier, type DueAsk, type PushCounts, type QuietHours } from '../api/push';
import { createWebPushSender, PushConfigError, type PushTransport } from './push-sender';

export interface PushEnv { STACK_VAPID_PUBLIC_KEY?: string; STACK_VAPID_PRIVATE_KEY?: string; STACK_VAPID_SUBJECT?: string; STACK_PUSH_QUIET?: string }

/** Per-device dedupe ledger in the private data repo. @req FR:iphone-access/notify.dedupe.store */
export const PUSH_LEDGER_PATH = '.stack/push-sent.json';

const QUIET = /^(\d{1,2})-(\d{1,2})$/;

/** Quiet hours from `STACK_PUSH_QUIET` (`21-8` default, `off` for none) in the config time zone. @req FR:iphone-access/notify.quiet */
export function quietFrom(raw: string | undefined, timeZone: string): QuietHours | undefined | null {
  const v = (raw ?? '21-8').trim();
  if (v === 'off') return undefined;
  const m = QUIET.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 23 || m[1] === m[2]) return null;
  return { start: Number(m[1]), end: Number(m[2]), timeZone };
}

/**
 * Builds the check when all three VAPID values are set and valid; otherwise push stays off.
 * Logs name the setting, never a value. @req FR:iphone-access/check.config @req FR:iphone-access/check.read
 */
export function createPushCheck(o: {
  env: PushEnv; timeZone: string; devices: DeviceService; ledgerStore: TokenStore;
  /** Open asks as the api lists them. */
  asks: () => Promise<DueAsk[]>;
  transport?: PushTransport; log: (line: string) => void;
}): (() => Promise<PushCounts>) | null {
  const pub = o.env.STACK_VAPID_PUBLIC_KEY?.trim();
  const priv = o.env.STACK_VAPID_PRIVATE_KEY?.trim();
  const subject = o.env.STACK_VAPID_SUBJECT?.trim();
  if (!pub || !priv || !subject) return null;
  let sender;
  try { sender = createWebPushSender({ vapid: { publicKey: pub, privateKey: priv, subject }, transport: o.transport }); } catch (e) {
    o.log(e instanceof PushConfigError ? 'host: STACK_VAPID_* invalid' : 'host: push setup failed');
    return null;
  }
  const quiet = quietFrom(o.env.STACK_PUSH_QUIET, o.timeZone);
  if (quiet === null) { o.log('host: STACK_PUSH_QUIET invalid'); return null; }
  const notifier = createPushNotifier({ devices: o.devices, sender, quiet, ledger: createPushLedger(o.ledgerStore), onEvent: (c) => o.log(JSON.stringify({ kind: 'push', ...c })) });
  return async () => notifier.notify(await o.asks());
}

const ROUTE = { name: 'push.check', method: 'POST', write: true };
const ASK_WRITE = /^\/asks\/[^/]+$/;

/**
 * Serves `POST <base>/push/check` and runs the check after each ask write.
 * @req FR:iphone-access/check.@http @req FR:iphone-access/check.asks
 */
export function withPush(next: (req: Request) => Promise<Response>, o: { authorize: Authorize; check: (() => Promise<PushCounts>) | null; onError: (e: unknown) => void; basePath?: string }) {
  const base = (o.basePath ?? '/api').replace(/\/+$/, '');
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    const method = req.method.toUpperCase();
    if (path === `${base}/push/check`) {
      try {
        if (method !== 'POST') throw new ApiError('method_not_allowed', 'Method not allowed', undefined, { allow: 'POST' });
        const d = await o.authorize(req, ROUTE);
        const allowed = typeof d === 'boolean' ? d : d.allow;
        if (!allowed) {
          const status = typeof d === 'object' && d.status === 401 ? 401 : 403;
          throw new ApiError(status === 401 ? 'unauthorized' : 'forbidden', status === 401 ? 'Authentication required' : 'Forbidden');
        }
        if (!o.check) throw new ApiError('not_found', 'Push is not configured');
        validate(await readBody(req), {});
        return json(200, await o.check());
      } catch (e) {
        return errorResponse(toApiError(e));
      }
    }
    const res = await next(req);
    if (o.check && method === 'POST' && res.status < 300 && path.startsWith(base) && ASK_WRITE.test(path.slice(base.length))) {
      // A failed check never changes the ask write's answer.
      try { await o.check(); } catch (e) { o.onError(e); }
    }
    return res;
  };
}
