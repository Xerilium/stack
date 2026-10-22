/**
 * Message in, task out. Parsing and running are pure over an injected Client.
 * @req FR:chat-bots/cmd.parse @req FR:chat-bots/cmd.run
 */
export interface ClientResult { ref?: string; changed?: boolean }
export interface Client {
  next(): Promise<{ ref: string; text: string; project: string } | null>;
  add(project: string, text: string): Promise<ClientResult>;
  start(ref?: string): Promise<ClientResult>;
  complete(ref?: string, summary?: string): Promise<ClientResult>;
  skip(ref?: string): Promise<ClientResult>;
}

export type Command =
  | { kind: 'next' } | { kind: 'help' } | { kind: 'invalid' }
  | { kind: 'add'; project: string; text: string }
  | { kind: 'start' | 'skip'; ref?: string }
  | { kind: 'complete'; ref?: string; summary?: string };

export const MAX_TEXT = 2000;
const REF = /^[A-Za-z0-9][A-Za-z0-9._-]*:\d+$/;
const LINE_BREAK = new RegExp("[\\r\\n\\u0085\\u2028\\u2029]");
const NEXT = /^(?:next|\?|what['’]?s\s+next\??|what\s+next\??)$/i;

export const HELP = "Commands: next | add <project> <text> | start [ref] | done [ref] [summary] | skip [ref]";

/** @req FR:chat-bots/cmd.limits @req FR:chat-bots/cmd.ref */
export function parseCommand(input: string): Command {
  const t = input.trim();
  if (t.length > MAX_TEXT || LINE_BREAK.test(t)) return { kind: 'invalid' };
  const s = t.replace(/^\/stack(?:\s+|$)/i, '');
  if (s === '') return { kind: 'help' };
  if (NEXT.test(s)) return { kind: 'next' };
  const [verb, ...rest] = s.split(/\s+/);
  const tail = rest.join(' ');
  switch (verb.toLowerCase()) {
    case 'add': {
      const m = /^(\S+)\s+(.+)$/.exec(tail);
      return m ? { kind: 'add', project: m[1], text: m[2] } : { kind: 'help' };
    }
    case 'start': case 'skip': {
      const kind = verb.toLowerCase() as 'start' | 'skip';
      if (rest.length === 0) return { kind };
      return rest.length === 1 && REF.test(rest[0]) ? { kind, ref: rest[0] } : { kind: 'help' };
    }
    case 'complete': case 'done': {
      if (rest.length === 0) return { kind: 'complete' };
      if (REF.test(rest[0])) return { kind: 'complete', ref: rest[0], ...(rest.length > 1 ? { summary: rest.slice(1).join(' ') } : {}) };
      return { kind: 'complete', summary: tail };
    }
    default: return { kind: 'help' };
  }
}

const failText = (e: unknown): string => {
  const status = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined;
  if (status === 404) return 'Not found';
  if (status === 400 || status === 422) return 'Invalid input';
  return 'Failed';
};

const done = (verb: string, r: ClientResult) => (r.changed === false ? 'No change' : r.ref ? `${verb} ${r.ref}` : verb);

/** Never throws: client failures become fixed text (core messages are never echoed). */
export async function runCommand(client: Client, cmd: Command, onError?: (name: string) => void): Promise<string> {
  try {
    switch (cmd.kind) {
      case 'help': return HELP;
      case 'invalid': return 'Invalid input';
      case 'next': {
        const n = await client.next();
        return n ? `Next: ${n.text} (${n.project}) [${n.ref}]` : 'Nothing active';
      }
      case 'add': return done('Added', await client.add(cmd.project, cmd.text));
      case 'start': return done('Started', await client.start(cmd.ref));
      case 'skip': return done('Skipped', await client.skip(cmd.ref));
      case 'complete': return done('Completed', await client.complete(cmd.ref, cmd.summary));
    }
  } catch (e) {
    const status = typeof e === "object" && e !== null ? (e as { status?: unknown }).status : undefined;
    if (typeof status !== "number" || status >= 500) onError?.(e instanceof Error ? e.constructor.name : "unknown");
    return failText(e);
  }
}
