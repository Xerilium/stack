/** @req FR:agent-team/web.chip @req FR:agent-team/web.chip.live @req FR:agent-team/web.chip.title @req FR:agent-team/web.talk @req FR:agent-team/web.review @req FR:agent-team/web.anything @req FR:agent-team/org.match */
import { describe, expect, it } from 'vitest';
import { agentForAsk, agentsFor, ancestorsOf, runnable, chipFor, liveAgents, matchAgent, ownerOf, sessionFor, verdictLabel, type ReviewItem, type TeamAgent } from '../src/team';
import type { SessionItem } from '../src/sessions';

const ag = (slug: string, scope: string[], o: Partial<TeamAgent> = {}): TeamAgent => ({ slug, name: slug, scope, mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: [], ...o });
const team = [ag('cos', ['*']), ag('labels', ['f4/Labels']), ag('cid', ['f4'], { name: '🎧 Cid Manager', role: 'label manager' })];
const sess = (o: Partial<SessionItem>): SessionItem => ({ id: 'a', title: 't', project: 'f4', cwd: '/x', lastActive: '2026-10-29T10:00:00Z', state: 'idle', cost: { usd: 0, tokens: 0 }, prs: [], ...o });
const review = (o: Partial<ReviewItem> = {}): ReviewItem => ({ ref: 'f4:7', at: '2026-10-29T10:00:00Z', verdict: 'can', plan: 'Upload it', estimate: '2h', agent: 'cid', needs: [], ...o });

// @req FR:agent-team/agent.team.scan.view
describe('view-only scanned agents', () => {
  const base: TeamAgent = { slug: 'cos', name: 'CoS', scope: ['*'], mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: ['f4'] };
  const away: TeamAgent = { slug: 'fh-dev', name: 'FH Dev', scope: ['f4'], mode: 'ad-hoc', prompt: '', defined: true, source: 'claude', projects: ['f4'], home: 'finops-hubs' };
  const user: TeamAgent = { ...away, slug: 'helper', name: 'Helper', home: 'user' };
  it('is not runnable when it has a home', () => {
    expect(runnable(base)).toBe(true);
    expect(runnable(away)).toBe(false);
    expect(runnable(user)).toBe(false);
  });
  it('is never offered to assign, review or talk', () => {
    expect(agentsFor([base, away, user], 'f4').map((a) => a.slug)).toEqual(['cos']);
  });
  it('never answers an ask from its name; the project agent does', () => {
    expect(agentForAsk([base, away], { from: 'fh-dev', project: 'f4' })?.slug).toBe('cos');
    expect(agentForAsk([away], { from: 'FH Dev' })).toBeUndefined();
  });
});

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
    // a session started under the old H1 prefix still ties to the agent
    expect(matchAgent(sess({ title: 'Team Captain · release' }), [...t, ag('lead', ['*'], { name: 'Project Coordinator', aliases: ['Team Captain'] })])?.slug).toBe('lead');
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
    expect(chipFor({ agent })).toMatchObject({ text: '🎧 Cid Manager', tone: 'plain', title: '🎧 Cid Manager: label manager. Talk to it (a)', agent }); // @req FR:product-reset/ui.agentchip: avatar + name
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
  it('with the task, picks by the scope that matched: an agent that also holds * still owns its section', () => {
    const team = [ag('cos', ['*']), ag('section', ['*', 'alpha/Active']), ag('lead', ['alpha'])];
    const task = { project: 'alpha', section: '🔄 Active' };
    expect(ownerOf(agentsFor(team, task.project, task.section), task)?.slug).toBe('section');
    // Elsewhere in alpha the section owner matches only through *: the project agent owns it.
    expect(ownerOf(agentsFor(team, 'alpha', '📋 Backlog'), { project: 'alpha', section: '📋 Backlog' })?.slug).toBe('lead');
    // A * agent with another project's scope is never the owner here.
    const other = [ag('cos', ['*']), ag('beta-lead', ['*', 'beta'])];
    expect(ownerOf(agentsFor(other, 'alpha'), { project: 'alpha' })?.slug).toBe('cos');
  });
});

// One owner rule for the chip, the composer, the tiles and Now. @req FR:product-reset/schema.agent @req FR:product-reset/schema.owner
describe('ownerOf: the owning agent', () => {
  const meta = (slug: string, name: string, scope: string[]) => ag(slug, scope, { name, defined: false, source: 'metadata', projects: scope });
  const sweep = meta('sweep-manager', '🔄 Sweep Manager', ['allyte', 'f4', 'focus']);
  const cid = meta('cid-manager', '🎧 Cid Manager', ['f4']);
  const allyteCos = ag('allyte-cos', ['allyte', 'alescent'], { source: 'claude', projects: ['allyte', 'alescent'] });
  const crew = [ag('cos', ['*']), sweep, cid, allyteCos];
  it('is never the roll-up when a project agent covers the task', () => {
    expect(ownerOf(crew, { project: 'f4', section: '🔄 Active' })?.slug).toBe('cid-manager');
  });
  it('prefers the narrower agent over a broad worker listed first', () => {
    expect(ownerOf([ag('cos', ['*']), sweep, cid], { project: 'f4' })?.slug).toBe('cid-manager');
  });
  it('prefers an agent with a definition file over a metadata line', () => {
    expect(ownerOf([ag('cos', ['*']), sweep, meta('pmm', 'FinOps PMM', ['allyte']), allyteCos], { project: 'allyte' })?.slug).toBe('allyte-cos');
  });
  it('is the roll-up when no project agent covers the task', () => {
    expect(ownerOf(crew, { project: 'house' })?.slug).toBe('cos');
    expect(ownerOf([cid], { project: 'house' })).toBeUndefined(); // no roll-up: no agent, never an unrelated one
  });
  it('takes Owner: from the task, else the nearest ancestor that names an agent or me', () => {
    const f4 = { project: 'f4', section: 'Active' };
    expect(ownerOf(crew, { ...f4, notes: ['Owner: allyte-cos'] })?.slug).toBe('allyte-cos');
    expect(ownerOf(crew, { ...f4, notes: ['**Owner:** 🔄 Sweep Manager'] })?.slug).toBe('sweep-manager');
    expect(ownerOf(crew, f4, [{ ...f4, notes: ['Owner: allyte-cos'] }])?.slug).toBe('allyte-cos');
    expect(ownerOf(crew, { ...f4, notes: ['Owner: sweep-manager'] }, [{ ...f4, notes: ['Owner: allyte-cos'] }])?.slug).toBe('sweep-manager');
    // `me` on the nearer ancestor stops the walk: the task's agent is then the scope owner.
    expect(ownerOf(crew, f4, [{ ...f4, notes: ['Owner: me'] }, { ...f4, notes: ['Owner: allyte-cos'] }])?.slug).toBe('cid-manager');
    // An unknown name does not stop the walk.
    expect(ownerOf(crew, f4, [{ ...f4, notes: ['Owner: nobody-here'] }, { ...f4, notes: ['Owner: allyte-cos'] }])?.slug).toBe('allyte-cos');
  });
  it('reads Owner only with its colon', () => {
    const f4 = { project: 'f4' };
    expect(ownerOf(crew, { ...f4, notes: ['Ownership moved to allyte-cos'] })?.slug).toBe('cid-manager');
    expect(ownerOf(crew, f4, [{ ...f4, notes: ['Owner me'] }, { ...f4, notes: ['Owner: allyte-cos'] }])?.slug).toBe('allyte-cos');
  });
  it('never falls back to a view-only * agent: the runnable roll-up takes it, else no agent', () => {
    const away = ag('away-cos', ['*'], { home: 'other' });
    expect(ownerOf([away, ag('cos', ['*'])], { project: 'house' })?.slug).toBe('cos');
    expect(ownerOf([away, cid], { project: 'house' })).toBeUndefined();
  });
  it('never picks a view-only agent from Owner:', () => {
    expect(ownerOf([...crew, ag('away', ['x'], { home: 'other' })], { project: 'f4', notes: ['Owner: away'] })?.slug).toBe('cid-manager');
  });
});

describe('ancestorsOf', () => {
  const t = (ref: string, depth: number, project = 'a') => ({ ref, project, depth });
  const list = [t('a:1', 0), t('a:2', 1), t('a:3', 2), t('a:4', 1), t('b:1', 0, 'b'), t('b:2', 1, 'b')];
  it('walks up the file order, nearest first, within the project', () => {
    expect(ancestorsOf(list, 'a:3').map((x) => x.ref)).toEqual(['a:2', 'a:1']);
    expect(ancestorsOf(list, 'a:4').map((x) => x.ref)).toEqual(['a:1']);
    expect(ancestorsOf(list, 'b:2').map((x) => x.ref)).toEqual(['b:1']);
    expect(ancestorsOf(list, 'a:1')).toEqual([]);
    expect(ancestorsOf(list, 'zz:1')).toEqual([]);
    const index = new Map(list.map((x, i) => [x.ref, i]));
    expect(ancestorsOf(list, 'a:3', index).map((x) => x.ref)).toEqual(['a:2', 'a:1']); // the same with a ref index
  });
  it('stops at a section boundary', () => {
    const s = [{ ...t('a:1', 0), section: 'Active' }, { ...t('a:9', 1), section: 'Backlog' }];
    expect(ancestorsOf(s, 'a:9')).toEqual([]);
  });
});
