/** `stack devices add|list|revoke`: pairing codes for the tailnet host, in `<STACK_HOME>`. */
import { mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';
import { fileAuth } from '../../src/cli/devices';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'stack-devices-')); process.env.STACK_HOME = home; });
afterAll(() => { delete process.env.STACK_HOME; });

async function cli(...args: string[]) {
  let out = ''; let err = '';
  const code = await run(args, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

describe('stack devices', () => {
  // @req FR:tailnet-access/pair.@cli @req FR:tailnet-access/pair.@cli.add @req FR:tailnet-access/pair.@cli.list @req FR:tailnet-access/pair.@cli.revoke
  it('adds a device with a one-time pairing code, lists it without the code, and revokes it', async () => {
    const add = await cli('devices', 'add', 'iPhone');
    expect(add.code).toBe(0);
    const code = /Pairing code: (stk_[0-9a-f]{16}\.\S+)/.exec(add.out)?.[1] ?? '';
    expect(code).not.toBe('');
    expect(add.out).toContain(`/pair#${code}`);
    expect(statSync(join(home, 'tokens.json')).mode & 0o077).toBe(0);
    expect(statSync(join(home, 'devices.json')).mode & 0o077).toBe(0);
    const { tokens, devices } = fileAuth(home);
    const v = await tokens.verify(code);
    expect(v).not.toBeNull();
    expect(await devices.byTokenId(v!.id)).not.toBeNull();

    const list = await cli('devices', 'list');
    expect(list.code).toBe(0);
    expect(list.out).toContain('iPhone');
    expect(list.out).toContain('active');
    expect(list.out).not.toContain(code.split('.')[1]);
    const id = (await devices.list())[0].id;
    expect(list.out).toContain(id);

    const json = JSON.parse((await cli('devices', 'list', '--json')).out) as { items: { id: string; status: string }[] };
    expect(json.items[0]).toMatchObject({ id, status: 'active' });

    const rev = await cli('devices', 'revoke', id);
    expect(rev.code).toBe(0);
    expect(await tokens.verify(code)).toBeNull();
    expect((await cli('devices', 'revoke', 'ffffffffffffffff')).code).toBe(2);
  });

  // @req FR:tailnet-access/pair.@cli
  it('refuses a missing name or an unknown action', async () => {
    expect((await cli('devices', 'add')).code).toBe(2);
    expect((await cli('devices', 'wipe')).code).toBe(2);
    expect((await cli('devices')).code).toBe(2);
  });
});
