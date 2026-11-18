/**
 * The brief on an expanded ask (problem, proposed solution, risks, recommendation, evidence), `No context yet` when an
 * approve or decide ask has none, text with references as links, and a two-step confirm for going ahead without context.
 * @req FR:ask-briefs/web.brief @req FR:ask-briefs/web.none @req FR:ask-briefs/web.anyway @req FR:ask-briefs/link.web
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { autolink, repoMap } from './autolink';
import './brief.css';

export interface Brief { problem: string; solution: string; risks: string[]; recommendation: string; evidence?: string[] }

const host = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.length > 1 ? x.pathname : ''}`; } catch { return u; } };

/** Text with references as links that open in a new tab (the desktop app opens them in the browser). */
export function Linked({ text, repo }: { text: string; repo?: string }) {
  return <>{autolink(text, { repo, repos: repoMap() }).map((s, i) => (typeof s === 'string' ? s : <a key={i} href={s.href} target="_blank" rel="noopener noreferrer">{s.text}</a>))}</>;
}

export function BriefBlock({ brief, missing, from, repo }: { brief?: Brief; missing: boolean; from: string; repo?: string }) {
  if (!brief) return missing ? <p class="brief-none" data-testid="brief-none" role="note"><strong>No context yet.</strong> {from} sent no brief. Ask for one before you decide.</p> : null;
  return (
    <dl class="brief" data-testid="brief" aria-label="Brief">
      <div><dt>Problem</dt><dd><Linked text={brief.problem} repo={repo} /></dd></div>
      <div><dt>Proposed solution</dt><dd><Linked text={brief.solution} repo={repo} /></dd></div>
      <div><dt>Risks</dt><dd><ul>{brief.risks.map((r, i) => <li key={i}><Linked text={r} repo={repo} /></li>)}</ul></dd></div>
      <div><dt>Recommendation</dt><dd><Linked text={brief.recommendation} repo={repo} /></dd></div>
      {brief.evidence && brief.evidence.length > 0 && (
        <div><dt>Evidence</dt><dd><ul>{brief.evidence.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{host(u)} <span aria-hidden="true">↗</span></a></li>)}</ul></dd></div>
      )}
    </dl>
  );
}

/** First tap arms; the second confirms. Esc or Cancel disarms. Never a browser dialog. */
export function ConfirmAct({ label, confirmLabel, cls, disabled, onConfirm }: { label: string; confirmLabel: string; cls: string; disabled?: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const sure = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (armed) sure.current?.focus(); }, [armed]);
  if (!armed) return <button type="button" class={cls} disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
  return (
    <span class="confirm-act" role="group" aria-label="Confirm without context">
      <button type="button" class={`${cls} danger`} disabled={disabled} ref={sure} onClick={() => { setArmed(false); onConfirm(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setArmed(false); } }}>{confirmLabel}</button>
      <button type="button" class={cls} onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}
