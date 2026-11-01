// POST /api/claim { kind, link, token? } — подтверждение владения прямо в приложении.
// Канал: наш бот добавлен в админы канала, проверяем, что пользователь — создатель или админ.
// Бот/игра: владелец вставляет токен от @BotFather; проверяем getMe и сразу забываем токен.
import { currentUser, json, normalizeLink, setOwner, tgApi } from '../_lib.js';
import { tgInfo, tgName } from '../_tg.js';

export async function onRequestPost({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: 'Откройте BOX APPS в Telegram' }, 401);
  const b = await request.json().catch(() => ({}));
  const name = tgName(normalizeLink(b.link));
  if (!name) return json({ ok: false, error: 'Нужен юзернейм: @username' }, 400);

  if (b.kind === 'channel') {
    const m = await tgApi(env, 'getChatMember', { chat_id: '@' + name, user_id: user.id });
    if (!m.ok) {
      const bot = await tgApi(env, 'getMe', {});
      const me = bot.ok ? '@' + bot.result.username : 'нашего бота';
      return json({ ok: false, needBot: true, error: `${me} пока не в администраторах @${name}. Добавьте и проверьте ещё раз.` }, 409);
    }
    if (!['creator', 'administrator'].includes(m.result.status)) return json({ ok: false, error: `Вы не админ @${name}. Добавить канал может только его владелец или админ.` }, 403);
  } else {
    const token = String(b.token || '').trim();
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) return json({ ok: false, error: 'Вставьте токен целиком: @BotFather → /mybots → бот → API Token' }, 400);
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`).then(x => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) return json({ ok: false, error: 'Токен не подошёл. Скопируйте его из @BotFather ещё раз.' }, 400);
    if (String(r.result.username).toLowerCase() !== name.toLowerCase()) return json({ ok: false, error: `Это токен от @${r.result.username}, а не от @${name}.` }, 400);
  }
  await setOwner(env, name, user.id, b.kind === 'channel' ? 'admin' : 'token');
  const info = await tgInfo(request, name).catch(() => null);
  return json({ ok: true, name, info: info ? { title: info.title, description: info.description } : null });
}
