import { setPageCapture } from '../../src/core/feedback';
import { PAGE_GOALS, PAGE_IDS, pageFromRoute } from '../../src/core/page-goals';
import { createDesignReview, createOpenAiReviewer, DesignReviewError, issueFor, MAX_BODY } from '../../src/core/design-review';

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
    expect([...PAGE_IDS].sort()).toEqual(['asks', 'home', 'inbox', 'list', 'now', 'projects', 'prs', 'qm', 'sessions', 'settings', 'today']);
    for (const id of PAGE_IDS) {
      expect(PAGE_GOALS[id].name.length).toBeGreaterThan(0);
      expect(PAGE_GOALS[id].goals.length).toBeGreaterThanOrEqual(2);
      expect(PAGE_GOALS[id].goals.length).toBeLessThanOrEqual(5);
    }
  });
  // @req FR:design-review/goals.route @req FR:design-review/goals.route.empty @req FR:design-review/goals.route.unknown
  it('takes the page from the route hash', () => {
    expect(pageFromRoute('/#/asks')).toBe('asks');
    expect(pageFromRoute('#asks')).toBe('asks');
    expect(pageFromRoute('/#/list?state=open')).toBe('list');
    expect(pageFromRoute('/#/sessions/team')).toBe('sessions');
    expect(pageFromRoute('#/qm')).toBe('qm');
    expect(pageFromRoute('/')).toBe('now');
    expect(pageFromRoute('')).toBe('now');
    expect(pageFromRoute('/#/nope')).toBeNull();
    expect(pageFromRoute('/#/constructor')).toBeNull();
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
    await expect(createOpenAiReviewer({ env, fetch: fakeFetch({ error: { message: 'bad key' } }, 401).f }).review(args)).rejects.toMatchObject({ code: 'down', message: expect.stringContaining('401') });
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(createOpenAiReviewer({ env, fetch: boom }).review(args)).rejects.toBeInstanceOf(DesignReviewError);
  });
});

describe('issue', () => {
  // @req FR:design-review/issue.title @req FR:design-review/issue.body @req FR:design-review/issue.redact
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

  // @req FR:design-review/issue.repo @req FR:design-review/api.route
  it('reviews the page and files one issue in the default repo', async () => {
    const fl = filer();
    const rv = reviewer();
    const d = createDesignReview({ reviewer: rv, filer: fl, env: {} });
    expect(await d.run({ route: '/#/prs', viewport: '1280x800', theme: 'dark', png: PNG })).toEqual({ page: 'prs', url: 'https://github.com/Xerilium/stack/issues/999' });
    expect(rv.seen).toEqual([expect.objectContaining({ page: 'prs', name: PAGE_GOALS.prs.name, goals: PAGE_GOALS.prs.goals, viewport: '1280x800', theme: 'dark', png: PNG })]);
    expect(fl.filed).toEqual([expect.objectContaining({ repo: 'Xerilium/stack', title: 'design(prs): Design review of Pull requests', labels: [] })]);
    const other = filer();
    await createDesignReview({ reviewer: reviewer(), filer: other, env: { STACK_DESIGN_REVIEW_REPO: 'me/repo' } }).run({ route: '#/now', png: PNG });
    expect(other.filed[0].repo).toBe('me/repo');
  });

  // @req FR:design-review/api.shot @req FR:design-review/ui.shot
  it('uses the host capture, and needs a screenshot', async () => {
    const d = createDesignReview({ reviewer: reviewer(), filer: filer(), env: {} });
    await expect(d.run({ route: '#/now' })).rejects.toMatchObject({ code: 'shot' });
    await expect(d.run({ route: '#/now', capture: true })).rejects.toMatchObject({ code: 'shot' });
    await expect(d.run({ route: '#/now', png: Buffer.from('nope') })).rejects.toMatchObject({ code: 'shot' });
    setPageCapture(async () => { throw new Error('gone'); });
    await expect(d.run({ route: '#/now', capture: true })).rejects.toMatchObject({ code: 'shot' });
    setPageCapture(async () => PNG);
    expect((await d.run({ route: '#/now', capture: true })).page).toBe('now');
  });

  // @req FR:design-review/api.page @req FR:design-review/api.down @req FR:design-review/api.down.issue
  it('maps page, reviewer, and issue failures', async () => {
    await expect(createDesignReview({ reviewer: reviewer(), filer: filer(), env: {} }).run({ route: '#/nope', png: PNG })).rejects.toMatchObject({ code: 'page' });
    const off = { ...reviewer(), connected: () => false };
    await expect(createDesignReview({ reviewer: off, filer: filer(), env: {} }).run({ route: '#/now', png: PNG })).rejects.toMatchObject({ code: 'down' });
    const bad = { file: async () => { throw new Error('gh failed'); } };
    await expect(createDesignReview({ reviewer: reviewer(), filer: bad, env: {} }).run({ route: '#/now', png: PNG })).rejects.toMatchObject({ code: 'issue' });
    const throws = { ...reviewer(), review: async () => { throw new Error('raw'); } };
    await expect(createDesignReview({ reviewer: throws, filer: filer(), env: {} }).run({ route: '#/now', png: PNG })).rejects.toMatchObject({ code: 'down' });
  });
});
