// GET /api/catalog — каталог для сайта и мини-приложения.
import { BRAND, KINDS } from '../_catalog.js';
import { fullCatalog, getCategories, json, kvGet } from '../_lib.js';

export async function onRequestGet({ env }) {
  const [all, bot, categories] = await Promise.all([fullCatalog(env), kvGet(env, "bot_username", ""), getCategories(env)]);
  // публично: без ID владельца
  const items = all.filter(x => !x.hidden).map(({ owner, ...x }) => x);
  return json({ brand: BRAND, bot, kinds: KINDS, categories, items });
}

