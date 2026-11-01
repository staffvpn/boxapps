// POST /tg/webhook — бот BOX APPS. Каталог — только в мини-приложении; в чате: открыть приложение и добавить свой проект.
// Для админов из ADMIN_IDS: /admin (открывает админку), кнопки «Добавить / Отклонить» на заявках.
import { BRAND } from '../_catalog.js';
import { admins, approveSubmission, esc, fullCatalog, json, kvGet, rejectSubmission, tgApi } from '../_lib.js';

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
    [{ text: 'Добавить свой проект', web_app: { url: ctx.origin + '/#submit' } }],
  ];
  if (uid && isAdmin(ctx, uid)) rows.push([{ text: 'Админка', web_app: { url: ctx.origin + '/#admin' } }]);
  return { inline_keyboard: rows };
}
const welcome = () => `<b>${BRAND}</b>\nИгры, боты и каналы для Telegram в одном каталоге. Открывайте каталог кнопкой ниже.\n\nЕсть свой канал, бот или игра? Добавьте их в каталог.`;

async function clearState(ctx, uid) { if (ctx.env.STORE) await ctx.env.STORE.delete('st:' + uid); }


// «Добавить свой проект» — форма в приложении
async function startSubmit(ctx, chat) {
  return send(ctx, chat, '<b>Добавить свой проект</b>\nЗаполните короткую форму: юзернейм, название, категория. Мы посмотрим заявку и ответим здесь.',
    { inline_keyboard: [[{ text: 'Открыть форму', web_app: { url: ctx.origin + '/#submit' } }]] });
}

async function onMessage(ctx, m) {
  const chat = m.chat.id, uid = m.from.id;
  const text = (m.text || '').trim();
  if (!text) return;
  const cmd = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;
  if (cmd) await clearState(ctx, uid);

  if (cmd === '/start' && /\badd/.test(text)) return startSubmit(ctx, chat);
  if (cmd === '/start' || cmd === '/menu') return send(ctx, chat, welcome(), menuKb(ctx, uid));
  if (cmd === '/submit') return startSubmit(ctx, chat);
  if (cmd === '/myid') return send(ctx, chat, `Ваш ID: <code>${uid}</code>`);
  if (cmd === '/admin') {
    if (!isAdmin(ctx, uid)) return send(ctx, chat, welcome(), menuKb(ctx, uid));
    const p = await kvGet(ctx.env, 'pending', []);
    const items = await fullCatalog(ctx.env);
    return send(ctx, chat, `<b>Админка BOX APPS</b>\nПроектов: ${items.length} · заявок в очереди: ${p.length}`,
      { inline_keyboard: [[{ text: 'Открыть админку', web_app: { url: ctx.origin + '/#admin' } }]] });
  }
  if (cmd) return send(ctx, chat, welcome(), menuKb(ctx, uid));

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
  if (data === 'submit' || /^(sk:|sc:|fb:|vchk$)/.test(data)) { await startSubmit(ctx, chat); return answer(); }
  if (data === 'cancel') { await clearState(ctx, uid); await edit(ctx, m, 'Отменено.', menuKb(ctx, uid)); return answer(); }

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
