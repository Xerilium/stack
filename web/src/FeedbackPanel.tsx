/** The feedback icon and its panel: text, optional screenshot, Send. @req FR:feedback-button/ui.icon @req FR:feedback-button/ui.panel */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Client } from './api';
import { isDesktopApp, pageContext, startShot } from './feedback';
import './feedback.css';

type Phase = 'closed' | 'open' | 'sending' | 'sent';
/** The host's open function; the icons call it. */
let openFn: ((from: HTMLElement | null) => void) | undefined;

const Icon = () => (
  <svg class="fb-ic" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <path d="M4.5 3h11A2.5 2.5 0 0 1 18 5.5v7a2.5 2.5 0 0 1-2.5 2.5H9.7l-3.9 2.9a.5.5 0 0 1-.8-.4V15h-.5A2.5 2.5 0 0 1 2 12.5v-7A2.5 2.5 0 0 1 4.5 3Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
    <path d="M6.5 7.5h7M6.5 10.5h4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
  </svg>
);

/** The icon: rail footer, or `compact` in the phone top bar. No shortcut badge. @req FR:feedback-button/ui.icon */
export function FeedbackButton({ compact = false }: { compact?: boolean }) {
  return (
    <button type="button" class={`fb-btn${compact ? ' compact' : ''}`} data-testid={compact ? 'feedback-btn-phone' : 'feedback-btn'}
      aria-label="Send feedback (F)" title="Send feedback (F)" aria-haspopup="dialog" onClick={(e) => openFn?.(e.currentTarget as HTMLElement)}>
      <Icon />
    </button>
  );
}

/** The panel and the Shift+F shortcut; mount once. Focus returns to the opener. @req FR:feedback-button/ui.icon @req FR:feedback-button/ui.a11y */
export function FeedbackHost({ api }: { api: Client }) {
  const [phase, setPhase] = useState<Phase>('closed');
  const from = useRef<HTMLElement | null>(null);
  const phaseRef = useRef<Phase>('closed');
  phaseRef.current = phase;
  useEffect(() => {
    openFn = (el) => { if (phaseRef.current !== 'closed') return; from.current = el ?? document.querySelector<HTMLElement>('.fb-btn:not(.compact)'); setPhase('open'); };
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'F' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      const vis = [...document.querySelectorAll<HTMLElement>('.fb-btn')].find((b) => b.offsetParent !== null) ?? null;
      openFn?.(vis);
    };
    window.addEventListener('keydown', on);
    return () => { window.removeEventListener('keydown', on); openFn = undefined; };
  }, []);
  if (phase === 'closed') return null;
  return <Panel api={api} phase={phase} setPhase={setPhase} onClose={() => { setPhase('closed'); setTimeout(() => from.current?.focus(), 0); }} />;
}

function Panel({ api, phase, setPhase, onClose }: { api: Client; phase: Phase; setPhase: (p: Phase) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [shot, setShot] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { ref.current?.querySelector<HTMLElement>('textarea')?.focus(); }, []);
  useEffect(() => { if (phase !== 'sent') return; const t = setTimeout(onClose, 1200); return () => clearTimeout(t); }, [phase]);

  /** Hide the panel, capture (host or browser), send. @req FR:feedback-button/ui.shot @req FR:feedback-button/ui.sent */
  const send = async () => {
    if (!text.trim() || phase === 'sending') return;
    setError(null);
    setPhase('sending');
    const desktop = isDesktopApp();
    // The browser prompt comes first, while the click is still a user gesture; then the panel hides for the frame.
    const grab = shot && !desktop ? await startShot() : null;
    if (shot) { setHidden(true); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))); }
    const png = grab ? await grab() : null;
    try {
      await api.feedback({ text: text.trim(), ...pageContext(), ...(shot && desktop ? { capture: true } : {}), ...(png ? { png } : {}) });
      setHidden(false);
      setPhase('sent');
    } catch (e) {
      setHidden(false);
      setError(e instanceof Error ? e.message : 'Could not send');
      setPhase('open');
      setTimeout(() => ref.current?.querySelector<HTMLElement>('textarea')?.focus(), 0);
    }
  };

  if (hidden) return null;
  return (
    <div class="scrim fb-scrim" onClick={phase === 'sending' ? undefined : onClose}>
      <div ref={ref} class="dialog fb-panel" role="dialog" aria-modal="true" aria-label="Send feedback" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (phase !== 'sending') onClose(); return; }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); return; }
          if (e.key === 'Tab') {
            const els = [...ref.current!.querySelectorAll<HTMLElement>('textarea, input, button')].filter((x) => !(x as HTMLButtonElement).disabled);
            if (!els.length) return;
            const i = els.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            els[e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length].focus();
          }
        }}>
        {phase === 'sent'
          ? <p class="fb-sent" role="status" tabIndex={-1}>Sent</p>
          : (
            <>
              <h2 class="dialog-title">Send feedback</h2>
              <textarea class="fb-text" aria-label="Feedback" rows={5} maxLength={4000} value={text} disabled={phase === 'sending'}
                onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
              <label class="fb-shot"><input type="checkbox" checked={shot} disabled={phase === 'sending'} onChange={(e) => setShot((e.target as HTMLInputElement).checked)} />Include a screenshot of this page</label>
              {error && <p class="fb-err" role="alert">{error}</p>}
              <div class="fb-actions">
                <button type="button" class="btn primary" disabled={!text.trim() || phase === 'sending'} onClick={() => void send()}>{phase === 'sending' ? 'Sending…' : 'Send'}</button>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
