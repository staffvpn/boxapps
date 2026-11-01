// GET /avatar/<username> — аватарка бота, канала или игры из её публичной страницы t.me/<username>.
// Картинка кешируется в Cloudflare на 3 дня; если аватарки нет — 404 (на сайте тогда остаётся наша иллюстрация).
const OK_TTL = 3 * 86400, MISS_TTL = 12 * 3600;

export async function onRequestGet({ params, request, waitUntil }) {
  const name = String(params.name || '');
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name)) return new Response('Bad name', { status: 400 });
  const cache = caches.default;
  const key = new Request(new URL('/avatar/' + name.toLowerCase(), request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  let res = new Response('No avatar', { status: 404, headers: { 'cache-control': `public, max-age=${MISS_TTL}` } });
  try {
    const page = await fetch('https://t.me/' + name, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; BoxAppsBot/1.0)', 'accept-language': 'ru,en' } });
    const html = await page.text();
    const m = html.match(/<meta property="og:image" content="([^"]+)"/i);
    const src = m ? m[1].replace(/&amp;/g, '&') : '';
    // у кого нет аватарки, Telegram подставляет свой логотип — его не показываем
    if (src && /^https:\/\//.test(src) && !/telegram\.org\/img\//.test(src)) {
      const img = await fetch(src);
      const type = img.headers.get('content-type') || '';
      if (img.ok && type.startsWith('image/')) {
        res = new Response(img.body, { headers: { 'content-type': type, 'cache-control': `public, max-age=${OK_TTL}` } });
      }
    }
  } catch (e) {
    res = new Response('Unavailable', { status: 404, headers: { 'cache-control': 'public, max-age=600' } });
  }
  waitUntil(cache.put(key, res.clone()));
  return res;
}
