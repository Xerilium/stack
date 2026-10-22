import { captureTask, CaptureError, parseCapture, toTaskText } from '../../src/core/quick-capture';
import { LifecycleError } from '../../src/core/lifecycle';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-22T18:00:00Z'); // Thursday
const now = () => NOW;

type Row = [string, string, { title: string; due?: string; minutes?: number; emoji?: string; project?: string; cadence?: string; weekdays?: string[] }];

// @req FR:quick-capture/parse.@function @req FR:quick-capture/parse.due @req FR:quick-capture/parse.effort
// @req FR:quick-capture/parse.project @req FR:quick-capture/parse.recurrence @req FR:quick-capture/parse.title
const TABLE: Row[] = [
  ['basic', 'call dentist tomorrow 30m', { title: 'Call dentist', due: '2026-10-23', minutes: 30, emoji: '🟢' }],
  ['today', 'buy milk today', { title: 'Buy milk', due: '2026-10-22' }],
  ['tonight', 'laundry tonight', { title: 'Laundry', due: '2026-10-22' }],
  ['day after tomorrow', 'call mom day after tomorrow', { title: 'Call mom', due: '2026-10-24' }],
  ['in n days', 'email Sam in 3 days', { title: 'Email Sam', due: '2026-10-25' }],
  ['in n weeks', 'renew passport in 2 weeks', { title: 'Renew passport', due: '2026-11-05' }],
  ['next week', 'review budget next week', { title: 'Review budget', due: '2026-10-26' }],
  ['by weekday', 'submit report by friday 2h #work', { title: 'Submit report', due: '2026-10-23', minutes: 120, emoji: '🟠', project: 'work' }],
  ['same weekday is next week', 'dentist thursday', { title: 'Dentist', due: '2026-10-29' }],
  ['next weekday', 'dentist next thursday', { title: 'Dentist', due: '2026-10-29' }],
  ['end of month', 'invoice client end of month', { title: 'Invoice client', due: '2026-10-31' }],
  ['month day', 'file taxes oct 30', { title: 'File taxes', due: '2026-10-30' }],
  ['day month', 'file taxes 30 october', { title: 'File taxes', due: '2026-10-30' }],
  ['past month rolls to next year', 'file taxes jan 15', { title: 'File taxes', due: '2027-01-15' }],
  ['iso', 'plan trip 2026-12-01', { title: 'Plan trip', due: '2026-12-01' }],
  ['hours', 'write spec for 1.5 hours', { title: 'Write spec', minutes: 90, emoji: '🟠' }],
  ['compound', 'refactor 1h30m', { title: 'Refactor', minutes: 90, emoji: '🟠' }],
  ['tiny', 'ping Ann 10 min', { title: 'Ping Ann', minutes: 10, emoji: '🔹' }],
  ['hour', 'walk an hour', { title: 'Walk', minutes: 60, emoji: '🟡' }],
  ['half hour', 'read half an hour', { title: 'Read', minutes: 30, emoji: '🟢' }],
  ['hour and a half', 'stretch an hour and a half', { title: 'Stretch', minutes: 90, emoji: '🟠' }],
  ['n and a half hours', 'paint two and a half hours', { title: 'Paint', minutes: 150, emoji: '🔴' }],
  ['big', 'migrate db 6h', { title: 'Migrate db', minutes: 360, emoji: '⚫️' }],
  ['at project', 'fix bug @stack', { title: 'Fix bug', project: 'stack' }],
  ['project phrase', 'write report in project stack', { title: 'Write report', project: 'stack' }],
  ['recur weekday', 'pay rent every Monday', { title: 'Pay rent', cadence: 'weekly', weekdays: ['mon'], due: '2026-10-26' }],
  ['recur today weekday', 'standup every thursday', { title: 'Standup', cadence: 'weekly', weekdays: ['thu'], due: '2026-10-22' }],
  ['daily', 'water plants daily', { title: 'Water plants', cadence: 'daily', due: '2026-10-22' }],
  ['every day', 'stretch every day', { title: 'Stretch', cadence: 'daily', due: '2026-10-22' }],
  ['weekly', 'review inbox weekly', { title: 'Review inbox', cadence: 'weekly', due: '2026-10-22' }],
  ['monthly', 'pay rent monthly', { title: 'Pay rent', cadence: 'monthly', due: '2026-10-22' }],
  ['quarterly', 'estimated taxes every quarter', { title: 'Estimated taxes', cadence: 'quarterly', due: '2026-10-22' }],
  ['yearly with date', 'renew domain yearly oct 30', { title: 'Renew domain', cadence: 'yearly', due: '2026-10-30' }],
  ['no phrase words in title', 'call about the 3rd floor', { title: 'Call about the 3rd floor' }],
  ['keeps number words that are not durations', 'order three pizzas', { title: 'Order three pizzas' }],
  ['trailing connector', 'send invoice by tomorrow', { title: 'Send invoice', due: '2026-10-23' }],
  // speech
  ['speech fillers', 'um, call the dentist uh tomorrow for thirty minutes.', { title: 'Call the dentist', due: '2026-10-23', minutes: 30, emoji: '🟢' }],
  ['speech remind', 'Hey, remind me to email Sam in two days', { title: 'Email Sam', due: '2026-10-24' }],
  ['speech add task', 'okay so add a task to buy stamps tomorrow', { title: 'Buy stamps', due: '2026-10-23' }],
  ['speech hyphen numbers', 'draft memo forty-five minutes', { title: 'Draft memo', minutes: 45, emoji: '🟡' }],
  ['speech you know', 'you know, I mean, clean the garage next friday', { title: 'Clean the garage', due: '2026-10-30' }],
  ['speech upper', 'CALL DENTIST TOMORROW', { title: 'CALL DENTIST', due: '2026-10-23' }],
  ['speech hundred', 'walk in a hundred days', { title: 'Walk', due: '2027-01-30' }],
];

describe('parseCapture', () => {
  it.each(TABLE)('%s: %s', (_n, text, want) => {
    const s = parseCapture(text, { now });
    expect(s.title).toBe(want.title);
    expect(s.due).toBe(want.due);
    expect(s.effort?.minutes).toBe(want.minutes);
    expect(s.effort?.emoji).toBe(want.emoji);
    expect(s.project).toBe(want.project);
    expect(s.recurrence?.cadence).toBe(want.cadence);
    expect(s.recurrence?.weekdays).toEqual(want.weekdays);
  });

  it('is deterministic for the injected clock', () => {
    const a = parseCapture('x tomorrow', { now: () => new Date('2026-12-31T10:00:00Z') });
    expect(a.due).toBe('2027-01-01');
    expect(parseCapture('x tomorrow', { now })).toEqual(parseCapture('x tomorrow', { now }));
  });

  it.each([['tomorrow'], ['  '], ['um uh'], ['30m'], ['every monday and wednesday gym'], ['gym every weekday']])('rejects %j', (t) => {
    expect(() => parseCapture(t, { now })).toThrow(CaptureError);
  });
});

// @req FR:quick-capture/map.row
describe('toTaskText', () => {
  const r = (t: string, n = NOW) => toTaskText(parseCapture(t, { now: () => n }), n);
  it.each([
    ['call dentist tomorrow 30m', '📅 Oct 23: Call dentist 🟢'],
    ['pay rent every Monday', '📅 Monday: 🔄 Weekly: Pay rent'],
    ['water plants daily', '📅 Oct 22: 🔄 Daily: Water plants'],
    ['file taxes jan 15', '📅 Jan 15, 2027: File taxes'],
    ['buy milk', 'Buy milk'],
    ['review inbox weekly 1h', '📅 Oct 22: 🔄 Weekly: Review inbox 🟡'],
  ])('%s', (t, want) => expect(r(t)).toBe(want));
});

// @req FR:quick-capture/map.add
describe('captureTask', () => {
  const setup = async () => {
    const storage = new MemoryStorage();
    const { addProject } = await import('../../src/core/lifecycle');
    await addProject({ storage, now }, { name: 'Alpha', aliases: ['al'] });
    return { storage, ctx: { storage, now } };
  };

  it('adds through the lifecycle using the text hint', async () => {
    const { ctx, storage } = await setup();
    const { result, spec } = await captureTask(ctx, 'call dentist tomorrow 30m #alpha');
    expect(result.changed).toBe(true);
    expect(result.after).toContain('📅 Oct 23: Call dentist 🟢');
    expect(spec.project).toBe('alpha');
    expect((await storage.read('tasks/alpha.md')).content).toContain('- [ ] 📅 Oct 23: Call dentist 🟢');
  });

  it('falls back to the option, hint wins over the option', async () => {
    const { ctx } = await setup();
    expect((await captureTask(ctx, 'x thing', { project: 'al' })).result.changed).toBe(true);
    expect((await captureTask(ctx, 'y thing @alpha', { project: 'ghost' })).result.changed).toBe(true);
  });

  it('errors without a project or with an unknown one', async () => {
    const { ctx } = await setup();
    await expect(captureTask(ctx, 'x thing')).rejects.toThrow(LifecycleError);
    await expect(captureTask(ctx, 'x thing #ghost')).rejects.toThrow(LifecycleError);
  });

  it('dry run does not write', async () => {
    const { ctx, storage } = await setup();
    const before = (await storage.read('tasks/alpha.md')).content;
    const { result } = await captureTask(ctx, 'x thing tomorrow', { project: 'alpha', dryRun: true });
    expect(result.changed).toBe(false);
    expect(result.after).toBe('- [ ] 📅 Oct 23: X thing');
    expect((await storage.read('tasks/alpha.md')).content).toBe(before);
  });
});
