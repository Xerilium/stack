import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitStorage } from '../../src/core/storage-git';

const git = (d: string, at: string, ...a: string[]) => execFileSync('git', a, { cwd: d, env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });

describe('GitStorage.commitSubjects', () => {
  // @req FR:pri-first-ranking/daily.done
  it('lists the commit subjects of one file since a time, newest first', async () => {
    const d = mkdtempSync(join(tmpdir(), 'stack-subjects-'));
    git(d, '2026-11-01T00:00:00Z', 'init', '-q');
    mkdirSync(join(d, 'tasks'));
    const commit = (at: string, file: string, body: string, msg: string) => { writeFileSync(join(d, file), body); git(d, at, 'add', '-A'); git(d, at, 'commit', '-qm', msg); };
    commit('2026-11-17T10:00:00Z', 'tasks/a.md', '- [ ] one\n', 'Add: one');
    commit('2026-11-18T09:00:00Z', 'tasks/a.md', '- [x] one\n', 'Complete: one');
    commit('2026-11-18T10:00:00Z', 'tasks/b.md', '- [ ] two\n', 'Add: two');
    const s = new GitStorage(d);
    expect(await s.commitSubjects('tasks/a.md', new Date('2026-11-18T00:00:00Z'))).toEqual(['Complete: one']);
    expect(await s.commitSubjects('tasks/a.md', new Date('2026-11-01T00:00:00Z'))).toEqual(['Complete: one', 'Add: one']);
    expect(await s.commitSubjects('tasks/none.md', new Date('2026-11-01T00:00:00Z'))).toEqual([]);
  });
});
