// GET /img/<id> — обложка проекта из хранилища.
export async function onRequestGet({ params, env }) {
  if (!env.STORE) return new Response('Not found', { status: 404 });
  const r = await env.STORE.getWithMetadata('img:' + params.id, 'arrayBuffer');
  if (!r.value) return new Response('Not found', { status: 404 });
  return new Response(r.value, { headers: { 'content-type': (r.metadata && r.metadata.type) || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
}
