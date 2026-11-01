// POST /tg/webhook — бот каталога: разделы, категории, случайный выбор, поиск, заявки и модерация.
import { BRAND, CATEGORIES, CRITERIA } from '../_catalog.js';
import { admins, createSubmission, esc, fullCatalog, json, kvGet, kvPut, normalizeLink, tgApi } from '../_lib.js';

const PAGE = 6;
const KIND = { game: 'Игры', bot: 'Боты' };
const ok = () => json({ ok: true });

export async function onRequestPost({ request, env }) {
  if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return json({ ok: false }, 403);
  let upd;
  try { upd = await request.json(); } catch { return ok(); }
  const origin = new URL(request.url).origin;
  const ctx = { env, origin };
  try {
    if (upd.callback_query) await onCallback(ctx, upd.callback_query);
    else if (upd.message && upd.message.chat.type === 'private') await onMessage(ctx, upd.message);
  } catch (e) {
    console.error(e);
  }
  return ok();
}

// ---------- отправка ----------
const send = (ctx, chat_id, text, reply_markup) =>
  tgApi(ctx.env, 'sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });
const edit = (ctx, m, text, reply_markup) =>
  tgApi(ctx.env, 'editMessageText', { chat_id: m.chat.id, message_id: m.message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup });

const btn = (text, data) => ({ text, callback_data: data });
const menuKb = ctx => ({
  inline_keyboard: [
    [{ text: 'Открыть каталог', web_app: { url: ctx.origin } }],
    [btn('Игры', 'kind:game'), btn('Боты', 'kind:bot')],
    [btn('Случайно', 'rnd:any'), btn('Поиск', 'search')],
    [btn('Предложить проект', 'submit')],
  ],
});

async function setState(ctx, uid, st) { await kvPut(ctx.env, 'st:' + uid, st, 3600); }
async function getState(ctx, uid) { return kvGet(ctx.env, 'st:' + uid, null); }
async function clearState(ctx, uid) { if (ctx.env.STORE) await ctx.env.STORE.delete('st:' + uid); }

// ---------- экраны ----------
function welcome() {
  return `<b>${BRAND}</b>\nИгры и боты для Telegram, отобранные вручную.\n\nЗдесь нет тапалок, казино, «заработка» и обязательных подписок. Только то, чем действительно хочется пользоваться.`;
}

async function categoriesView(ctx, kind) {
  const items = await fullCatalog(ctx.env);
  const rows = [];
  const cats = CATEGORIES[kind];
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(cats.slice(i, i + 2).map((c, j) => {
      const n = items.filter(x => x.kind === kind && x.categories.includes(c)).length;
      return btn(`${c} · ${n}`, `cat:${kind}:${i + j}:0`);
    }));
  }
  rows.push([btn(`Все ${KIND[kind].toLowerCase()}`, `cat:${kind}:all:0`)]);
  rows.push([btn('← Меню', 'menu')]);
  return { text: `<b>${KIND[kind]}</b>\nВыберите категорию.`, kb: { inline_keyboard: rows } };
}

async function listView(ctx, kind, cat, page) {
  let items = (await fullCatalog(ctx.env)).filter(x => x.kind === kind);
  const title = cat === 'all' ? `Все ${KIND[kind].toLowerCase()}` : CATEGORIES[kind][Number(cat)];
  if (cat !== 'all') items = items.filter(x => x.categories.includes(title));
  items.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (!items.length) {
    return { text: `<b>${esc(title)}</b>\n\nЗдесь пока пусто. Знаете что-то достойное?`, kb: { inline_keyboard: [[btn('Предложить проект', 'submit')], [btn('← Категории', 'kind:' + kind)]] } };
  }
  const rows = items.slice(page * PAGE, (page + 1) * PAGE).map(x => [btn(`${x.title}${x.rating ? '  ·  ' + x.rating : ''}`, 'item:' + x.id)]);
  const nav = [];
  if (page > 0) nav.push(btn('←', `cat:${kind}:${cat}:${page - 1}`));
  if ((page + 1) * PAGE < items.length) nav.push(btn('→', `cat:${kind}:${cat}:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([btn('← Категории', 'kind:' + kind)]);
  return { text: `<b>${esc(title)}</b> · ${items.length}`, kb: { inline_keyboard: rows } };
}

function itemText(x) {
  const lines = [`<b>${esc(x.title)}</b>`, `<i>${x.kind === 'bot' ? 'Бот' : 'Игра'} · ${esc(x.categories.join(' · '))}</i>`, '', esc(x.description || '')];
  if (x.note) lines.push('', `<i>«${esc(x.note)}»</i>`);
  const facts = [];
  if (x.rating) facts.push(`оценка ${x.rating}`);
  if (x.session) facts.push(`сессия ~${esc(x.session)}`);
  if (facts.length) lines.push('', facts.join(' · '));
  lines.push('', 'Проверено: без фарма, казино и обязательных подписок.');
  if (x.example) lines.push('', '<i>Образец карточки.</i>');
  return lines.join('\n');
}
function itemKb(ctx, x) {
  const rows = [];
  if (x.link) rows.push([{ text: x.kind === 'bot' ? 'Открыть бота' : 'Играть', url: x.link }]);
  rows.push([{ text: 'Страница в каталоге', web_app: { url: `${ctx.origin}/#item-${x.id}` } }]);
  if (x.channel) rows.push([{ text: 'Канал проекта', url: x.channel }]);
  rows.push([btn('Ещё случайное', 'rnd:' + x.kind), btn('← Категории', 'kind:' + x.kind)]);
  return { inline_keyboard: rows };
}

async function randomItem(ctx, chat, kind) {
  const items = (await fullCatalog(ctx.env)).filter(x => kind === 'any' || x.kind === kind);
  if (!items.length) return send(ctx, chat, 'Каталог пока пуст.');
  const x = items[Math.floor(Math.random() * items.length)];
  return send(ctx, chat, itemText(x), itemKb(ctx, x));
}

// ---------- заявка ----------
async function startSubmit(ctx, chat, uid) {
  await setState(ctx, uid, { step: 'kind' });
  return send(ctx, chat, '<b>Предложить проект</b>\nЧто хотите предложить?', { inline_keyboard: [[btn('Игру', 'sk:game'), btn('Бота', 'sk:bot')], [btn('Отмена', 'cancel')]] });
}

async function onMessage(ctx, m) {
  const chat = m.chat.id, uid = m.from.id;
  const text = (m.text || '').trim();
  if (!text) return;
  const cmd = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;

  if (cmd) await clearState(ctx, uid);
  if (cmd === '/start' || cmd === '/menu') return send(ctx, chat, welcome(), menuKb(ctx));
  if (cmd === '/games' || cmd === '/bots') { const v = await categoriesView(ctx, cmd === '/games' ? 'game' : 'bot'); return send(ctx, chat, v.text, v.kb); }
  if (cmd === '/random') return randomItem(ctx, chat, 'any');
  if (cmd === '/search') { await setState(ctx, uid, { step: 'search' }); return send(ctx, chat, 'Напишите название игры или бота.'); }
  if (cmd === '/submit') return startSubmit(ctx, chat, uid);
  if (cmd === '/myid') return send(ctx, chat, `Ваш ID: <code>${uid}</code>`);
  if (cmd === '/pending' && admins(ctx.env).includes(uid)) {
    const p = await kvGet(ctx.env, 'pending', []);
    return send(ctx, chat, `Заявок в очереди: ${p.length}` + p.map(s => `\n• ${esc(s.title)} — ${esc(s.link)}`).join(''));
  }
  if (cmd) return send(ctx, chat, welcome(), menuKb(ctx));

  const st = await getState(ctx, uid);
  if (!st) return send(ctx, chat, welcome(), menuKb(ctx));

  if (st.step === 'search') {
    await clearState(ctx, uid);
    const q = text.toLowerCase();
    const res = (await fullCatalog(ctx.env)).filter(x => x.title.toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q));
    if (!res.length) return send(ctx, chat, 'Ничего не нашлось. Попробуйте другое слово.', { inline_keyboard: [[btn('Поиск', 'search'), btn('Меню', 'menu')]] });
    return send(ctx, chat, `Найдено: ${res.length}`, { inline_keyboard: res.slice(0, 10).map(x => [btn(x.title, 'item:' + x.id)]) });
  }
  if (st.step === 'title') {
    await setState(ctx, uid, { ...st, title: text.slice(0, 64), step: 'link' });
    return send(ctx, chat, 'Ссылка на проект: <code>t.me/имя_бота</code> или <code>@имя_бота</code>.');
  }
  if (st.step === 'link') {
    const link = normalizeLink(text);
    if (!link) return send(ctx, chat, 'Нужна ссылка на Telegram: <code>t.me/имя_бота</code> или <code>@имя_бота</code>.');
    await setState(ctx, uid, { ...st, link, step: 'category' });
    const cats = CATEGORIES[st.kind];
    const rows = [];
    for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map((c, j) => btn(c, 'sc:' + (i + j))));
    return send(ctx, chat, 'Категория:', { inline_keyboard: rows });
  }
  if (st.step === 'desc') {
    await setState(ctx, uid, { ...st, description: text.slice(0, 600), step: 'criteria' });
    return send(ctx, chat, 'Последний шаг. Проект соответствует всем правилам?\n\n' + CRITERIA.map(c => '— ' + c).join('\n'),
      { inline_keyboard: [[btn('Да, всё так', 'sok'), btn('Нет', 'sno')]] });
  }
  return send(ctx, chat, welcome(), menuKb(ctx));
}

async function onCallback(ctx, q) {
  const m = q.message, uid = q.from.id, data = String(q.data || '');
  const answer = (text, show_alert) => tgApi(ctx.env, 'answerCallbackQuery', { callback_query_id: q.id, text, show_alert });
  if (!m) return answer();
  const chat = m.chat.id;

  if (data === 'menu') { await clearState(ctx, uid); await edit(ctx, m, welcome(), menuKb(ctx)); return answer(); }
  if (data.startsWith('kind:')) { const v = await categoriesView(ctx, data.slice(5)); await edit(ctx, m, v.text, v.kb); return answer(); }
  if (data.startsWith('cat:')) { const [, kind, cat, page] = data.split(':'); const v = await listView(ctx, kind, cat, Number(page)); await edit(ctx, m, v.text, v.kb); return answer(); }
  if (data.startsWith('item:')) {
    const x = (await fullCatalog(ctx.env)).find(i => i.id === data.slice(5));
    if (!x) return answer('Проект больше не в каталоге', true);
    await send(ctx, chat, itemText(x), itemKb(ctx, x)); return answer();
  }
  if (data.startsWith('rnd:')) { await randomItem(ctx, chat, data.slice(4)); return answer(); }
  if (data === 'search') { await setState(ctx, uid, { step: 'search' }); await send(ctx, chat, 'Напишите название игры или бота.'); return answer(); }
  if (data === 'submit') { await startSubmit(ctx, chat, uid); return answer(); }
  if (data === 'cancel') { await clearState(ctx, uid); await edit(ctx, m, 'Отменено.', menuKb(ctx)); return answer(); }

  if (data.startsWith('sk:')) {
    const st = await getState(ctx, uid);
    if (!st) return answer('Начните заново: /submit', true);
    await setState(ctx, uid, { step: 'title', kind: data.slice(3) === 'bot' ? 'bot' : 'game' });
    await edit(ctx, m, 'Как называется проект?'); return answer();
  }
  if (data.startsWith('sc:')) {
    const st = await getState(ctx, uid);
    if (!st || st.step !== 'category') return answer('Начните заново: /submit', true);
    await setState(ctx, uid, { ...st, category: CATEGORIES[st.kind][Number(data.slice(3))], step: 'desc' });
    await edit(ctx, m, 'Пара строк: что это и чем оно хорошо?'); return answer();
  }
  if (data === 'sno') { await clearState(ctx, uid); await edit(ctx, m, 'Тогда добавить не получится: это главное правило каталога.'); return answer(); }
  if (data === 'sok') {
    const st = await getState(ctx, uid);
    if (!st || st.step !== 'criteria') return answer('Начните заново: /submit', true);
    await clearState(ctx, uid);
    await createSubmission(ctx.env, { kind: st.kind, title: st.title, link: st.link, category: st.category, description: st.description, user_id: uid, username: q.from.username || '', source: 'bot' });
    await edit(ctx, m, 'Спасибо. Заявка у редакции: мы сами всё попробуем и ответим здесь.', menuKb(ctx));
    return answer();
  }

  if (data.startsWith('mod:')) {
    if (!admins(ctx.env).includes(uid)) return answer('Только для редакции', true);
    const [, action, sid] = data.split(':');
    const pending = await kvGet(ctx.env, 'pending', []);
    const sub = pending.find(s => s.sid === sid);
    if (!sub) return answer('Уже обработано');
    await kvPut(ctx.env, 'pending', pending.filter(s => s.sid !== sid));
    let verdict, note;
    if (action === 'ok') {
      const approved = await kvGet(ctx.env, 'approved', []);
      approved.push({ id: sid, kind: sub.kind, title: sub.title, categories: [sub.category], description: sub.description, link: sub.link, author: sub.username ? '@' + sub.username : '' });
      await kvPut(ctx.env, 'approved', approved);
      verdict = 'Добавлено'; note = `«${esc(sub.title)}» теперь в каталоге ${BRAND}. Спасибо!`;
    } else {
      verdict = 'Отклонено'; note = `«${esc(sub.title)}» пока не прошёл отбор. Спасибо, что предложили.`;
    }
    await tgApi(ctx.env, 'editMessageReplyMarkup', { chat_id: chat, message_id: m.message_id, reply_markup: { inline_keyboard: [[btn(verdict, 'noop')]] } });
    if (sub.user_id) await send(ctx, sub.user_id, note);
    return answer(verdict);
  }
  return answer();
}
