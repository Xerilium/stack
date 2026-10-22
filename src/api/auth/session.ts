/**
 * Static Web Apps session: parse the `x-ms-client-principal` header and match it to the owner allow-list.
 * @req FR:auth-security/session.@function
 */

export interface Principal { provider: string; userId: string; userDetails: string; roles: string[] }
export interface Owner { provider: string; userId: string }

const MAX_HEADER = 8 * 1024;
const MAX_FIELD = 512;
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Never throws; any malformed input is `null`. @req FR:auth-security/session.parse @req FR:auth-security/session.parse.roles */
export function parseClientPrincipal(header: string | null | undefined): Principal | null {
  try {
    if (typeof header !== 'string' || header === '' || header.length > MAX_HEADER || !BASE64.test(header)) return null;
    const v: unknown = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const { identityProvider: provider, userId, userDetails, userRoles } = o;
    const text = (s: unknown): s is string => typeof s === 'string' && s.length <= MAX_FIELD;
    if (!text(provider) || provider === '' || !text(userId) || userId === '') return null;
    if (userDetails !== undefined && !text(userDetails)) return null;
    if (!Array.isArray(userRoles) || userRoles.length > 50 || !userRoles.every(text)) return null;
    if (!userRoles.includes('authenticated')) return null;
    return { provider, userId, userDetails: userDetails ?? '', roles: userRoles };
  } catch {
    return null;
  }
}

/** `provider:userId` entries, comma-separated; malformed entries are dropped. @req FR:auth-security/session.input */
export function parseOwners(setting: string | null | undefined): Owner[] {
  if (typeof setting !== 'string') return [];
  const out: Owner[] = [];
  for (const raw of setting.split(',')) {
    const entry = raw.trim();
    const i = entry.indexOf(':');
    if (i <= 0 || i === entry.length - 1) continue;
    out.push({ provider: entry.slice(0, i).toLowerCase(), userId: entry.slice(i + 1) });
  }
  return out;
}

/** Provider is case-insensitive, user id exact; `userDetails` is never consulted. @req FR:auth-security/session.allow @req FR:auth-security/session.allow.empty @req FR:auth-security/session.allow.details */
export function isOwner(p: Principal, owners: Owner[]): boolean {
  return owners.some((o) => o.provider === p.provider.toLowerCase() && o.userId === p.userId);
}
