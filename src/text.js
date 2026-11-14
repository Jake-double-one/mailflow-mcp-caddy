// Helpers that shape MailFlow's rows into something compact for a model to read.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// A rough plain-text rendering of an HTML mail, used only when MailFlow has no text part.
export function htmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch { return ''; }
}

export function truncate(text, maxChars) {
  if (typeof text !== 'string') return { text: '', truncated: false };
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

const SUMMARY_FIELDS = [
  'id', 'account_id', 'folder', 'thread_id', 'message_id', 'subject', 'from_name', 'from_email',
  'to_addresses', 'cc_addresses', 'date', 'snippet', 'is_read', 'is_starred', 'has_attachments', 'category',
];

// The list and search rows carry many UI-only columns; keep what identifies and describes a mail.
export function summarize(message) {
  const out = {};
  for (const field of SUMMARY_FIELDS) {
    if (message[field] !== undefined && message[field] !== null) out[field] = message[field];
  }
  return out;
}

// "Re: " once, however often the subject already carries it.
export function replySubject(subject) {
  const base = String(subject ?? '').trim();
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`;
}

// The References header of a reply: the original's chain, then the original itself.
export function replyReferences(message) {
  return [...new Set([...headerIds(message.thread_references), ...headerIds(message.message_id)])].join(' ');
}

// The <id> entries of a Message-ID, In-Reply-To or References value.
export function headerIds(value) {
  return typeof value === 'string' ? value.match(/<[^<>\s]+>/g) ?? [] : [];
}

// "Name <email>" from one of MailFlow's { name, email } pairs, or '' without a usable address.
export function formatAddress(entry) {
  const email = String(entry?.email ?? '').trim();
  if (!/^[^\s<>"(),;:\\]+@[^\s<>"(),;:\\]+$/.test(email)) return '';
  const name = String(entry?.name ?? '').replace(/[\x00-\x1f\x7f"<>\\]/g, '').trim();
  // A name with list or route characters would need quoting; the bare address is always right.
  return name && !/[,;:@()[\]]/.test(name) ? `${name} <${email}>` : email;
}
