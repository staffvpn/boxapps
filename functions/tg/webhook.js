// POST /tg/webhook — бот BOX APPS. Каталог — только в мини-приложении; в чате: открыть приложение и добавить свой проект.
// Для админов из ADMIN_IDS: /admin (открывает админку), кнопки «Добавить / Отклонить» на заявках.
import { BRAND, KINDS } from '../_catalog.js';
import { admins, getCategories, approveSubmission, createSubmission, esc, fullCatalog, json, kvGet, kvPut, rejectSubmission, setOwner, tgApi } from '../_lib.js';
import { tgInfo } from '../_tg.js';

const BOTFATHER_ID = 93372553; // @BotFather

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

function menuKb(ctx, uid) {
  const rows = [
    [{ text: 'Открыть BOX APPS', web_app: { url: ctx.origin } }],
    [btn('Добавить свой проект', 'submit')],
  ];
  if (uid && isAdmin(ctx, uid)) rows.push([{ text: 'Админка', web_app: { url: ctx.origin + '/#admin' } }]);
  return { inline_keyboard: rows };
}
const welcome = () => `<b>${BRAND}</b>\nИгры, боты и каналы для Telegram в одном каталоге. Открывайте каталог кнопкой ниже.\n\nЕсть свой канал, бот или игра? Добавьте их в каталог.`;

async function setState(ctx, uid, st) { await kvPut(ctx.env, 'st:' + uid, st, 3600); }
async function getState(ctx, uid) { return kvGet(ctx.env, 'st:' + uid, null); }
async function clearState(ctx, uid) { if (ctx.env.STORE) await ctx.env.STORE.delete('st:' + uid); }


async function startSubmit(ctx, chat, uid) {
  await setState(ctx, uid, { step: 'kind' });
  return send(ctx, chat, '<b>Добавить свой проект</b>\nДобавлять может только владелец. Что это?', { inline_keyboard: [[btn('Игра', 'sk:game'), btn('Бот', 'sk:bot'), btn('Канал', 'sk:channel')], [btn('Отмена', 'cancel')]] });
}
// Канал: Telegram сам показывает список каналов, которые создал пользователь
async function startChannel(ctx, chat, uid) {
  await setState(ctx, uid, { step: 'pickchan', kind: 'channel' });
  return send(ctx, chat, 'Нажмите кнопку внизу и выберите свой канал. Telegram покажет только каналы, которые создали вы.', {
    keyboard: [[{ text: 'Выбрать мой канал', request_chat: { request_id: 1, chat_is_channel: true, chat_is_created: true, request_title: true, request_username: true } }], [{ text: 'Отмена' }]],
    resize_keyboard: true, one_time_keyboard: true,
  });
}
async function askCategory(ctx, chat, kind) {
  const cats = (await getCategories(ctx.env))[kind];
  const rows = [];
  for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map((c, j) => btn(c, 'sc:' + (i + j))));
  return send(ctx, chat, 'Выберите категорию:', { inline_keyboard: rows });
}
// Бот или игра: владелец пересылает сообщение от @BotFather про своего бота.
// /mybots показывает только свои боты, а метку «переслано от @BotFather» подделать нельзя.
async function startBot(ctx, chat, uid, kind) {
  await setState(ctx, uid, { step: 'fwd', kind });
  return send(ctx, chat, `<b>Добавить ${kind === 'bot' ? 'бота' : 'игру'}</b>\n\nОткройте @BotFather → /mybots → выберите ${kind === 'bot' ? 'бота' : 'бота с игрой'} и <b>перешлите</b> ответ сюда.\n\nТак мы видим, что бот ваш. Токен не нужен.`,
    { inline_keyboard: [[{ text: 'Открыть @BotFather', url: 'https://t.me/BotFather' }], [btn('Отмена', 'cancel')]] });
}
const fromBotFather = m => (m.forward_origin && m.forward_origin.type === 'user' && m.forward_origin.sender_user && m.forward_origin.sender_user.id === BOTFATHER_ID)
  || (m.forward_from && m.forward_from.id === BOTFATHER_ID);
function botNames(m) {
  const txt = (m.text || m.caption || '') + ' ' + JSON.stringify((m.reply_markup && m.reply_markup.inline_keyboard) || []);
  const set = new Set();
  for (const r of txt.matchAll(/(?:@|t\.me\/)([A-Za-z][A-Za-z0-9_]{2,30}bot)\b/gi)) if (r[1].toLowerCase() !== 'botfather') set.add(r[1]);
  return [...set];
}
async function acceptBot(ctx, chat, uid, st, name) {
  await setOwner(ctx.env, name, uid, 'botfather');
  const info = await tgInfo(new Request(ctx.origin), name).catch(() => null);
  await setState(ctx, uid, { ...st, step: 'category', name, link: 'https://t.me/' + name, title: ((info && info.title) || name).slice(0, 64), verified: true });
  await send(ctx, chat, `✅ @${esc(name)} подтверждён.`);
  return askCategory(ctx, chat, st.kind);
}

async function onMessage(ctx, m) {
  const chat = m.chat.id, uid = m.from.id;
  const text = (m.text || '').trim();
  if (m.chat_shared) {
    const st0 = await getState(ctx, uid);
    const c = m.chat_shared;
    if (!c.username) return send(ctx, chat, 'У канала нет публичного @юзернейма. Сделайте канал публичным и выберите его снова.');
    await setOwner(ctx.env, c.username, uid, 'picker');
    await setState(ctx, uid, { ...(st0 || {}), step: 'category', kind: 'channel', title: (c.title || c.username).slice(0, 64), link: 'https://t.me/' + c.username, verified: true });
    await send(ctx, chat, `✅ Канал «${esc(c.title || c.username)}» подтверждён.`, { remove_keyboard: true });
    return askCategory(ctx, chat, 'channel');
  }
  if (m.forward_origin || m.forward_from) {
    const st0 = await getState(ctx, uid);
    if (!st0 || st0.step !== 'fwd') return send(ctx, chat, 'Чтобы добавить бота, нажмите «Добавить свой проект».', menuKb(ctx, uid));
    if (!fromBotFather(m)) return send(ctx, chat, 'Это сообщение не от @BotFather. Откройте @BotFather → /mybots → выберите бота и перешлите его ответ.');
    const names = botNames(m);
    if (!names.length) return send(ctx, chat, 'Не нашли в сообщении юзернейм бота. Перешлите ответ @BotFather после выбора бота в /mybots — там есть @имя_бота.');
    if (names.length > 1) {
      await setState(ctx, uid, { ...st0, cands: names.slice(0, 10) });
      return send(ctx, chat, 'Какого бота добавить?', { inline_keyboard: names.slice(0, 10).map((n, i) => [btn('@' + n, 'fb:' + i)]) });
    }
    return acceptBot(ctx, chat, uid, st0, names[0]);
  }
  if (!text) return;
  const cmd = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;
  if (cmd) await clearState(ctx, uid);

  if (cmd === '/start' && /\baddchannel\b/.test(text)) return startChannel(ctx, chat, uid);
  if (cmd === '/start' && /\baddbot\b/.test(text)) return startBot(ctx, chat, uid, 'bot');
  if (cmd === '/start' && /\baddgame\b/.test(text)) return startBot(ctx, chat, uid, 'game');
  if (cmd === '/start' && /\badd\b/.test(text)) return startSubmit(ctx, chat, uid);
  if (cmd === '/start' || cmd === '/menu') return send(ctx, chat, welcome(), menuKb(ctx, uid));
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

  if (st.step === 'pickchan' && text === 'Отмена') {
    await clearState(ctx, uid);
    await send(ctx, chat, 'Отменено.', { remove_keyboard: true });
    return send(ctx, chat, welcome(), menuKb(ctx, uid));
  }
  if (st.step === 'fwd') return send(ctx, chat, 'Нужно именно <b>переслать</b> сообщение от @BotFather: /mybots → выберите бота → удерживайте ответ → «Переслать» → сюда.', { inline_keyboard: [[{ text: 'Открыть @BotFather', url: 'https://t.me/BotFather' }], [btn('Отмена', 'cancel')]] });
  if (st.step === 'desc') {
    await clearState(ctx, uid);
    await createSubmission(ctx.env, { kind: st.kind, title: st.title, link: st.link, category: st.category, description: text === '-' ? '' : text.slice(0, 600), user_id: uid, username: m.from.username || '', source: 'bot', verified: Boolean(st.verified) });
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
  // кнопки каталога из старых сообщений — каталог теперь в приложении
  if (/^(kind:|cat:|item:|rnd:|cats$|search$)/.test(data)) { await edit(ctx, m, welcome(), menuKb(ctx, uid)); return answer('Каталог теперь в приложении'); }
  if (data === 'submit') { await startSubmit(ctx, chat, uid); return answer(); }
  if (data === 'cancel') { await clearState(ctx, uid); await edit(ctx, m, 'Отменено.', menuKb(ctx, uid)); return answer(); }

  if (data.startsWith('sk:')) {
    const k = KINDS[data.slice(3)] ? data.slice(3) : 'game';
    if (k === 'channel') { await edit(ctx, m, '<b>Добавить канал</b>'); await startChannel(ctx, chat, uid); return answer(); }
    await edit(ctx, m, `<b>Добавить ${k === 'bot' ? 'бота' : 'игру'}</b>`); await startBot(ctx, chat, uid, k); return answer();
  }
  if (data.startsWith('fb:')) {
    const st = await getState(ctx, uid);
    const name = st && st.cands && st.cands[Number(data.slice(3))];
    if (!name) return answer('Начните заново: /submit', true);
    await edit(ctx, m, '@' + esc(name));
    await acceptBot(ctx, chat, uid, st, name);
    return answer();
  }
  if (data.startsWith('sc:')) {
    const st = await getState(ctx, uid);
    if (!st || st.step !== 'category') return answer('Начните заново: /submit', true);
    await setState(ctx, uid, { ...st, category: (await getCategories(ctx.env))[st.kind][Number(data.slice(3))], step: 'desc' });
    await edit(ctx, m, 'Пара строк о проекте (или «-», чтобы пропустить):'); return answer();
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
