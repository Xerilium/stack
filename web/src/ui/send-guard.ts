/**
 * The send guard (used by `web/tests/send-guard.test.ts` only; no view imports it): finds an event handler that sends
 * with no confirm step. A send is a call that gives text or a decision to an agent, a session, a person or GitHub.
 * The one confirm step is a form: the text shows in a box you can change, and the submit button names the effect.
 * @req FR:ui-kit/send.guard
 */
import ts from 'typescript';

/**
 * The names that send. A call counts when the last name of its callee is here (`api.promptSession(…)`, `onSend(…)`).
 * A new function that sends MUST take one of these names, or be added here.
 * @req FR:ui-kit/send.guard.names
 */
export const SENDERS: readonly string[] = [
  // The API client (`web/src/api.ts`).
  'api.promptSession', 'api.newSession', 'api.send', 'api.assign', 'api.review', 'api.answerAsk', 'api.putAsk', 'api.answerNeed', 'api.decideRec', 'api.inboxAct', 'api.inboxJunk', 'api.prAck', 'api.prRec', 'api.feedback', 'api.designReview',
  // Hooks and props that pass a send on.
  'team.assign', 'team.review', 'team.start', 'th.ask', 'th.assign', 'th.answer', 'asks.answer', 'asks.reply', 'asks.askAgent', 's.send', 's.start', 'onSend', 'onAsk', 'onDo', 'onAnswer', 'onAccept', 'onReply', 'sendToSession',
];

export interface SendFinding { file: string; line: number; /** The element and event: `button onClick`. */ at: string; /** The sender it calls. */ call: string }

const isFn = (n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);
/** An identifier that names a member, a property or a declaration: not a use of a local function. */
const isName = (n: ts.Identifier): boolean => {
  const p = n.parent;
  return ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p) || ts.isJsxAttribute(p) || ts.isParameter(p) || ts.isBindingElement(p)) && p.name === n);
};
/** A callee as `name` and `object.name`: `send` and `api.send` for `props.api.send`, `api?.send` and `api.send!`. */
const calleeNames = (e: ts.Expression): string[] => {
  if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) return calleeNames(e.expression);
  if (ts.isIdentifier(e)) return [e.text];
  if (!ts.isPropertyAccessExpression(e)) return [];
  const on = calleeNames(e.expression)[0];
  return [e.name.text, ...(on ? [`${on}.${e.name.text}`] : [])];
};

/**
 * Each handler on an element (`onClick`, `onKeyDown`, `onChange`; not `onSubmit`) that calls a sender, itself or through a
 * function of the same file. A handler prop on a component is not an element handler: the component owns the element.
 * @req FR:ui-kit/send.guard.fail
 */
export function findSends(file: string, source: string, senders: readonly string[] = SENDERS): SendFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(senders);
  /** Functions of this file by name: `const f = () => …`, `const f = useCallback(() => …)`, `function f() {…}`. */
  const local = new Map<string, ts.Node>();
  const collect = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) local.set(n.name.text, n.body);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      const fn = isFn(init) ? init : ts.isCallExpression(init) && init.arguments[0] && isFn(init.arguments[0]) ? init.arguments[0] : null;
      if (fn) local.set(n.name.text, fn);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  /** The first sender a node reaches: a sender call, or a use of a local function that sends. */
  const memo = new Map<string, string | null>();
  const viaLocal = (name: string): string | null => {
    if (memo.has(name)) return memo.get(name)!;
    memo.set(name, null); // a cycle ends here
    const body = local.get(name);
    const hit = body ? reach(body) : null;
    memo.set(name, hit);
    return hit;
  };
  const reach = (n: ts.Node): string | null => {
    if (ts.isCallExpression(n)) { const c = calleeNames(n.expression).find((x) => names.has(x)); if (c) return c; }
    if (ts.isIdentifier(n) && local.has(n.text) && !isName(n)) { const hit = viaLocal(n.text); if (hit) return hit; }
    return ts.forEachChild(n, (c) => reach(c) ?? undefined) ?? null;
  };
  const out: SendFinding[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && /^on[A-Z]/.test(n.name.text) && n.name.text !== 'onSubmit' && n.initializer) {
      const el = n.parent.parent;
      const tag = ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el) ? el.tagName.getText(sf) : '';
      if (/^[a-z]/.test(tag)) {
        const call = reach(n.initializer);
        if (call) out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, at: `${tag} ${n.name.text}`, call });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * The audited one-step sends: each file, how many it may keep, and why each is safe. A one-step send is safe only when it
 * sends a fixed decision (never text the owner did not see) and its label names the effect.
 * @req FR:ui-kit/send.guard.audit
 */
export interface Audit { n: number; why: string }
export const AUDITED: Record<string, Audit> = {
  'AgentTalk.tsx': { n: 1, why: 'Start review: a fixed command with no owner text; the label names the effect' },
  'AsksView.tsx': { n: 5, why: 'Answer buttons of an ask (Approve, Reject, Done, an option): each sends a fixed decision, its label names it, and the toast has Undo' },
  'FeedbackPanel.tsx': { n: 3, why: 'Send and Cmd+Enter send the text the owner typed in the box above; Send to ChatGPT names its effect' },
  'InboxView.tsx': { n: 4, why: 'Mail actions named by their effect; Create draft saves the typed text as a draft and sends nothing; a request is under Request this action' },
  'NowChat.tsx': { n: 1, why: 'Enter in the message box sends the text the owner typed; the form has the Send button' },
  'SessionsView.tsx': { n: 2, why: 'Enter in the prompt box sends the text the owner typed; the form has the send button' },
  'ThreadView.tsx': { n: 1, why: 'Answer buttons of an ask: each sends a fixed decision and its label names it' },
  'views.tsx': { n: 1, why: 'Approve on a decision row: sends the recommendation that shows on the row, and the label names it' },
};

/** Each file that has more one-step sends than its audit entry allows. @req FR:ui-kit/send.guard.fail */
export function overAudit(found: SendFinding[], audited: Record<string, Audit>): string[] {
  const by = new Map<string, SendFinding[]>();
  for (const f of found) by.set(f.file, [...(by.get(f.file) ?? []), f]);
  return [...by].filter(([file, fs]) => fs.length > (audited[file]?.n ?? 0)).map(([file, fs]) => saySend(file, fs, audited[file]?.n ?? 0));
}

/** One line for a file: the handlers, and what to do. @req FR:ui-kit/send.guard.message */
export const saySend = (file: string, fs: SendFinding[], allowed: number): string =>
  `${file}: ${fs.length} one-step sends (allowed ${allowed}): ${fs.map((f) => `line ${f.line} ${f.at} calls ${f.call}`).join('; ')}. Send from a form: show the text in a box (web/src/ui/MessageBox.tsx) and name the effect on the submit button.`;
