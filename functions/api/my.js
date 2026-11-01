// GET /api/my — «Мои проекты»: заявки пользователя и статистика его проектов в каталоге.
import { currentUser, fullCatalog, json, kvGet } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ ok: false, error: 'Откройте BOX APPS в Telegram' }, 401);
  const [mine, items] = await Promise.all([kvGet(env, 'mine:' + user.id, []), fullCatalog(env)]);
  const ids = new Set([...mine.filter(m => m.item).map(m => m.item), ...items.filter(x => x.owner === user.id).map(x => x.id)]);
  let hits = {};
  if (env.DB && ids.size) {
    try {
      const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
      const list = [...ids];
      const { results } = await env.DB.prepare(`SELECT id, SUM(views) v, SUM(opens) o, SUM(CASE WHEN day >= ?1 THEN views ELSE 0 END) v7, SUM(CASE WHEN day >= ?1 THEN opens ELSE 0 END) o7 FROM hits WHERE id IN (${list.map((_, i) => '?' + (i + 2)).join(',')}) GROUP BY id`).bind(since, ...list).all();
      hits = Object.fromEntries(results.map(r => [r.id, r]));
    } catch {}
  }
  return json({ ok: true, subs: mine, items: items.filter(x => ids.has(x.id)).map(({ owner, ...x }) => ({ ...x, hits: hits[x.id] || {} })) });
}
