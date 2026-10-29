import { graphTransport, GraphHttpError } from '../../src/graph/transport';

// @req FR:day-inputs/graph.transport
describe('Graph transport', () => {
  const fake = (status: number, body: unknown) => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), init: init! }); return new Response(JSON.stringify(body), { status }); }) as typeof globalThis.fetch;
    return { fetch, seen };
  };
  it('sends the bearer token and JSON body to Graph and returns the parsed body', async () => {
    const f = fake(200, { value: [] });
    let n = 0;
    const t = graphTransport({ token: () => `tok${++n}`, fetch: f.fetch });
    expect(await t({ method: 'POST', url: 'https://graph.microsoft.com/v1.0/me/messages/1/createReply', body: { comment: 'x' } })).toEqual({ value: [] });
    await t({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me/calendarView' });
    const h0 = new Headers(f.seen[0].init.headers);
    expect(h0.get('authorization')).toBe('Bearer tok1');
    expect(h0.get('content-type')).toBe('application/json');
    expect(f.seen[0].init.body).toBe('{"comment":"x"}');
    expect(new Headers(f.seen[1].init.headers).get('authorization')).toBe('Bearer tok2');
  });
  it('refuses other hosts before fetching', async () => {
    const f = fake(200, {});
    await expect(graphTransport({ token: 't', fetch: f.fetch })({ method: 'GET', url: 'https://evil.test/v1.0/me' })).rejects.toThrow();
    expect(f.seen).toHaveLength(0);
  });
  it('a non-2xx throws status and Graph code only', async () => {
    const f = fake(403, { error: { code: 'ErrorAccessDenied', message: 'secret detail about mailbox' } });
    const e = await graphTransport({ token: 'sekret', fetch: f.fetch })({ method: 'GET', url: 'https://graph.microsoft.com/v1.0/me' }).catch((x: unknown) => x as GraphHttpError);
    expect(e).toBeInstanceOf(GraphHttpError);
    expect(e).toMatchObject({ status: 403, code: 'ErrorAccessDenied' });
    expect(String(e.message)).not.toMatch(/secret detail|sekret/);
  });
});
