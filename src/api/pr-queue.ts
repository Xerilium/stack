/**
 * How the host changes the PR priority queue: the `stack pr-pri` CLI (`FR:pr-priority/cli.*`), one argv entry per value, no shell.
 * @req FR:pr-page/api.queue-client
 */
import { execFile } from 'child_process';
import { join } from 'path';
import { PrPriBusy, PrPriConflict, PrPriInvalid, PrPriNotFound, type PrPriorityStore } from '../core/pr-priority';

export type MoveTo = 'top' | 'up' | 'down' | number;
export interface PrQueue {
  move(ref: string, to: MoveTo): Promise<void>;
  add(ref: string): Promise<void>;
  pin(ref: string): Promise<void>;
  unpin(ref: string): Promise<void>;
  remove(ref: string): Promise<void>;
  /** Restores the order before the last queue edit. */
  undo(): Promise<void>;
  /** Records the owner's answer on a thread. */
  ack(ref: string, thread: string, note: string): Promise<void>;
  accept(id: string): Promise<void>;
  edit(id: string, d: { reason: string; rank?: number; note?: string }): Promise<void>;
  reject(id: string, reason: string): Promise<void>;
  /** True when the queue commands exist on this host. */
  available?(): Promise<boolean>;
}
/** The `pr-pri` command is not in this build. */
export class QueueUnavailable extends Error { constructor() { super('PR priority queue is not installed'); this.name = 'QueueUnavailable'; } }
/** The queue refused the change (not queued, excluded, decided); the message is the CLI's error line. */
export class QueueRefused extends Error { constructor(msg: string) { super(msg); this.name = 'QueueRefused'; } }

/** Runs `stack <args>` and returns stdout, or rejects with `{stderr}`. */
export type StackRun = (args: string[]) => Promise<string>;
const defaultRun: StackRun = (args) => new Promise((ok, no) => {
  execFile(process.execPath, [join(__dirname, '../cli/index.js'), ...args], { timeout: 20_000, maxBuffer: 1024 * 1024 }, (e, out, err) => (e ? no(Object.assign(e, { stderr: String(err) })) : ok(String(out))));
});

/** A host with no queue (no `stack` CLI in its build): every change answers "not installed", and the board hides queue actions. */
export function noQueue(): PrQueue {
  const no = async (): Promise<void> => { throw new QueueUnavailable(); };
  return { move: no, add: no, pin: no, unpin: no, remove: no, undo: no, ack: no, accept: no, edit: no, reject: no, available: async () => false };
}

/** `--name=value` keeps a value that starts with `--` a value. */
export function cliPrQueue(run: StackRun = defaultRun): PrQueue {
  const call = async (args: string[]) => {
    try { await run(['pr-pri', ...args]); } catch (e) {
      const err = String((e as { stderr?: string }).stderr ?? '');
      if (/Unknown command/i.test(err)) throw new QueueUnavailable();
      throw new QueueRefused((/error: (.*)/.exec(err)?.[1] ?? 'PR priority change failed').slice(0, 200));
    }
  };
  let probe: { at: number; ok: boolean } | null = null;
  return {
    move: (ref, to) => call(['move', ref, `--to=${to}`]),
    add: (ref) => call(['add', ref]),
    pin: (ref) => call(['pin', ref]),
    unpin: (ref) => call(['unpin', ref]),
    remove: (ref) => call(['remove', ref]),
    undo: () => call(['undo']),
    ack: (ref, thread, note) => call(['ack', ref, `--thread=${thread}`, `--note=${note}`]),
    accept: (id) => call(['accept', id]),
    edit: (id, d) => call(['edit', id, `--reason=${d.reason}`, ...(d.rank !== undefined ? [`--rank=${d.rank}`] : []), ...(d.note ? [`--note=${d.note}`] : [])]),
    reject: (id, reason) => call(['reject', id, `--reason=${reason}`]),
    /** Runs `pr-pri list --json` (no GitHub call) at most every 10 minutes. */
    async available() {
      if (probe && Date.now() - probe.at < 600_000) return probe.ok;
      let ok = true;
      try { await run(['pr-pri', 'list', '--json']); } catch { ok = false; }
      probe = { at: Date.now(), ok };
      return ok;
    },
  };
}

/** In-process: the host's own `PrPriorityStore` (`stack web`), the same ops as the CLI with no child process. Store errors become refusals. */
export function storePrQueue(s: PrPriorityStore): PrQueue {
  const wrap = async (fn: () => Promise<unknown>): Promise<void> => {
    try { await fn(); } catch (e) {
      if (e instanceof PrPriInvalid || e instanceof PrPriNotFound || e instanceof PrPriConflict || e instanceof PrPriBusy) throw new QueueRefused(e.message.slice(0, 200) || 'PR priority change failed');
      throw e;
    }
  };
  return {
    move: (ref, to) => wrap(() => s.edit({ op: 'move', ref, to })),
    add: (ref) => wrap(() => s.edit({ op: 'add', ref })),
    pin: (ref) => wrap(() => s.edit({ op: 'pin', ref })),
    unpin: (ref) => wrap(() => s.edit({ op: 'unpin', ref })),
    remove: (ref) => wrap(() => s.edit({ op: 'remove', ref })),
    undo: () => wrap(() => s.edit({ op: 'undo' })),
    ack: (ref, thread, note) => wrap(() => s.ack(ref, thread, note)),
    accept: (id) => wrap(() => s.decide(id, { decision: 'accept' })),
    edit: (id, d) => wrap(() => s.decide(id, { decision: 'edit', ...d })),
    reject: (id, reason) => wrap(() => s.decide(id, { decision: 'reject', reason })),
    available: async () => true,
  };
}
