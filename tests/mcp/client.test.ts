import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setup, URL_MCP } from './helpers';

// @req FR:mcp-server/http.@function
describe('official SDK client', () => {
  it('initializes, lists, and calls tools over the handler', async () => {
    const { mcp, mint } = await setup();
    const t = await mint('read', 'write');
    const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
      fetch: (u, i) => mcp(new Request(u as string, i)),
      requestInit: { headers: { authorization: `Bearer ${t}` } },
    });
    const client = new Client({ name: 't', version: '1' });
    await client.connect(transport);
    expect((await client.listTools()).tools.map((x) => x.name)).toContain('next');
    const add = await client.callTool({ name: 'add', arguments: { project: 'alpha', text: 'Via SDK' } });
    expect((add.content as { text: string }[])[0].text).toMatch(/^added alpha:\d+$/);
    const next = await client.callTool({ name: 'next', arguments: {} });
    expect(JSON.parse((next.content as { text: string }[])[0].text).text).toBe('Via SDK');
    await client.close();
  });
});
