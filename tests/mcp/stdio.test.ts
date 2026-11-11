import { PassThrough } from 'stream';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveScopes, runStdio } from '../../src/mcp/stdio';

// @req FR:mcp-server/stdio.entry
describe('resolveScopes', () => {
  it('defaults to read+write; narrows; unknown grants nothing', () => {
    expect(resolveScopes(undefined)).toEqual(['read', 'write']);
    expect(resolveScopes('tasks:read')).toEqual(['tasks:read']);
    expect(resolveScopes(' read , bogus ')).toEqual(['read']);
    expect(resolveScopes('bogus')).toEqual([]);
    expect(resolveScopes('')).toEqual([]);
  });
});

/**
 * Reads newline-framed JSON-RPC replies and resolves once every awaited id has arrived: no sleep decides whether a reply came.
 * Holds partial lines, so a frame split across chunks still parses. @req FR:test-reliability/wait.event
 */
function frames(stdout: PassThrough) {
  const msgs: any[] = [];
  let buf = '';
  let waiters: { ids: number[]; ok: () => void }[] = [];
  const settle = () => { waiters = waiters.filter((w) => (w.ids.every((id) => msgs.some((m) => m.id === id)) ? (w.ok(), false) : true)); };
  stdout.on('data', (d) => {
    buf += String(d);
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const l of parts) if (l.trim()) msgs.push(JSON.parse(l));
    settle();
  });
  return { msgs, until: (...ids: number[]) => new Promise<void>((ok) => { waiters.push({ ids, ok }); settle(); }) };
}

// @req FR:mcp-server/stdio.entry @req FR:mcp-server/stdio.quiet
describe('runStdio', () => {
  const toolNames = async (argv: string[], env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-mcp-'));
    const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
    const done = runStdio({ argv: ['--dir', dir, ...argv], env, stdin, stdout, stderr });
    const f = frames(stdout);
    const send = (o: unknown) => stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await f.until(2);
    const m = f.msgs.find((x) => x.id === 2);
    stdin.end(); await done;
    return m.result.tools.map((t: any) => t.name);
  };
  it('STACK_MCP_SCOPES narrows; --scopes overrides env; default is read+write', async () => {
    expect(await toolNames([], { STACK_MCP_SCOPES: 'read' })).toEqual(['next', 'list', 'asks_list', 'asks_answer_wait']);
    expect(await toolNames(['--scopes', 'write'], { STACK_MCP_SCOPES: 'read' })).not.toContain('next');
    expect(await toolNames([], {})).toContain('add');
  });
  it('serves tools on stdio; stdout is protocol frames only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-mcp-'));
    mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 'alpha.md'), '# Alpha\n\n## 📥 Inbox\n\n- [ ] Local task\n');
    const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
    const done = runStdio({ argv: ['--dir', dir, '--scopes', 'read'], env: {}, stdin, stdout, stderr });
    const f = frames(stdout);
    const send = (o: unknown) => stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list', arguments: {} } });
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add', arguments: { project: 'alpha', text: 'x' } } });
    await f.until(1, 2, 3, 4);
    const msgs = [...f.msgs].sort((a, b) => a.id - b.id);
    expect(msgs.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(msgs[1].result.tools.map((t: any) => t.name)).toEqual(['next', 'list', 'asks_list', 'asks_answer_wait']);
    expect(JSON.parse(msgs[2].result.content[0].text).items[0][1]).toBe('Local task');
    expect(msgs[3].result).toEqual({ content: [{ type: 'text', text: 'error forbidden' }], isError: true });
    stdin.end();
    await done;
  });
  it('rejects bad flags on stderr without task data', async () => {
    const stderr = new PassThrough(); let err = '';
    stderr.on('data', (d) => { err += d; });
    const code = await runStdio({ argv: ['--wat'], env: {}, stdin: new PassThrough(), stdout: new PassThrough(), stderr });
    expect(code).toBe(2);
    expect(err).toMatch(/Usage: stack-mcp/);
  });
});
