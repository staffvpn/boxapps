import { CATALOG, CATEGORIES, CATEGORIES_VERSION, KINDS } from './_catalog.js';

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
export const kindLabel = k => ({ game: 'игра', bot: 'бот', channel: 'канал' }[k] || k);

// KV: items — проекты каталога, pending — очередь заявок, st:<id> — шаг диалога, img:<id> — обложки.
export async function kvGet(env, key, fallback) {
  if (!env.STORE) return fallback;
  const v = await env.STORE.get(key, 'json');
  return v ?? fallback;
}
export async function kvPut(env, key, value, ttl) {
  if (!env.STORE) return;
  await env.STORE.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);
}

// Категории: правятся в админке и хранятся в KV, по умолчанию — из _catalog.js.
export async function getCategories(env) {
  let c = await kvGet(env, 'categories', null);
  if (c && c.v !== CATEGORIES_VERSION) c = null; // старый набор — берём новый по умолчанию
  const out = {};
  for (const k of Object.keys(KINDS)) out[k] = c && Array.isArray(c[k]) ? c[k] : CATEGORIES[k];
  return out;
}

export async function storedItems(env) { return kvGet(env, 'items', []); }
export async function saveItems(env, items) { await kvPut(env, 'items', items); }
export async function fullCatalog(env) {
  const stored = await storedItems(env);
  const ids = new Set(stored.map(x => x.id));
  return [...CATALOG.filter(x => !ids.has(x.id)), ...stored];
}

// Принимает @username, username, t.me/username, https://t.me/... — в любом регистре.
export function normalizeLink(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  s = s.replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.(me|dog)\//i, '').replace(/^@/, '');
  if (/^[A-Za-z][A-Za-z0-9_]{3,31}(\/[A-Za-z0-9_-]{1,64})?(\?[A-Za-z0-9_=&-]{1,128})?$/.test(s)) return 'https://t.me/' + s;
  if (/^(\+|joinchat\/)[A-Za-z0-9_-]{6,}$/i.test(s)) return 'https://t.me/' + s;
  return '';
}

export function slug(s) {
  const map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
  const out = String(s || '').toLowerCase().split('').map(c => map[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return out || 'item';
}

// Проверка подписи Telegram Mini App (initData).
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? new TextEncoder().encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
}
export async function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', botToken);
  const sig = [...await hmac(secret, dcs)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (sig !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}

// Админ: либо открыл мини-приложение из Telegram и его ID в ADMIN_IDS, либо ввёл ADMIN_KEY в браузере.
export async function isAdmin(request, env) {
  const key = request.headers.get('x-admin-key');
  if (key && env.ADMIN_KEY && key === env.ADMIN_KEY) return { via: 'key' };
  const user = await verifyInitData(request.headers.get('x-tg-init-data'), env.BOT_TOKEN);
  if (user && admins(env).includes(user.id)) return { via: 'telegram', user };
  return null;
}

// Новая заявка: в очередь + сообщение админам с кнопками модерации.
export async function createSubmission(env, sub) {
  sub.sid = crypto.randomUUID().slice(0, 8);
  sub.at = Date.now();
  const pending = await kvGet(env, 'pending', []);
  pending.push(sub);
  await kvPut(env, 'pending', pending.slice(-200));
  const who = sub.username ? '@' + sub.username : sub.user_id ? String(sub.user_id) : (sub.contact || 'с сайта');
  const text = `Новая заявка от ${esc(who)}\n\n<b>${esc(sub.title)}</b> · ${kindLabel(sub.kind)} · ${esc(sub.category)}\n${esc(sub.link)}\n\n${esc(sub.description)}`;
  await Promise.all(admins(env).map(id => tgApi(env, 'sendMessage', {
    chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: 'Добавить', callback_data: `mod:ok:${sub.sid}` }, { text: 'Отклонить', callback_data: `mod:no:${sub.sid}` }]] },
  })));
  return sub;
}

// Одобрить заявку: превращаем её в проект каталога.
export async function approveSubmission(env, sid) {
  const pending = await kvGet(env, 'pending', []);
  const sub = pending.find(s => s.sid === sid);
  if (!sub) return null;
  await kvPut(env, 'pending', pending.filter(s => s.sid !== sid));
  const items = await storedItems(env);
  let id = slug(sub.title);
  while (items.some(x => x.id === id)) id += '-' + Math.floor(Math.random() * 90 + 10);
  const item = { id, kind: KINDS[sub.kind] ? sub.kind : 'game', title: sub.title, categories: [sub.category], link: sub.link, description: sub.description || '', author: sub.username ? '@' + sub.username : '', createdAt: Date.now() };
  items.push(item);
  await saveItems(env, items);
  return { sub, item };
}
export async function rejectSubmission(env, sid) {
  const pending = await kvGet(env, 'pending', []);
  const sub = pending.find(s => s.sid === sid);
  if (!sub) return null;
  await kvPut(env, 'pending', pending.filter(s => s.sid !== sid));
  return { sub };
}
