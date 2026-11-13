/**
 * Graph diagnostics: one JSON line per failed Graph call in `~/.stack/graph.log` (mode 0600), so an outage can be shown to Microsoft
 * with its request id. Never a token, a query value or a response body.
 * @req FR:connect-accounts/acct.diag
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export interface GraphFailureRecord {
  at: string; account?: string; method: string; path: string; status: number; code: string;
  /** Graph's `request-id`, else the `client-request-id` Stack sent (also set on timeouts). */
  requestId: string; ms: number;
}

export const graphLogPath = (home = homedir()) => join(home, '.stack', 'graph.log');
const MAX_BYTES = 1 << 20;

/** A writer for failure records. Rolls the file to `.1` past 1 MB. Never throws. */
export function graphLogger(file = graphLogPath()): (r: GraphFailureRecord) => void {
  return (r) => {
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      try { if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`); } catch { /* no file yet */ }
      appendFileSync(file, `${JSON.stringify(r)}\n`, { mode: 0o600 });
    } catch { /* diagnostics never break a read */ }
  };
}
