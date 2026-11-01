// /api/admin/items — проекты каталога. GET список, POST создать или сохранить, DELETE ?id= удалить.
import { KINDS } from '../../_catalog.js';
import { getCategories, fullCatalog, isAdmin, json, kvGet, normalizeLink, saveItems, slug, storedItems } from '../../_lib.js';

const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const num = v => (v === '' || v == null || isNaN(Number(v)) ? undefined : Number(v));

function clean(b, CATEGORIES) {
  const kind = KINDS[b.kind] ? b.kind : 'game';
  const cats = (Array.isArray(b.categories) ? b.categories : []).filter(c => CATEGORIES[kind].includes(c));
  const it = {
    id: slug(b.id || b.title),
    kind,
    title: str(b.title, 64),
    categories: cats.length ? cats : [CATEGORIES[kind][0]],
    link: normalizeLink(b.link) || str(b.link, 300),
    description: str(b.description, 1500),
    author: str(b.author, 64),
    note: str(b.note, 400),
    price: str(b.price, 40),
    session: str(b.session, 20),
    subscribers: str(b.subscribers, 20),
    channel: normalizeLink(b.channel),
    image: str(b.image, 300),
    featured: Boolean(b.featured),
    hidden: Boolean(b.hidden),
    rating: num(b.rating),
    votes: num(b.votes),
  };
  const st = b.stats || {};
  const week = String(st.week ?? '').split(/[\s,;]+/).map(Number).filter(n => !isNaN(n) && n >= 0).slice(0, 7);
  if (st.players || st.session || st.d7 || week.length === 7) it.stats = { players: str(st.players, 20), session: str(st.session, 20), d7: str(st.d7, 20), ...(week.length === 7 ? { week } : {}) };
  for (const k of Object.keys(it)) if (it[k] === '' || it[k] === undefined || it[k] === false) delete it[k];
  return it;
}

// Просмотры и переходы: всего и за последние 7 дней.
async function loadHits(env) {
  if (!env.DB) return {};
  try {
    const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const { results } = await env.DB.prepare(
      'SELECT id, SUM(views) v, SUM(opens) o, SUM(CASE WHEN day >= ?1 THEN views ELSE 0 END) v7, SUM(CASE WHEN day >= ?1 THEN opens ELSE 0 END) o7 FROM hits GROUP BY id'
    ).bind(since).all();
    return Object.fromEntries(results.map(r => [r.id, { v: r.v, o: r.o, v7: r.v7, o7: r.o7 }]));
  } catch { return {}; }
}

export async function onRequest({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ ok: false, error: 'Нет доступа' }, 403);
  if (!env.STORE) return json({ ok: false, error: 'Хранилище не подключено' }, 503);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const [items, pending, hits] = await Promise.all([fullCatalog(env), kvGet(env, 'pending', []), loadHits(env)]);
    return json({ ok: true, items, pending: pending.length, hits });
  }
  if (request.method === 'POST') {
    let b;
    try { b = await request.json(); } catch { return json({ ok: false, error: 'Не удалось прочитать данные' }, 400); }
    const it = clean(b, await getCategories(env));
    if (!it.title) return json({ ok: false, error: 'Укажите название' }, 400);
    if (!it.link) return json({ ok: false, error: 'Укажите ссылку' }, 400);
    const items = await storedItems(env);
    const prevId = b.prevId ? slug(b.prevId) : null;
    const at = items.findIndex(x => x.id === (prevId || it.id));
    if (!prevId && at >= 0) return json({ ok: false, error: `Адрес «${it.id}» уже занят, задайте другой` }, 409);
    if (prevId && prevId !== it.id && items.some(x => x.id === it.id)) return json({ ok: false, error: `Адрес «${it.id}» уже занят` }, 409);
    if (at >= 0) { it.createdAt = items[at].createdAt; items[at] = it; } else { it.createdAt = Date.now(); items.push(it); }
    if (it.featured) items.forEach(x => { if (x.id !== it.id) delete x.featured; });
    await saveItems(env, items);
    return json({ ok: true, item: it });
  }
  if (request.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const items = await storedItems(env);
    await saveItems(env, items.filter(x => x.id !== id));
    await env.STORE.delete('img:' + id);
    if (env.DB) await env.DB.prepare('DELETE FROM hits WHERE id = ?1').bind(id).run().catch(() => {});
    return json({ ok: true });
  }
  return json({ ok: false }, 405);
}
