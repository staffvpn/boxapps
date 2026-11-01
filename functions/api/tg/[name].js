// GET /api/tg/<username>[?posts=1] — живые данные проекта из Telegram для страницы проекта.
// Только для проектов из каталога, чтобы сервер не превращался в открытый прокси.
import { fullCatalog, json } from '../../_lib.js';
import { tgInfo, tgName } from '../../_tg.js';

export async function onRequestGet({ params, request, env }) {
  const name = String(params.name || '');
  const items = await fullCatalog(env);
  if (!items.some(x => tgName(x.link).toLowerCase() === name.toLowerCase() || tgName(x.channel).toLowerCase() === name.toLowerCase())) return json({ ok: false }, 404);
  try {
    const info = await tgInfo(request, name, { posts: new URL(request.url).searchParams.get('posts') === '1' });
    return json({ ok: true, ...info });
  } catch { return json({ ok: false }, 502); }
}
