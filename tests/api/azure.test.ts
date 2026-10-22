import { registerAzure, toAzureHandler } from '../../src/api/azure';

const echo = async (req: Request) =>
  new Response(JSON.stringify({ m: req.method, u: req.url, b: await req.text(), h: req.headers.get('x-a') }), { status: 201, headers: { 'content-type': 'application/json' } });

// @req FR:api/azure.@function
describe('azure adapter', () => {
  it('converts request and response', async () => {
    const out = await toAzureHandler(echo)({ method: 'POST', url: 'https://h/api/x?y=1', headers: new Headers({ 'x-a': '1' }), text: async () => 'body' });
    expect(out.status).toBe(201);
    expect(JSON.parse(out.body as string)).toEqual({ m: 'POST', u: 'https://h/api/x?y=1', b: 'body', h: '1' });
    expect(out.headers['content-type']).toBe('application/json');
  });
  // @req FR:api/azure.body
  it('GET and HEAD carry no body and never call text()', async () => {
    const text = jest.fn(async () => 'nope');
    for (const method of ['GET', 'HEAD']) {
      const out = await toAzureHandler(echo)({ method, url: 'https://h/api/x', headers: new Headers(), text });
      expect(JSON.parse(out.body as string).b).toBe('');
    }
    expect(text).not.toHaveBeenCalled();
  });
  it('registers a catch-all function', async () => {
    const app = { http: jest.fn() };
    registerAzure(app, echo);
    const [name, opts] = app.http.mock.calls[0];
    expect(name).toBe('api');
    expect(opts.route).toBe('{*route}');
    expect(opts.authLevel).toBe('anonymous');
    expect(opts.methods).toEqual(expect.arrayContaining(['GET', 'POST']));
    const out = await opts.handler({ method: 'GET', url: 'https://h/api/x', headers: new Headers(), text: async () => '' });
    expect(out.status).toBe(201);
  });
});
