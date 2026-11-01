// POST /tg/webhook — бот BOX APPS: разделы, категории, случайный выбор, поиск, заявки.
// Для админов из ADMIN_IDS: /admin (открывает админку), кнопки «Добавить / Отклонить» на заявках.
import { BRAND, KINDS } from '../_catalog.js';
import { admins, getCategories, approveSubmission, createSubmission, esc, fullCatalog, json, kindLabel, kvGet, kvPut, normalizeLink, rejectSubmission, tgApi } from '../_lib.js';

const PAGE = 6;
const ok = () => json({ ok: true });

export async function onRequestPost({ request, env }) {
  if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return json({ ok: false }, 403);
  let upd;
  try { upd = await request.json(); } catch { return ok(); }
  const ctx = { env, origin: new URL(request.url).origin };
  try {
    if (upd.callback_query) await onCallback(ctx, upd.callback_query);
    else if (upd.message && upd.message.chat.type === 'private') await onMessage(ctx, upd.message);
  } catch (e) {
    console.error(e);
  }
  return ok();
}

const send = (ctx, chat_id, text, reply_markup) =>
  tgApi(ctx.env, 'sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });
const edit = (ctx, m, text, reply_markup) =>
  tgApi(ctx.env, 'editMessageText', { chat_id: m.chat.id, message_id: m.message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });
const btn = (text, data) => ({ text, callback_data: data });
const isAdmin = (ctx, uid) => admins(ctx.env).includes(uid);
const visible = async ctx => (await fullCatalog(ctx.env)).filter(x => !x.hidden);

function menuKb(ctx, uid) {
  const rows = [
    [{ text: 'Открыть BOX APPS', web_app: { url: ctx.origin } }],
    [btn('Игры', 'kind:game'), btn('Боты', 'kind:bot'), btn('Каналы', 'kind:channel')],
    [btn('Категории', 'cats'), btn('Поиск', 'search')],
    [btn('Предложить проект', 'submit')],
  ];
  if (uid && isAdmin(ctx, uid)) rows.push([{ text: 'Админка', web_app: { url: ctx.origin + '/#admin' } }]);
  return { inline_keyboard: rows };
}
const welcome = () => `<b>${BRAND}</b>\nИгры, боты и каналы для Telegram в одном каталоге.`;

async function setState(ctx, uid, st) { await kvPut(ctx.env, 'st:' + uid, st, 3600); }
async function getState(ctx, uid) { return kvGet(ctx.env, 'st:' + uid, null); }
async function clearState(ctx, uid) { if (ctx.env.STORE) await ctx.env.STORE.delete('st:' + uid); }

async function categoriesView(ctx, kind) {
  const items = await visible(ctx);
  const cats = (await getCategories(ctx.env))[kind];
  const rows = [];
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(cats.slice(i, i + 2).map((c, j) => btn(`${c} · ${items.filter(x => x.kind === kind && x.categories.includes(c)).length}`, `cat:${kind}:${i + j}:0`)));
  }
  rows.push([btn(`Все ${KINDS[kind].toLowerCase()} · ${items.filter(x => x.kind === kind).length}`, `cat:${kind}:all:0`)]);
  rows.push([btn('← Меню', 'menu')]);
  return { text: `<b>${KINDS[kind]}</b>\nВыберите категорию.`, kb: { inline_keyboard: rows } };
}

async function listView(ctx, kind, cat, page) {
  let items = (await visible(ctx)).filter(x => x.kind === kind);
  const title = cat === 'all' ? `Все ${KINDS[kind].toLowerCase()}` : (await getCategories(ctx.env))[kind][Number(cat)];
  if (cat !== 'all') items = items.filter(x => x.categories.includes(title));
  items.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (!items.length) return { text: `<b>${esc(title)}</b>\n\nЗдесь пока пусто.`, kb: { inline_keyboard: [[btn('Предложить проект', 'submit')], [btn('← Категории', 'kind:' + kind)]] } };
  const rows = items.slice(page * PAGE, (page + 1) * PAGE).map(x => [btn(`${x.title}${x.rating ? '  ·  ' + x.rating : ''}`, 'item:' + x.id)]);
  const nav = [];
  if (page > 0) nav.push(btn('←', `cat:${kind}:${cat}:${page - 1}`));
  if ((page + 1) * PAGE < items.length) nav.push(btn('→', `cat:${kind}:${cat}:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([btn('← Категории', 'kind:' + kind)]);
  return { text: `<b>${esc(title)}</b> · ${items.length}`, kb: { inline_keyboard: rows } };
}

function itemText(x) {
  const lines = [`<b>${esc(x.title)}</b>`, `<i>${kindLabel(x.kind)} · ${esc(x.categories.join(' · '))}</i>`];
  if (x.description) lines.push('', esc(x.description));
  if (x.note) lines.push('', `<i>${esc(x.note)}</i>`);
  const facts = [];
  if (x.rating) facts.push(`оценка ${x.rating}`);
  if (x.session) facts.push(`сессия ~${esc(x.session)}`);
  if (x.subscribers) facts.push(`${esc(x.subscribers)} подписчиков`);
  if (x.price) facts.push(esc(x.price));
  if (facts.length) lines.push('', facts.join(' · '));
  return lines.join('\n');
}
function itemKb(ctx, x) {
  const rows = [];
  const label = { game: 'Играть', bot: 'Открыть бота', channel: 'Перейти в канал' }[x.kind];
  if (x.link) rows.push([{ text: label, url: x.link }]);
  rows.push([{ text: 'Страница в каталоге', web_app: { url: `${ctx.origin}/#item-${x.id}` } }]);
  if (x.channel) rows.push([{ text: 'Канал проекта', url: x.channel }]);
  rows.push([btn('← Категории', 'kind:' + x.kind), btn('Меню', 'menu')]);
  return { inline_keyboard: rows };
}
// своя обложка, иначе аватарка проекта из Telegram (через /avatar), иначе просто текст
function photoOf(ctx, x) {
  if (x.image) return x.image.startsWith('/') ? ctx.origin + x.image : x.image;
  const m = /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})(?:[/?#]|$)/.exec(x.link || '');
  return m ? `${ctx.origin}/avatar/${m[1]}` : '';
}
async function sendItem(ctx, chat, x) {
  const photo = photoOf(ctx, x);
  if (photo) {
    const r = await tgApi(ctx.env, 'sendPhoto', { chat_id: chat, photo, caption: itemText(x).slice(0, 1000), parse_mode: 'HTML', reply_markup: itemKb(ctx, x) });
    if (r.ok) return r;
  }
  return send(ctx, chat, itemText(x), itemKb(ctx, x));
}
async function allCategoriesView(ctx) {
  const [items, cats] = await Promise.all([visible(ctx), getCategories(ctx.env)]);
  const rows = [];
  for (const k of Object.keys(KINDS)) {
    rows.push([btn(`— ${KINDS[k]} —`, 'kind:' + k)]);
    const list = cats[k];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2).map((c, j) => btn(`${c} · ${items.filter(x => x.kind === k && x.categories.includes(c)).length}`, `cat:${k}:${i + j}:0`)));
  }
  rows.push([btn('← Меню', 'menu')]);
  return { text: '<b>Категории</b>', kb: { inline_keyboard: rows } };
}

async function startSubmit(ctx, chat, uid) {
  await setState(ctx, uid, { step: 'kind' });
  return send(ctx, chat, '<b>Предложить проект</b>\nЧто это?', { inline_keyboard: [[btn('Игра', 'sk:game'), btn('Бот', 'sk:bot'), btn('Канал', 'sk:channel')], [btn('Отмена', 'cancel')]] });
}

async function onMessage(ctx, m) {
  const chat = m.chat.id, uid = m.from.id;
  const text = (m.text || '').trim();
  if (!text) return;
  const cmd = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;
  if (cmd) await clearState(ctx, uid);

  if (cmd === '/start' || cmd === '/menu') return send(ctx, chat, welcome(), menuKb(ctx, uid));
  if (cmd === '/games' || cmd === '/bots' || cmd === '/channels') {
    const v = await categoriesView(ctx, { '/games': 'game', '/bots': 'bot', '/channels': 'channel' }[cmd]);
    return send(ctx, chat, v.text, v.kb);
  }
  if (cmd === '/categories') { const v = await allCategoriesView(ctx); return send(ctx, chat, v.text, v.kb); }
  if (cmd === '/search') { await setState(ctx, uid, { step: 'search' }); return send(ctx, chat, 'Напишите название.'); }
  if (cmd === '/submit') return startSubmit(ctx, chat, uid);
  if (cmd === '/myid') return send(ctx, chat, `Ваш ID: <code>${uid}</code>`);
  if (cmd === '/admin') {
    if (!isAdmin(ctx, uid)) return send(ctx, chat, welcome(), menuKb(ctx, uid));
    const p = await kvGet(ctx.env, 'pending', []);
    const items = await fullCatalog(ctx.env);
    return send(ctx, chat, `<b>Админка BOX APPS</b>\nПроектов: ${items.length} · заявок в очереди: ${p.length}`,
      { inline_keyboard: [[{ text: 'Открыть админку', web_app: { url: ctx.origin + '/#admin' } }]] });
  }
  if (cmd) return send(ctx, chat, welcome(), menuKb(ctx, uid));

  const st = await getState(ctx, uid);
  if (!st) return send(ctx, chat, welcome(), menuKb(ctx, uid));

  if (st.step === 'search') {
    await clearState(ctx, uid);
    const q = text.toLowerCase();
    const res = (await visible(ctx)).filter(x => x.title.toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q));
    if (!res.length) return send(ctx, chat, 'Ничего не нашлось.', { inline_keyboard: [[btn('Поиск', 'search'), btn('Меню', 'menu')]] });
    return send(ctx, chat, `Найдено: ${res.length}`, { inline_keyboard: res.slice(0, 10).map(x => [btn(x.title, 'item:' + x.id)]) });
  }
  if (st.step === 'title') {
    await setState(ctx, uid, { ...st, title: text.slice(0, 64), step: 'link' });
    return send(ctx, chat, 'Юзернейм или ссылка: <code>@username</code> или <code>t.me/username</code>.');
  }
  if (st.step === 'link') {
    const link = normalizeLink(text);
    if (!link) return send(ctx, chat, 'Не похоже на юзернейм. Пришлите <code>@username</code> или <code>t.me/username</code>.');
    await setState(ctx, uid, { ...st, link, step: 'category' });
    const cats = (await getCategories(ctx.env))[st.kind];
    const rows = [];
    for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map((c, j) => btn(c, 'sc:' + (i + j))));
    return send(ctx, chat, 'Категория:', { inline_keyboard: rows });
  }
  if (st.step === 'desc') {
    await clearState(ctx, uid);
    await createSubmission(ctx.env, { kind: st.kind, title: st.title, link: st.link, category: st.category, description: text.slice(0, 600), user_id: uid, username: m.from.username || '', source: 'bot' });
    return send(ctx, chat, 'Спасибо, заявка отправлена. Ответим здесь.', menuKb(ctx, uid));
  }
  return send(ctx, chat, welcome(), menuKb(ctx, uid));
}

async function onCallback(ctx, q) {
  const m = q.message, uid = q.from.id, data = String(q.data || '');
  const answer = (text, show_alert) => tgApi(ctx.env, 'answerCallbackQuery', { callback_query_id: q.id, text, show_alert });
  if (!m) return answer();
  const chat = m.chat.id;

  if (data === 'menu') { await clearState(ctx, uid); await edit(ctx, m, welcome(), menuKb(ctx, uid)); return answer(); }
  if (data.startsWith('kind:')) { const k = data.slice(5); if (!KINDS[k]) return answer(); const v = await categoriesView(ctx, k); await edit(ctx, m, v.text, v.kb); return answer(); }
  if (data.startsWith('cat:')) { const [, kind, cat, page] = data.split(':'); const v = await listView(ctx, kind, cat, Number(page)); await edit(ctx, m, v.text, v.kb); return answer(); }
  if (data.startsWith('item:')) {
    const x = (await visible(ctx)).find(i => i.id === data.slice(5));
    if (!x) return answer('Проекта больше нет в каталоге', true);
    await sendItem(ctx, chat, x); return answer();
  }
  if (data === 'cats') { const v = await allCategoriesView(ctx); await edit(ctx, m, v.text, v.kb); return answer(); }
  if (data === 'search') { await setState(ctx, uid, { step: 'search' }); await send(ctx, chat, 'Напишите название.'); return answer(); }
  if (data === 'submit') { await startSubmit(ctx, chat, uid); return answer(); }
  if (data === 'cancel') { await clearState(ctx, uid); await edit(ctx, m, 'Отменено.', menuKb(ctx, uid)); return answer(); }

  if (data.startsWith('sk:')) {
    const k = data.slice(3);
    await setState(ctx, uid, { step: 'title', kind: KINDS[k] ? k : 'game' });
    await edit(ctx, m, 'Как называется?'); return answer();
  }
  if (data.startsWith('sc:')) {
    const st = await getState(ctx, uid);
    if (!st || st.step !== 'category') return answer('Начните заново: /submit', true);
    await setState(ctx, uid, { ...st, category: (await getCategories(ctx.env))[st.kind][Number(data.slice(3))], step: 'desc' });
    await edit(ctx, m, 'Пара строк о проекте:'); return answer();
  }

  if (data.startsWith('mod:')) {
    if (!isAdmin(ctx, uid)) return answer('Только для админов', true);
    const [, action, sid] = data.split(':');
    const r = action === 'ok' ? await approveSubmission(ctx.env, sid) : await rejectSubmission(ctx.env, sid);
    if (!r) return answer('Уже обработано');
    const verdict = action === 'ok' ? 'Добавлено' : 'Отклонено';
    const rows = [[btn(verdict, 'noop')]];
    if (r.item) rows.push([{ text: 'Дополнить в админке', web_app: { url: `${ctx.origin}/#admin-edit-${r.item.id}` } }]);
    await tgApi(ctx.env, 'editMessageReplyMarkup', { chat_id: chat, message_id: m.message_id, reply_markup: { inline_keyboard: rows } });
    if (r.sub.user_id) await send(ctx, r.sub.user_id, action === 'ok' ? `«${esc(r.sub.title)}» добавлен в каталог ${BRAND}.` : `«${esc(r.sub.title)}» пока не добавлен в каталог.`);
    return answer(verdict);
  }
  return answer();
}
