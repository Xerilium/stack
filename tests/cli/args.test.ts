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

/** @req FR:cli/run.@function */
describe('cli args: flag values', () => {
  it('rejects a value flag followed by another flag', () => {
    expect(() => parseArgs(['set', 'x', '--suspend', '--status', 'y'])).toThrow(UsageError);
  });
  it('allows --flag=--literal', () => {
    expect(parseArgs(['add', '--section=--x']).flags.section).toBe('--x');
  });
});

/** @req FR:email-runner/cli.offline @req FR:email-runner/cli.all */
describe('cli args: email boolean flags', () => {
  it('--offline and --all take no value (the 15-minute schedule runs email run --all)', () => {
    expect(parseArgs(['email', 'run', '--dry-run', '--offline', '--fixture', 'f.json']).flags).toEqual({ 'dry-run': true, offline: true, fixture: 'f.json' });
    expect(parseArgs(['email', 'run', '--all']).flags).toEqual({ all: true });
    expect(parseArgs(['email', 'run', '--all', '--dir', '/r']).flags).toEqual({ all: true, dir: '/r' });
  });
});
