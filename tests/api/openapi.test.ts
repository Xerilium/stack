import { readFileSync } from 'fs';
import { join } from 'path';
import { ROUTES } from '../../src/api/handler';

// Minimal YAML scan: path keys (2-space indent under `paths:`) and method keys (4-space).
function scan(): Set<string> {
  const out = new Set<string>();
  let path = '';
  let inPaths = false;
  for (const line of readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) inPaths = line.startsWith('paths:');
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) path = p[1];
    const m = /^ {4}(get|post|put|delete|patch):\s*$/.exec(line);
    if (m) out.add(`${m[1].toUpperCase()} ${path}`);
  }
  return out;
}

// @req FR:api/docs.openapi
describe('openapi.yaml', () => {
  it('documents exactly the routes the handler serves', () => {
    const served = new Set(ROUTES.map((r) => `${r.method} ${r.doc}`));
    expect([...scan()].sort()).toEqual([...served].sort());
  });
  it('is OpenAPI 3.0.3 with the error model', () => {
    const y = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    expect(y).toMatch(/^openapi: 3\.0\.3$/m);
    expect(y).toMatch(/Error:/);
    expect(y).toMatch(/name: fields/);
  });
});
