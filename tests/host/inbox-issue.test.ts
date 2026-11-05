import { writeInbox, ghIssueFiler, type InboxItem, type IssueFiler } from '../../src/inbox';
import { setup } from './helpers';

const item: InboxItem = { id: 'mail-abcdef012345', source: 'email', account: 'a', from: 'Alex', subject: 'Private subject', receivedAt: '2026-10-28T13:00:00Z', unread: true, summary: 'Private body', suggested: 'unsubscribe', actions: ['unsubscribe'], kind: 'newsletter' };
const post = (h: Awaited<ReturnType<typeof setup>>) => h.owner('/api/inbox-items/mail-abcdef012345/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'archive', request: true }) });

// @req FR:inbox-page/wire.issue
describe('host issue filer', () => {
  it('files a help wanted issue through the injected filer, without message text', async () => {
    const file = jest.fn(async (i: Parameters<IssueFiler['file']>[0]) => ({ url: i.repo ? 'https://github.com/Xerilium/stack/issues/9' : '' }));
    const h = await setup(undefined, { issues: { file } });
    await writeInbox(h.storage, [item]);
    const r = await post(h);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ via: 'issue', url: 'https://github.com/Xerilium/stack/issues/9' });
    const arg = file.mock.calls[0][0];
    expect(arg).toMatchObject({ repo: 'Xerilium/stack', labels: ['help wanted'] });
    expect(JSON.stringify(arg)).not.toContain('Private');
  });
  it('falls back to a task when filing fails', async () => {
    const h = await setup(undefined, { issues: { file: async () => { throw new Error('gh missing'); } } });
    await writeInbox(h.storage, [item]);
    await h.storage.write('tasks/stack.md', '# Stack\n\n## 🔄 Active\n\n- [ ] Existing\n');
    expect(await (await post(h)).json()).toEqual({ via: 'task' });
    expect((await h.storage.read('tasks/stack.md')).content).toContain('Inbox action: Archive');
  });
  it('default filer is gh with fixed args', async () => {
    const run = jest.fn(async () => 'https://github.com/Xerilium/stack/issues/3\n');
    const r = await ghIssueFiler(run).file({ repo: 'Xerilium/stack', title: 'T', body: 'B', labels: ['help wanted'] });
    expect(r.url).toBe('https://github.com/Xerilium/stack/issues/3');
    expect(run).toHaveBeenCalledWith(['issue', 'create', '--repo', 'Xerilium/stack', '--title', 'T', '--body', 'B', '--label', 'help wanted']);
  });
});
