/**
 * The task store cannot keep up with main: one alert with the count behind and the files in the way, or the error.
 * Nothing shows while the store is in sync, catching up, or offline.
 * @req FR:store-sync/banner.component @req FR:store-sync/banner.text @req FR:store-sync/banner.role
 * @owns class:ui-drift
 */
import './ui.css';

/** `drift` of `GET /api/sync` (`FR:store-sync/$drift-state`). */
export interface Drift { base: string; state: 'ok' | 'behind' | 'merged' | 'conflict' | 'blocked' | 'offline' | 'error'; behind: number; files: string[]; at: string; message?: string }

const SHOWN = new Set<Drift['state']>(['conflict', 'blocked', 'error']);

export function DriftBanner({ drift }: { drift: Drift | null | undefined }) {
  if (!drift || !SHOWN.has(drift.state)) return null;
  const branch = drift.base.replace(/^[^/]+\//, '');
  const detail = drift.files.length ? `${drift.state === 'conflict' ? 'Conflicts' : 'Uncommitted'}: ${drift.files.join(', ')}` : drift.message ?? '';
  return (
    <div class="ui-drift" role="alert" data-testid="drift-banner">
      <strong class="ui-drift-title">Task store out of sync with {branch}: {drift.behind} commit{drift.behind === 1 ? '' : 's'} behind</strong>
      {detail && <span class="ui-drift-files">{detail}</span>}
    </div>
  );
}
