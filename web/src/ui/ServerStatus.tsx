/**
 * One local server: a status chip, then the step, a link to the URL, or the error, and one Start or Stop button.
 * With no server it says so and offers Start. A state change is said in a polite live region.
 * @req FR:ui-kit/server
 * @owns class:ui-server
 */
import { StatusChip, type ChipTone } from './StatusChip';
import './ui.css';

export interface ServerInfo { state: 'starting' | 'running' | 'failed'; step?: 'checkout' | 'build' | 'run'; url?: string; error?: string }
const WORD: Record<ServerInfo['state'], { label: string; tone: ChipTone }> = { starting: { label: 'Starting', tone: 'info' }, running: { label: 'Running', tone: 'ok' }, failed: { label: 'Failed', tone: 'bad' } };
const STEP: Record<NonNullable<ServerInfo['step']>, string> = { checkout: 'Checking out the PR', build: 'Building it', run: 'Waiting for the port' };
/** Only a local `http` URL is a link. */
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;

export function ServerStatus({ server, busy = false, onStart, onStop }: { server?: ServerInfo | undefined; busy?: boolean; onStart: () => void; onStop: () => void }) {
  const live = !!server && server.state !== 'failed';
  const url = server?.state === 'running' && LOCAL.test(server.url ?? '') ? server.url! : null;
  const note = server?.state === 'starting' ? (server.step ? STEP[server.step] : '') : server?.state === 'failed' ? server.error ?? '' : '';
  return (
    <div class="ui-server">
      <div class="ui-server-state" role="status" aria-live="polite">
        {server ? <StatusChip label={WORD[server.state].label} tone={WORD[server.state].tone} /> : <span class="ui-server-none">No test server runs.</span>}
        {note && <span class="ui-server-note">{note}</span>}
      </div>
      {url && <a class="fl-btn primary" href={url} target="_blank" rel="noopener noreferrer">Open {url.replace(/^http:\/\//, '')}</a>}
      <button type="button" class="fl-btn" disabled={busy} onClick={live ? onStop : onStart}>{live ? 'Stop server' : 'Start server'}</button>
    </div>
  );
}
