import { existsSync, mkdtempSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FeedbackError, FeedbackStore, redactSecrets, setPageCapture } from '../../src/core/feedback';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const NOW = new Date('2026-11-12T18:00:00Z');
let home: string;
const mk = (o: ConstructorParameters<typeof FeedbackStore>[1] = {}) => new FeedbackStore(home, { now: () => NOW, ...o });
const lines = (f = 'feedback.jsonl') => readFileSync(join(home, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'stack-fb-')); setPageCapture(undefined); });

describe('FeedbackStore', () => {
  // @req FR:feedback-button/store.path @req FR:feedback-button/store.line
  it('appends one JSON line per item, 0600, with host app info', async () => {
    const s = mk({ app: { appVersion: '1.2.3', sha: 'abc1234' } });
    const a = await s.add({ text: 'Rail is too wide', route: '/#list', viewport: '1280x800', theme: 'dark' });
    const b = await s.add({ text: 'second' });
    expect(a).toMatchObject({ at: NOW.toISOString(), text: 'Rail is too wide', route: '/#list', viewport: '1280x800', theme: 'dark', appVersion: '1.2.3', sha: 'abc1234' });
    expect(a.id < b.id).toBe(true);
    expect(lines().map((x) => x.id)).toEqual([a.id, b.id]);
    expect(readFileSync(join(home, 'feedback.jsonl'), 'utf8').endsWith('\n')).toBe(true);
    expect(statSync(join(home, 'feedback.jsonl')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(home, 'feedback.lock'))).toBe(false);
  });

  // @req FR:feedback-button/api.route
  it('rejects blank or too long text', async () => {
    await expect(mk().add({ text: '  ' })).rejects.toBeInstanceOf(FeedbackError);
    await expect(mk().add({ text: 'x'.repeat(4001) })).rejects.toBeInstanceOf(FeedbackError);
  });

  // @req FR:feedback-button/store.redact
  it('removes tokens from text and the query from route', async () => {
    const it = await mk().add({ text: 'stk_ab12cd34.s3cretvalue key ghp_abcdefghijklmnopqrstuvwxyz0123456789 and Bearer abc.def.ghi sk-ant-api03-xxxxxxxxxxxxxxxxxxxx', route: '/x?token=secret#asks' });
    expect(it.text).not.toMatch(/stk_|s3cret|ghp_|abc\.def|sk-ant/);
    expect(it.text).toContain('[redacted]');
    expect(it.route).toBe('/x#asks');
    expect((await mk().add({ text: 'x', route: '/#/list?code=abc' })).route).toBe('/#/list');
    expect(redactSecrets('plain words stay')).toBe('plain words stay');
  });

  // @req FR:feedback-button/store.atomic @req FR:feedback-button/store.path
  it('saves an uploaded PNG before its line; checks magic and size', async () => {
    const it = await mk().add({ text: 'look' }, { png: PNG });
    expect(it.screenshotPath).toBe(join(home, 'feedback', `${it.id}.png`));
    expect(readFileSync(it.screenshotPath!)).toEqual(PNG);
    expect(statSync(it.screenshotPath!).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'feedback')).mode & 0o777).toBe(0o700);
    await expect(mk().add({ text: 'x' }, { png: Buffer.from('not a png') })).rejects.toBeInstanceOf(FeedbackError);
    await expect(mk({ maxPngBytes: 10 }).add({ text: 'x' }, { png: PNG })).rejects.toBeInstanceOf(FeedbackError);
  });

  // @req FR:feedback-button/store.capture
  it('captures the page through the registered capture; a failed capture stores no screenshot', async () => {
    expect((await mk().add({ text: 'none' }, { capture: true })).screenshotPath).toBeUndefined();
    setPageCapture(async () => PNG);
    const it = await mk().add({ text: 'shot' }, { capture: true });
    expect(readFileSync(it.screenshotPath!)).toEqual(PNG);
    setPageCapture(async () => { throw new Error('gone'); });
    expect((await mk().add({ text: 'fail' }, { capture: true })).screenshotPath).toBeUndefined();
  });

  // @req FR:feedback-button/store.done @req FR:feedback-button/cli.list
  it('marks done in a sidecar and lists after an id', async () => {
    const s = mk();
    const a = await s.add({ text: 'a' });
    const b = await s.add({ text: 'b' });
    expect(await s.done(a.id)).toEqual({ id: a.id, changed: true });
    expect(await s.done(a.id)).toEqual({ id: a.id, changed: false });
    await expect(s.done('fb-nope')).rejects.toBeInstanceOf(FeedbackError);
    expect(lines('feedback.done.jsonl')).toEqual([{ id: a.id, at: NOW.toISOString() }]);
    expect(s.list().map((x) => [x.id, x.done])).toEqual([[a.id, true], [b.id, false]]);
    expect(s.list({ since: a.id }).map((x) => x.id)).toEqual([b.id]);
    expect(mk().list()).toHaveLength(2);
  });

  // @req FR:feedback-button/store.atomic
  it('parallel writers each land one whole line, ids in file order', async () => {
    const a = new FeedbackStore(home), b = new FeedbackStore(home);
    await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).add({ text: `n${i} ` + 'y'.repeat(2000) })));
    const raw = readFileSync(join(home, 'feedback.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(raw).toHaveLength(40);
    const ids = raw.map((l) => JSON.parse(l).id as string);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(40);
  });

  it('lists nothing when there is no file', () => { expect(mk().list()).toEqual([]); });
});
