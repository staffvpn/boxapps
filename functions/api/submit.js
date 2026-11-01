// POST /api/submit — заявка с сайта. Уходит в ту же очередь модерации, что и заявки из бота.
import { KINDS } from '../_catalog.js';
import { createSubmission, currentUser, getCategories, getOwner, ownsIt, json, normalizeLink } from '../_lib.js';
import { tgName } from '../_tg.js';

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: 'Не удалось прочитать заявку' }, 400); }
  const kind = KINDS[b.kind] ? b.kind : 'game';
  const CATEGORIES = await getCategories(env);
  const title = String(b.title || '').trim().slice(0, 64);
  const link = normalizeLink(b.link);
  const category = CATEGORIES[kind].includes(b.category) ? b.category : CATEGORIES[kind][0];
  if (!title) return json({ ok: false, error: 'Укажите название' }, 400);
  if (!link) return json({ ok: false, error: 'Нужна ссылка: @username или t.me/username' }, 400);
  if (!env.STORE) return json({ ok: false, error: 'Хранилище не подключено' }, 503);
  // добавлять может только владелец: канал — через выбор в боте, бот и игра — кодом в описании
  const user = await currentUser(request, env);
  const own = await getOwner(env, tgName(link));
  const verified = ownsIt(own, user);
  if (!verified) return json({ ok: false, error: 'Сначала подтвердите, что проект ваш', needVerify: true }, 403);
  await createSubmission(env, {
    kind, title, link, category,
    description: String(b.description || '').trim().slice(0, 600),
    contact: String(b.contact || '').trim().slice(0, 64),
    source: 'site', verified,
    ...(user ? { user_id: user.id, username: user.username || '' } : {}),
  });
  return json({ ok: true });
}
