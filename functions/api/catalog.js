// GET /api/catalog — каталог для сайта и мини-приложения.
import { BRAND, CATEGORIES, CRITERIA } from '../_catalog.js';
import { fullCatalog, json, kvGet } from '../_lib.js';

export async function onRequestGet({ env }) {
  const [items, bot] = await Promise.all([fullCatalog(env), kvGet(env, 'bot_username', '')]);
  return json({ brand: BRAND, bot, categories: CATEGORIES, criteria: CRITERIA, items });
}
