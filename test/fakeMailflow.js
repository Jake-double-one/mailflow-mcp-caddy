import http from 'node:http';

export const TOKEN = 'mfat_' + 'a'.repeat(43);
export const ACCOUNT = '11111111-1111-4111-8111-111111111111';
export const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
export const MESSAGE = '33333333-3333-4333-8333-333333333333';

const message = {
  id: MESSAGE, account_id: ACCOUNT, folder: 'INBOX', message_id: '<b@example.com>',
  thread_references: '<a@example.com>', subject: 'Angebot', from_name: 'Anna', from_email: 'anna@example.com',
  reply_to: [], date: '2026-11-01T10:00:00Z', snippet: 'Hallo', is_read: false, account_email: 'me@example.com',
  spam_score_ml: 0.1,
};

// The few MailFlow routes the bridge calls, with the refusals that matter to it.
export async function startFakeMailflow() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const url = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, auth: req.headers.authorization });
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Invalid or expired API token' });
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/accounts') return send(200, [{ id: ACCOUNT, name: 'Work', email_address: 'me@example.com', aliases: [] }]);
    if (route === `GET /api/accounts/${ACCOUNT}/folders`) return send(200, [{ path: 'INBOX' }, { path: 'Drafts' }]);
    if (route === 'GET /api/mail/messages') return send(200, { messages: [message], total: 1 });
    if (route === 'GET /api/search') return send(200, { messages: [message], total: 1 });
    if (route === 'GET /api/mail/thread') return send(200, { messages: url.searchParams.get('id') === '<a@example.com>' ? [{ ...message, id: 'root' }, message] : [] });
    if (route === `GET /api/mail/messages/${MESSAGE}`) return send(200, message);
    if (route === `GET /api/mail/messages/${MESSAGE}/body`) return send(200, { html: '<p>Hallo <b>Welt</b> &amp; mehr</p>', text: null, attachments: [{ filename: 'a.pdf', size: 3 }] });
    if (route === 'POST /api/mail/draft') {
      if (body.accountId !== ACCOUNT) return send(404, { error: 'Account not found' });
      return send(200, { uid: 42, folder: 'Drafts', messageId: '<new@example.com>' });
    }
    if (route === 'POST /api/mail/send') return send(403, { error: 'This API token cannot be used for this request' });
    send(404, { error: 'Not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(resolve => server.close(resolve)) };
}
