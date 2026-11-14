#!/usr/bin/env node
// Checks a running bridge end to end with a real MailFlow token.
//   MAILFLOW_API_TOKEN=mfat_… node scripts/smoke.js http://localhost:3100/mcp [--draft]
// Read-only unless --draft is given; then it saves one test draft in the first account.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [url, flag] = process.argv.slice(2);
const token = process.env.MAILFLOW_API_TOKEN;
if (!url || !token) {
  console.error('Usage: MAILFLOW_API_TOKEN=mfat_… node scripts/smoke.js <bridge-url>/mcp [--draft]');
  process.exit(2);
}

const client = new Client({ name: 'mailflow-mcp-smoke', version: '0' });
await client.connect(new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
}));

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0]?.text ?? '';
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

try {
  const { tools } = await client.listTools();
  console.log(`tools: ${tools.map(t => t.name).join(', ')}`);

  const { accounts } = await call('mailflow_list_accounts');
  console.log(`accounts: ${accounts.map(a => a.email_address).join(', ') || '(none)'}`);
  if (!accounts.length) throw new Error('The MailFlow user has no mail account');
  const account = accounts[0];

  const { folders } = await call('mailflow_list_folders', { accountId: account.id });
  console.log(`folders of ${account.email_address}: ${folders.map(f => f.path).join(', ')}`);

  const inbox = await call('mailflow_list_messages', { accountId: account.id, limit: 5 });
  console.log(`inbox: ${inbox.total} message(s)`);
  for (const m of inbox.messages) console.log(`  - ${m.date}  ${m.from_email}  ${m.subject}`);

  const first = inbox.messages[0];
  if (first) {
    const message = await call('mailflow_get_message', { messageId: first.id, maxChars: 500 });
    console.log(`body of "${message.subject}": ${JSON.stringify(message.body.slice(0, 120))}`);
  }

  if (flag === '--draft') {
    const draft = await call('mailflow_create_draft', first
      ? { accountId: account.id, replyToMessageId: first.id, body: 'Test draft from the MailFlow MCP bridge. Safe to delete.' }
      : { accountId: account.id, to: [account.email_address], subject: 'MCP bridge test', body: 'Test draft from the MailFlow MCP bridge. Safe to delete.' });
    console.log(`draft: saved in ${draft.folder} (uid ${draft.uid}), sent=${draft.sent}, to=${draft.to.join(', ')}, subject=${JSON.stringify(draft.subject)}`);
  }
  console.log('OK');
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
