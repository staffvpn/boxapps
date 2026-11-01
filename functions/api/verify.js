// POST /api/verify { link, check? } — подтверждение владения ботом, игрой или каналом.
// Без check: возвращает код, который владелец ставит в описание. С check: читает t.me и сверяет код.
import { currentUser, getOwner, ownsIt, json, normalizeLink, setOwner } from '../_lib.js';
import { ownerCode, tgInfo, tgName } from '../_tg.js';

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  const name = tgName(normalizeLink(b.link));
  if (!name) return json({ ok: false, error: 'Нужен юзернейм: @username или t.me/username' }, 400);
  const user = await currentUser(request, env);
  const code = await ownerCode(env, name);
  const own = await getOwner(env, name);
  const mine = ownsIt(own, user);
  if (!b.check) return json({ ok: true, name, code, verified: Boolean(mine) });
  let info;
  try { info = await tgInfo(request, name, { fresh: true }); } catch { return json({ ok: false, error: 'Telegram не ответил, попробуйте ещё раз' }, 502); }
  if (!info.title) return json({ ok: false, error: `Не нашли @${name} в Telegram. Проверьте юзернейм.` }, 404);
  if (!String(info.description || '').toUpperCase().includes(code)) {
    return json({ ok: false, name, code, error: `Код ${code} пока не виден в описании @${name}. Сохраните описание и проверьте через минуту.` }, 409);
  }
  await setOwner(env, name, user ? user.id : 0, 'code');
  return json({ ok: true, name, code, verified: true, info: { title: info.title, description: info.description.replace(code, '').trim() } });
}
