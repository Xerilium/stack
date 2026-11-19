import { checkPath, parseCheck } from '../../src/core/pr-check';

// @req FR:pr-page/check.parse
describe('parseCheck: the PR live check file', () => {
  it('reads Ask, Server, As of, Steps, Pass, Fail', () => {
    const t = [
      '# Xerilium/stack#188', '- Ask: Check sign-in on the phone', '- Server: `pnpm web --port 5180`', '- As of: 2026-11-18T10:00:00Z', '',
      '## Steps', '1. Open the app', '2. Sign in', '', '## pass', '- Home shows tasks', '## Fail', '* An error toast', 'stray text',
    ].join('\n');
    expect(parseCheck(t)).toEqual({ ask: 'Check sign-in on the phone', server: 'pnpm web --port 5180', at: '2026-11-18T10:00:00Z', steps: ['Open the app', 'Sign in'], pass: ['Home shows tasks'], fail: ['An error toast'] });
  });
  it('null when nothing is found; caps lists and item length', () => {
    expect(parseCheck('hello\n# title')).toBeNull();
    expect(parseCheck('')).toBeNull();
    const many = ['## Steps', ...Array.from({ length: 30 }, (_, i) => `${i + 1}. ${'x'.repeat(i === 0 ? 300 : 3)}`)].join('\n');
    const c = parseCheck(many)!;
    expect(c.steps).toHaveLength(20);
    expect(c.steps[0].length).toBeLessThanOrEqual(200);
    expect(c).toEqual(expect.objectContaining({ pass: [], fail: [] }));
    expect(c.ask).toBeUndefined();
  });
});

// @req FR:pr-page/check.file
describe('checkPath', () => {
  it('builds <home>/pr/<owner>/<repo>/<n>.md and refuses bad parts', () => {
    expect(checkPath('/h', 'Xerilium/stack', 188)).toBe('/h/pr/Xerilium/stack/188.md');
    expect(checkPath('/h', '../x/stack', 1)).toBeNull();
    expect(checkPath('/h', 'o/..', 1)).toBeNull();
    expect(checkPath('/h', 'o/r', 0)).toBeNull();
    expect(checkPath('/h', 'o/r/x', 1)).toBeNull();
  });
});
