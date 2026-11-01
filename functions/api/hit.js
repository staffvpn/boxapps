// POST /api/hit { id, type: 'view' | 'open' } — считает просмотры страницы проекта и переходы по кнопке.
// Без персональных данных: только проект, день и счётчик.
import { json } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: true, skipped: true });
  const b = await request.json().catch(() => ({}));
  const id = String(b.id || '');
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return json({ ok: false }, 400);
  const col = b.type === 'open' ? 'opens' : 'views';
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(`INSERT INTO hits (id, day, ${col}) VALUES (?1, ?2, 1) ON CONFLICT(id, day) DO UPDATE SET ${col} = ${col} + 1`).bind(id, day).run();
  return json({ ok: true });
}
