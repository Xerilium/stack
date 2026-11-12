/**
 * The Updates dialog: when updates install, which builds, and `Restart now`. Opened only by the owner (the chip or `Stack > Updates…`).
 * @req FR:devops-installer/notice.dialog @req FR:devops-installer/notice.words @req FR:devops-installer/notice.restart
 */
import { Dialog } from './parts';
import { MODE_WORDS, UPDATE_MODES, type BuildStamp, type UpdateMode, type VersionState } from './update';

const build = (s: BuildStamp | null) => (s ? `${s.sha}${s.dirty ? '+dirty' : ''} · ${new Date(s.builtAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'none');

export function UpdatesDialog({ state, onClose, onMode, onRestart, restarting }: {
  state: VersionState; onClose: () => void; onMode: (m: UpdateMode) => void; onRestart: () => void; restarting: boolean;
}) {
  return (
    <Dialog title="Updates" onClose={onClose} sheet={false}>
      <fieldset class="update-modes">
        <legend>Install updates</legend>
        {UPDATE_MODES.map((m) => (
          <label key={m}>
            <input type="radio" name="update-mode" value={m} checked={state.mode === m} onChange={() => onMode(m)} />
            {MODE_WORDS[m](state.idleMinutes)}
          </label>
        ))}
      </fieldset>
      <dl class="update-builds">
        <dt>Running</dt><dd>{build(state.running)}</dd>
        <dt>Ready</dt><dd>{state.ready ? build(state.available) : 'Up to date'}</dd>
        {state.last && !state.last.ok && <><dt>Last update</dt><dd>Failed at {state.last.step}; rolled back. See ~/.stack/update.log</dd></>}
      </dl>
      <div class="update-actions">
        {state.ready && state.canRestart && (
          <button type="button" class="btn primary" disabled={restarting} onClick={onRestart}>{restarting ? 'Restarting…' : 'Restart now'}</button>
        )}
        <button type="button" class="btn" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
