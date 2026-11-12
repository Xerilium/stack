/**
 * `stack pr-pri`: the owner's PR priority queue for the Sweep Manager, agent recommendations, edges, acks and escalations.
 * Live state under ~/.stack; needs no content repo; no LLM call. The only GitHub call is a `gh` read on `list --refresh`.
 * @req FR:pr-priority/cli.edit @req FR:pr-priority/record.model @req FR:pr-priority/cli.recommend @req FR:pr-priority/cli.decisions @req FR:pr-priority/cli.decide @req FR:pr-priority/cli.more
 */
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { blockedText, parsePrRef, PrPriorityStore, prUrl, type Decision, type PrPriView, type QueueOp } from '../core/pr-priority';
import { stackHome } from '../core/reports';
import { BOOLEAN_FLAGS, UsageError } from './args';
import { briefCmd } from './pr-review';

export interface PrPriOutcome { json: Record<string, unknown>; text: string; code?: number }
type Flags = Record<string, string | true>;

export const PR_PRI_USAGE = 'pr-pri brief <ref> [--file brief.json --agent a] [--refresh] | list [--refresh] | add <ref> [--rank n] [--note t] | move <ref> --top|--up|--down|--to <n> | pin|unpin|remove <ref> | undo | recommend <ref> --agent a --reason t [--to-rank n] | accept <id> | edit <id> --reason t [--rank n] [--note t] | reject <id> --reason t | decisions [--agent a] | depends <ref> --on <ref> [--remove] | depends --file edges.json [--remove] | record <ref> [--file rec.json] | ack <ref> --thread url --note t | escalate --file set.json';

/**
 * `--top`, `--up` and `--down` are spelled `--to=<target>` before parsing (`--top` takes a value for other commands).
 * The command is found with the shared parser's flag/value boundaries; nothing after `--` is rewritten.
 */
export function prPriArgv(argv: string[]): string[] {
  const end = argv.indexOf('--');
  const stop = end === -1 ? argv.length : end;
  let cmd = -1;
  for (let i = 0; i < stop; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { cmd = i; break; }
    if (!a.includes('=') && !BOOLEAN_FLAGS.has(a.slice(2))) i++; // a value-taking flag: skip its value
  }
  if (cmd === -1 || argv[cmd] !== 'pr-pri') return argv;
  const TO: Record<string, string> = { '--top': '--to=top', '--up': '--to=up', '--down': '--to=down' };
  return argv.map((a, i) => (i > cmd && i < stop && TO[a] ? TO[a] : a));
}

const str = (f: Flags, n: string): string | undefined => {
  const v = f[n];
  if (v === true) throw new UsageError(`--${n} needs a value`);
  return v;
};
const int = (f: Flags, n: string): number | undefined => {
  const v = str(f, n);
  if (v === undefined) return undefined;
  if (!/^\d{1,9}$/.test(v)) throw new UsageError(`--${n} must be a whole number: ${v}`);
  return Number(v);
};

/** One row per PR, under 20 words. @req FR:pr-priority/view.text */
const rows = (items: PrPriView[]): string => (items.length
  ? items.map((i) => `${i.rank}. ${i.url}${i.pinned ? ' 📌' : ''}${i.status ? ` ${i.status}` : ''}${i.note ? ` - ${i.note.length > 60 ? `${i.note.slice(0, 59)}…` : i.note}` : ''}`).join('\n')
  : 'no PR priorities (run: stack pr-pri add <repo>#<n>)');

/** Reads one PR through `gh` (STACK_GH or gh); null when gh fails. */
const ghRead = (repo: string, n: number): Promise<unknown> => new Promise((ok) => {
  execFile(process.env.STACK_GH || 'gh', ['pr', 'view', String(n), '-R', repo, '--json', 'title,author,isDraft,assignees,labels,reviewDecision,statusCheckRollup,mergeable,commits,headRefOid,state'], { timeout: 20_000, maxBuffer: 4 << 20 }, (err, out) => {
    if (err) return ok(null);
    try { ok(JSON.parse(out)); } catch { ok(null); }
  });
});

/** JSON from `--file` or stdin; bad or missing input is a usage error. */
async function readJson(f: Flags, input: () => Promise<string | null>, what: string): Promise<unknown> {
  const file = str(f, 'file');
  let text: string | null;
  if (file !== undefined) { try { text = readFileSync(resolve(file), 'utf8'); } catch { throw new UsageError(`Cannot read --file: ${file}`); } } else text = await input();
  if (!text?.trim()) throw new UsageError(`${what} needs JSON on stdin or --file <path>`);
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new UsageError(`${what} input is not valid JSON`); }
}

/** Runs one `stack pr-pri` subcommand. */
export async function prPriCmd(positionals: string[], f: Flags, input: () => Promise<string | null>): Promise<PrPriOutcome> {
  const home = stackHome();
  const store = new PrPriorityStore(home);
  const [sub = 'list', arg, extra] = positionals;
  // Agent briefs live in the PR review lane. @req FR:pr-review-lane/brief.cli
  if (sub === 'brief') return briefCmd({ command: 'pr-pri', positionals, flags: f });
  if (extra !== undefined) throw new UsageError(`Unexpected argument: ${extra}`);
  const view = (more: Record<string, unknown> = {}): PrPriOutcome => {
    const q = store.read();
    const items = store.view();
    return { json: { ok: true, ...more, version: q.version, rev: q.rev, ...(q.updatedAt ? { updatedAt: q.updatedAt } : {}), items, escalations: store.state().escalations ?? null }, text: rows(items) };
  };
  const need = (what: string) => { if (!arg) throw new UsageError(`pr-pri ${sub} needs ${what}`); return arg; };
  const noArg = () => { if (arg !== undefined) throw new UsageError(`Unexpected argument: ${arg}`); };
  const rev = int(f, 'rev');
  const edit = async (op: QueueOp) => { const r = await store.edit(op, rev === undefined ? {} : { rev }); return view({ changed: r.changed }); };
  const decide = async (decision: Decision) => {
    const id = need('<id>');
    const rank = int(f, 'rank'); const note = str(f, 'note'); const reason = str(f, 'reason');
    const r = await store.decide(id, { decision, ...(rank !== undefined ? { rank } : {}), ...(note !== undefined ? { note } : {}), ...(reason !== undefined ? { reason } : {}) });
    return view({ changed: r.changed, rec: r.rec });
  };
  switch (sub) {
    // @req FR:pr-priority/view.item @req FR:pr-priority/view.refresh
    case 'list': {
      noArg();
      if (f.refresh === true) await store.refresh(ghRead);
      return view();
    }
    case 'add': {
      const rank = int(f, 'rank'); const note = str(f, 'note');
      return edit({ op: 'add', ref: need('<ref>'), ...(rank !== undefined ? { rank } : {}), ...(note !== undefined ? { note } : {}) });
    }
    case 'move': {
      const t = str(f, 'to');
      if (t === undefined) throw new UsageError('pr-pri move needs --top, --up, --down or --to <rank>');
      const to = t === 'top' || t === 'up' || t === 'down' ? t : int(f, 'to')!;
      const note = str(f, 'note');
      return edit({ op: 'move', ref: need('<ref>'), to, ...(note !== undefined ? { note } : {}) });
    }
    case 'pin': case 'unpin': case 'remove': return edit({ op: sub, ref: need('<ref>') });
    case 'undo': noArg(); return edit({ op: 'undo' });
    case 'recommend': {
      const ref = need('<ref>');
      const agent = str(f, 'agent'); const reason = str(f, 'reason'); const toRank = int(f, 'to-rank');
      if (!agent) throw new UsageError('pr-pri recommend needs --agent <name>');
      if (!reason) throw new UsageError('pr-pri recommend needs --reason <text>');
      const p = parsePrRef(ref);
      const r = await store.recommend({ ...p, agent, reason, ...(toRank !== undefined ? { toRank } : {}) });
      // @req FR:pr-priority/rec.memory: a blocked recommendation exits 4 with the owner's reason.
      if ('blocked' in r) return { json: { ok: false, blocked: r.blocked }, text: blockedText(r.blocked), code: 4 };
      return { json: { ok: true, ...r }, text: `${r.created ? 'recommended' : 'already open:'} ${r.rec.id} ${r.rec.url}` };
    }
    case 'accept': return decide('accept');
    case 'edit': return decide('edit');
    case 'reject': return decide('reject');
    case 'decisions': {
      noArg();
      const items = store.decisions(str(f, 'agent'));
      return { json: { ok: true, items }, text: items.length ? items.map((d) => `${d.state} ${d.url} (${d.agent}) ${d.decision!.at.slice(0, 10)}: ${d.decision!.reason ?? '-'}`).join('\n') : 'no decisions' };
    }
    case 'depends': {
      // One edge, or many from --file / stdin as [{pr, on}]. @req FR:pr-priority/edge.depends
      const on = str(f, 'on');
      if (!arg) {
        const r = await store.dependsMany(await readJson(f, input, 'pr-pri depends'), f.remove === true);
        return { json: { ok: true, ...r }, text: `edges ${f.remove === true ? 'removed' : 'added'}: ${r.count}` };
      }
      if (!on) throw new UsageError('pr-pri depends needs --on <ref> (or --file edges.json)');
      const r = await store.depends(arg, on, f.remove === true);
      const a = parsePrRef(arg); const b = parsePrRef(on);
      return { json: { ok: true, ...r }, text: `${prUrl(a.repo, a.number)} ${f.remove === true ? 'no longer merges after' : 'merges after'} ${prUrl(b.repo, b.number)}` };
    }
    case 'record': {
      // @req FR:pr-priority/record.model @req FR:pr-priority/record.latest
      const ref = need('<ref>');
      const r = await store.record(ref, await readJson(f, input, 'pr-pri record'));
      const p = parsePrRef(ref);
      return { json: { ok: true, ...r }, text: `${r.changed ? 'recorded' : 'no change:'} ${prUrl(p.repo, p.number)} ${r.record.state}` };
    }
    case 'ack': {
      const thread = str(f, 'thread'); const note = str(f, 'note');
      if (!thread || !note) throw new UsageError('pr-pri ack needs --thread <url> --note <text>');
      const r = await store.ack(need('<ref>'), thread, note);
      return { json: { ok: true, ...r }, text: `acked ${thread}` };
    }
    case 'escalate': {
      noArg();
      const body = await readJson(f, input, 'pr-pri escalate');
      const e = await store.escalate(body);
      return { json: { ok: true, escalations: e }, text: `escalations: ${e.blockedAutopilot.length} blocked, ${e.enableAutopilot.length} enable, ${e.liveValidation.length} live` };
    }
    default: throw new UsageError(`Usage: stack ${PR_PRI_USAGE}`);
  }
}

