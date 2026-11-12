/**
 * `stack devices add|list|revoke`: paired devices for the tailnet host, in `<STACK_HOME>/tokens.json` and `devices.json`.
 * @req FR:tailnet-access/pair.@cli
 */
import { mkdirSync } from 'fs';
import { join } from 'path';
import { createDeviceService, createTokenService, FileTokenStore, type DeviceService, type TokenService } from '../api';
import { UsageError } from './args';

/** The file stores `stack web` and `stack devices` share. Owner-only file mode (`FR:auth-security/token.file`). */
export function fileAuth(home: string): { tokens: TokenService; devices: DeviceService } {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const tokens = createTokenService({ store: new FileTokenStore(join(home, 'tokens.json')) });
  return { tokens, devices: createDeviceService({ store: new FileTokenStore(join(home, 'devices.json')), tokens }) };
}

export interface DevicesOutcome { json: Record<string, unknown>; text: string }

/** @req FR:tailnet-access/pair.@cli.add @req FR:tailnet-access/pair.@cli.list @req FR:tailnet-access/pair.@cli.revoke */
export async function devicesCmd(action: string | undefined, args: string[], home: string): Promise<DevicesOutcome> {
  const { devices } = fileAuth(home);
  if (action === 'add') {
    const name = args.join(' ').trim();
    if (!name) throw new UsageError('Usage: stack devices add <name>');
    let made: Awaited<ReturnType<DeviceService['create']>>;
    try { made = await devices.create(name); } catch (e) { throw new UsageError(e instanceof Error ? e.message : 'Cannot add the device'); }
    return {
      json: { device: made.device, token: made.token, path: `/pair#${made.token}` },
      text: [
        `Paired device ${made.device.name} (${made.device.id}). The code shows only once.`,
        `Pairing code: ${made.token}`,
        `Open on the phone: <tailnet URL>/pair#${made.token}  (or open <tailnet URL>/pair and paste the code)`,
      ].join('\n'),
    };
  }
  if (action === 'list') {
    const items = await devices.list();
    return { json: { items }, text: items.length ? items.map((d) => `${d.id}  ${d.status.padEnd(7)}  ${d.createdAt}  ${d.name}`).join('\n') : 'No devices. Add one: stack devices add <name>' };
  }
  if (action === 'revoke') {
    const id = args[0];
    if (!id) throw new UsageError('Usage: stack devices revoke <id>');
    const result = await devices.revoke(id);
    if (result === 'not_found') throw new UsageError(`Device not found: ${id}`);
    return { json: { id, result }, text: result === 'already' ? `Device ${id} was already revoked` : `Revoked device ${id}` };
  }
  throw new UsageError('Usage: stack devices add <name> | list | revoke <id>');
}
