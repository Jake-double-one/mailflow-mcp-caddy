#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createApp } from './http.js';
import { MailflowClient } from './mailflow.js';
import { createServer } from './tools.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`mailflow-mcp: ${err.message}`);
  process.exit(1);
}

if (config.transport === 'stdio') {
  const client = new MailflowClient({ baseUrl: config.mailflowUrl, token: config.token });
  await createServer(client, { version }).connect(new StdioServerTransport());
  console.error(`mailflow-mcp ${version} on stdio → ${config.mailflowUrl}`);
} else {
  if (config.token && !config.urlSecret) {
    console.warn('mailflow-mcp: MAILFLOW_API_TOKEN is ignored over HTTP without MCP_URL_SECRET; callers send their own token.');
  }
  const listener = createApp(config, { version }).listen(config.port, config.host, () => {
    console.log(`mailflow-mcp ${version} listening on ${config.host}:${config.port} → ${config.mailflowUrl}`);
    if (config.urlSecret) console.log('mailflow-mcp: the secret URL /mcp/<MCP_URL_SECRET> is enabled');
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => listener.close(() => process.exit(0)));
  }
}
