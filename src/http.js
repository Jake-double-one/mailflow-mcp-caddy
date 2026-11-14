import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MailflowClient, isMailflowToken } from './mailflow.js';
import { createServer } from './tools.js';

const sameSecret = (given, expected) => {
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const bearer = header => /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? null;

const rpcError = (res, status, message, headers = {}) =>
  res.set(headers).status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

// The MCP endpoint, stateless: every request brings its credential and gets its own server.
//   POST /mcp            Authorization: Bearer mfat_…   each caller's own MailFlow token
//   POST /mcp/<secret>   no header                      the one token from MAILFLOW_API_TOKEN
export function createApp(config, { version, fetchImpl } = {}) {
  const app = createMcpExpressApp({
    host: config.host,
    ...(config.allowedHosts.length ? { allowedHosts: config.allowedHosts } : {}),
  });
  app.disable('x-powered-by');

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  const handle = pickToken => async (req, res) => {
    const token = pickToken(req);
    if (!token) {
      return rpcError(res, 401, 'Send a MailFlow API token: Authorization: Bearer mfat_…', { 'WWW-Authenticate': 'Bearer realm="MailFlow MCP"' });
    }
    if (req.method !== 'POST') return rpcError(res, 405, 'Method not allowed', { Allow: 'POST' });

    const client = new MailflowClient({ baseUrl: config.mailflowUrl, token, fetchImpl });
    const server = createServer(client, { version });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err.message);
      if (!res.headersSent) rpcError(res, 500, 'Internal server error');
    }
  };

  app.all('/mcp', handle(req => {
    const token = bearer(req.headers.authorization);
    return isMailflowToken(token) ? token : null;
  }));

  if (config.urlSecret) {
    app.all('/mcp/:secret', handle(req => (sameSecret(req.params.secret, config.urlSecret) ? config.token : null)));
  }

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}
