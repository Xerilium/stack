import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hostFilePath, parseReport, readHostFile, ReportBusy, ReportDenied, ReportInvalid, ReportStore, stackHome, writeHostFile } from '../../src/core/reports';

const NOW = new Date('2026-11-11T18:00:00Z');
const home = () => mkdtempSync(join(tmpdir(), 'stack-home-'));
const store = (dir = home(), now = NOW) => new ReportStore(dir, { now: () => now });
const ASK = { id: 'pr-12', ask: 'Approve PR 12', link: 'https://github.com/o/r/pull/12', by: '2026-11-12T17:00:00Z' };
const BODY = {
  top: [{ text: 'Ship status ingest', link: 'https://github.com/o/r/pull/1' }, { text: 'Fix CI' }],
  asks: [ASK],
  blockers: [{ text: 'Waiting on review' }],
  progress: [{ text: 'Spec merged' }],
};
const issues = (fn: () => unknown): { field: string; message: string }[] => {
  try { fn(); } catch (e) { if (e instanceof ReportInvalid) return e.issues; throw e; }
  throw new Error('expected ReportInvalid');
};

describe('parseReport', () => {
  // @req FR:status-ingest/schema.body @req FR:status-ingest/schema.items @req FR:status-ingest/schema.asks @req FR:status-ingest/$report
  it('accepts a full report and defaults empty lists and the ask kind', () => {
    const r = parseReport({ agent: 'xe-cos', project: 'stack', ...BODY });
    expect(r).toMatchObject({ agent: 'xe-cos', project: 'stack', top: BODY.top, blockers: BODY.blockers, progress: BODY.progress });
    expect(r.asks[0]).toEqual({ ...ASK, kind: 'answer' });
    expect(parseReport({ agent: 'a', project: 'p' })).toEqual({ agent: 'a', project: 'p', top: [], asks: [], blockers: [], progress: [] });
  });

  // @req FR:status-ingest/schema.errors @req FR:status-ingest/schema.body @req FR:status-ingest/schema.names
  it('lists every issue at once, including unknown keys and bad names', () => {
    const got = issues(() => parseReport({ agent: 'Bad Agent', project: '', extra: 1, top: 'x', asks: [{ ...ASK, link: 'http://x' }] }));
    expect(got.map((i) => i.field).sort()).toEqual(['agent', 'asks[0].link', 'extra', 'project', 'top']);
    expect(issues(() => parseReport(null)).map((i) => i.field)).toEqual(['body']);
    expect(issues(() => parseReport([])).map((i) => i.field)).toEqual(['body']);
  });

  // @req FR:status-ingest/schema.items
  it('caps top at 3 and blockers and progress at 10; items allow only text and link', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `t${i}` }));
    expect(issues(() => parseReport({ agent: 'a', project: 'p', top: many(4), blockers: many(11), progress: many(11) })).map((i) => i.field)).toEqual(['top', 'blockers', 'progress']);
    const bad = issues(() => parseReport({ agent: 'a', project: 'p', top: [{ text: '' }, { text: 'x'.repeat(201) }, { text: 'ok', link: 'javascript:alert(1)' }], progress: [{ text: 'ok', note: 'x' }, 'str'] }));
    expect(bad.map((i) => i.field)).toEqual(['top[0].text', 'top[1].text', 'top[2].link', 'progress[0].note', 'progress[1]']);
  });

  // @req FR:status-ingest/schema.asks
  it('asks need id, ask, link and by; ids are unique; kind and priority are checked', () => {
    const bad = issues(() => parseReport({ agent: 'a', project: 'p', asks: [
      { ask: 'x', link: ASK.link, by: ASK.by },
      { ...ASK, by: 'tomorrow' },
      { ...ASK, id: 'dup' }, { ...ASK, id: 'dup' },
      { ...ASK, id: 'k', kind: 'decide', priority: 'urgent', options: ['a', 'b'] },
      { ...ASK, id: 'm', link: undefined },
    ] }));
    expect(bad.map((i) => i.field)).toEqual(['asks[0].id', 'asks[1].by', 'asks[3].id', 'asks[4].kind', 'asks[4].priority', 'asks[4].options', 'asks[5].link']);
    expect(issues(() => parseReport({ agent: 'a', project: 'p', asks: Array.from({ length: 11 }, (_, i) => ({ ...ASK, id: `a${i}` })) })).map((i) => i.field)).toEqual(['asks']);
  });

  // @req FR:status-ingest/schema.text
  it('rejects control, line-break and invisible characters instead of cleaning them', () => {
    const bad = issues(() => parseReport({ agent: 'a', project: 'p', top: [{ text: 'a\nb' }, { text: 'a\u0007b' }, { text: 'a\u202eb' }], asks: [{ ...ASK, why: 'x\u2028y' }] }));
    expect(bad.map((i) => i.field)).toEqual(['top[0].text', 'top[1].text', 'top[2].text', 'asks[0].why']);
  });
});

describe('ReportStore', () => {
  // @req FR:status-ingest/store.path @req FR:status-ingest/asks.key @req FR:status-ingest/asks.result @req FR:status-ingest/store.read
  it('stores the report in <home>/reports.json with each ask key; nothing goes to a repo', async () => {
    const s = store();
    const r = await s.put({ agent: 'xe-cos', project: 'stack', ...BODY }, 'xe-cos');
    expect(r).toEqual({ agent: 'xe-cos', project: 'stack', created: true, asks: { put: ['rp.xe-cos.stack.pr-12'], dropped: [] } });
    const raw = JSON.parse(readFileSync(join(s.dir, 'reports.json'), 'utf8'));
    expect(raw.reports['xe-cos/stack']).toMatchObject({ agent: 'xe-cos', project: 'stack', at: NOW.toISOString(), writer: 'xe-cos', top: BODY.top, asks: [{ ...ASK, kind: 'answer', key: 'rp.xe-cos.stack.pr-12' }] });
    expect(s.list().map((x) => `${x.agent}/${x.project}`)).toEqual(['xe-cos/stack']);
    expect(existsSync(join(s.dir, 'reports.lock'))).toBe(false);
  });

  // @req FR:status-ingest/store.path
  it('stackHome is STACK_HOME or <home>/.stack', () => {
    expect(stackHome({ STACK_HOME: '/x' }, '/h')).toBe('/x');
    expect(stackHome({}, '/h')).toBe(join('/h', '.stack'));
  });

  // @req FR:status-ingest/store.replace @req FR:status-ingest/asks.answer.keep @req FR:status-ingest/needs.answer
  it('the latest report replaces the prior one; answers on kept asks stay, dropped asks go', async () => {
    const s = store();
    const other = { id: 'other', ask: 'Pick a name', link: ASK.link, by: ASK.by };
    await s.put({ agent: 'xe-cos', project: 'stack', asks: [ASK, other] }, 'xe-cos');
    await s.put({ agent: 'allyte-cos', project: 'allyte', top: [{ text: 'Keep me' }] }, 'allyte-cos');
    await s.answer('rp.xe-cos.stack.pr-12', { choice: 'reply', text: 'Wait for CI' });
    await s.answer('rp.xe-cos.stack.other', { choice: 'go' });
    const r = await s.put({ agent: 'xe-cos', project: 'stack', top: [{ text: 'New top' }], asks: [{ ...ASK, ask: 'Approve PR 12 now' }] }, 'xe-cos');
    expect(r).toEqual({ agent: 'xe-cos', project: 'stack', created: false, asks: { put: ['rp.xe-cos.stack.pr-12'], dropped: ['rp.xe-cos.stack.other'] } });
    const all = s.list();
    const xe = all.find((x) => x.agent === 'xe-cos')!;
    expect(xe).toMatchObject({ top: [{ text: 'New top' }], blockers: [] });
    expect(xe.asks).toEqual([expect.objectContaining({ key: 'rp.xe-cos.stack.pr-12', ask: 'Approve PR 12 now', answer: { choice: 'reply', text: 'Wait for CI', at: NOW.toISOString() } })]);
    expect(all.find((x) => x.agent === 'allyte-cos')).toMatchObject({ top: [{ text: 'Keep me' }] });
    await s.answer('rp.xe-cos.stack.pr-12', { choice: 'undo' });
    expect(s.list().find((x) => x.agent === 'xe-cos')!.asks[0].answer).toBeUndefined();
    await expect(s.answer('rp.nope.x.y', { choice: 'go' })).rejects.toThrow('Unknown report ask');
  });

  // @req FR:status-ingest/needs.list
  it('needs() maps report asks to Needs you items, newest report first', async () => {
    const dir = home();
    await store(dir).put({ agent: 'a', project: 'p', asks: [{ ...ASK, recommend: 'Approve', default: 'Waits' }] }, 'a');
    await store(dir, new Date('2026-11-11T19:00:00Z')).put({ agent: 'b', project: 'q', asks: [{ ...ASK, id: 'x' }] }, 'b');
    expect(store(dir).needs()).toEqual([
      { id: 'rp.b.q.x', title: 'Approve PR 12', recommendation: 'Open the link and decide', link: ASK.link, project: 'q', by: ASK.by },
      { id: 'rp.a.p.pr-12', title: 'Approve PR 12', recommendation: 'Approve', default: 'Waits', link: ASK.link, project: 'p', by: ASK.by },
    ]);
  });

  // @req FR:status-ingest/schema.errors
  it('writes nothing for an invalid body', async () => {
    const s = store();
    await expect(s.put({ agent: 'a', project: 'p', asks: [ASK, { ...ASK, id: 'b', link: 'nope' }] }, 'a')).rejects.toBeInstanceOf(ReportInvalid);
    expect(existsSync(join(s.dir, 'reports.json'))).toBe(false);
  });

  // @req FR:status-ingest/auth.writer
  it('a token writes only pairs it owns; the owner writes any pair and the first writer keeps it', async () => {
    const s = store();
    await s.put({ agent: 'a', project: 'p', asks: [ASK] }, 'cos', { writer: 'token:cos' });
    await expect(s.put({ agent: 'a', project: 'p' }, 'evil', { writer: 'token:evil' })).rejects.toBeInstanceOf(ReportDenied);
    await expect(s.put({ agent: 'a', project: 'p' }, 'owner')).resolves.toMatchObject({ created: false });
    expect(s.list()[0].writer).toBe('token:cos');
  });

  // @req FR:status-ingest/store.read
  it('list: none for a missing or broken file', () => {
    expect(store().list()).toEqual([]);
    const dir = home(); writeFileSync(join(dir, 'reports.json'), '{oops');
    expect(store(dir).list()).toEqual([]);
  });

  // @req FR:status-ingest/store.lock @req FR:status-ingest/store.atomic
  it('one writer at a time: a held lock waits then fails busy; a stale lock is taken over; no temp files remain', async () => {
    const dir = home();
    writeFileSync(join(dir, 'reports.lock'), '');
    await expect(new ReportStore(dir, { lockWaitMs: 50 }).put({ agent: 'a', project: 'p' }, 'a')).rejects.toBeInstanceOf(ReportBusy);
    const old = new Date(Date.now() - 60_000); utimesSync(join(dir, 'reports.lock'), old, old);
    await new ReportStore(dir, { lockWaitMs: 50 }).put({ agent: 'a', project: 'p' }, 'a');
    const s = new ReportStore(dir);
    await Promise.all(['b', 'c', 'd', 'e'].map((agent) => s.put({ agent, project: 'p' }, agent)));
    expect(s.list().map((x) => x.agent).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(readdirSync(dir).sort()).toEqual(['reports.json']);
  });
});

describe('host.json', () => {
  // @req FR:status-ingest/host.file
  it('the host writes its url; readHostFile accepts only a loopback url; remove deletes only its own file', () => {
    const dir = home();
    expect(readHostFile(dir)).toBeNull();
    const remove = writeHostFile(dir, { url: 'http://127.0.0.1:5123', pid: 42 });
    expect(readHostFile(dir)).toEqual({ url: 'http://127.0.0.1:5123', pid: 42 });
    writeFileSync(hostFilePath(dir), JSON.stringify({ url: 'http://evil.example:80', pid: 1 }));
    expect(readHostFile(dir)).toBeNull();
    remove();
    expect(existsSync(hostFilePath(dir))).toBe(true); // another host's file stays
    writeHostFile(dir, { url: 'http://127.0.0.1:5123', pid: 42 })();
    expect(existsSync(hostFilePath(dir))).toBe(false);
  });
});
