// Публичные данные проекта со страниц t.me: название, описание, подписчики/пользователи, последние посты канала.
// Ответы кешируются в Cloudflare, чтобы не дёргать Telegram на каждый просмотр.

export function tgName(link) {
  const m = /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})(?:[/?#]|$)/.exec(String(link || ''));
  return m ? m[1] : '';
}

const decode = s => String(s || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').trim();
const num = s => { const n = Number(String(s).replace(/[^\d]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; BoxAppsBot/1.0)', 'accept-language': 'en' };

// Разбор страницы t.me/<name>
export function parsePage(html) {
  const meta = p => { const m = html.match(new RegExp(`<meta property="${p}" content="([^"]*)"`, 'i')); return m ? decode(m[1]) : ''; };
  const extraM = html.match(/<div class="tgme_page_extra">([\s\S]*?)<\/div>/i);
  const extra = extraM ? decode(extraM[1]) : '';
  const descM = html.match(/<div class="tgme_page_description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const image = meta('og:image');
  const subs = extra.match(/([\d\s,.]+)\s+(subscribers|members)/i);
  const monthly = extra.match(/([\d\s,.]+)\s+monthly users/i);
  return {
    title: meta('og:title'),
    description: descM ? decode(descM[1]) : meta('og:description'),
    photo: Boolean(image && !/telegram\.org\/img\//.test(image)),
    subscribers: subs ? num(subs[1]) : 0,
    monthly: monthly ? num(monthly[1]) : 0,
    verified: /verified-icon|tgme_page_title[^>]*>[\s\S]{0,200}verified/i.test(html),
  };
}

// Последние посты публичного канала со страницы t.me/s/<name>
export function parsePosts(html, name, limit = 2) {
  const out = [];
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const b of blocks) {
    const post = (b.match(/data-post="([^"]+)"/) || [])[1];
    const textM = b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const date = (b.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
    const views = (b.match(/<span class="tgme_widget_message_views">([^<]+)<\/span>/) || [])[1];
    const text = textM ? decode(textM[1]) : '';
    if (!post || !text) continue;
    out.push({ url: 'https://t.me/' + post, text: text.length > 320 ? text.slice(0, 317).trimEnd() + '…' : text, date: date || '', views: views || '' });
  }
  return out.slice(-limit).reverse();
}

async function cached(request, key, ttl, make) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const k = new Request(new URL(key, request.url).toString());
  if (cache) { const hit = await cache.match(k); if (hit) return hit.json(); }
  const data = await make();
  if (cache) await cache.put(k, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } }));
  return data;
}

export async function tgInfo(request, name, { posts = false, fresh = false } = {}) {
  const make = async () => {
    const page = await fetch('https://t.me/' + name, { headers: UA });
    const info = parsePage(await page.text());
    if (posts) {
      try { const s = await fetch('https://t.me/s/' + name, { headers: UA }); info.posts = s.ok ? parsePosts(await s.text(), name) : []; } catch { info.posts = []; }
    }
    return info;
  };
  if (fresh) return make();
  return cached(request, `/__tg/${name.toLowerCase()}${posts ? '/posts' : ''}`, 6 * 3600, make);
}
