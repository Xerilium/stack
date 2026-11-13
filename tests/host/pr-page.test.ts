import { ENV, setup } from './helpers';

// @req FR:pr-page/api.get @req FR:pr-page/icon.absent @req FR:github-pr-status/wire.token
describe('Azure host PR board', () => {
  it('no GITHUB_TOKEN: {off: true}', async () => {
    const { owner } = await setup({ ...ENV, GITHUB_TOKEN: undefined });
    const res = await owner('/api/prs');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ off: true });
  });
  it('with a token: the board, WIP label for agents, no token in the answer', async () => {
    const calls: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: { a: { nodes: [] }, b: { nodes: [] }, c: { nodes: [] } } }), { status: 200 });
    }) as typeof globalThis.fetch;
    const { owner } = await setup({ ...ENV, GITHUB_TOKEN: 'ghp_board_token', STACK_GITHUB_REPOS: 'acme' }, { fetch });
    const res = await owner('/api/prs');
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ agents: { source: 'wip-label' }, rows: [] });
    expect(text).not.toContain('ghp_board_token');
    expect(calls.every((u) => u.startsWith('https://api.github.com/'))).toBe(true);
  });
});
