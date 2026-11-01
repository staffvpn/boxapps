// /api/admin/categories — категории по разделам. GET текущие, POST { categories: { game: [...], bot: [...], channel: [...] } }.
// Если категорию переименовали (renames: [{ kind, from, to }]) или удалили, проекты обновляются вместе с ней.
import { CATEGORIES_VERSION, KINDS } from '../../_catalog.js';
import { getCategories, isAdmin, json, kvPut, saveItems, storedItems } from '../../_lib.js';

export async function onRequest({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ ok: false, error: 'Нет доступа' }, 403);
  if (request.method === 'GET') return json({ ok: true, categories: await getCategories(env) });
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const b = await request.json().catch(() => ({}));
  const next = {};
  for (const k of Object.keys(KINDS)) {
    const list = (Array.isArray(b.categories && b.categories[k]) ? b.categories[k] : [])
      .map(s => String(s).trim().slice(0, 32)).filter(Boolean);
    next[k] = [...new Set(list)];
    if (!next[k].length) return json({ ok: false, error: `В разделе «${KINDS[k]}» нужна хотя бы одна категория` }, 400);
  }
  const items = await storedItems(env);
  for (const r of Array.isArray(b.renames) ? b.renames : []) {
    items.forEach(x => { if (x.kind === r.kind) x.categories = x.categories.map(c => (c === r.from ? String(r.to).trim().slice(0, 32) : c)); });
  }
  items.forEach(x => {
    x.categories = [...new Set(x.categories.filter(c => next[x.kind].includes(c)))];
    if (!x.categories.length) x.categories = [next[x.kind][0]];
  });
  await Promise.all([kvPut(env, 'categories', { v: CATEGORIES_VERSION, ...next }), saveItems(env, items)]);
  return json({ ok: true, categories: next });
}
