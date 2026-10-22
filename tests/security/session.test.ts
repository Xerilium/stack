import { isOwner, parseClientPrincipal, parseOwners } from '../../src/api/auth';
import { principal } from './helpers';

const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64');

// @req FR:auth-security/session.parse
describe('parseClientPrincipal', () => {
  it('parses a valid principal', () => {
    expect(parseClientPrincipal(principal())).toEqual({ provider: 'github', userId: 'owner-1', userDetails: 'octocat', roles: ['anonymous', 'authenticated'] });
  });
  it('returns null and never throws for bad input', () => {
    const bad: unknown[] = [
      undefined, null, '', '!!!not base64!!!', b64('not json'), b64('[]'), b64('null'), b64('"s"'), b64('1'),
      b64({}), b64({ identityProvider: 1, userId: 'x', userRoles: ['authenticated'] }),
      b64({ identityProvider: 'github', userId: 5, userRoles: ['authenticated'] }),
      b64({ identityProvider: 'github', userId: '', userRoles: ['authenticated'] }),
      b64({ identityProvider: 'github', userId: 'x', userRoles: 'authenticated' }),
      b64({ identityProvider: 'github', userId: 'x', userRoles: [1, 'authenticated'] }),
      'a'.repeat(9000), b64({ identityProvider: 'github', userId: 'x'.repeat(9000), userRoles: ['authenticated'] }),
    ];
    for (const h of bad) expect(parseClientPrincipal(h as string)).toBeNull();
  });
  // @req FR:auth-security/session.parse.roles
  it('requires the authenticated role', () => {
    expect(parseClientPrincipal(principal({ userRoles: ['anonymous'] }))).toBeNull();
    expect(parseClientPrincipal(principal({ userRoles: [] }))).toBeNull();
  });
});

// @req FR:auth-security/session.allow
describe('owner allow-list', () => {
  const owners = parseOwners('GitHub:owner-1, aad:abc');
  const p = (over = {}) => parseClientPrincipal(principal(over))!;
  it('matches provider (case-insensitive) and exact user id', () => {
    expect(isOwner(p(), owners)).toBe(true);
    expect(isOwner(p({ identityProvider: 'AAD', userId: 'abc' }), owners)).toBe(true);
    expect(isOwner(p({ userId: 'Owner-1' }), owners)).toBe(false);
    expect(isOwner(p({ userId: 'owner-1 ' }), owners)).toBe(false);
    expect(isOwner(p({ identityProvider: 'twitter' }), owners)).toBe(false);
    expect(isOwner(p({ userId: 'owner-2' }), owners)).toBe(false);
  });
  // @req FR:auth-security/session.allow.empty
  it('denies everyone when the list is empty or malformed', () => {
    for (const s of [undefined, '', '  ', ',', 'owner-1', ':x', 'github:']) expect(isOwner(p(), parseOwners(s))).toBe(false);
  });
  // @req FR:auth-security/session.allow.details
  it('never matches on userDetails', () => {
    expect(isOwner(p({ userId: 'someone-else', userDetails: 'owner-1' }), owners)).toBe(false);
    expect(isOwner(p({ userId: 'someone-else', userDetails: 'github:owner-1' }), owners)).toBe(false);
  });
});
