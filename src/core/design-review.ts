/**
 * Design review: the page screenshot and goals go to ChatGPT (OpenAI Responses API) in a new, stateless request,
 * and the reply is filed as one GitHub issue. Runs only on the owner's click. See docs/design-review.md.
 */
import { capturePageNow, isPng, redactSecrets } from './feedback';
import { PAGE_GOALS, pageFromRoute, type PageId } from './page-goals';

export type DesignReviewCode = 'shot' | 'down' | 'issue';
export class DesignReviewError extends Error { constructor(readonly code: DesignReviewCode, m: string) { super(m); this.name = 'DesignReviewError'; } }

export interface ReviewInput { page: PageId; name: string; goals: string[]; viewport?: string; theme?: 'light' | 'dark'; png: Buffer }
export interface Reviewer { connected(): boolean; model(): string; review(i: ReviewInput): Promise<string> }
export interface DesignReviewRequest { route: string; viewport?: string; theme?: 'light' | 'dark'; capture?: boolean; png?: Buffer }
export interface DesignReview { run(r: DesignReviewRequest): Promise<{ page: PageId; url: string }> }
/** Same shape as the inbox issue filer (`gh issue create`). */
export interface DesignIssueFiler { file(issue: { repo: string; title: string; body: string; labels: string[] }): Promise<{ url: string }> }
type Env = Record<string, string | undefined>;

const RESPONSES = 'https://api.openai.com/v1/responses';
export const DEFAULT_MODEL = 'gpt-5';
export const DEFAULT_REPO = 'Xerilium/stack';
export const MAX_BODY = 60_000;
const TIMEOUT_MS = 180_000;

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
      if (!res.ok) throw new DesignReviewError('down', `ChatGPT returned ${res.status}`);
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
  let reply = redactSecrets(i.reply).replace(/@(?=[A-Za-z0-9])/g, '@\u200b');
  // @req FR:design-review/issue.body.cap
  const note = '\n\n_Reply cut to fit the issue size limit._';
  if (head.length + reply.length > MAX_BODY) reply = reply.slice(0, MAX_BODY - head.length - note.length) + note;
  return { title: `design(${i.page}): Design review of ${g.name}`, body: head + reply };
}

/** The whole flow: page, screenshot, review, issue. Errors carry a code the route maps to a status. */
export function createDesignReview(o: { reviewer?: Reviewer; filer: DesignIssueFiler; env?: Env }): DesignReview {
  const env = o.env ?? process.env;
  const reviewer = o.reviewer ?? createOpenAiReviewer({ env });
  return {
    async run(r) {
      const page = pageFromRoute(r.route);
      // Before the capture, so a host with no key fails at once. @req FR:design-review/api.down @req FR:design-review/api.down.first
      if (!reviewer.connected()) throw new DesignReviewError('down', 'ChatGPT is not connected: set STACK_OPENAI_API_KEY');
      // @req FR:design-review/api.shot
      let png = r.png && isPng(r.png) ? r.png : null;
      if (!png && r.capture) png = await capturePageNow();
      if (!png) throw new DesignReviewError('shot', 'A screenshot is needed');
      const g = PAGE_GOALS[page];
      let reply: string;
      try { reply = await reviewer.review({ page, name: g.name, goals: g.goals, viewport: r.viewport, theme: r.theme, png }); } catch (e) {
        throw e instanceof DesignReviewError ? e : new DesignReviewError('down', 'ChatGPT review failed');
      }
      const issue = issueFor({ page, viewport: r.viewport, theme: r.theme, model: reviewer.model(), reply });
      // @req FR:design-review/issue.repo @req FR:design-review/api.issue
      try {
        const { url } = await o.filer.file({ repo: env.STACK_DESIGN_REVIEW_REPO || DEFAULT_REPO, ...issue, labels: [] });
        return { page, url };
      } catch { throw new DesignReviewError('issue', 'Could not file the GitHub issue (is gh signed in?)'); }
    },
  };
}
