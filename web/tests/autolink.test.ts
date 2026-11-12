import { describe, expect, it } from 'vitest';
import { autolink, repoFor, repoMapOf, repoOfUrl } from '../src/autolink';

const REPOS = { fh: 'microsoft/finops-toolkit', ftk: 'microsoft/finops-toolkit', stack: 'Xerilium/stack' };
const links = (t: string, repo?: string) => autolink(t, { repo, repos: REPOS }).filter((s) => typeof s !== 'string');

// @req FR:ask-briefs/link.refs
describe('autolink', () => {
  it('links #123, PR 123 and PR #123 to the context repo', () => {
    expect(autolink('Merge #12 then PR 13 and PR #14.', { repo: 'o/r' })).toEqual([
      'Merge ', { href: 'https://github.com/o/r/issues/12', text: '#12' }, ' then ',
      { href: 'https://github.com/o/r/pull/13', text: 'PR 13' }, ' and ', { href: 'https://github.com/o/r/pull/14', text: 'PR #14' }, '.',
    ]);
  });

  it('links "Approve PR 12": a word that is not an alias never swallows the PR', () => {
    expect(links('Approve PR 12', 'o/r')).toEqual([{ href: 'https://github.com/o/r/pull/12', text: 'PR 12' }]);
  });

  it('links alias refs like FH 1105 and FH PR 1105 through the project map', () => {
    expect(links('See FH 1105 and ftk PR 7')).toEqual([
      { href: 'https://github.com/microsoft/finops-toolkit/issues/1105', text: 'FH 1105' },
      { href: 'https://github.com/microsoft/finops-toolkit/pull/7', text: 'ftk PR 7' },
    ]);
  });

  it('links owner/repo#123 and full urls; trailing punctuation stays text', () => {
    expect(autolink('Fix in Xerilium/stack#152, see https://github.com/Xerilium/stack/pull/153).')).toEqual([
      'Fix in ', { href: 'https://github.com/Xerilium/stack/issues/152', text: 'Xerilium/stack#152' }, ', see ',
      { href: 'https://github.com/Xerilium/stack/pull/153', text: 'https://github.com/Xerilium/stack/pull/153' }, ').',
    ]);
  });

  it('leaves unresolved refs plain: no context repo, unknown alias, ordinary numbers', () => {
    expect(autolink('PR 12 and #3 and Oct 29 and step 2 and a&#39;b')).toEqual(['PR 12 and #3 and Oct 29 and step 2 and a&#39;b']);
    expect(autolink('')).toEqual(['']);
  });
});

// @req FR:ask-briefs/link.repo
describe('repo resolution', () => {
  it('reads owner/repo from GitHub urls only', () => {
    expect(repoOfUrl('https://github.com/Xerilium/stack/pull/1')).toBe('Xerilium/stack');
    expect(repoOfUrl('https://github.com/o/r.git')).toBe('o/r');
    expect(repoOfUrl('https://example.test/o/r')).toBeUndefined();
    expect(repoOfUrl('https://github.com/orgs/Xerilium/projects/1')).toBeUndefined();
    expect(repoOfUrl(undefined)).toBeUndefined();
  });

  it('maps project name and aliases (never the title) to its Repository', () => {
    const m = repoMapOf([
      { name: 'finops-toolkit', title: 'FinOps toolkit', metadata: { Repository: '[microsoft/finops-toolkit](https://github.com/microsoft/finops-toolkit)', Aliases: 'ftk, FH' } },
      { name: 'stack', metadata: { Repo: 'Xerilium/stack' } },
      { name: 'house', metadata: { Aliases: 'home' } },
    ]);
    expect(m).toEqual({ 'finops-toolkit': 'microsoft/finops-toolkit', ftk: 'microsoft/finops-toolkit', fh: 'microsoft/finops-toolkit', stack: 'Xerilium/stack' });
  });

  it('prefers the link repo, then the project repo', () => {
    expect(repoFor('https://github.com/a/b/pull/1', 'stack', REPOS)).toBe('a/b');
    expect(repoFor('https://example.test', 'Stack', REPOS)).toBe('Xerilium/stack');
    expect(repoFor(undefined, undefined, REPOS)).toBeUndefined();
  });
});
