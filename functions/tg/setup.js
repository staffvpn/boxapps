// GET /tg/setup?key=WEBHOOK_SECRET — открыть один раз после того, как заданы переменные.
// Подключает вебхук, кнопку меню, команды (у админов — плюс /admin) и описание бота.
import { BRAND } from '../_catalog.js';
import { admins, json, kvPut, tgApi } from '../_lib.js';

const COMMANDS = [
  { command: 'start', description: 'Открыть BOX APPS' },
  { command: 'submit', description: 'Добавить свой проект' },
];

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const seen = { BOT_TOKEN: Boolean(env.BOT_TOKEN), WEBHOOK_SECRET: Boolean(env.WEBHOOK_SECRET), ADMIN_IDS: Boolean(env.ADMIN_IDS), ADMIN_KEY: Boolean(env.ADMIN_KEY), STORE: Boolean(env.STORE) };
  if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) {
    return json({
      ok: false,
      error: 'Сервер не видит BOT_TOKEN или WEBHOOK_SECRET. В Settings → Variables and Secrets они должны быть типа Secret (Encrypt) в окружении Production, затем Deployments → Retry deployment.',
      seen,
    }, 503);
  }
  if (url.searchParams.get('key') !== env.WEBHOOK_SECRET) return json({ ok: false, error: 'Неверный ключ' }, 403);
  const origin = url.origin;
  const me = await tgApi(env, 'getMe', {});
  if (me.ok) await kvPut(env, 'bot_username', me.result.username);
  const webhook = await tgApi(env, 'setWebhook', {
    url: origin + '/tg/webhook', secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
  });
  const menu = await tgApi(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'BOX APPS', web_app: { url: origin } } });
  const cmds = await tgApi(env, 'setMyCommands', { commands: COMMANDS });
  const adminCmds = await Promise.all(admins(env).map(id => tgApi(env, 'setMyCommands', {
    scope: { type: 'chat', chat_id: id },
    commands: [{ command: 'admin', description: 'Админка' }, ...COMMANDS, { command: 'myid', description: 'Мой ID' }],
  })));
  const desc = await tgApi(env, 'setMyDescription', { description: `${BRAND}: игры, боты и каналы для Telegram в одном каталоге.` });
  const short = await tgApi(env, 'setMyShortDescription', { short_description: 'Игры, боты и каналы для Telegram.' });
  return json({
    ok: webhook.ok && menu.ok, bot: me.ok ? '@' + me.result.username : null,
    webhook, menu, commands: cmds.ok, admins: admins(env).length, adminCommands: adminCmds.every(r => r.ok),
    description: desc.ok && short.ok, seen,
  });
}
