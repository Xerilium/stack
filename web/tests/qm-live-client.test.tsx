// @vitest-environment jsdom
/** @req FR:web-app/api.client */
import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import { unreachable } from '../src/api';
import { LivePanel } from '../src/LivePanel';
import { QmView } from '../src/QmView';

const html502 = (async () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } })) as typeof fetch;
const down = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;

async function alert(node: preact.ComponentChild): Promise<string> {
  const root = document.createElement('div'); document.body.append(root);
  render(node, root);
  for (let i = 0; i < 50 && !root.querySelector('[role="alert"]'); i++) await new Promise((r) => setTimeout(r, 10));
  const text = root.querySelector('[role="alert"]')?.textContent ?? '';
  render(null, root); root.remove();
  return text;
}

describe('QM and live lane pages use the shared client', () => {
  it('a 502 HTML page shows the HTTP failure, not a JSON SyntaxError', async () => {
    for (const t of [await alert(<QmView fetchFn={html502} />), await alert(<LivePanel fetchFn={html502} />)]) {
      expect(t).toContain('502');
      expect(t).not.toMatch(/Unexpected token|SyntaxError|JSON/);
    }
  });
  it('a network failure shows the standard unreachable text', async () => {
    expect(await alert(<QmView fetchFn={down} />)).toBe(unreachable());
    expect(await alert(<LivePanel fetchFn={down} />)).toContain(unreachable());
  });
});
