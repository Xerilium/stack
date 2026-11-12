/**
 * Owner queue (0f) and stale cap (0g): what Now, My day, `stack next` and `stack rank` show.
 * Rows use the shapes of the live task files (allyte agent rows; F4 rows overdue for days with no commit).
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDefaults } from '../../src/core/config';
import { explainStack, nextTask, rankStack, type LifecycleContext } from '../../src/core/lifecycle';
import { MemoryStorage } from '../../src/core/storage';
import { GitStorage } from '../../src/core/storage-git';
import { STALE_CAP } from '../../src/core/scoring';

const config = { ...getDefaults(), timezone: 'America/Los_Angeles' };
const AT = new Date('2026-11-12T10:00:00-08:00');
const ANY = { ignoreBlocks: true };
const titles = (r: { text: string }[]) => r.map((t) => t.text);

const ALLYTE = `# 🟣 Allyte

- **Aliases:** allyte

## 🔄 Active

- [ ] 🤖 Accept all FOCUS meeting invites (email-cos) 🟢
- [ ] 🤖 FH PR quality follow-ups (from review; Sweep Manager likely handles most) 🟡
  - [ ] Merge [888](https://github.com/allytehq/finops-hubs/pull/888) first (owns topItemDetailQueries.test.ts clock fix)
  - [ ] 🙋 [880](https://github.com/allytehq/finops-hubs/pull/880): decide if §5a should say the /test route instead of ?app.mode=test
- [ ] 🚨 🪄 📅 Nov 12: FinOpsHubs.com launch schedule draft 💰💰💰💰
- [ ] 🙋 🤖 Review and send the launch post 🟢
- [ ] 🙋 Launch prep
  - [ ] 🤖 Collect the launch metrics
  - [ ] Approve the launch metrics 🟢
- [ ] 🤖:assist Send the CIO Review decline 🟢
- [ ] ✍️ Blog backlog (Allyte/MVP): AI agent plugin in-depth guide 🔹
`;

const mem = (files: Record<string, string>): LifecycleContext => {
  const s = new MemoryStorage();
  for (const [p, c] of Object.entries(files)) s.seed(p, c);
  return { storage: s, config, engine: 'stack' };
};

describe('owner queue', () => {
  // @req FR:task-lifecycle/rank.owner
  it('drops agent rows (🤖, 🪄) and the unmarked rows under them; an open 🙋 child of an agent row ranks', async () => {
    const r = titles(await rankStack(mem({ 'tasks/allyte.md': ALLYTE }), AT, undefined, ANY));
    expect(r.some((t) => /FOCUS meeting invites/.test(t))).toBe(false);
    expect(r.some((t) => /Merge \[888\]/.test(t))).toBe(false);
    expect(r.some((t) => /launch schedule draft/.test(t))).toBe(false); // 🪄 and 🚨 due today: still not the owner's
    expect(r.some((t) => /Collect the launch metrics/.test(t))).toBe(false);
    expect(r.some((t) => /\[880\]/.test(t))).toBe(true);
    expect(r.some((t) => /Approve the launch metrics/.test(t))).toBe(true); // nearest marked ancestor is 🙋
    expect(r.some((t) => /CIO Review decline/.test(t))).toBe(true); // 🤖:assist is autonomy, not a mark
    expect(r.some((t) => /Blog backlog/.test(t))).toBe(true); // no mark anywhere: the owner's
  });
  // @req FR:task-lifecycle/rank.owner
  it('a row with both 🙋 and 🤖 is mixed and not the owner queue', async () => {
    const r = titles(await rankStack(mem({ 'tasks/allyte.md': ALLYTE }), AT, undefined, ANY));
    expect(r.some((t) => /Review and send the launch post/.test(t))).toBe(false);
  });
  // @req FR:task-lifecycle/rank.owner
  it('a mixed ancestor is skipped: an unmarked row takes the next marked ancestor, else the owner', async () => {
    const f = `# X\n\n## 🔄 Active\n\n- [ ] 🤖 Agent epic\n  - [ ] 🙋 🤖 Mixed step\n    - [ ] Unmarked under mixed under agent\n- [ ] 🙋 🤖 Mixed top\n  - [ ] Unmarked under mixed only\n`;
    const r = titles(await rankStack(mem({ 'tasks/x.md': f }), AT, undefined, ANY));
    expect(r).toEqual(['Unmarked under mixed only']);
  });
  // @req FR:task-lifecycle/rank.owner
  it('ownership follows the parsed tree: a checked agent ancestor still owns, and 4-space or tab indents nest', async () => {
    const f = `# X\n\n## 🔄 Active\n\n- [ ] 🤖 Agent epic\n  - [x] Done step\n    - [ ] Unmarked under a checked row\n- [ ] 🤖 Four-space epic\n    - [ ] Four-space child\n- [ ] 🤖 Tab epic\n\t- [ ] Tab child\n- [ ] Mine\n`;
    const r = titles(await rankStack(mem({ 'tasks/x.md': f }), AT, undefined, ANY));
    expect(r).toEqual(['Mine']);
  });
  // @req FR:task-lifecycle/rank.owner @req FR:task-lifecycle/next.rank
  it('next never gives an agent row, even when it scores highest', async () => {
    const n = await nextTask(mem({ 'tasks/allyte.md': ALLYTE }), AT);
    expect(n?.text).not.toMatch(/🪄|🤖(?!:)/u);
  });
  // @req FR:task-lifecycle/rank.owner
  it("owner: 'any' keeps every row", async () => {
    const r = titles(await rankStack(mem({ 'tasks/allyte.md': ALLYTE }), AT, undefined, { ...ANY, owner: 'any' }));
    expect(r.some((t) => /launch schedule draft/.test(t))).toBe(true);
    expect(r.some((t) => /Merge \[888\]/.test(t))).toBe(true);
  });
});

// ------------------------------------------------------------------ stale

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd: string, date: string | null, ...a: string[]) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', env: date ? { ...ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : ENV });
const commitAt = (d: string, date: string, files: Record<string, string>) => {
  for (const [p, c] of Object.entries(files)) writeFileSync(join(d, p), c);
  git(d, date, 'add', '-A');
  git(d, date, 'commit', '-q', '-m', `sync ${date}`);
};
const repo = () => {
  const d = mkdtempSync(join(tmpdir(), 'stack-stale-')); dirs.push(d);
  git(d, null, 'init', '-q', '-b', 'main');
  git(d, null, 'config', 'user.name', 'T'); git(d, null, 'config', 'user.email', 't@t.t'); git(d, null, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(d, 'tasks'));
  return d;
};

const F4 = (ftk: string) => `# 🎧 Flantastic 4

- **Aliases:** f4

## 🔄 Active

- [ ] 🙋 📅 Nov 3: Cid Instagram + TikTok: accounts created; paste TikTok bio 💰💰
- [ ] 🙋 📅 Nov 11: Pay the DistroKid invoice 💰
- [ ] ${ftk}
- [ ] 🙋 📅 Sep 20, 2026: Renew the label agreement 💰
- [ ] 🙋 📅 Nov 4: Draft the single cover 🟢
- [ ] 🙋 📅 Nov 12: Release the single -- after Draft the single cover 💰💰
`;
const FTK_OLD = '🙋 📅 Nov 4: FTK v15 announcement draft 💰';
const FTK_NEW = '🙋 📅 Nov 4: FTK v15 announcement draft (waiting on PR 288) 💰';

/** One file committed Nov 1; the FTK and label rows changed again Nov 11. */
const staleRepo = () => {
  const d = repo();
  commitAt(d, '2026-11-01T09:00:00-07:00', { 'tasks/flantastic-4.md': F4(FTK_OLD) });
  const later = F4(FTK_NEW).replace('Renew the label agreement 💰', 'Renew the label agreement (Roland has the draft) 💰');
  commitAt(d, '2026-11-11T09:00:00-08:00', { 'tasks/flantastic-4.md': later });
  return d;
};
const find = <T extends { text: string }>(r: T[], re: RegExp) => r.find((x) => re.test(x.text))!;

describe('stale cap', () => {
  // @req FR:task-lifecycle/rank.stale @req FR:scoring-engine/engine.stack
  it('a row 3+ days overdue with no commit in 3+ days gets tier 0, a score of at most 500, and stale', async () => {
    const ctx: LifecycleContext = { storage: new GitStorage(staleRepo()), config, engine: 'stack' };
    const r = await rankStack(ctx, AT, undefined, ANY);
    const cid = find(r, /Cid Instagram/);
    expect(cid.score).toBeLessThanOrEqual(STALE_CAP);
    expect(STALE_CAP).toBe(500);
    expect(cid.stale).toEqual({ overdueDays: 9, lastActivity: new Date('2026-11-01T09:00:00-07:00').toISOString() });
    expect(r.indexOf(cid)).toBeGreaterThan(r.indexOf(find(r, /DistroKid invoice/)));
  });
  // @req FR:task-lifecycle/rank.stale
  it('overdue 1 day, or overdue but changed in the last 3 days, is not stale and keeps the overdue tier', async () => {
    const ctx: LifecycleContext = { storage: new GitStorage(staleRepo()), config, engine: 'stack' };
    const r = await rankStack(ctx, AT, undefined, ANY);
    for (const re of [/DistroKid invoice/, /FTK v15/, /label agreement/]) {
      const x = find(r, re);
      expect(x.stale).toBeUndefined();
      expect(x.score).toBeGreaterThanOrEqual(3000); // the 30-day rule no longer applies once activity is known
    }
  });
  // @req FR:task-lifecycle/rank.stale @req FR:scoring-engine/blockers.inherit
  it('the cap holds after a blocker inherits a due-today score', async () => {
    const ctx: LifecycleContext = { storage: new GitStorage(staleRepo()), config, engine: 'stack' };
    const r = await rankStack(ctx, AT, undefined, ANY);
    const cover = find(r, /Nov 4: Draft the single cover/);
    expect(cover.stale).toBeDefined();
    expect(cover.score).toBeLessThanOrEqual(STALE_CAP);
  });
  // @req FR:task-lifecycle/rank.stale
  it('without line activity (no git history) a row is never stale', async () => {
    const r = await rankStack(mem({ 'tasks/flantastic-4.md': F4(FTK_OLD) }), AT, undefined, ANY);
    const cid = find(r, /Cid Instagram/);
    expect(cid.stale).toBeUndefined();
    expect(cid.score).toBeGreaterThanOrEqual(3000);
  });
  // @req FR:task-lifecycle/rank.stale
  it('an uncommitted edit to the row counts as activity now', async () => {
    const d = staleRepo();
    writeFileSync(join(d, 'tasks/flantastic-4.md'), F4(FTK_NEW).replace('paste TikTok bio', 'paste TikTok bio (bio ready)'));
    const r = await rankStack({ storage: new GitStorage(d), config, engine: 'stack' }, AT, undefined, ANY);
    expect(find(r, /Cid Instagram/).stale).toBeUndefined();
  });
  // @req FR:task-lifecycle/rank.explain
  it('explain says why: stale rows name the overdue days, the last commit, tier 0 and the cap; dropped agent rows are counted', async () => {
    const d = staleRepo();
    writeFileSync(join(d, 'tasks/allyte.md'), ALLYTE);
    git(d, '2026-11-11T09:00:00-08:00', 'add', '-A'); git(d, '2026-11-11T09:00:00-08:00', 'commit', '-q', '-m', 'allyte');
    const e = await explainStack({ storage: new GitStorage(d), config, engine: 'stack' }, AT, ANY);
    const cid = e.items.find((x) => /Cid Instagram/.test(x.text))!;
    expect(cid.stale).toBe(true);
    expect(cid.why).toMatch(/stale: 9d overdue, last commit 2026-11-01; tier 0, cap 500/);
    expect(e.items.find((x) => /DistroKid/.test(x.text))!.why).toMatch(/tier 3 \(1d overdue\)/);
    expect(e.dropped).toBe(5);
    expect(e.text).toMatch(/5 rows dropped: not the owner's/);
    expect(e.text).toMatch(/Cid Instagram.*stale/);
  });
});

describe('GitStorage.lineActivity', () => {
  // @req FR:storage-git/git.activity @req FR:task-lifecycle/rank.stale
  it('keeps commit times on the right rows in a CRLF file with a BOM', async () => {
    const d = repo();
    const crlf = (s: string) => '\uFEFF' + s.replace(/\n/g, '\r\n');
    commitAt(d, '2026-11-01T09:00:00-07:00', { 'tasks/flantastic-4.md': crlf(F4(FTK_OLD)) });
    commitAt(d, '2026-11-11T09:00:00-08:00', { 'tasks/flantastic-4.md': crlf(F4(FTK_NEW)) });
    const r = await rankStack({ storage: new GitStorage(d), config, engine: 'stack' }, AT, undefined, ANY);
    expect(find(r, /Cid Instagram/).stale?.overdueDays).toBe(9);
    expect(find(r, /FTK v15/).stale).toBeUndefined();
  });
  // @req FR:storage-git/git.activity
  it('gives the last commit time per line, cached per revision', async () => {
    const d = staleRepo();
    const s = new GitStorage(d);
    const a = await s.lineActivity('tasks/flantastic-4.md');
    expect(a[0]).toBe(new Date('2026-11-01T09:00:00-07:00').getTime());
    const ftk = F4(FTK_NEW).split('\n').findIndex((l) => l.includes('FTK v15'));
    expect(a[ftk]).toBe(new Date('2026-11-11T09:00:00-08:00').getTime());
    expect(await s.lineActivity('tasks/flantastic-4.md')).toBe(a); // same revision: no second blame
    commitAt(d, '2026-11-12T09:00:00-08:00', { 'tasks/flantastic-4.md': F4(FTK_NEW) + '- [ ] new row\n' });
    expect(await s.lineActivity('tasks/flantastic-4.md')).not.toBe(a);
    expect(await s.lineActivity('tasks/untracked.md')).toEqual([]);
  });
});
