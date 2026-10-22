import { parseArgs, parseRef, UsageError } from '../../src/cli/args';

/** @req FR:cli/run.@function @req FR:cli/ref.format @req FR:cli/ref.invalid */
describe('cli args', () => {
  it('splits command, positionals, and flags', () => {
    const a = parseArgs(['add', 'alpha', 'do', 'it', '--section', 'Backlog', '--json', '--dir=/x']);
    expect(a.command).toBe('add');
    expect(a.positionals).toEqual(['alpha', 'do', 'it']);
    expect(a.flags).toEqual({ section: 'Backlog', json: true, dir: '/x' });
  });

  it('treats everything after -- as positional', () => {
    const a = parseArgs(['add', 'p', '--', '--weird', 'text']);
    expect(a.positionals).toEqual(['p', '--weird', 'text']);
  });

  it('rejects a value flag with no value', () => {
    expect(() => parseArgs(['add', '--section'])).toThrow(UsageError);
  });

  it('parses refs as 1-based and returns 0-based core refs', () => {
    expect(parseRef('tasks/a.md:3')).toEqual({ path: 'tasks/a.md', line: 2 });
    expect(() => parseRef('tasks/a.md')).toThrow(UsageError);
    expect(() => parseRef('tasks/a.md:0')).toThrow(UsageError);
    expect(() => parseRef('tasks/a.md:x')).toThrow(UsageError);
  });
});
