import * as fs from 'fs';
import * as path from 'path';
import { assertSafeScopes, scopesFor as signInScopes } from '../../src/graph/auth';
import { createGraphGuard, GRAPH_BASE, GraphDenied, MOVE_TARGETS, type WriteMode } from '../../src/email/guard';
import { createGraphActions } from '../../src/email/graph-mail';

const G = GRAPH_BASE;
const MODES: WriteMode[] = ['observe', 'categories', 'drafts'];
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
// Built from parts so this file never contains the literal it forbids.
const SEND_SCOPE = 'Mail.' + 'Send';

// @req FR:email-runner/cli.nosend
describe('no code path sends mail', () => {
  it('no source file under src names the send scope', () => {
    const root = path.join(__dirname, '../../src');
    const files = walk(root);
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect([f, fs.readFileSync(f, 'utf8').toLowerCase().includes(SEND_SCOPE.toLowerCase())]).toEqual([f, false]);
  });

  it('only the guard deny list names send, forward or reply-all paths; no source calls them', () => {
    const root = path.join(__dirname, '../../src');
    const bad = /\/(sendmail|send|forward|createforward|replyall|createreplyall)\b|\.sendMail\(|\.forward\(|\.replyAll\(/i;
    for (const f of walk(root)) {
      if (f.endsWith(path.join('email', 'guard.ts'))) continue;
      const code = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l));
      expect([f, code.filter((l) => bad.test(l))]).toEqual([f, []]);
    }
  });

  it('sign-in refuses the send scope in every spelling, and never offers it', () => {
    for (const s of [SEND_SCOPE, SEND_SCOPE.toLowerCase(), SEND_SCOPE.toUpperCase(), `https://graph.microsoft.com/${SEND_SCOPE}`, `${SEND_SCOPE}.Shared`, 'Mail.Send.Shared'.toLowerCase()]) {
      expect(() => assertSafeScopes(['Mail.Read', s])).toThrow(/unsafe_scope/);
    }
    for (const f of ['send', 'sendmail', 'mail.send'] as never[]) expect(() => signInScopes([f])).toThrow();
    expect(signInScopes(['mail', 'drafts', 'calendar'] as never[]).join(' ').toLowerCase()).not.toContain('send');
  });

  const FORMS = ['sendMail', 'send', 'forward', 'createForward', 'reply', 'replyAll', 'createReplyAll', 'SENDMAIL', 'ReplyAll', 'createreplyall'];
  it.each(MODES)('%s mode refuses every send, forward and reply form under every owner path', (mode) => {
    const guard = createGraphGuard({ mode, approvedMoves: new Map([['AAMk1', 'archive']]) });
    for (const method of ['POST', 'PUT', 'PATCH', 'GET', 'DELETE']) {
      for (const form of FORMS) {
        for (const p of [`/me/${form}`, `/me/messages/AAMk1/${form}`, `/me/mailFolders/inbox/messages/AAMk1/${form}`, `/users/x@example.test/${form}`, `/me/messages/AAMk1/${form}?$select=id`, `/me/messages/AAMk1/${encodeURIComponent(form)}`]) {
          expect(() => guard.check({ method, url: `${G}${p}`, body: { comment: 'x' } })).toThrow(GraphDenied);
        }
      }
    }
  });

  it('a move can only target Archive or Junk, and only for an approved id', () => {
    expect([...MOVE_TARGETS]).toEqual(['archive', 'junkemail']);
    const guard = createGraphGuard({ approvedMoves: new Map([['AAMk1', 'archive']]) });
    const move = (id: string, destinationId: unknown) => () => guard.check({ method: 'POST', url: `${G}/me/messages/${id}/move`, body: { destinationId } });
    expect(move('AAMk1', 'archive')).not.toThrow();
    for (const [id, dest] of [['AAMk1', 'inbox'], ['AAMk1', 'sentitems'], ['AAMk1', 'drafts'], ['AAMk2', 'archive'], ['AAMk1', 5]] as const) expect(move(id, dest)).toThrow(GraphDenied);
  });

  it('the mailbox actions object exposes no send, forward or reply method', () => {
    const actions = createGraphActions({ transport: async () => ({}), approvedMoves: new Map() });
    expect(Object.keys(actions).filter((k) => /send|forward|reply/i.test(k))).toEqual([]);
  });
});
