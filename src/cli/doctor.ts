/**
 * `stack doctor`: health checks from the terminal. Today one check: how the task store's branch stands against main.
 * Read-only: it fetches, never merges.
 * @req FR:store-sync/doctor.@cli @req FR:store-sync/doctor.check @req FR:store-sync/doctor.readonly
 */
import { execFileSync } from 'child_process';
import { GitStorage, type DriftState } from '../core/storage-git';

const BAD: DriftState['state'][] = ['conflict', 'blocked', 'error'];
const sh = (dir: string, ...a: string[]) => { try { return execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

/** The drift lines for one state. @req FR:store-sync/doctor.text @req FR:store-sync/doctor.text.files */
export function driftLines(d: DriftState): string[] {
  const head = d.state === 'ok' ? `store: ok (in sync with ${d.base})` : `store: ${d.state} (${d.behind} behind ${d.base})`;
  const files = d.files.length ? [`  ${d.state === 'conflict' ? 'Conflicts' : 'Uncommitted'}: ${d.files.join(', ')}`] : [];
  return [head, ...files, ...(d.message && d.state !== 'ok' ? [`  ${d.message.split('\n')[0]}`] : [])];
}

/** @req FR:store-sync/doctor.exit @req FR:store-sync/doctor.text.skip */
export async function doctorCmd(dir: string, remote = 'origin', base = 'main'): Promise<{ json: Record<string, unknown>; text: string; code: number }> {
  const branch = sh(dir, 'symbolic-ref', '--short', '-q', 'HEAD');
  const skip = (reason: string) => ({ json: { store: { state: 'skipped', reason } }, text: `store: skipped (${reason})`, code: 0 });
  if (!branch) return skip('detached HEAD');
  if (branch === base) return skip(`on ${base}`);
  if (sh(dir, 'remote', 'get-url', remote) === null) return skip(`no remote ${remote}`);
  let d: DriftState;
  try { d = (await new GitStorage(dir, { remote, branch }).drift(base))!; } catch (e) {
    d = { base: `${remote}/${base}`, state: 'error', behind: 0, files: [], at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) };
  }
  return { json: { store: d }, text: driftLines(d).join('\n'), code: BAD.includes(d.state) ? 1 : 0 };
}
