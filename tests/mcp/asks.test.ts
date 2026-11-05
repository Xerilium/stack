/** @req FR:mcp-server/tools.asks */
import { setup } from './helpers';

const put = { key: 'pr-1', ask: 'Approve PR 1', kind: 'approve', from: 'allyte-cos' };

describe('asks tools', () => {
  it('shows ask tools by scope; no answer tool', async () => {
    const { rpc, mint } = await setup();
    const names = async (...s: any[]) => (await rpc(await mint(...s), 'tools/list')).json.result.tools.map((x: any) => x.name).filter((n: string) => n.startsWith('asks'));
    expect(await names('tasks:read')).toEqual(['asks_list', 'asks_answer_wait']);
    expect(await names('tasks:write')).toEqual(['asks_put', 'asks_handle']);
    expect(await names('read', 'write')).toEqual(['asks_put', 'asks_list', 'asks_handle', 'asks_answer_wait']);
  });
  it('puts, lists, and handles', async () => {
    const { text, mint, api } = await setup();
    const t = await mint('read', 'write');
    expect(await text(t, 'asks_put', { ...put, options: 'A|B', recommend: 'A', kind: 'decide' })).toBe('created pr-1');
    expect(await text(t, 'asks_put', { ...put, kind: 'decide', options: 'A|B' })).toBe('updated pr-1');
    const l = JSON.parse(await text(t, 'asks_list'));
    expect(l.items[0]).toMatchObject({ key: 'pr-1', ask: 'Approve PR 1', from: 'allyte-cos' });
    // owner answers through the api (agents cannot)
    expect(await text(t, 'asks_put', { key: 'x', from: 'a' })).toMatch(/^error invalid/);
    void api;
    expect(await text(t, 'asks_handle', { key: 'pr-1', outcome: 'resolved' })).toBe('handled pr-1');
    expect(await text(t, 'asks_handle', { key: 'pr-1', outcome: 'resolved' })).toBe('no change');
    expect(await text(t, 'asks_handle', { key: 'nope', outcome: 'resolved' })).toBe('error not_found');
  });
  it('wait: pending, then the answer', async () => {
    const { text, mint, call, storage } = await setup();
    const t = await mint('read', 'write');
    await call(t, 'asks_put', put);
    expect(await text(t, 'asks_answer_wait', { key: 'pr-1' })).toBe('pending');
    const { answerAsk } = await import('../../src/core/asks');
    await answerAsk({ storage }, 'pr-1', { answer: 'go' });
    const r = JSON.parse(await text(t, 'asks_answer_wait', { key: 'pr-1', waitSec: 2 }));
    expect(r).toMatchObject({ key: 'pr-1', state: 'answered', answer: 'go' });
    expect(await text(t, 'asks_answer_wait', { key: 'nope' })).toBe('error not_found');
  });
  it('wait polls until the answer lands', async () => {
    const { text, mint, call, storage } = await setup();
    const t = await mint('read', 'write');
    await call(t, 'asks_put', put);
    const { answerAsk } = await import('../../src/core/asks');
    setTimeout(() => void answerAsk({ storage }, 'pr-1', { answer: 'reply', text: 'ok then' }), 300);
    const r = JSON.parse(await text(t, 'asks_answer_wait', { key: 'pr-1', waitSec: 5 }));
    expect(r).toMatchObject({ state: 'answered', answer: 'reply', text: 'ok then' });
  });
  it('rejects bad waitSec and unknown fields', async () => {
    const { text, mint } = await setup();
    const t = await mint('read');
    expect(await text(t, 'asks_answer_wait', { key: 'k', waitSec: 99 })).toMatch(/^error invalid/);
    expect(await text(t, 'asks_answer_wait', { key: 'k', x: 1 })).toMatch(/^error invalid/);
  });
});
