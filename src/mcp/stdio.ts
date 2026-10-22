#!/usr/bin/env node
/**
 * `stack-mcp`: MCP over stdio for a local project directory. stdout is protocol frames only.
 * @req FR:mcp-server/stdio.entry @req FR:mcp-server/stdio.quiet
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { Readable, Writable } from 'stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApiHandler } from '../api/handler';
import { SCOPES } from '../api/auth';
import { getDefaults, parseConfig, type StackConfig } from '../core/config';
import { FsStorage } from '../core/storage';
import { GitStorage } from '../core/storage-git';
import { createMcpServer } from './server';

const USAGE = 'Usage: stack-mcp [--dir <path>] [--scopes <a,b>]\nScopes: ' + SCOPES.join(', ') + ' (default: read,write; env STACK_MCP_SCOPES)\n';

/** Unknown names grant nothing; absent means full local access. @req FR:mcp-server/stdio.entry */
export function resolveScopes(raw: string | undefined): string[] {
  if (raw === undefined) return ['read', 'write'];
  return raw.split(',').map((s) => s.trim()).filter((s) => (SCOPES as readonly string[]).includes(s));
}

function loadConfig(dir: string): StackConfig {
  const p = join(dir, '.xe/config/stack.json');
  if (!existsSync(p)) return getDefaults();
  return parseConfig(JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')));
}

export interface StdioIo { argv: string[]; env: Record<string, string | undefined>; stdin: Readable; stdout: Writable; stderr: Writable }

export async function runStdio(io: StdioIo): Promise<number> {
  let dir = io.env['STACK_DIR'] ?? process.cwd();
  let scopes = io.env['STACK_MCP_SCOPES'];
  for (let i = 0; i < io.argv.length; i += 2) {
    const [flag, value] = [io.argv[i], io.argv[i + 1]];
    if ((flag !== '--dir' && flag !== '--scopes') || value === undefined) { io.stderr.write(USAGE); return 2; }
    if (flag === '--dir') dir = value; else scopes = value;
  }
  dir = resolve(dir);
  try {
    const storage = existsSync(join(dir, '.git')) ? new GitStorage(dir) : new FsStorage(dir);
    // Local process, same trust as the CLI: the API gate is open and the tool scopes are the limit.
    const api = createApiHandler({ storage, config: loadConfig(dir), authorize: () => true });
    const server = createMcpServer({ api, scopes: resolveScopes(scopes), onError: (n) => io.stderr.write(`stack-mcp: ${n}\n`) });
    const closed = new Promise<void>((r) => { server.onclose = () => r(); });
    await server.connect(new StdioServerTransport(io.stdin, io.stdout));
    io.stdin.once('end', () => { void server.close(); });
    await closed;
    return 0;
  } catch (e) {
    io.stderr.write(`stack-mcp: ${e instanceof Error ? e.constructor.name : 'Error'}\n`);
    return 1;
  }
}

if (require.main === module) {
  runStdio({ argv: process.argv.slice(2), env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
    .then((code) => { process.exitCode = code; });
}
