#!/usr/bin/env node
/**
 * A fake ACP agent for tests: newline-delimited JSON-RPC 2.0 on stdio, no dependencies, no network, no model.
 * The prompt text picks the behavior: `ask` (tool call + permission request), `slow` (waits for session/cancel),
 * `ask-read` (a read tool), `ask-die` (exits while asking), `stuck` (ignores session/cancel), `crash` (exits), `error` (JSON-RPC error), `refusal` (stop reason), `env` (echoes the environment it was given),
 * `think` (a thought chunk, a plan and a non-text chunk the driver must ignore) and `big` (a tool call with 5000 chars of output, clipped by the driver).
 * @req FR:acp-driver/test.fake
 */
'use strict';
const readline = require('readline');

/** A 1x1 transparent PNG: enough to be a valid non-text content block. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const out = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
const pending = new Map();
let nextId = 1000;
let cancel = null;
const call = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); out({ id, method, params }); });
const update = (sessionId, u) => out({ method: 'session/update', params: { sessionId, update: u } });
const chunk = (sessionId, text) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });

async function prompt(id, params) {
  const sid = params.sessionId;
  const text = (params.prompt[0] && params.prompt[0].text) || '';
  if (text.includes('crash')) { process.stderr.write('fake agent crashed, token ghp_abcdefghijklmnopqrstuvwxyz0123456789ab\n'); process.exit(3); }
  if (text.includes('error')) { out({ id, error: { code: -32603, message: 'Internal error: token ghp_abcdefghijklmnopqrstuvwxyz0123456789ab' } }); return; }
  if (text.includes('think')) {
    update(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Weighing the options.' } });
    update(sid, { sessionUpdate: 'plan', entries: [{ content: 'Answer the prompt', priority: 'high', status: 'in_progress' }] });
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'image', mimeType: 'image/png', data: PIXEL } });
  }
  chunk(sid, 'Hello');
  if (text.includes('big')) {
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 'big1', title: 'Run: dump', kind: 'execute', status: 'in_progress', rawInput: { command: 'dump' } });
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'big1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'x'.repeat(5000) } }] });
  }
  if (text.includes('env')) chunk(sid, ` GH_TOKEN=${process.env.GH_TOKEN ? 'set' : 'unset'} FAKE_FLAG=${process.env.FAKE_FLAG || 'unset'}`);
  if (text.includes('stuck')) { await new Promise(() => undefined); return; } // ignores session/cancel
  if (text.includes('slow')) {
    await new Promise((r) => { cancel = r; });
    out({ id, result: { stopReason: 'cancelled' } });
    return;
  }
  if (text.includes('ask')) {
    const read = text.includes('ask-read');
    const title = read ? 'Read: README.md' : 'Run: git push';
    const kind = read ? 'read' : 'execute';
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 't1', title, kind, status: 'pending', rawInput: read ? { path: 'README.md' } : { command: 'git push' } });
    if (text.includes('ask-die')) setTimeout(() => { process.stderr.write('fake agent died mid-ask\n'); process.exit(4); }, 1500);
    const r = await call('session/request_permission', {
      sessionId: sid,
      toolCall: { toolCallId: 't1', title, kind },
      options: [
        { optionId: 'opt-allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'opt-reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    const o = r.outcome || {};
    const allowed = o.outcome === 'selected' && o.optionId === 'opt-allow';
    chunk(sid, ` permission=${o.outcome === 'selected' ? o.optionId : o.outcome}`);
    update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: allowed ? 'pushed' : 'denied' } }] });
  }
  chunk(sid, ' world');
  out({ id, result: { stopReason: text.includes('refusal') ? 'refusal' : 'end_turn' } });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  if (m.id !== undefined && !m.method) { const r = pending.get(m.id); pending.delete(m.id); if (r) r(m.result || {}); return; }
  switch (m.method) {
    case 'initialize':
      out({ id: m.id, result: { protocolVersion: Number(process.env.FAKE_ACP_VERSION || 1), agentCapabilities: {}, agentInfo: { name: 'fake-acp-agent', version: '0.0.0' }, authMethods: [] } });
      break;
    case 'session/new':
      out({ id: m.id, result: { sessionId: `fake-${process.pid}` } });
      break;
    case 'session/prompt':
      void prompt(m.id, m.params);
      break;
    case 'session/cancel':
      if (cancel) cancel();
      break;
    default:
      if (m.id !== undefined) out({ id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));
