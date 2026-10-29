/** @req FR:agent-team/web.chip @req FR:agent-team/web.talk @req FR:agent-team/web.review @req FR:agent-team/web.anything */
import { describe, expect, it } from 'vitest';
import { agentForAsk, agentsFor, chipFor, sessionFor, verdictLabel, type ReviewItem, type TeamAgent } from '../src/team';
import type { SessionItem } from '../src/sessions';

const ag = (slug: string, scope: string[], o: Partial<TeamAgent> = {}): TeamAgent => ({ slug, name: slug, scope, mode: 'ad-hoc', prompt: '', defined: true, projects: [], ...o });
const team = [ag('cos', ['*']), ag('labels', ['f4/Labels']), ag('cid', ['f4'], { name: '🎧 Cid Manager', role: 'label manager' })];
const sess = (o: Partial<SessionItem>): SessionItem => ({ id: 'a', title: 't', project: 'f4', cwd: '/x', lastActive: '2026-10-29T10:00:00Z', state: 'idle', cost: { usd: 0, tokens: 0 }, prs: [], ...o });
const review = (o: Partial<ReviewItem> = {}): ReviewItem => ({ ref: 'f4:7', at: '2026-10-29T10:00:00Z', verdict: 'can', plan: 'Upload it', estimate: '2h', agent: 'cid', needs: [], ...o });

describe('agentsFor', () => {
  it('most specific first: section, project, everything', () => {
    expect(agentsFor(team, 'f4', '🏷️ Labels').map((a) => a.slug)).toEqual(['labels', 'cid', 'cos']);
    expect(agentsFor(team, 'f4', 'Active').map((a) => a.slug)).toEqual(['cid', 'cos']);
    expect(agentsFor(team, 'other').map((a) => a.slug)).toEqual(['cos']);
    expect(agentsFor(team.slice(1), 'other')).toEqual([]);
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
    expect(chipFor({ agent, review: review({ verdict: 'partial', needs: ['a', 'b'] }) })).toMatchObject({ text: 'Partial · needs 2', tone: 'plain', needs: 2 });
    expect(chipFor({ agent, review: review({ verdict: 'cannot' }) })).toMatchObject({ text: "Can't", tone: 'warn' });
    expect(chipFor({ agent })).toMatchObject({ text: '🎧 Cid Manager', tone: 'plain', title: '🎧 Cid Manager: label manager. Talk to it (a)' });
    expect(chipFor({})).toMatchObject({ text: 'No agent', tone: 'muted' });
    expect(verdictLabel(review({ estimate: undefined }))).toBe('Can');
  });
});

describe('agentForAsk', () => {
  it('prefers the ask author when it is on the team, else the project agent', () => {
    expect(agentForAsk(team, { from: 'cid', project: 'other' })?.slug).toBe('cid');
    expect(agentForAsk(team, { from: '🎧 Cid Manager' })?.slug).toBe('cid');
    expect(agentForAsk(team, { from: 'email-triage', project: 'f4' })?.slug).toBe('cid');
    expect(agentForAsk(team, { from: 'email-triage' })).toBeUndefined();
  });
});
