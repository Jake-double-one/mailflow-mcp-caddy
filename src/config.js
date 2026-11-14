import { isMailflowToken } from './mailflow.js';

const MIN_URL_SECRET = 32;

// Reads and checks the environment once, so a wrong setup stops the start instead of the first call.
export function loadConfig(env = process.env) {
  const transport = (env.MCP_TRANSPORT || 'http').toLowerCase();
  if (!['http', 'stdio'].includes(transport)) throw new Error('MCP_TRANSPORT must be http or stdio');

  const mailflowUrl = (env.MAILFLOW_URL || '').trim();
  if (!/^https?:\/\//.test(mailflowUrl)) throw new Error('MAILFLOW_URL must be set, e.g. http://backend:3000');

  const token = (env.MAILFLOW_API_TOKEN || '').trim() || null;
  if (token && !isMailflowToken(token)) throw new Error('MAILFLOW_API_TOKEN does not look like a MailFlow API token (mfat_…)');
  if (transport === 'stdio' && !token) throw new Error('MCP_TRANSPORT=stdio needs MAILFLOW_API_TOKEN');

  const urlSecret = (env.MCP_URL_SECRET || '').trim() || null;
  if (urlSecret) {
    if (!token) throw new Error('MCP_URL_SECRET needs MAILFLOW_API_TOKEN: it opens that one token to whoever knows the URL');
    if (urlSecret.length < MIN_URL_SECRET || !/^[A-Za-z0-9_-]+$/.test(urlSecret)) {
      throw new Error(`MCP_URL_SECRET must be at least ${MIN_URL_SECRET} characters of A-Z a-z 0-9 _ -`);
    }
  }

  const port = Number(env.PORT || 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a port number');

  const allowedHosts = (env.MCP_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);

  return { transport, mailflowUrl, token, urlSecret, port, host: env.HOST || '0.0.0.0', allowedHosts };
}
