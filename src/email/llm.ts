/**
 * Model calls through the owner's Claude login: `claude -p` in safe mode, no tools, structured output, no session kept.
 * @req FR:email-runner/model.cli
 */
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const MODELS = { classify: 'claude-haiku-5-5', escalate: 'claude-sonnet-5-5', draft: 'claude-sonnet-5-5', judge: 'claude-haiku-5-5' } as const;
export const TIMEOUT_MS = 120_000;

export interface JsonCall { model: string; system: string; user: string; schema: object }
export interface JsonResult<T> { value: T; costUsd: number }
/** Runs one call; injected so tests never start a process. */
export type ClaudeJson = <T>(call: JsonCall) => Promise<JsonResult<T>>;

/** Spawns a command in `cwd` with stdin and returns stdout; the seam tests replace. */
export type Runner = (cmd: string, args: string[], stdin: string, o: { timeoutMs: number; cwd: string }) => Promise<{ code: number; stdout: string; stderr: string }>;

export const spawnRunner: Runner = (cmd, args, stdin, o) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env, cwd: o.cwd });
  let stdout = '';
  let stderr = '';
  const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`claude timed out after ${o.timeoutMs / 1000}s`)); }, o.timeoutMs);
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });
  p.stdin.on('error', () => undefined); // the process may exit before reading stdin (EPIPE); its exit code tells the story
  p.on('error', (e) => { clearTimeout(t); reject(e); });
  p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, stdout, stderr }); });
  p.stdin.end(stdin);
});

/**
 * The `claude -p` arguments: safe mode (no CLAUDE.md, plugins, hooks or MCP), no tools so injected text cannot act, nothing persisted.
 * The system prompt (which holds the owner's writing samples) goes in a 0600 file, not argv. @req FR:email-runner/model.cli
 */
export function claudeArgs(c: JsonCall, systemFile: string): string[] {
  return ['-p', '--safe-mode', '--model', c.model, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', '--json-schema', JSON.stringify(c.schema), '--system-prompt-file', systemFile];
}

export function createClaudeJson(o: { bin?: string; run?: Runner; timeoutMs?: number } = {}): ClaudeJson {
  const bin = o.bin ?? process.env.STACK_CLAUDE_BIN ?? 'claude';
  const run = o.run ?? spawnRunner;
  return async <T>(c: JsonCall): Promise<JsonResult<T>> => {
    // A private empty folder: no project files to load, and the prompt file is removed after the call.
    const dir = mkdtempSync(join(tmpdir(), 'stack-claude-'));
    const systemFile = join(dir, 'system.txt');
    try {
      writeFileSync(systemFile, c.system, { mode: 0o600 });
      const r = await run(bin, claudeArgs(c, systemFile), c.user, { timeoutMs: o.timeoutMs ?? TIMEOUT_MS, cwd: dir });
      if (r.code !== 0) throw new Error(`claude exited ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
      let out: { structured_output?: unknown; total_cost_usd?: unknown; is_error?: unknown };
      try { out = JSON.parse(r.stdout); } catch { throw new Error('claude returned no JSON'); }
      if (out.is_error === true || out.structured_output === undefined || out.structured_output === null) throw new Error('claude returned no structured output');
      return { value: out.structured_output as T, costUsd: typeof out.total_cost_usd === 'number' ? out.total_cost_usd : 0 };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
}
