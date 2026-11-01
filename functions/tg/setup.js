// GET /tg/setup?key=WEBHOOK_SECRET — открыть один раз после того, как заданы переменные.
// Подключает вебхук, кнопку меню «Каталог», команды и описание бота.
import { BRAND } from '../_catalog.js';
import { json, kvPut, tgApi } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) return json({ ok: false, error: 'Добавьте BOT_TOKEN и WEBHOOK_SECRET в переменные проекта' }, 503);
  if (url.searchParams.get('key') !== env.WEBHOOK_SECRET) return json({ ok: false, error: 'Неверный ключ' }, 403);
  const origin = url.origin;
  const me = await tgApi(env, 'getMe', {});
  if (me.ok) await kvPut(env, 'bot_username', me.result.username);
  const webhook = await tgApi(env, 'setWebhook', {
    url: origin + '/tg/webhook', secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
  });
  const menu = await tgApi(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Каталог', web_app: { url: origin } } });
  const cmds = await tgApi(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Главное меню' },
      { command: 'games', description: 'Игры' },
      { command: 'bots', description: 'Боты' },
      { command: 'random', description: 'Случайный выбор' },
      { command: 'search', description: 'Поиск по названию' },
      { command: 'submit', description: 'Предложить проект' },
    ],
  });
  const desc = await tgApi(env, 'setMyDescription', {
    description: `${BRAND}: игры и боты для Telegram, отобранные вручную. Без тапалок, казино, «заработка» и обязательных подписок.`,
  });
  const short = await tgApi(env, 'setMyShortDescription', { short_description: 'Отборные игры и боты для Telegram. Без фарма и мусора.' });
  return json({ ok: webhook.ok && menu.ok, bot: me.ok ? '@' + me.result.username : null, webhook, menu, commands: cmds, description: desc.ok && short.ok, store: Boolean(env.STORE) });
}
