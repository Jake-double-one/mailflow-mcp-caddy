import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http.js';
import { formatAddress, htmlToText, replyReferences, replySubject } from '../src/text.js';
import { ACCOUNT, MESSAGE, OTHER_ACCOUNT, TOKEN, startFakeMailflow } from './fakeMailflow.js';

const SECRET = 's'.repeat(40);
let mailflow, listener, base;

before(async () => {
  mailflow = await startFakeMailflow();
  const config = loadConfig({ MAILFLOW_URL: mailflow.url, MAILFLOW_API_TOKEN: TOKEN, MCP_URL_SECRET: SECRET, HOST: '127.0.0.1' });
  listener = createApp(config, { version: 'test' }).listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  base = `http://127.0.0.1:${listener.address().port}`;
});

after(async () => {
  await new Promise(resolve => listener.close(resolve));
  await mailflow.close();
});

async function connect(path = '/mcp', token = TOKEN) {
  const client = new Client({ name: 'test', version: '0' });
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  await client.connect(new StreamableHTTPClientTransport(new URL(base + path), { requestInit: { headers } }));
  return client;
}

const call = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return { isError: !!result.isError, text: result.content[0].text, data: result.isError ? null : JSON.parse(result.content[0].text) };
};

test('offers read and draft tools only', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), [
    'mailflow_create_draft', 'mailflow_get_message', 'mailflow_get_thread', 'mailflow_list_accounts',
    'mailflow_list_folders', 'mailflow_list_messages', 'mailflow_search',
  ]);
  for (const tool of tools.filter(t => t.name !== 'mailflow_create_draft')) assert.equal(tool.annotations.readOnlyHint, true);
  await client.close();
});

test('reads accounts, folders, lists, search and thread', async () => {
  const client = await connect();
  assert.equal((await call(client, 'mailflow_list_accounts')).data.accounts[0].id, ACCOUNT);
  assert.equal((await call(client, 'mailflow_list_folders', { accountId: ACCOUNT })).data.folders.length, 2);

  const list = await call(client, 'mailflow_list_messages', { accountId: ACCOUNT, unreadOnly: true });
  assert.equal(list.data.total, 1);
  assert.equal(list.data.messages[0].subject, 'Angebot');
  assert.equal(list.data.messages[0].spam_score_ml, undefined, 'UI-only columns are dropped');
  assert.deepEqual(mailflow.requests.at(-1).query, { accountId: ACCOUNT, folder: 'INBOX', limit: '25', offset: '0', unreadOnly: 'true' });

  await call(client, 'mailflow_search', { query: 'from:anna' });
  assert.equal(mailflow.requests.at(-1).query.q, 'from:anna');
  assert.equal((await call(client, 'mailflow_get_thread', { messageId: MESSAGE })).data.messages.length, 2);
  await client.close();
});

test('reads a message body as text', async () => {
  const client = await connect();
  const { data } = await call(client, 'mailflow_get_message', { messageId: MESSAGE });
  assert.equal(data.body, 'Hallo Welt & mehr');
  assert.equal(data.attachments[0].filename, 'a.pdf');
  await client.close();
});

test('saves a plain-text draft and never sends', async () => {
  const client = await connect();
  const { data } = await call(client, 'mailflow_create_draft', { accountId: ACCOUNT, to: ['bob@example.com'], subject: 'Hi', body: 'Text' });
  assert.equal(data.saved, true);
  assert.equal(data.sent, false);
  assert.equal(data.folder, 'Drafts');
  const sent = mailflow.requests.at(-1);
  assert.equal(`${sent.method} ${sent.path}`, 'POST /api/mail/draft');
  assert.deepEqual(sent.body, { accountId: ACCOUNT, to: ['bob@example.com'], subject: 'Hi', body: 'Text', includeIdentity: true });
  assert.equal(mailflow.requests.some(r => r.path === '/api/mail/send'), false);
  await client.close();
});

test('a reply draft takes recipient, subject and threading from the original', async () => {
  const client = await connect();
  await call(client, 'mailflow_create_draft', { accountId: ACCOUNT, body: 'Danke', replyToMessageId: MESSAGE });
  const { body } = mailflow.requests.at(-1);
  assert.deepEqual(body.to, ['Anna <anna@example.com>']);
  assert.equal(body.subject, 'Re: Angebot');
  assert.equal(body.inReplyTo, '<b@example.com>');
  assert.equal(body.references, '<a@example.com> <b@example.com>');
  await client.close();
});

test('refusals come back as tool errors', async () => {
  const client = await connect();
  const noRecipient = await call(client, 'mailflow_create_draft', { accountId: ACCOUNT, body: 'x' });
  assert.equal(noRecipient.isError, true);
  assert.match(noRecipient.text, /recipient/);
  const wrongAccount = await call(client, 'mailflow_create_draft', { accountId: OTHER_ACCOUNT, to: ['b@example.com'], body: 'x' });
  assert.match(wrongAccount.text, /404: Account not found/);
  const crossAccount = await call(client, 'mailflow_create_draft', { accountId: OTHER_ACCOUNT, body: 'x', replyToMessageId: MESSAGE });
  assert.match(crossAccount.text, /different account/);
  const injected = await call(client, 'mailflow_create_draft', { accountId: ACCOUNT, to: ['a@example.com\r\nBcc: x@example.com'], body: 'x' });
  assert.equal(injected.isError, true);
  await client.close();
});

test('the endpoint needs a token; a wrong one is refused by MailFlow', async () => {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' };
  assert.equal((await fetch(`${base}/mcp`, init)).status, 401);
  assert.equal((await fetch(`${base}/mcp`, { ...init, headers: { ...init.headers, Authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await fetch(`${base}/mcp/${'x'.repeat(40)}`, init)).status, 401);

  const client = await connect('/mcp', 'mfat_' + 'b'.repeat(43));
  const result = await call(client, 'mailflow_list_accounts');
  assert.match(result.text, /401: Invalid or expired API token/);
  await client.close();
});

test('the secret URL uses the configured token without a header', async () => {
  const client = await connect(`/mcp/${SECRET}`, null);
  assert.equal((await call(client, 'mailflow_list_accounts')).data.accounts.length, 1);
  assert.equal(mailflow.requests.at(-1).auth, `Bearer ${TOKEN}`);
  await client.close();
});

test('config refuses unsafe setups', () => {
  assert.throws(() => loadConfig({}), /MAILFLOW_URL/);
  assert.throws(() => loadConfig({ MAILFLOW_URL: 'http://b:3000', MCP_TRANSPORT: 'stdio' }), /MAILFLOW_API_TOKEN/);
  assert.throws(() => loadConfig({ MAILFLOW_URL: 'http://b:3000', MCP_URL_SECRET: SECRET }), /needs MAILFLOW_API_TOKEN/);
  assert.throws(() => loadConfig({ MAILFLOW_URL: 'http://b:3000', MAILFLOW_API_TOKEN: TOKEN, MCP_URL_SECRET: 'short' }), /at least 32/);
});

test('text helpers', () => {
  assert.equal(htmlToText('<style>p{}</style><p>a<br>b</p>&#228;'), 'a\nb\nä');
  assert.equal(replySubject('RE: x'), 'RE: x');
  assert.equal(formatAddress({ name: 'Doe, Jane', email: 'j@x.org' }), 'j@x.org');
  assert.equal(formatAddress({ name: 'x', email: 'a@b\r\nBcc: c@d' }), '');
  assert.equal(replyReferences({ thread_references: '<a@x> <b@x>', message_id: '<b@x>' }), '<a@x> <b@x>');
});
