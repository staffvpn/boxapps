// /api/admin/pending — заявки. GET очередь, POST { sid, action: 'ok' | 'no' }.
import { approveSubmission, isAdmin, json, kvGet, rejectSubmission, tgApi, esc } from '../../_lib.js';
import { BRAND } from '../../_catalog.js';

export async function onRequest({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ ok: false, error: 'Нет доступа' }, 403);
  if (request.method === 'GET') return json({ ok: true, pending: await kvGet(env, 'pending', []) });
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const { sid, action } = await request.json().catch(() => ({}));
  const r = action === 'ok' ? await approveSubmission(env, sid) : await rejectSubmission(env, sid);
  if (!r) return json({ ok: false, error: 'Заявка уже обработана' }, 404);
  if (r.sub.user_id) {
    await tgApi(env, 'sendMessage', { chat_id: r.sub.user_id, parse_mode: 'HTML',
      text: action === 'ok' ? `«${esc(r.sub.title)}» добавлен в каталог ${BRAND}.` : `«${esc(r.sub.title)}» пока не добавлен в каталог.` });
  }
  return json({ ok: true, item: r.item || null });
}
