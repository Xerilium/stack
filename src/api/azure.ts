/**
 * Azure Functions v4 adapter. Structural types only: no `@azure/functions` import, so the core
 * handler and its tests never depend on the host.
 */

/** @req FR:api/azure.@function */
export interface AzureRequestLike {
  method: string;
  url: string;
  headers: Headers;
  text(): Promise<string>;
  /** Host body stream; preferred over text() so the handler can cap the read. */
  body?: ReadableStream<Uint8Array> | null;
}
export interface AzureResponseLike { status: number; headers: Record<string, string>; body: string }
export interface AzureAppLike {
  http(name: string, opts: {
    methods: string[]; route: string; authLevel: 'anonymous';
    handler: (req: AzureRequestLike) => Promise<AzureResponseLike>;
  }): void;
}

/** @req FR:api/azure.@function @req FR:api/azure.body */
export function toAzureHandler(handler: (req: Request) => Promise<Response>) {
  return async (req: AzureRequestLike): Promise<AzureResponseLike> => {
    const method = req.method.toUpperCase();
    // The body is only pulled when the handler reads it, i.e. after authorization.
    const hasBody = method !== 'GET' && method !== 'HEAD';
    let body: ReadableStream<Uint8Array> | undefined;
    if (hasBody) {
      body = req.body ?? new ReadableStream<Uint8Array>({
        async pull(c) { const t = await req.text(); if (t !== '') c.enqueue(new TextEncoder().encode(t)); c.close(); },
      }, { highWaterMark: 0 });
    }
    const res = await handler(new Request(req.url, { method, headers: req.headers, body, ...(body ? { duplex: 'half' } : {}) } as RequestInit));
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, body: await res.text() };
  };
}

/** Registers one catch-all function; the handler does its own routing and auth. @req FR:api/azure.@function */
export function registerAzure(app: AzureAppLike, handler: (req: Request) => Promise<Response>, name = 'api'): void {
  app.http(name, {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    route: '{*route}',
    authLevel: 'anonymous',
    handler: toAzureHandler(handler),
  });
}
