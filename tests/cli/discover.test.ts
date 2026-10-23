/** @req FR:cli/run.discover */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findStackDir } from '../../src/cli/discover';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'stack-disc-')));
const mk = (root: string) => { mkdirSync(join(root, '.xe/config'), { recursive: true }); writeFileSync(join(root, '.xe/config/stack.json'), '{}'); };

describe('findStackDir', () => {
  it('walks up from cwd to the config', () => {
    const root = tmp(); mk(root);
    const sub = join(root, 'a/b'); mkdirSync(sub, { recursive: true });
    expect(findStackDir({ cwd: sub, env: {}, home: tmp() })).toBe(root);
  });
  it('accepts a tasks/ folder with markdown', () => {
    const root = tmp(); mkdirSync(join(root, 'tasks')); mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'tasks/x.md'), '# x');
    expect(findStackDir({ cwd: root, env: {}, home: tmp() })).toBe(root);
  });
  it('falls back to STACK_DIR, then user config', () => {
    const cwd = tmp(); const env = tmp(); const home = tmp();
    expect(findStackDir({ cwd, env: { STACK_DIR: env }, home })).toBe(env);
    mkdirSync(join(home, '.config/stack'), { recursive: true });
    const cfgDir = tmp();
    writeFileSync(join(home, '.config/stack/config.json'), JSON.stringify({ dir: cfgDir }));
    expect(findStackDir({ cwd, env: {}, home })).toBe(cfgDir);
  });
  it('ignores a tasks/ folder outside a git repo and a missing STACK_DIR', () => {
    const root = tmp(); mkdirSync(join(root, 'tasks')); writeFileSync(join(root, 'tasks/x.md'), '# x');
    expect(findStackDir({ cwd: root, env: { STACK_DIR: join(root, 'nope') }, home: tmp() })).toBeNull();
  });
  it('returns null when nothing is found', () => {
    expect(findStackDir({ cwd: tmp(), env: {}, home: tmp() })).toBeNull();
  });
});
