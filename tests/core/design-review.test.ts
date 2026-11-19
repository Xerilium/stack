import { setPageCapture } from '../../src/core/feedback';
import { PAGE_GOALS, PAGE_IDS, pageFromRoute } from '../../src/core/page-goals';
import { createDesignReview, createOpenAiReviewer, DesignReviewError, ghRepoVisibility, issueFor, MAX_BODY, reviewPrompt } from '../../src/core/design-review';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };
const fakeFetch = (reply: unknown, status = 200) => {
  const calls: Call[] = [];
  const f = (async (url: string, init: Call['init']) => { calls.push({ url, init }); return new Response(JSON.stringify(reply), { status }); }) as unknown as typeof fetch;
  return { f, calls };
};
const OK = { output: [{ type: 'message', content: [{ type: 'output_text', text: '1. Too dense.' }] }] };
const filer = () => { const filed: { repo: string; title: string; body: string; labels: string[] }[] = []; return { filed, file: async (i: (typeof filed)[number]) => { filed.push(i); return { url: 'https://github.com/Xerilium/stack/issues/999' }; } }; };
afterEach(() => setPageCapture(undefined));

describe('page goals', () => {
  // @req FR:design-review/goals.file @req FR:design-review/goals.file.pages @req FR:design-review/goals.file.entry
  it('lists every page with a name and 2 to 5 goals', () => {
    expect([...PAGE_IDS].sort()).toEqual(['asks', 'home', 'inbox', 'list', 'now', 'projects', 'prs', 'sessions', 'settings', 'today']);
    for (const id of PAGE_IDS) {
      expect(PAGE_GOALS[id].name.length).toBeGreaterThan(0);
      expect(PAGE_GOALS[id].goals.length).toBeGreaterThanOrEqual(2);
      expect(PAGE_GOALS[id].goals.length).toBeLessThanOrEqual(5);
    }
  });
  // @req FR:design-review/goals.route @req FR:design-review/goals.route.empty @req FR:design-review/goals.route.alias @req FR:design-review/goals.route.unknown
  it('takes the page from the route hash', () => {
    expect(pageFromRoute('/#/asks')).toBe('asks');
    expect(pageFromRoute('#asks')).toBe('asks');
    expect(pageFromRoute('/#/list?state=open')).toBe('list');
    expect(pageFromRoute('/#/prs/review')).toBe('prs');
    expect(pageFromRoute('/#/agents')).toBe('sessions');
    expect(pageFromRoute('#/next')).toBe('home');
    expect(pageFromRoute('#/stack')).toBe('list');
    expect(pageFromRoute('/')).toBe('now');
    expect(pageFromRoute('')).toBe('now');
    expect(pageFromRoute('/#/nope')).toBe('now');
    expect(pageFromRoute('/#/constructor')).toBe('now');
  });
});

describe('OpenAI reviewer', () => {
  // @req FR:design-review/review.connect
  it('is not connected without a key', async () => {
    const { f, calls } = fakeFetch(OK);
    const r = createOpenAiReviewer({ env: {}, fetch: f });
    expect(r.connected()).toBe(false);
    await expect(r.review({ page: 'asks', name: 'Needs you', goals: ['a', 'b'], png: PNG })).rejects.toMatchObject({ code: 'down' });
    expect(calls).toHaveLength(0);
    expect(createOpenAiReviewer({ env: { OPENAI_API_KEY: 'k' } }).connected()).toBe(true);
  });

  // @req FR:design-review/review.fresh @req FR:design-review/review.input @req FR:design-review/review.model @req FR:design-review/review.output
  it('sends one stateless request with the goals and the screenshot', async () => {
    const { f, calls } = fakeFetch(OK);
    const r = createOpenAiReviewer({ env: { STACK_OPENAI_API_KEY: 'sk-stack', OPENAI_API_KEY: 'sk-other' }, fetch: f });
    const out = await r.review({ page: 'asks', name: 'Needs you', goals: ['Show what needs me', 'One action per row'], viewport: '1280x800', theme: 'dark', png: PNG });
    expect(out).toBe('1. Too dense.');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-stack');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe('gpt-5');
    expect(body.store).toBe(false);
    expect(body.previous_response_id).toBeUndefined();
    expect(body.conversation).toBeUndefined();
    expect(body.input).toHaveLength(1);
    const [text, image] = body.input[0].content;
    expect(body.input[0].role).toBe('user');
    expect(text.type).toBe('input_text');
    expect(text.text).toEqual(expect.stringContaining('Needs you'));
    expect(text.text).toEqual(expect.stringContaining('Show what needs me'));
    expect(text.text).toEqual(expect.stringContaining('1280x800'));
    expect(text.text).toEqual(expect.stringContaining('dark'));
    expect(image).toEqual({ type: 'input_image', image_url: `data:image/png;base64,${PNG.toString('base64')}` });
    const m = fakeFetch({ output_text: 'Fine.' });
    expect(await createOpenAiReviewer({ env: { OPENAI_API_KEY: 'k', STACK_DESIGN_REVIEW_MODEL: 'gpt-x' }, fetch: m.f }).review({ page: 'now', name: 'Now', goals: ['a', 'b'], png: PNG })).toBe('Fine.');
    expect(JSON.parse(String(m.calls[0].init.body)).model).toBe('gpt-x');
  });

  // @req FR:design-review/review.output.empty @req FR:design-review/api.down
  it('fails on an empty reply or an HTTP error', async () => {
    const env = { OPENAI_API_KEY: 'k' };
    const args = { page: 'now' as const, name: 'Now', goals: ['a', 'b'], png: PNG };
    await expect(createOpenAiReviewer({ env, fetch: fakeFetch({ output: [] }).f }).review(args)).rejects.toMatchObject({ code: 'down' });
    await expect(createOpenAiReviewer({ env, fetch: fakeFetch({ error: { message: 'bad key' } }, 401).f }).review(args)).rejects.toMatchObject({ code: 'down', message: expect.stringContaining('401: check STACK_OPENAI_API_KEY') });
    await expect(createOpenAiReviewer({ env, fetch: fakeFetch({}, 500).f }).review(args)).rejects.toMatchObject({ message: 'ChatGPT returned 500' });
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(createOpenAiReviewer({ env, fetch: boom }).review(args)).rejects.toBeInstanceOf(DesignReviewError);
  });
});

describe('issue', () => {
  // @req FR:design-review/issue.title @req FR:design-review/issue.body @req FR:design-review/issue.redact @req FR:design-review/issue.mentions
  it('titles by page and starts the body with the AI prefix', () => {
    const i = issueFor({ page: 'asks', viewport: '375x812', theme: 'light', model: 'gpt-5', reply: 'Use ghp_abcdefghijklmnopqrstuvwxyz0123 less.' });
    expect(i.title).toBe('design(asks): Design review of Needs you');
    expect(i.body.startsWith('🤖 [AI] ')).toBe(true);
    for (const g of PAGE_GOALS.asks.goals) expect(i.body).toContain(g);
    expect(i.body).toContain('375x812');
    expect(i.body).toContain('light');
    expect(i.body).toContain('gpt-5');
    expect(i.body).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(i.body).toContain('[redacted]');
    const m = issueFor({ page: 'now', model: 'gpt-5', reply: 'Ask @octocat about #12' });
    expect(m.body).not.toMatch(/@octocat|#12/);
    expect(m.body).toContain('@\u200boctocat about #\u200b12');
  });
  // @req FR:design-review/issue.body.cap
  it('cuts a long reply with a note', () => {
    const i = issueFor({ page: 'now', model: 'gpt-5', reply: 'x'.repeat(MAX_BODY * 2) });
    expect(i.body.length).toBeLessThanOrEqual(MAX_BODY);
    expect(i.body).toMatch(/cut/i);
  });
});

describe('design review', () => {
  const reviewer = (reply = 'Looks fine.') => { const seen: unknown[] = []; return { seen, connected: () => true, model: () => 'gpt-5', review: async (x: unknown) => { seen.push(x); return reply; } }; };
  const priv = async () => 'PRIVATE';
  const mk = (o: Partial<Parameters<typeof createDesignReview>[0]> = {}) => createDesignReview({ reviewer: reviewer(), filer: filer(), env: {}, visibility: priv, ...o });

  // @req FR:design-review/issue.repo @req FR:design-review/api.route
  it('reviews the page and files one issue in the default repo', async () => {
    const fl = filer();
    const rv = reviewer();
    const repos: string[] = [];
    const d = mk({ reviewer: rv, filer: fl, visibility: async (r) => { repos.push(r); return 'PRIVATE'; } });
    expect(await d.run({ route: '/#/prs', viewport: '1280x800', theme: 'dark', png: PNG })).toEqual({ page: 'prs', url: 'https://github.com/Xerilium/stack/issues/999' });
    expect(rv.seen).toEqual([expect.objectContaining({ page: 'prs', name: PAGE_GOALS.prs.name, goals: PAGE_GOALS.prs.goals, viewport: '1280x800', theme: 'dark', png: PNG })]);
    expect(fl.filed).toEqual([expect.objectContaining({ repo: 'Xerilium/stack', title: 'design(prs): Design review of Pull requests', labels: [] })]);
    expect(repos).toEqual(['Xerilium/stack']);
    const other = filer();
    await mk({ filer: other, env: { STACK_DESIGN_REVIEW_REPO: 'me/repo' } }).run({ route: '#/now', png: PNG });
    expect(other.filed[0].repo).toBe('me/repo');
  });

  // @req FR:design-review/issue.public
  it('files in a public repo only with an explicit yes', async () => {
    const fl = filer();
    await expect(mk({ filer: fl, visibility: async () => 'PUBLIC' }).run({ route: '#/now', png: PNG })).rejects.toMatchObject({ code: 'public' });
    expect(fl.filed).toHaveLength(0);
    await expect(mk({ visibility: async () => { throw new Error('gh'); } }).run({ route: '#/now', png: PNG })).rejects.toMatchObject({ code: 'issue' });
    expect((await mk({ filer: fl, visibility: async () => 'PUBLIC', env: { STACK_DESIGN_REVIEW_PUBLIC: '1' } }).run({ route: '#/now', png: PNG })).page).toBe('now');
    expect((await mk({ visibility: async () => 'INTERNAL' }).run({ route: '#/now', png: PNG })).page).toBe('now');
    const args: string[][] = [];
    expect(await ghRepoVisibility(async (a) => { args.push(a); return 'private\n'; })('me/repo')).toBe('PRIVATE');
    expect(args[0]).toEqual(['repo', 'view', 'me/repo', '--json', 'visibility', '-q', '.visibility']);
  });

  // @req FR:design-review/api.capture @req FR:design-review/api.shot @req FR:design-review/ui.shot
  it('holds a host capture for one review, and needs a screenshot', async () => {
    let t = 0;
    const d = mk({ now: () => t });
    await expect(d.run({ route: '#/now' })).rejects.toMatchObject({ code: 'shot' });
    await expect(d.capture()).rejects.toMatchObject({ code: 'shot' });
    await expect(d.run({ route: '#/now', png: Buffer.from('nope') })).rejects.toMatchObject({ code: 'shot' });
    setPageCapture(async () => { throw new Error('gone'); });
    await expect(d.capture()).rejects.toMatchObject({ code: 'shot' });
    setPageCapture(async () => PNG);
    const { shot } = await d.capture();
    expect(shot).toMatch(/^[0-9a-f]{24}$/);
    expect((await d.run({ route: '#/now', shot })).page).toBe('now');
    // One use only.
    await expect(d.run({ route: '#/now', shot })).rejects.toMatchObject({ code: 'shot' });
    // Expired after 10 minutes.
    const old = (await d.capture()).shot;
    t += 10 * 60_000 + 1;
    await expect(d.run({ route: '#/now', shot: old })).rejects.toMatchObject({ code: 'shot' });
    // Only the newest few are kept.
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await d.capture()).shot);
    await expect(d.run({ route: '#/now', shot: ids[0] })).rejects.toMatchObject({ code: 'shot' });
    expect((await d.run({ route: '#/now', shot: ids[5] })).page).toBe('now');
  });

  // @req FR:design-review/api.down @req FR:design-review/api.down.first @req FR:design-review/api.issue
  it('maps reviewer and issue failures, and checks the key before the capture', async () => {
    const off = { ...reviewer(), connected: () => false };
    let captured = 0;
    setPageCapture(async () => { captured++; return PNG; });
    await expect(mk({ reviewer: off }).capture()).rejects.toMatchObject({ code: 'down' });
    await expect(mk({ reviewer: off }).run({ route: '#/now', png: PNG })).rejects.toMatchObject({ code: 'down' });
    expect(captured).toBe(0);
    const bad = { file: async () => { throw new Error('gh failed'); } };
    await expect(mk({ filer: bad }).run({ route: '#/now', png: PNG })).rejects.toMatchObject({ code: 'issue' });
    const throws = { ...reviewer(), review: async () => { throw new Error('raw'); } };
    await expect(mk({ reviewer: throws }).run({ route: '#/now', png: PNG })).rejects.toMatchObject({ code: 'down' });
  });
});

// @req FR:design-review/review.private
it('tells ChatGPT not to repeat page content', () => {
  expect(reviewPrompt({ page: 'now', name: 'Now', goals: ['a', 'b'] })).toMatch(/Do not quote, name, or describe any task, person, project, message/);
});
