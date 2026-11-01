// POST /api/submit — заявка с сайта. Уходит в ту же очередь модерации, что и заявки из бота.
import { CATEGORIES } from '../_catalog.js';
import { createSubmission, json, normalizeLink } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: 'Не удалось прочитать заявку' }, 400); }
  const kind = b.kind === 'bot' ? 'bot' : 'game';
  const title = String(b.title || '').trim().slice(0, 64);
  const link = normalizeLink(b.link);
  const category = CATEGORIES[kind].includes(b.category) ? b.category : CATEGORIES[kind][0];
  if (!title) return json({ ok: false, error: 'Укажите название' }, 400);
  if (!link) return json({ ok: false, error: 'Нужна ссылка вида t.me/имя_бота' }, 400);
  if (!b.criteria) return json({ ok: false, error: 'В каталог попадают только проекты, которые проходят все критерии' }, 400);
  if (!env.STORE) return json({ ok: false, error: 'Хранилище не подключено' }, 503);
  await createSubmission(env, {
    kind, title, link, category,
    description: String(b.description || '').trim().slice(0, 600),
    contact: String(b.contact || '').trim().slice(0, 64),
    source: 'site',
  });
  return json({ ok: true });
}
