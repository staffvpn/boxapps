// POST /api/admin/upload?id=<id> — обложка проекта (картинка в теле запроса, до 2 МБ). Отдаётся по /img/<id>.
import { isAdmin, json } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ ok: false, error: 'Нет доступа' }, 403);
  const id = new URL(request.url).searchParams.get('id') || '';
  const type = request.headers.get('content-type') || '';
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return json({ ok: false, error: 'Сначала сохраните проект' }, 400);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return json({ ok: false, error: 'Нужна картинка JPG, PNG, WebP или GIF' }, 400);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > 2 * 1024 * 1024) return json({ ok: false, error: 'Картинка больше 2 МБ' }, 413);
  await env.STORE.put('img:' + id, buf, { metadata: { type } });
  return json({ ok: true, url: `/img/${id}?v=${Date.now()}` });
}
