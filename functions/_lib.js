import { CATALOG } from './_catalog.js';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function tgApi(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false }));
}

export const admins = env => String(env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);

// KV: approved — одобренные заявки, pending — очередь, st:<id> — шаг диалога пользователя.
export async function kvGet(env, key, fallback) {
  if (!env.STORE) return fallback;
  const v = await env.STORE.get(key, 'json');
  return v ?? fallback;
}
export async function kvPut(env, key, value, ttl) {
  if (!env.STORE) return;
  await env.STORE.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);
}

export async function fullCatalog(env) {
  const approved = await kvGet(env, 'approved', []);
  return [...CATALOG, ...approved];
}

export function normalizeLink(raw) {
  let s = String(raw || '').trim();
  if (s.startsWith('@')) s = 'https://t.me/' + s.slice(1);
  if (s.startsWith('t.me/')) s = 'https://' + s;
  return /^https:\/\/t\.me\/[A-Za-z0-9_]{5,}/.test(s) ? s : '';
}

// Новая заявка: в очередь + сообщение админам с кнопками модерации.
export async function createSubmission(env, sub) {
  sub.sid = crypto.randomUUID().slice(0, 8);
  sub.at = Date.now();
  const pending = await kvGet(env, 'pending', []);
  pending.push(sub);
  await kvPut(env, 'pending', pending.slice(-200));
  const who = sub.username ? '@' + sub.username : sub.user_id ? String(sub.user_id) : (sub.contact || 'с сайта');
  const text = `Новая заявка от ${esc(who)}\n\n<b>${esc(sub.title)}</b> · ${sub.kind === 'bot' ? 'бот' : 'игра'} · ${esc(sub.category)}\n${esc(sub.link)}\n\n${esc(sub.description)}`;
  await Promise.all(admins(env).map(id => tgApi(env, 'sendMessage', {
    chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: 'Добавить', callback_data: `mod:ok:${sub.sid}` }, { text: 'Отклонить', callback_data: `mod:no:${sub.sid}` }]] },
  })));
  return sub;
}
