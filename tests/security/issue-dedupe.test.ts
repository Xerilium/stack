import { ghIssueFiler } from '../../src/inbox';

describe('request-action issue filer (L3)', () => {
  const issue = { repo: 'Xerilium/stack', title: 'Inbox action: Archive', body: 'b', labels: ['help wanted'] };
  it('reuses an open issue with the same title', async () => {
    const run = jest.fn(async (args: string[]) => (args[1] === 'list' ? JSON.stringify([{ title: 'Inbox action: Archive', url: 'https://github.com/Xerilium/stack/issues/9' }]) : 'never'));
    expect(await ghIssueFiler(run).file(issue)).toEqual({ url: 'https://github.com/Xerilium/stack/issues/9' });
    expect(run.mock.calls.some((c) => c[0][1] === 'create')).toBe(false);
  });
  it('files a new one when none matches', async () => {
    const run = jest.fn(async (args: string[]) => (args[1] === 'list' ? '[]' : 'https://github.com/Xerilium/stack/issues/10\n'));
    expect(await ghIssueFiler(run).file(issue)).toEqual({ url: 'https://github.com/Xerilium/stack/issues/10' });
  });
  it('a failed lookup still files', async () => {
    const run = jest.fn(async (args: string[]) => { if (args[1] === 'list') throw new Error('x'); return 'https://github.com/Xerilium/stack/issues/11'; });
    expect((await ghIssueFiler(run).file(issue)).url).toMatch(/11$/);
  });
});
