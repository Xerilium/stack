/**
 * The PR page rework: next action per card, the Summary sections, sign-off threads, details, spec lines.
 */
import { buildRows, nextActionOf, signoffThreads, summaryOf, validationSteps, type BoardCtx, type PrFacts, type PrThread } from '../../src/core/pr-board';

const NOW = new Date('2026-11-12T12:00:00Z');
let n = 0;
const pr = (o: Partial<PrFacts> = {}): PrFacts => {
  const num = o.number ?? ++n + 100;
  return {
    url: `https://github.com/Xerilium/stack/pull/${num}`, repo: 'Xerilium/stack', number: num, title: `PR ${num}`, author: 'flanakin', draft: false,
    createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-11T11:00:00Z', headOid: 'abc1234def', headAt: '2026-11-11T11:30:00Z', body: '',
    labels: ['Status: 🤖 Autopilot'], assignees: [], requested: [], reviews: [], mergeable: 'MERGEABLE', checks: [{ name: 'ci', state: 'pass' }], threads: [], comments: [], ...o,
  };
};
const ctx = (o: Partial<BoardCtx> = {}): BoardCtx => ({ user: 'flanakin', now: NOW, agentPrs: new Set(), myRepos: ['Xerilium'], ...o });
const T = (o: Partial<PrThread> & { comments: PrThread['comments'] }): PrThread => {
  const last = o.comments![o.comments!.length - 1];
  return { resolved: false, lastAuthor: last.author, lastBody: last.body, url: o.comments![0].url, id: 9, nodeId: 'PRRT_a', path: 'src/x.ts', ...o };
};
const hold = { author: 'flanakin', body: 'Hold until I test it live', url: 'https://github.com/Xerilium/stack/pull/1#discussion_r9', at: '2026-11-11T09:00:00Z' };

// @req FR:pr-page/card.action
describe('signoffThreads: threads where I asked to wait', () => {
  it('my human hold, wait, or ack phrase on an unresolved thread', () => {
    for (const body of ['Hold until I test it live', 'Please wait for my ack', 'wait', 'Do not merge yet', "Don't merge until I check", 'Ack first please', 'Until I ack this, leave it']) {
      expect(signoffThreads(pr({ threads: [T({ comments: [{ ...hold, body }] })] }), ctx())).toHaveLength(1);
    }
  });
  it('an agent note, another login, a resolved thread, or no phrase is not a sign-off', () => {
    expect(signoffThreads(pr({ threads: [T({ comments: [{ ...hold, body: '🤖 [AI] wait for my ack' }] })] }), ctx())).toHaveLength(0);
    expect(signoffThreads(pr({ threads: [T({ comments: [{ ...hold, author: 'roland' }] })] }), ctx())).toHaveLength(0);
    expect(signoffThreads(pr({ threads: [T({ resolved: true, comments: [hold] })] }), ctx())).toHaveLength(0);
    expect(signoffThreads(pr({ threads: [T({ comments: [{ ...hold, body: 'Rename this' }] })] }), ctx())).toHaveLength(0);
  });
  it('a later agent reply keeps it a sign-off: only I can sign off', () => {
    const t = T({ comments: [hold, { author: 'flanakin', body: '🤖 [AI] Fixed in abc', url: 'https://github.com/Xerilium/stack/pull/1#discussion_r10', at: '2026-11-11T10:00:00Z' }] });
    expect(signoffThreads(pr({ threads: [t] }), ctx())).toHaveLength(1);
  });
  it('an ack of mine on the thread (url or a comment url) makes it a sign-off', () => {
    const p = pr({ threads: [T({ comments: [{ author: 'copilot[bot]', body: 'Consider X', url: 'https://github.com/Xerilium/stack/pull/1#discussion_r5' }] })] });
    const acks = new Map([[p.url.toLowerCase(), [{ thread: 'https://github.com/Xerilium/stack/pull/1#discussion_r5', note: 'Keep it', at: 't' }]]]);
    expect(signoffThreads(p, ctx({ acks }))).toHaveLength(1);
    expect(signoffThreads(p, ctx())).toHaveLength(0);
  });
});

// @req FR:pr-page/card.action @req FR:pr-page/data.row
describe('nextActionOf: one action per card, first match wins', () => {
  const rowOf = (p: PrFacts, c = ctx()) => buildRows([p], c)[0];
  it('validate: the Live PR wins over everything', () => {
    const p = pr({ threads: [T({ comments: [hold] })] });
    expect(rowOf(p, ctx({ live: { url: p.url, state: 'ready-for-michael', items: [] } })).nextAction).toBe('validate');
  });
  it('signoff: a sign-off thread', () => {
    expect(rowOf(pr({ threads: [T({ comments: [hold] })] })).nextAction).toBe('signoff');
  });
  it('publish: my pending review with a body or a comment; an empty pending review is nothing', () => {
    const other = { author: 'roland', labels: [] as string[] };
    expect(rowOf(pr({ ...other, pendingReview: { url: 'https://github.com/Xerilium/stack/pull/1#pullrequestreview-1', body: '', comments: [{ path: 'a.ts', body: 'Nit' }] } })).nextAction).toBe('publish');
    expect(rowOf(pr({ ...other, pendingReview: { url: 'https://github.com/Xerilium/stack/pull/1#pullrequestreview-1', body: '', comments: [] } })).nextAction).toBe('approve');
  });
  it('approve: someone else\'s clean PR I have not approved', () => {
    const other = { author: 'roland', labels: [] as string[] };
    expect(rowOf(pr(other)).nextAction).toBe('approve');
    expect(rowOf(pr({ ...other, checks: [{ name: 'ci', state: 'fail' }] })).nextAction).toBeNull();
    expect(rowOf(pr({ ...other, mergeable: 'CONFLICTING' })).nextAction).toBeNull();
    expect(rowOf(pr({ ...other, checks: [] })).nextAction).toBe('approve');
    expect(rowOf(pr({ ...other, reviews: [{ author: 'flanakin', state: 'COMMENTED' }] })).nextAction).toBe('approve');
  });
  it('autopilot: my PR with no Autopilot label, threads resolved or exactly one that waits for me', () => {
    const mine = { labels: [] as string[] };
    const waitsOnMe = T({ comments: [{ author: 'copilot[bot]', body: 'Consider X', url: 'u1' }] });
    const waitsOnAgent = T({ comments: [{ author: 'flanakin', body: 'Rename it', url: 'u2' }] });
    expect(rowOf(pr(mine)).nextAction).toBe('autopilot');
    expect(rowOf(pr({ ...mine, threads: [T({ resolved: true, comments: [{ author: 'x', body: 'y', url: 'u3' }] })] })).nextAction).toBe('autopilot');
    expect(rowOf(pr({ ...mine, threads: [waitsOnMe] })).nextAction).toBe('autopilot');
    expect(rowOf(pr({ ...mine, threads: [waitsOnAgent] })).nextAction).toBeNull();
    expect(rowOf(pr({ ...mine, threads: [waitsOnMe, { ...waitsOnMe, url: 'u4' }] })).nextAction).toBeNull();
    expect(rowOf(pr({ ...mine, draft: true })).nextAction).toBeNull();
    expect(rowOf(pr({ labels: ['Status: ⏸️ Paused'] })).nextAction).toBeNull();
    expect(rowOf(pr()).nextAction).toBeNull(); // already Autopilot
  });
  it('the Autopilot label matches with the emoji on either side', () => {
    expect(rowOf(pr({ labels: ['Status: Autopilot 🤖'] })).nextAction).toBeNull();
    expect(rowOf(pr({ labels: ['status: autopilot'] })).autopilot).toBe(true);
    expect(rowOf(pr({ labels: ['Status: 🔁 Updated'] })).nextAction).toBe('autopilot');
  });
  it('nextActionOf is pure and matches the row', () => {
    const p = pr({ labels: [] });
    expect(nextActionOf(p, ctx(), 'pending', undefined)).toBe('autopilot');
  });
});

// @req FR:pr-page/data.row @req FR:pr-review-lane/sort.lines
describe('row fields', () => {
  it('mine, specLines from the changed files (null when unknown), pinned', () => {
    const p = pr({ files: [{ path: '.xe/features/a/spec.md', additions: 10, deletions: 2 }, { path: 'src/a.ts', additions: 50, deletions: 0 }, { path: 'docs/x.md', additions: 1, deletions: 1 }] });
    const [r] = buildRows([p], ctx({ pinned: new Set([p.url.toLowerCase()]) }));
    expect(r).toMatchObject({ mine: true, specLines: 14, pinned: true });
    expect(buildRows([pr({ author: 'roland', labels: [] })], ctx())[0]).toMatchObject({ mine: false, specLines: null });
  });
});

// @req FR:pr-page/summary.@function @req FR:pr-page/summary.live @req FR:pr-page/summary.signoff @req FR:pr-page/summary.autopilot @req FR:pr-page/summary.missing
describe('summaryOf', () => {
  it('Live PR order: the live lane PR, else the escalation set, else the first PR of mine that needs live validation', () => {
    const a = pr({ labels: [] }); const b = pr({ labels: [], body: 'Needs live validation on the tailnet' }); const c = pr({ labels: [], files: [{ path: 'infra/main.bicep', additions: 1, deletions: 0 }] });
    expect(summaryOf(buildRows([a, b, c], ctx()), ctx()).live).toEqual([b.url]);
    const esc = ctx({ liveFirst: c.url });
    expect(summaryOf(buildRows([a, b, c], esc), esc).live).toEqual([c.url]);
    const lane = ctx({ liveFirst: c.url, live: { url: a.url, state: 'preparing', items: [] } });
    expect(summaryOf(buildRows([a, b, c], lane), lane).live).toEqual([a.url]);
    // A lane PR that is not a board row: fall back.
    const gone = ctx({ live: { url: 'https://github.com/o/r/pull/9', state: 'working', items: [] } });
    expect(summaryOf(buildRows([a, b], gone), gone).live).toEqual([b.url]);
    expect(summaryOf(buildRows([a], ctx()), ctx()).live).toEqual([]);
  });
  it('sections: 1 live, up to 3 sign-off, up to 3 autopilot (fewest spec lines first), and the rest in missing; no PR twice', () => {
    const signs = [1, 2, 3, 4].map(() => pr({ threads: [T({ comments: [hold] })] }));
    const autos = [30, 5, null, 12].map((lines) => pr({ labels: [], ...(lines === null ? {} : { files: [{ path: '.xe/a.md', additions: lines, deletions: 0 }] }) }));
    const approve = pr({ author: 'roland', labels: [] });
    const publish = pr({ author: 'roland', labels: [], pendingReview: { url: 'https://github.com/x', body: 'Looks off', comments: [] } });
    const asks = pr({ labels: ['Status: 🤖 Autopilot', 'Needs: Attention'] });
    const quiet = pr();
    const all = [...signs, ...autos, approve, publish, asks, quiet];
    const c = ctx({ live: { url: signs[0].url, state: 'ready-for-michael', items: [{ text: 'Login works', state: 'failed' }, { text: 'Logout works', state: 'passed' }] } });
    const rows = buildRows(all, c);
    const s = summaryOf(rows, c);
    expect(s.live).toEqual([signs[0].url]);
    expect(s.signoff).toEqual([signs[1].url, signs[2].url, signs[3].url]);
    expect(s.autopilot).toEqual([autos[1].url, autos[3].url, autos[0].url]);
    expect(s.missing.map((m) => m.url)).toEqual([autos[2].url, approve.url, publish.url, asks.url, signs[0].url]);
    expect(s.missing.map((m) => m.reason)).toEqual(['Enable Autopilot', 'Approve', 'Publish review', 'Needs attention label', 'Live check failed: Login works']);
    const listed = [...s.live, ...s.signoff, ...s.autopilot, ...s.missing.filter((m) => !m.reason.startsWith('Live check')).map((m) => m.url)];
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).not.toContain(quiet.url);
  });
  it('missing is empty when nothing else needs me; reasons never say hold, escalate, or blocked', () => {
    expect(summaryOf(buildRows([pr()], ctx()), ctx()).missing).toEqual([]);
    const held = pr({ threads: [{ resolved: false, lastAuthor: 'flanakin', lastBody: 'hold', url: 'u', id: 1 }] });
    // Five sign-offs: the 4th and 5th go to missing with a Sign off reason.
    const rows = buildRows([held, ...[1, 2, 3].map(() => pr({ threads: [T({ comments: [hold] })] }))], ctx());
    for (const m of summaryOf(rows, ctx()).missing) expect(m.reason).not.toMatch(/hold|held|escalat|blocked/i);
  });
});

// @req FR:pr-page/detail.data @req FR:pr-page/detail.signoff @req FR:pr-page/detail.autopilot @req FR:pr-page/detail.publish @req FR:pr-page/detail.validate
describe('detail data (no AI call)', () => {
  it('signoff: my ask, the replies after it, and the commits after it', () => {
    const reply = { author: 'flanakin', body: '🤖 [AI] Fixed in abc', url: 'https://github.com/Xerilium/stack/pull/1#discussion_r10', at: '2026-11-11T10:00:00Z' };
    const before = { author: 'copilot[bot]', body: 'Consider X', url: 'https://github.com/Xerilium/stack/pull/1#discussion_r8', at: '2026-11-11T08:00:00Z' };
    const p = pr({
      threads: [T({ comments: [before, hold, reply] })],
      commits: [{ sha: 'aaa1111', title: 'Old', url: 'https://github.com/c/1', at: '2026-11-11T08:30:00Z' }, { sha: 'bbb2222', title: 'Fix the hold', url: 'https://github.com/c/2', at: '2026-11-11T09:30:00Z' }],
    });
    const [r] = buildRows([p], ctx());
    expect(r.detail.signoff).toEqual([{ id: 'PRRT_a', url: before.url, path: 'src/x.ts', ask: hold, after: [reply], commits: [{ sha: 'bbb2222', title: 'Fix the hold', url: 'https://github.com/c/2', at: '2026-11-11T09:30:00Z' }] }]);
  });
  it('notes: my human comments on the PR, newest first, at most 5', () => {
    const cs = Array.from({ length: 7 }, (_, i) => ({ author: 'flanakin', body: `Note ${i}`, url: `https://github.com/n/${i}`, at: `2026-11-0${i + 1}T00:00:00Z` }));
    const p = pr({ labels: [], comments: [...cs, { author: 'flanakin', body: '🤖 [AI] agent', url: 'x', at: '2026-11-09T00:00:00Z' }, { author: 'roland', body: 'other', url: 'y' }] });
    const [r] = buildRows([p], ctx());
    expect(r.detail.notes!.map((x) => x.body)).toEqual(['Note 6', 'Note 5', 'Note 4', 'Note 3', 'Note 2']);
  });
  it('review: my pending review link and findings', () => {
    const rv = { url: 'https://github.com/Xerilium/stack/pull/1#pullrequestreview-7', body: 'Two nits', comments: [{ path: 'a.ts', body: 'Nit 1' }] };
    const [r] = buildRows([pr({ author: 'roland', labels: [], pendingReview: rv })], ctx());
    expect(r.detail.review).toEqual(rv);
  });
  it('steps: the live lane checklist, else the validation section of the PR body', () => {
    const body = '## Summary\nStuff\n\n## Validation steps\n1. Open the app\n2. Click Sign in\n- Check the badge\n\n## Notes\n- not a step';
    expect(validationSteps(body)).toEqual(['Open the app', 'Click Sign in', 'Check the badge']);
    expect(validationSteps('No heading here')).toEqual([]);
    const p = pr({ labels: [], body });
    const c = ctx({ live: { url: p.url, state: 'ready-for-michael', serverUrl: 'http://localhost:5174', items: [{ text: 'Login works', state: 'passed' }] } });
    expect(buildRows([p], c)[0].detail.steps).toEqual({ source: 'lane', state: 'ready-for-michael', serverUrl: 'http://localhost:5174', items: [{ text: 'Login works', state: 'passed' }] });
    expect(buildRows([pr({ labels: [], body: `${body}\nlive validation` })], ctx())[0].detail.steps).toEqual({ source: 'body', items: [{ text: 'Open the app' }, { text: 'Click Sign in' }, { text: 'Check the badge' }] });
  });
});
