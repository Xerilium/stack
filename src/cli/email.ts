/**
 * `stack email run|voice|status`: one triage pass, voice learning, and status for the signed-in mailbox. Never prints mail text.
 * @req FR:email-runner/cli.run @req FR:email-runner/cli.voice @req FR:email-runner/cli.status @req FR:email-runner/cli.lock
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { LifecycleContext } from '../core/lifecycle';
import { MemoryStorage } from '../core/storage';
import { sentItems } from '../email/graph-mail';
import type { Transport } from '../email/guard';
import { createSafeHttp } from '../email/http';
import type { ClaudeJson } from '../email/llm';
import { lockPath, MaxExceeded, readState, rulesFor, runPass, statePath, takeLock } from '../email/runner';
import { learnVoice, loadVoice, renderStyleGuide, saveVoice, voicePath, type SentMessage } from '../email/voice';
import { defaultCachePath, FileTokenCache, graphToken, hasScope } from '../graph/auth';
import { graphTransport } from '../graph/transport';
import { UsageError } from './args';

/** `--extra`: a JSON array of `{subject?, body, sentAt?}` objects; anything else is refused. */
function readExtra(path: string): SentMessage[] {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(v) || v.length > 5000) throw new UsageError('--extra must be a JSON array (at most 5000 items) of {subject?, body, sentAt?}');
  return v.map((x, i) => {
    const o = x as Record<string, unknown>;
    if (!o || typeof o.body !== 'string') throw new UsageError(`--extra item ${i} has no text body`);
    return { id: `extra-${i}`, subject: typeof o.subject === 'string' ? o.subject : '', sentAt: typeof o.sentAt === 'string' ? o.sentAt : '1970-01-01T00:00:00Z', body: o.body.slice(0, 20_000), to: [], kind: 'other' as const };
  });
}

/** A launchd job that runs one pass every 15 minutes with absolute paths (launchd has no shell PATH) and logs beside the state. @req FR:email-runner/cli.schedule */
export function launchdPlist(o: { node: string; cli: string; claudeDir: string; repo: string; logDir: string; remote?: string }): string {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const args = [o.node, o.cli, 'email', 'run', '--dir', o.repo, ...(o.remote ? ['--remote', o.remote] : [])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>com.xerilium.stack-email</string>\n  <key>ProgramArguments</key><array>${args.map((a) => `<string>${esc(a)}</string>`).join('')}</array>\n  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(`${o.claudeDir}:/usr/bin:/bin`)}</string></dict>\n  <key>StartInterval</key><integer>900</integer>\n  <key>StandardOutPath</key><string>${esc(join(o.logDir, 'run.log'))}</string>\n  <key>StandardErrorPath</key><string>${esc(join(o.logDir, 'run.err.log'))}</string>\n</dict></plist>\n`;
}

export interface EmailOutcome { json: Record<string, unknown>; text: string; code?: number }
export interface EmailDeps { cache?: FileTokenCache; transport?: Transport; llm?: ClaudeJson; dataDir?: string; repo?: string }
function whichSync(cmd: string): string | undefined {
  for (const p of (process.env.PATH ?? '').split(':')) { const c = join(p, cmd); if (p && existsSync(c)) return c; }
  return undefined;
}
const flag = (f: Record<string, string | true>, n: string): string | undefined => (typeof f[n] === 'string' ? (f[n] as string) : undefined);

export async function emailCmd(ctx: LifecycleContext, action: string | undefined, f: Record<string, string | true>, d: EmailDeps = {}): Promise<EmailOutcome> {
  const cache = d.cache ?? new FileTokenCache(process.env.STACK_GRAPH_CACHE ?? defaultCachePath());
  const t = await cache.read();
  if (!t) return { json: { ok: false, signedIn: false }, text: 'not signed in (run: stack graph login --with mail,drafts)', code: 4 };
  const account = (flag(f, 'account') ?? t.account)?.toLowerCase();
  if (!account) throw new UsageError('Missing --account <mailbox address> (the token cache does not name one)');
  if (t.account && account !== t.account.toLowerCase()) throw new UsageError(`--account ${account} is not the signed-in mailbox (${t.account})`);
  const transport = d.transport ?? graphTransport({ token: graphToken(cache) });
  const mode = flag(f, 'mode') ?? (hasScope(t.scopes, 'Mail.ReadWrite') ? 'drafts' : 'observe');
  if (mode !== 'observe' && mode !== 'drafts') throw new UsageError('--mode must be observe or drafts');

  if (action === 'status') {
    const s = readState(statePath(account, d.dataDir));
    const voice = loadVoice(voicePath(account, d.dataDir));
    const v = { ok: true, account, mode, lastRun: s.lastRun ?? null, summary: s.lastSummary ?? null, archivePending: s.hygiene.batches.filter((b) => b.kind === 'archive').reduce((t, b) => t + b.ids.length, 0), spamPending: s.hygiene.batches.filter((b) => b.kind === 'spam').reduce((t, b) => t + b.ids.length, 0), voice: voice ? { samples: voice.sampleCount, learnedAt: voice.learnedAt } : null };
    return { json: v, text: `${account} · ${mode} · last pass ${v.lastRun ?? 'never'} · archive ${v.archivePending} · spam ${v.spamPending} · voice ${voice ? `${voice.sampleCount} samples` : 'not learned'}` };
  }

  if (action === 'voice') {
    const sent = await sentItems({ transport });
    const extraPath = flag(f, 'extra');
    const extra = extraPath ? readExtra(extraPath) : [];
    const rules = rulesFor(account, d.dataDir);
    // Mail to sensitive recipients never becomes an example sent to a model.
    const p = learnVoice([...sent, ...extra], { account, owner: [account.slice(account.indexOf('@') + 1)], rules });
    const path = voicePath(account, d.dataDir);
    saveVoice(path, p);
    writeFileSync(join(dirname(path), 'style-guide.md'), `${renderStyleGuide(p)}\n`, { mode: 0o600 });
    return { json: { ok: true, account, samples: p.sampleCount, sent: sent.length, extra: extra.length, profile: path }, text: `Learned ${account} from ${p.sampleCount} samples (${sent.length} sent, ${extra.length} other). Profile: ${path}` };
  }

  if (action === 'run') {
    const release = takeLock(lockPath(account, d.dataDir));
    if (!release) return { json: { ok: false, busy: true }, text: 'a pass is already running', code: 4 };
    try {
      const max = flag(f, 'max') ? Number(flag(f, 'max')) : undefined;
      if (max !== undefined && (!Number.isInteger(max) || max < 1)) throw new UsageError('--max must be a positive integer');
      const dry = f['dry-run'] === true;
      const passCtx: LifecycleContext = dry ? { ...ctx, storage: new MemoryStorage() } : ctx;
      const s = await runPass({ ctx: passCtx, account, transport, mode, max, dryRun: dry, dataDir: d.dataDir, ...(d.llm ? { llm: d.llm } : {}), http: createSafeHttp(), project: flag(f, 'project') });
      return { json: { ok: true, account, mode, dryRun: dry, ...s }, text: `${mode}${dry ? ' (dry run)' : ''}: ${s!.messages} messages, ${s!.rules} by rules, ${s!.model} by model, ${s!.asks} asks, ${s!.drafts} drafts, archive ${s!.archivePending}, spam ${s!.spamPending}, ${s!.modelCalls} model calls` };
    } catch (e) {
      if (e instanceof MaxExceeded) return { json: { ok: false, found: e.found, max: e.max }, text: e.message, code: 4 };
      throw e;
    } finally { release(); }
  }
  if (action === 'schedule') {
    // Prints only: installing a LaunchAgent is the owner's call (`launchctl bootstrap`).
    const claudeBin = process.env.STACK_CLAUDE_BIN ?? whichSync('claude');
    if (!claudeBin) throw new UsageError('claude is not on PATH; set STACK_CLAUDE_BIN to its full path');
    const plist = launchdPlist({ node: process.execPath, cli: process.argv[1] ?? 'stack', claudeDir: dirname(claudeBin), repo: d.repo ?? process.cwd(), logDir: dirname(statePath(account, d.dataDir)), remote: flag(f, 'remote') });
    return { json: { ok: true, plist }, text: plist };
  }
  throw new UsageError('Usage: stack email run [--mode observe|drafts] [--max n] [--dry-run] | voice [--extra file.json] | status | schedule');
}
