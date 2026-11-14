// A thin client for the part of MailFlow's REST API that API tokens may call
// (backend/src/services/apiTokenAllowlist.js upstream). Read and draft only.

export class MailflowError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'MailflowError';
    this.status = status;
  }
}

const TOKEN_FORMAT = /^mfat_[A-Za-z0-9_-]+$/;
export const isMailflowToken = value => typeof value === 'string' && TOKEN_FORMAT.test(value);

export class MailflowClient {
  constructor({ baseUrl, token, timeoutMs = 30_000, fetchImpl = fetch }) {
    if (!baseUrl) throw new Error('MAILFLOW_URL is not set');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (err) {
      throw new MailflowError(`MailFlow is not reachable at ${this.baseUrl}: ${err.cause?.message ?? err.message}`, 0);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: reported below */ }
    if (!response.ok) {
      const detail = data?.error ?? (text.slice(0, 200) || response.statusText);
      throw new MailflowError(`MailFlow answered ${response.status}: ${detail}`, response.status);
    }
    if (data === null) throw new MailflowError(`MailFlow answered ${response.status} without JSON`, response.status);
    return data;
  }

  self() { return this.request('GET', '/api/api-tokens/self'); }
  accounts() { return this.request('GET', '/api/accounts'); }
  folders(accountId) { return this.request('GET', `/api/accounts/${accountId}/folders`); }
  messages(query) { return this.request('GET', '/api/mail/messages', { query }); }
  message(id) { return this.request('GET', `/api/mail/messages/${id}`); }
  body(id) { return this.request('GET', `/api/mail/messages/${id}/body`); }
  thread(id) { return this.request('GET', '/api/mail/thread', { query: { id } }); }
  search(query) { return this.request('GET', '/api/search', { query }); }
  saveDraft(body) { return this.request('POST', '/api/mail/draft', { body }); }
}
