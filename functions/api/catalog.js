// GET /api/catalog — каталог для сайта и мини-приложения.
import { BRAND, KINDS } from '../_catalog.js';
import { fullCatalog, getCategories, json, kvGet } from '../_lib.js';

export async function onRequestGet({ env }) {
  const [all, bot, categories, hits] = await Promise.all([fullCatalog(env), kvGet(env, 'bot_username', ''), getCategories(env), loadHits(env)]);
  // публично: без ID владельца; просмотры и запуски в BOX APPS — для страницы проекта
  const items = all.filter(x => !x.hidden).map(({ owner, ...x }) => (hits[x.id] ? { ...x, views: hits[x.id].v, opens: hits[x.id].o } : x));
  return json({ brand: BRAND, bot, kinds: KINDS, categories, items });
}

async function loadHits(env) {
  if (!env.DB) return {};
  try {
    const { results } = await env.DB.prepare('SELECT id, SUM(views) v, SUM(opens) o FROM hits GROUP BY id').all();
    return Object.fromEntries(results.map(r => [r.id, r]));
  } catch { return {}; }
}
