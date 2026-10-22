import { createGhClient } from '../../src/core/query-tasks';

const mockExecFile = jest.fn();
jest.mock('child_process', () => ({ execFile: (...a: unknown[]) => mockExecFile(...a) }));

// @req FR:query-tasks/github.graphql
describe('default gh executor', () => {
  const req = { repo: 'o/r', kind: 'issues' as const, qualifiers: '' };
  it('passes a timeout to execFile', async () => {
    mockExecFile.mockImplementation((_f, _a, _o, cb) => cb(null, JSON.stringify({ data: { search: { nodes: [] } } }), ''));
    await createGhClient().search(req);
    expect(mockExecFile.mock.calls[0][2]).toMatchObject({ timeout: 60_000 });
  });
  it('reports a timed-out gh as a timeout', async () => {
    mockExecFile.mockImplementation((_f, _a, _o, cb) => cb(Object.assign(new Error('killed'), { killed: true, code: null }), '', ''));
    await expect(createGhClient().search(req)).rejects.toThrow(/timed out/);
  });
});
