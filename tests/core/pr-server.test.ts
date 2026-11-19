import { serverPlan, withPort } from '../../src/core/pr-server';

// @req FR:pr-page/server.port
describe('withPort: the free port replaces a port in the command', () => {
  it('replaces each port form', () => {
    expect(withPort('pnpm web --port 5180', 6001)).toBe('pnpm web --port 6001');
    expect(withPort('vite preview --port=5180', 6001)).toBe('vite preview --port=6001');
    expect(withPort('serve -p 5180 dist', 6001)).toBe('serve -p 6001 dist');
    expect(withPort('PORT=5180 node server.js', 6001)).toBe('PORT=6001 node server.js');
    expect(withPort('node s.js --url http://localhost:5180/x', 6001)).toBe('node s.js --url http://localhost:6001/x');
  });
  it('leaves a command with no port as it is', () => {
    expect(withPort('node server.js', 6001)).toBe('node server.js');
    expect(withPort('node build-1234.js', 6001)).toBe('node build-1234.js');
  });
});

// @req FR:pr-page/server.plan
describe('serverPlan: setup, run, and port', () => {
  it('the Server line of the check file wins, on the free port', () => {
    expect(serverPlan({ server: 'pnpm web --port 5180', scripts: { build: 'tsc', web: 'node x' }, deps: true, lock: 'pnpm', port: 6001 }))
      .toEqual({ setup: ['pnpm install --frozen-lockfile', 'pnpm run build'], run: 'pnpm web --port 6001', port: 6001 });
  });
  it('with no Server line: the first script of web, dev, start, preview', () => {
    expect(serverPlan({ scripts: { start: 'node s.js', dev: 'vite' }, deps: false, lock: 'pnpm', port: 6001 })).toEqual({ setup: [], run: 'pnpm run dev --port 6001', port: 6001 });
    expect(serverPlan({ scripts: { preview: 'vite preview' }, deps: true, lock: 'yarn', port: 6001 })).toEqual({ setup: ['yarn install --frozen-lockfile'], run: 'yarn run preview --port 6001', port: 6001 });
  });
  it('npm: ci with a lock file, install with none, and -- before the port', () => {
    expect(serverPlan({ scripts: { start: 'node s.js', build: 'tsc' }, deps: true, lock: 'npm', port: 6001 })).toEqual({ setup: ['npm ci', 'npm run build'], run: 'npm run start -- --port 6001', port: 6001 });
    expect(serverPlan({ scripts: { start: 'node s.js' }, deps: true, lock: null, port: 6001 })!.setup).toEqual(['npm install']);
  });
  it('null with no Server line and no known script', () => {
    expect(serverPlan({ scripts: { test: 'jest' }, deps: true, lock: 'pnpm', port: 6001 })).toBeNull();
    expect(serverPlan({ deps: false, lock: null, port: 6001 })).toBeNull();
  });
  it('a Server line needs no package.json', () => {
    expect(serverPlan({ server: 'python3 -m http.server 8000', deps: false, lock: null, port: 6001 })).toEqual({ setup: [], run: 'python3 -m http.server 8000', port: 6001 });
  });
});
