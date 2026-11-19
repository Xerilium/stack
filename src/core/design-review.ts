/**
 * Design review: the page screenshot and goals go to ChatGPT (OpenAI Responses API) in a new, stateless request,
 * and the reply is filed as one GitHub issue. Runs only on the owner's click. See docs/design-review.md.
 */
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { capturePageNow, isPng, redactSecrets } from './feedback';
import { PAGE_GOALS, pageFromRoute, type PageId } from './page-goals';

export type DesignReviewCode = 'shot' | 'down' | 'issue' | 'public';
export class DesignReviewError extends Error { constructor(readonly code: DesignReviewCode, m: string) { super(m); this.name = 'DesignReviewError'; } }

export interface ReviewInput { page: PageId; name: string; goals: string[]; viewport?: string; theme?: 'light' | 'dark'; png: Buffer }
export interface Reviewer { connected(): boolean; model(): string; review(i: ReviewInput): Promise<string> }
/** `shot` is a host capture id from `capture()`; `png` is a browser screenshot. */
export interface DesignReviewRequest { route: string; viewport?: string; theme?: 'light' | 'dark'; shot?: string; png?: Buffer }
export interface DesignReview {
  /** Captures the host window now and holds it for one `run`. */
  capture(): Promise<{ shot: string }>;
  run(r: DesignReviewRequest): Promise<{ page: PageId; url: string }>;
}
/** Same shape as the inbox issue filer (`gh issue create`). */
export interface DesignIssueFiler { file(issue: { repo: string; title: string; body: string; labels: string[] }): Promise<{ url: string }> }
type Env = Record<string, string | undefined>;

const RESPONSES = 'https://api.openai.com/v1/responses';
export const DEFAULT_MODEL = 'gpt-5';
export const DEFAULT_REPO = 'Xerilium/stack';
export const MAX_BODY = 60_000;
const TIMEOUT_MS = 180_000;

const HINT: Record<number, string> = { 401: ': check STACK_OPENAI_API_KEY', 403: ': the key cannot use this model', 429: ': rate limit or quota, try later' };
const key = (env: Env) => env.STACK_OPENAI_API_KEY || env.OPENAI_API_KEY || '';

/** The words sent with the screenshot. @req FR:design-review/review.input */
export function reviewPrompt(i: Omit<ReviewInput, 'png'>): string {
  return [
    `You are a senior product designer. Review this screenshot of the "${i.name}" page of Stack, a personal task and agent manager.`,
    '',
    'Page goals:',
    ...i.goals.map((g) => `- ${g}`),
    '',
    `Viewport: ${i.viewport ?? 'unknown'}. Theme: ${i.theme ?? 'unknown'}.`,
    '',
    // @req FR:design-review/review.private
    'Your reply goes into an issue others can read. Do not quote, name, or describe any task, person, project, message, or other text shown on the page; refer to elements by their role (for example "the first row title").',
    '',
    'Judge the page against its goals. List the top findings, most important first. For each: what is wrong, why it matters for the goals, and one concrete fix. Cover hierarchy, layout, density, typography, color and contrast, and accessibility. End with what works well. Use Markdown.',
  ].join('\n');
}

/** Text from a Responses API reply: `output_text`, else every `output_text` part. */
const replyText = (b: unknown): string => {
  const r = b as { output_text?: unknown; output?: { content?: { type?: string; text?: unknown }[] }[] } | null;
  if (typeof r?.output_text === 'string') return r.output_text;
  return (r?.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text' && typeof c.text === 'string').map((c) => c.text as string).join('\n');
};

/** ChatGPT over the OpenAI API: one new request per review. */
export function createOpenAiReviewer(o: { env?: Env; fetch?: typeof fetch } = {}): Reviewer {
  const env = o.env ?? process.env;
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  // @req FR:design-review/review.model
  const model = () => env.STACK_DESIGN_REVIEW_MODEL || DEFAULT_MODEL;
  return {
    // @req FR:design-review/review.connect
    connected: () => !!key(env),
    model,
    async review(i) {
      const k = key(env);
      if (!k) throw new DesignReviewError('down', 'ChatGPT is not connected: set STACK_OPENAI_API_KEY');
      // A new, stateless request: no earlier response, no conversation, nothing stored. @req FR:design-review/review.fresh @req FR:design-review/review.input
      const body = {
        model: model(), store: false,
        input: [{ role: 'user', content: [{ type: 'input_text', text: reviewPrompt(i) }, { type: 'input_image', image_url: `data:image/png;base64,${i.png.toString('base64')}` }] }],
      };
      let res: Response;
      try {
        res = await get(RESPONSES, { method: 'POST', headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) { throw new DesignReviewError('down', `ChatGPT did not answer: ${e instanceof Error ? e.message : 'network error'}`); }
      if (!res.ok) throw new DesignReviewError('down', `ChatGPT returned ${res.status}${HINT[res.status] ?? ''}`);
      // @req FR:design-review/review.output @req FR:design-review/review.output.empty
      const text = replyText(await res.json().catch(() => null)).trim();
      if (!text) throw new DesignReviewError('down', 'ChatGPT returned an empty reply');
      return text;
    },
  };
}

/** The issue: title by page, AI-prefixed body with the goals, context, and the redacted reply. @req FR:design-review/issue.title @req FR:design-review/issue.body */
export function issueFor(i: { page: PageId; viewport?: string; theme?: 'light' | 'dark'; model: string; reply: string }): { title: string; body: string } {
  const g = PAGE_GOALS[i.page];
  const head = [
    `🤖 [AI] Design review of the **${g.name}** page by ChatGPT (\`${i.model}\`).`,
    '',
    '**Page goals**',
    ...g.goals.map((x) => `- ${x}`),
    '',
    `Viewport: ${i.viewport ?? 'unknown'} · Theme: ${i.theme ?? 'unknown'}`,
    '',
    '## Feedback',
    '',
  ].join('\n');
  // @req FR:design-review/issue.redact
  // @req FR:design-review/issue.mentions: no @mentions in a public issue: a zero-width space after each @ keeps the text and pings no one.
  let reply = redactSecrets(i.reply).replace(/@(?=[A-Za-z0-9])/g, '@\u200b').replace(/#(?=\d)/g, '#\u200b');
  // @req FR:design-review/issue.body.cap
  const note = '\n\n_Reply cut to fit the issue size limit._';
  if (head.length + reply.length > MAX_BODY) reply = reply.slice(0, MAX_BODY - head.length - note.length) + note;
  return { title: `design(${i.page}): Design review of ${g.name}`, body: head + reply };
}

/** `gh repo view`: the repo visibility (`PUBLIC`, `PRIVATE`, `INTERNAL`). */
export function ghRepoVisibility(run: (args: string[]) => Promise<string> = (args) => new Promise((ok, no) => execFile('gh', args, (e, out) => (e ? no(e) : ok(out))))): (repo: string) => Promise<string> {
  return async (repo) => (await run(['repo', 'view', repo, '--json', 'visibility', '-q', '.visibility'])).trim().toUpperCase();
}

const SHOT_TTL_MS = 10 * 60_000;
const MAX_SHOTS = 4;

/** The whole flow: page, screenshot, review, issue. Errors carry a code the route maps to a status. */
export function createDesignReview(o: { reviewer?: Reviewer; filer: DesignIssueFiler; env?: Env; visibility?: (repo: string) => Promise<string>; now?: () => number }): DesignReview {
  const env = o.env ?? process.env;
  const reviewer = o.reviewer ?? createOpenAiReviewer({ env });
  const visibility = o.visibility ?? ghRepoVisibility();
  const now = o.now ?? Date.now;
  /** Host captures waiting for their review: one use each, newest few, short-lived. @req FR:design-review/api.capture */
  const shots = new Map<string, { png: Buffer; at: number }>();
  const notConnected = () => new DesignReviewError('down', 'ChatGPT is not connected: set STACK_OPENAI_API_KEY');
  return {
    async capture() {
      // Before the capture, so a host with no key fails at once. @req FR:design-review/api.down.first
      if (!reviewer.connected()) throw notConnected();
      const png = await capturePageNow();
      if (!png) throw new DesignReviewError('shot', 'This host cannot capture the page');
      for (const [k, v] of shots) if (now() - v.at > SHOT_TTL_MS) shots.delete(k);
      while (shots.size >= MAX_SHOTS) shots.delete(shots.keys().next().value as string);
      const id = randomBytes(12).toString('hex');
      shots.set(id, { png, at: now() });
      return { shot: id };
    },
    async run(r) {
      const page = pageFromRoute(r.route);
      // @req FR:design-review/api.down @req FR:design-review/api.down.first
      if (!reviewer.connected()) throw notConnected();
      // @req FR:design-review/api.shot
      let png = r.png && isPng(r.png) ? r.png : null;
      if (!png && r.shot) {
        const held = shots.get(r.shot);
        shots.delete(r.shot);
        if (held && now() - held.at <= SHOT_TTL_MS) png = held.png;
      }
      if (!png) throw new DesignReviewError('shot', 'A screenshot is needed');
      const repo = env.STACK_DESIGN_REVIEW_REPO || DEFAULT_REPO;
      // Page text can be private: a public repo needs an explicit yes. @req FR:design-review/issue.public
      let vis: string;
      try { vis = await visibility(repo); } catch { throw new DesignReviewError('issue', `Could not read ${repo} (is gh signed in?)`); }
      if (vis !== 'PRIVATE' && vis !== 'INTERNAL' && env.STACK_DESIGN_REVIEW_PUBLIC !== '1') throw new DesignReviewError('public', `${repo} is public: set STACK_DESIGN_REVIEW_PUBLIC=1 to file reviews there`);
      const g = PAGE_GOALS[page];
      let reply: string;
      try { reply = await reviewer.review({ page, name: g.name, goals: g.goals, viewport: r.viewport, theme: r.theme, png }); } catch (e) {
        throw e instanceof DesignReviewError ? e : new DesignReviewError('down', 'ChatGPT review failed');
      }
      const issue = issueFor({ page, viewport: r.viewport, theme: r.theme, model: reviewer.model(), reply });
      // @req FR:design-review/issue.repo @req FR:design-review/api.issue
      try {
        const { url } = await o.filer.file({ repo, ...issue, labels: [] });
        return { page, url };
      } catch { throw new DesignReviewError('issue', 'Could not file the GitHub issue (is gh signed in?)'); }
    },
  };
}
