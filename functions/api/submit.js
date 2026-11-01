// POST /api/submit — заявка с сайта. Уходит в ту же очередь модерации, что и заявки из бота.
import { KINDS } from '../_catalog.js';
import { createSubmission, getCategories, json, normalizeLink } from '../_lib.js';

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
  await createSubmission(env, {
    kind, title, link, category,
    description: String(b.description || '').trim().slice(0, 600),
    contact: String(b.contact || '').trim().slice(0, 64),
    source: 'site',
  });
  return json({ ok: true });
}
