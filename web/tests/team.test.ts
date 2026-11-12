/** @req FR:agent-team/web.chip @req FR:agent-team/web.chip.live @req FR:agent-team/web.chip.title @req FR:agent-team/web.talk @req FR:agent-team/web.review @req FR:agent-team/web.anything @req FR:agent-team/org.match */
import { describe, expect, it } from 'vitest';
import { agentForAsk, agentsFor, chipFor, liveAgents, matchAgent, ownerOf, sessionFor, verdictLabel, type ReviewItem, type TeamAgent } from '../src/team';
import type { SessionItem } from '../src/sessions';

const ag = (slug: string, scope: string[], o: Partial<TeamAgent> = {}): TeamAgent => ({ slug, name: slug, scope, mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: [], ...o });
const team = [ag('cos', ['*']), ag('labels', ['f4/Labels']), ag('cid', ['f4'], { name: '🎧 Cid Manager', role: 'label manager' })];
const sess = (o: Partial<SessionItem>): SessionItem => ({ id: 'a', title: 't', project: 'f4', cwd: '/x', lastActive: '2026-10-29T10:00:00Z', state: 'idle', cost: { usd: 0, tokens: 0 }, prs: [], ...o });
const review = (o: Partial<ReviewItem> = {}): ReviewItem => ({ ref: 'f4:7', at: '2026-10-29T10:00:00Z', verdict: 'can', plan: 'Upload it', estimate: '2h', agent: 'cid', needs: [], ...o });

describe('agentsFor', () => {
  it('the roll-up first, then most specific: section, project', () => {
    expect(agentsFor(team, 'f4', '🏷️ Labels').map((a) => a.slug)).toEqual(['cos', 'labels', 'cid']);
    expect(agentsFor(team, 'f4', 'Active').map((a) => a.slug)).toEqual(['cos', 'cid']);
    expect(agentsFor(team, 'f4', '✅ Labels done').map((a) => a.slug)).toEqual(['cos', 'labels', 'cid']); // the scope words lead the heading
    expect(agentsFor(team, 'f4', '✅ Labelsmith').map((a) => a.slug)).toEqual(['cos', 'cid']);
    expect(agentsFor(team, 'f4', 'No Labels').map((a) => a.slug)).toEqual(['cos', 'cid']);
    expect(agentsFor(team, 'other').map((a) => a.slug)).toEqual(['cos']);
    expect(agentsFor(team.slice(1), 'other')).toEqual([]);
  });
  // @req FR:agent-team/web.chip.live
  it('drops metadata-only agents no session has matched in 7 days; file agents stay', () => {
    const t = [...team, ag('sweep-manager', ['f4'], { name: '🔄 Sweep Manager', defined: false, source: 'metadata' }), ag('pr-sweep-worker-f4-music', ['f4'], { name: 'PR sweep worker: f4-music', defined: false, source: 'metadata' })];
    const now = new Date('2026-11-01T10:00:00Z');
    const items = [sess({ id: '1', title: 'Sweep Manager v2', lastActive: '2026-10-30T10:00:00Z' }), sess({ id: '2', title: 'PR sweep worker: f4-music', lastActive: '2026-10-01T10:00:00Z' }), sess({ id: '3', title: 'Cid manager', lastActive: '2026-10-31T10:00:00Z' })];
    const live = liveAgents(t, items, now);
    expect([...live].sort()).toEqual(['cid', 'sweep-manager']);
    expect(agentsFor(t, 'f4', 'Active', live).map((a) => a.slug)).toEqual(['cos', 'cid', 'sweep-manager']);
    expect(agentsFor(t, 'f4', 'Active').map((a) => a.slug)).toEqual(['cos', 'cid', 'sweep-manager', 'pr-sweep-worker-f4-music']);
  });
});

// @req FR:agent-team/org.match
describe('matchAgent', () => {
  it('ties a session to the agent whose name or slug opens its title, emoji and case ignored; the longest name wins', () => {
    const t = [...team, ag('allyte-cos', ['allyte'], { name: 'Allyte CoS' }), ag('cos-helper', ['*'], { name: 'CoS helper' })];
    expect(matchAgent(sess({ title: '🎧 Cid Manager · Release · f4:7' }), t)?.slug).toBe('cid');
    expect(matchAgent(sess({ title: 'cid manager: plan the album' }), t)?.slug).toBe('cid');
    expect(matchAgent(sess({ title: 'CoS · f4' }), t)?.slug).toBe('cos');
    expect(matchAgent(sess({ title: 'cos: morning brief' }), t)?.slug).toBe('cos');
    expect(matchAgent(sess({ title: 'Allyte CoS: release' }), t)?.slug).toBe('allyte-cos');
    expect(matchAgent(sess({ title: 'CoS helper · x' }), t)?.slug).toBe('cos-helper');
    expect(matchAgent(sess({ title: 'Cosmic research' }), t)).toBeUndefined();
    // a short role claims the title too: the owner's CoS session is titled by its role
    const t2 = [...t, ag('rollup', ['*'], { name: 'CoS', role: 'Chief of Staff.' }), ag('long', ['*'], { name: 'Long', role: 'Keeps Michael focused across all projects' })];
    expect(matchAgent(sess({ title: '👩 💼 Chief of Staff' }), t2)?.slug).toBe('rollup');
    expect(matchAgent(sess({ title: 'Keeps Michael focused across all projects' }), t2)).toBeUndefined();
    expect(matchAgent(sess({ title: 'fix the parser' }), t)).toBeUndefined();
  });
});

describe('sessionFor', () => {
  it('finds the newest session whose title ends with the ref', () => {
    const items = [sess({ id: '1', title: '🎧 Cid Manager · Release · f4:7', lastActive: '2026-10-29T09:00:00Z' }), sess({ id: '2', title: 'Cid · review · Release · f4:7', lastActive: '2026-10-29T11:00:00Z' }), sess({ id: '3', title: 'x · f4:70' })];
    expect(sessionFor(items, 'f4:7')?.id).toBe('2');
    expect(sessionFor(items, 'f4:8')).toBeUndefined();
  });
});

describe('chip', () => {
  it('reads a live session first, then the verdict, then the agent, then nothing', () => {
    const agent = team[2];
    expect(chipFor({ agent, reviewing: true })).toMatchObject({ text: 'Reviewing…', tone: 'accent' });
    expect(chipFor({ agent, session: sess({ state: 'needs-you' }), review: review() })).toMatchObject({ text: 'Needs you', tone: 'warn' });
    expect(chipFor({ agent, session: sess({ state: 'running', title: 'T' }) })).toMatchObject({ text: 'Working', tone: 'accent', title: 'T' });
    expect(chipFor({ agent, session: sess({ state: 'idle' }), review: review() })).toMatchObject({ text: 'Can · 2h', tone: 'ok', title: 'cid: Upload it (2h)' });
    expect(chipFor({ agent, review: review({ verdict: 'partial', needs: ['a', 'b'] }) })).toMatchObject({ text: 'Partial · needs 2', tone: 'warn', needs: 2, state: true });
    expect(chipFor({ agent, review: review({ verdict: 'partial' }) })).toMatchObject({ text: 'Partial · 2h', tone: 'ok' });
    expect(chipFor({ agent, review: review({ verdict: 'cannot' }) })).toMatchObject({ text: "Can't", tone: 'warn' });
    expect(chipFor({ agent })).toMatchObject({ text: '🎧 Cid Manager', tone: 'plain', title: '🎧 Cid Manager: label manager. Talk to it (a)' });
    // @req FR:agent-team/web.chip.title
    expect(chipFor({ agent: team[0], chain: [team[0], team[2]] })).toMatchObject({ text: 'cos', title: 'cos › 🎧 Cid Manager. Talk to it (a)' });
    expect(chipFor({})).toMatchObject({ text: 'No agent', tone: 'muted' });
    expect(verdictLabel(review({ estimate: undefined }))).toBe('Can');
  });
});

describe('agentForAsk', () => {
  it('prefers the ask author when it is on the team, else the project agent', () => {
    expect(agentForAsk(team, { from: 'cid', project: 'other' })?.slug).toBe('cid');
    expect(agentForAsk(team, { from: '🎧 Cid Manager' })?.slug).toBe('cid');
    expect(agentForAsk(team, { from: 'email-triage', project: 'f4' })?.slug).toBe('cos'); // the project's active agent is the roll-up
    expect(agentForAsk(team, { from: 'email-triage' })).toBeUndefined();
  });
});

// @req FR:task-detail-design/compose.to
describe('ownerOf', () => {
  const ag = (slug: string, scope: string[]) => ({ slug, name: slug, scope, mode: 'ad-hoc' as const, prompt: '', defined: true, source: 'stack' as const, projects: [] });
  it('is the first project-scoped agent, else the roll-up; a second * agent is never the owner', () => {
    expect(ownerOf([ag('cos', ['*']), ag('lead', ['alpha']), ag('scribe', ['*'])])?.slug).toBe('lead');
    expect(ownerOf([ag('cos', ['*']), ag('scribe', ['*'])])?.slug).toBe('cos');
    expect(ownerOf([])).toBeUndefined();
  });
});
