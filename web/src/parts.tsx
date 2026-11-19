import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { mdLinks as linksOf, parseInline, refCtxOf, type Node } from './markdown';
import { EFFORT, IMPACT, PRIORITY, STATUS, type Choice } from './row';

export const GROUPS = {
  priority: { label: 'Priority', key: 'p', set: PRIORITY },
  status: { label: 'Status', key: 't', set: STATUS },
  effort: { label: 'Effort', key: 'f', set: EFFORT },
  impact: { label: 'Impact', key: 'i', set: IMPACT },
} as const;
export type GroupName = keyof typeof GROUPS;
export const GROUP_NAMES = Object.keys(GROUPS) as GroupName[];

const renderNode = (n: Node, i: number): ComponentChildren => {
  if (typeof n === 'string') return n;
  if (n.t === 'code') return <code key={i}>{n.c}</code>;
  if (n.t === 'a') return <a key={i} href={n.href} rel="noopener noreferrer" target="_blank">{n.c}</a>;
  const kids = n.c.map(renderNode);
  return n.t === 'b' ? <b key={i}>{kids}</b> : <i key={i}>{kids}</i>;
};

/** A link as its text: inside a button (a row's open control) an anchor would nest one control in another. */
const plainNode = (n: Node, i: number): ComponentChildren => {
  if (typeof n === 'string') return n;
  if (n.t === 'code') return <code key={i}>{n.c}</code>;
  if (n.t === 'a') return n.c;
  const kids = n.c.map(plainNode);
  return n.t === 'b' ? <b key={i}>{kids}</b> : <i key={i}>{kids}</i>;
};

/** Refs resolve against the loaded projects' repos; set when the projects load. @req FR:product-reset/schema.refs */
let refsOf = refCtxOf([]);
export const setRefProjects = (projects: Parameters<typeof refCtxOf>[0]): void => { refsOf = refCtxOf(projects); };

/** Markdown subset as elements; PR and issue refs link to GitHub. `links={false}`: links as text (pair with `TitleLinks` outside the control). @req FR:web-app/edit.preview @req FR:product-reset/ui.reflink */
export function Md({ text, links = true, project }: { text: string; links?: boolean; /** Resolves `#N` and `PR N`. */ project?: string }) {
  return <>{parseInline(text, refsOf(project)).map(links ? renderNode : plainNode)}</>;
}

export type MdBlockNode = { t: 'p'; text: string } | { t: 'h'; text: string } | { t: 'pre'; text: string } | { t: 'ul'; items: string[] } | { t: 'ol'; items: string[]; start: number } | { t: 'hr' };

/**
 * Split a text into markdown blocks: paragraphs, `#` headings, `-` and `1.` lists, `---` rules, fenced code. No HTML.
 * @req FR:agent-sessions/web.drawer.md
 */
export function mdBlocks(text: string): MdBlockNode[] {
  const out: MdBlockNode[] = [];
  const lines = text.split('\n');
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ t: 'p', text: para.join('\n') }); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^\s*(`{3,})/.exec(l);
    if (fence) {
      flush();
      const code: string[] = [];
      // Only a fence at least as long as the opening one closes it, so a block can quote a shorter fence.
      const close = new RegExp(`^\\s*\`{${fence[1].length},}\\s*$`);
      for (i++; i < lines.length && !close.test(lines[i]); i++) code.push(lines[i]);
      out.push({ t: 'pre', text: code.join('\n') });
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push({ t: 'hr' }); continue; }
    const h = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(l);
    if (h) { flush(); out.push({ t: 'h', text: h[1] }); continue; }
    const li = /^\s*(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/.exec(l);
    if (li) {
      flush();
      const prev = out[out.length - 1];
      if (prev && prev.t === (li[1] ? 'ul' : 'ol') && 'items' in prev) prev.items.push(li[3]);
      else out.push(li[1] ? { t: 'ul', items: [li[3]] } : { t: 'ol', items: [li[3]], start: Number(li[2]) });
      continue;
    }
    para.push(l);
  }
  flush();
  return out;
}

/**
 * Block markdown as elements: headings as bold text (not page headings), lists, rules, code blocks, inline marks and links.
 * Never an HTML string. @req FR:agent-sessions/web.drawer.md
 */
export function MdBlock({ text, project }: { text: string; project?: string }) {
  return (
    <div class="md">
      {mdBlocks(text).map((b, i) => {
        if (b.t === 'hr') return <hr key={i} />;
        if (b.t === 'pre') return <pre key={i}><code>{b.text}</code></pre>;
        if (b.t === 'h') return <p key={i} class="md-h"><b><Md text={b.text} project={project} /></b></p>;
        if (b.t === 'p') return <p key={i}><Md text={b.text} project={project} /></p>;
        const items = b.items.map((it, j) => <li key={j}><Md text={it} project={project} /></li>);
        return b.t === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i} start={b.start === 1 ? undefined : b.start}>{items}</ol>;
      })}
    </div>
  );
}

/** The links in a text, in order: markdown links, bare urls and resolved refs. */
export const mdLinks = (text: string, project?: string) => linksOf(text, refsOf(project));

/** A title's markdown links as their own anchors, beside (never inside) the row's open button; a click never opens the row. @req FR:task-detail-design/detail.open */
export function TitleLinks({ text, project }: { text: string; project?: string }) {
  return <>{mdLinks(text, project).map((l, i) => <a key={`${i}-${l.href}`} class="tag link" href={l.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{l.label} ↗</a>)}</>;
}

const vsel = (s: string) => s.replace(/\uFE0F/g, '');
/** Plain-text glyph and tone for a marker value; the emoji stays in the file. */
const GLYPH: Record<GroupName, Record<string, [string, string]>> = {
  priority: { '🚨': ['Crit', 'hot'], '‼': ['High', 'warm'], '🔺': ['↑', ''], '🔻': ['↓', 'dim'], '🔝': ['Top', 'hot'] },
  status: { '🚧': ['Doing', 'accent'], '⏸': ['Paused', 'dim'], '👀': ['Review', ''], '⏳': ['Waiting', 'dim'], '⛔': ['Blocked', 'warm'] },
  effort: { '🔹': ['12m', ''], '🟢': ['30m', ''], '🟡': ['1h', ''], '🟠': ['2h', ''], '🔴': ['4h', ''], '⚫': ['8h', ''] },
  impact: { '⬆': ['↑', ''], '↔': ['→', 'dim'], '⬇': ['↓', 'dim'] },
};
export const glyphOf = (group: GroupName, value: string): { text: string; tone: string } => {
  const g = GLYPH[group][vsel(value)];
  return { text: g?.[0] ?? value, tone: g?.[1] ?? '' };
};

export function Chip({ group, value, onPick }: { group: GroupName; value: string; onPick: (g: GroupName) => void }) {
  const name = GROUPS[group].set.find((c) => vsel(c.e) === vsel(value))?.name ?? value;
  const g = glyphOf(group, value);
  return (
    // The name comes from the content (label in name, WCAG 2.5.3): "Effort: 30 min. Change". @req FR:first-run-onboarding/polish.contrast
    <button type="button" class={`chip chip-${group} ${g.tone}`} title={`${GROUPS[group].label}: ${name}`} onClick={(e) => { e.stopPropagation(); onPick(group); }}>
      <span class="sr-only">{GROUPS[group].label}: {name}. Change</span><span aria-hidden="true">{g.text}</span><span class="chip-name" aria-hidden="true">{name}</span>
    </button>
  );
}

/**
 * One shape for every empty state: what is empty, then the next step (a key, a button, or a link).
 * @req FR:first-run-onboarding/polish.empty
 */
export function EmptyState({ what, next }: { what: ComponentChildren; next?: ComponentChildren }) {
  return <div class="empty-state" data-testid="empty-state"><p class="empty-what">{what}</p>{next && <p class="empty-next">{next}</p>}</div>;
}

/** A terminal command with a Copy button. Used by first-run setup. @req FR:first-run-onboarding/step.email */
export function CopyCommand({ cmd, testId, label = 'Copy' }: { cmd: string; testId?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="ob-cmd">
      <code data-testid={testId}>{cmd}</code>
      <button type="button" class="ob-btn" aria-label={label === 'Copy' ? undefined : label} onClick={() => { void navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => undefined); }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

/** Dialog with focus restore. @req FR:web-app/ux.a11y */
export function Dialog({ title, onClose, children, sheet = true }: { title: string; onClose: () => void; children: ComponentChildren; sheet?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div class="scrim" onClick={onClose}>
      <div ref={ref} class={`dialog${sheet ? ' sheet' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
          if (e.key === 'Tab') {
            const els = [...ref.current!.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')].filter((x) => !(x as HTMLButtonElement).disabled);
            if (!els.length) return;
            const i = els.indexOf(document.activeElement as HTMLElement);
            const next = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length;
            e.preventDefault();
            els[next].focus();
          }
        }}>
        <h2 class="dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Property picker for one group or all. @req FR:web-app/pick.chips @req FR:web-app/pick.touch */
export function Picker({ groups, count, onChoose, onClose }: { groups: GroupName[]; count: number; onChoose: (g: GroupName, e: string) => void; onClose: () => void }) {
  const single = groups.length === 1;
  return (
    <Dialog title={count > 1 ? `Set properties on ${count} tasks` : 'Set properties'} onClose={onClose}>
      {groups.map((g) => (
        <fieldset class="picker-group" key={g}>
          <legend>{GROUPS[g].label}</legend>
          <div class="picker-opts">
            {[...GROUPS[g].set, { e: 'None', name: 'None' } as Choice].map((c, i) => (
              <button type="button" class="opt" key={c.e} onClick={() => onChoose(g, c.e)}>
                {single && <kbd>{i < GROUPS[g].set.length ? i + 1 : 0}</kbd>}
                <span aria-hidden="true">{c.e === 'None' ? '∅' : c.e}</span> {c.name}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
    </Dialog>
  );
}

export interface Toast { id: number; text: string; kind: 'ok' | 'err'; undo?: () => void }
export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.undo && <button type="button" class="link" onClick={() => { t.undo!(); dismiss(t.id); }}>Undo</button>}
          <button type="button" class="link" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['Ctrl/Cmd+K or :', 'Command palette'], ['c', 'Capture'], ['/', 'Search the list'], ['g h / g d / g k / g s / g p / g a', 'Go to Home / My day / Notifications / Agents / Projects / Full stack'], ['Agents: Enter, f, t, p, A, s, c, n, m', 'Open (a session) or talk (an agent), pin, team tree, by project, all repos, stop a run, usage, new, show more'], ['Asks: Enter, n, o, r, z, e, u, 1-4, m', 'Primary action, reject, open link, reply, defer, details, undo, pick option, show more'], ['a / A / R', 'Ask the task agent (opens its thread) / assign the task to its agent (Home: delegate 🪄) / review the task'], ['[ / ]', 'Less / more time today'], ['h then 1-4, 0', 'Home: I have 15m / 30m / 1h / 2h, reset'],
  ['j k or arrows', 'Move cursor'], ['Space', 'Expand in place'], ['Enter', 'Open full screen'], ['e', 'Edit row'], ['x', 'Select row'], ['Esc', 'Collapse, then clear selection'],
  ['p t f i', 'Priority, status, effort, impact'], ['d', 'Done'], ['s', 'Start'], ['n', 'Defer 2 hours'], ['Shift+A', 'Home: delegate to an agent (🪄); list rows: assign the task to its agent; My day: none (use Message)'], ['z', 'Defer…'], ['Shift+S', 'Skip'],
  ['Shift+J / Shift+K', 'Move row down / up'], ['Shift+F', 'Send feedback'], ['?', 'This sheet'],
];
export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} sheet={false}>
      <dl class="keys">{SHORTCUTS.map(([k, d]) => <><dt><kbd>{k}</kbd></dt><dd>{d}</dd></>)}</dl>
      <button type="button" class="btn" onClick={onClose}>Close</button>
    </Dialog>
  );
}
