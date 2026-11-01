// GET /api/admin/me — админ ли текущий пользователь. Сайт показывает раздел «Админка» только админам.
import { isAdmin, json } from '../../_lib.js';

export async function onRequestGet({ request, env }) {
  const a = await isAdmin(request, env);
  return json({ admin: Boolean(a), via: a ? a.via : null, name: a && a.user ? a.user.first_name : null });
}
