/**
 * What each Stack page is for, so a design review judges the page against its job.
 * Names match the web nav labels. @req FR:design-review/goals.file @req FR:design-review/goals.file.pages @req FR:design-review/goals.file.entry
 */
export const PAGE_IDS = ['now', 'home', 'today', 'asks', 'prs', 'inbox', 'sessions', 'projects', 'list', 'settings'] as const;
export type PageId = (typeof PAGE_IDS)[number];
export interface PageGoals { name: string; goals: string[] }

export const PAGE_GOALS: Record<PageId, PageGoals> = {
  now: { name: 'Now', goals: ['Show the one thing to do right now and why', 'Put the next few tasks one glance away', 'Let the owner start, finish, or skip with one action'] },
  home: { name: 'Top asks', goals: ['Show the few decisions only the owner can make, most urgent first', 'Make each ask answerable in place', 'Show when the list was last checked'] },
  today: { name: 'My day', goals: ['Show the plan for today against the time and meetings available', 'Make it easy to add, drop, or reorder a task for today', 'Show what is done so far'] },
  asks: { name: 'Needs you', goals: ['List every item waiting on the owner, from every agent and source', 'Give each row one clear next action', 'Make it fast to clear the list to zero'] },
  prs: { name: 'Pull requests', goals: ['Show which pull requests need the owner, in priority order', 'Show each PR state and checks at a glance', 'Allow the safe actions (Autopilot, comment) without leaving the page'] },
  inbox: { name: 'Inbox', goals: ['Triage incoming mail and messages to zero', 'Show the suggested action per item and let the owner accept it in one click', 'Keep the source and age of each item clear'] },
  sessions: { name: 'Agents', goals: ['Show every agent session, what it works on, and whether it is blocked', 'Let the owner talk to an agent or open its thread', 'Make stale or stuck sessions stand out'] },
  projects: { name: 'Projects', goals: ['Show every project with its priority and next task', 'Let the owner open a project and see its tasks', 'Make the balance of work across projects clear'] },
  list: { name: 'Full stack', goals: ['Show every task in ranked order', 'Make filtering and finding a task fast', 'Let the owner edit a task in place'] },
  settings: { name: 'Settings', goals: ['Group settings so each is easy to find', 'Show which accounts and agents are connected', 'Make each change safe and clear about its effect'] },
};

/** Old and alternate hash names the web app also serves (web/src/filters.ts ALIAS). @req FR:design-review/goals.route.alias */
const ALIAS: Record<string, PageId> = { next: 'home', focus: 'home', brief: 'now', capacity: 'projects', all: 'list', stack: 'list', agents: 'sessions' };

/** The page a route shows, read from its hash (`#/asks`, `#asks`, `/#/list?x=1`), as the web app reads it. @req FR:design-review/goals.route */
export function pageFromRoute(route: string): PageId {
  const hash = route.includes('#') ? route.slice(route.indexOf('#') + 1) : '';
  const name = /^\/?([a-z]*)/.exec(hash)?.[1] ?? '';
  // @req FR:design-review/goals.route.empty
  if (!name) return 'now';
  if (Object.prototype.hasOwnProperty.call(ALIAS, name)) return ALIAS[name];
  // The app shows Now for any other name. @req FR:design-review/goals.route.unknown
  return (PAGE_IDS as readonly string[]).includes(name) ? (name as PageId) : 'now';
}
