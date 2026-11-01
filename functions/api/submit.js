// POST /api/submit — заявка на добавление проекта. Без проверки владения: каждую заявку смотрит админ.
import { KINDS } from '../_catalog.js';
import { createSubmission, currentUser, getCategories, json, normalizeLink } from '../_lib.js';
import { tgName } from '../_tg.js';

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  const kind = KINDS[b.kind] ? b.kind : 'game';
  const name = tgName(normalizeLink(b.link));
  if (!name) return json({ ok: false, error: 'Укажите юзернейм: @username' }, 400);
  const title = String(b.title || '').trim().slice(0, 64);
  if (!title) return json({ ok: false, error: 'Укажите название' }, 400);
  if (!env.STORE) return json({ ok: false, error: 'Хранилище не подключено' }, 503);
  const user = await currentUser(request, env);
  const cats = (await getCategories(env))[kind];
  await createSubmission(env, {
    kind, title, link: 'https://t.me/' + name,
    category: cats.includes(b.category) ? b.category : cats[0],
    description: String(b.description || '').trim().slice(0, 600),
    contact: String(b.contact || '').trim().slice(0, 64),
    source: 'app',
    ...(user ? { user_id: user.id, username: user.username || '' } : {}),
  });
  return json({ ok: true });
}
