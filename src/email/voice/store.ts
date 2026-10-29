/**
 * The learned profile lives in the owner's data directory, never in the repository, readable by the owner only.
 * @req FR:email-voice/learn.store
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { VoiceProfile } from './learn';

/** `~/Library/Application Support/stack/email/<account>/voice.json`; `STACK_DATA_DIR` overrides the base. */
export function voicePath(account: string, base = process.env.STACK_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'stack')): string {
  if (!/^[\w.+-]+@[\w.-]+$/.test(account)) throw new Error(`Not a mailbox address: ${account}`);
  return join(base, 'email', account.toLowerCase(), 'voice.json');
}

/** Writes the profile with mode 0600 in a 0700 directory. */
export function saveVoice(path: string, p: VoiceProfile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  writeFileSync(path, `${JSON.stringify(p, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** The saved profile, or undefined when none was learned yet. Refuses a file others can read. */
export function loadVoice(path: string): VoiceProfile | undefined {
  if (!existsSync(path)) return undefined;
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) throw new Error(`Voice profile is readable by others; run chmod 600 ${path}`);
  const p = JSON.parse(readFileSync(path, 'utf8')) as VoiceProfile;
  if (p?.version !== 1 || !Array.isArray(p.examples)) throw new Error(`Not a voice profile: ${path}`);
  return p;
}
