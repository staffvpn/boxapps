// POST /api/submit — заявка из приложения. Принимаем только от подтверждённого владельца (см. /api/claim).
import { KINDS } from '../_catalog.js';
import { createSubmission, currentUser, getCategories, getOwner, json, normalizeLink } from '../_lib.js';
import { tgName } from '../_tg.js';

export async function onRequestPost({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: 'Откройте BOX APPS в Telegram' }, 401);
  const b = await request.json().catch(() => ({}));
  const kind = KINDS[b.kind] ? b.kind : 'game';
  const name = tgName(normalizeLink(b.link));
  const own = name ? await getOwner(env, name) : null;
  if (!own || own.user_id !== user.id) return json({ ok: false, error: 'Сначала подтвердите, что проект ваш' }, 403);
  const cats = (await getCategories(env))[kind];
  await createSubmission(env, {
    kind, link: 'https://t.me/' + name,
    title: String(b.title || name).trim().slice(0, 64) || name,
    category: cats.includes(b.category) ? b.category : cats[0],
    description: String(b.description || '').trim().slice(0, 600),
    user_id: user.id, username: user.username || '', source: 'app', verified: true,
  });
  return json({ ok: true });
}
