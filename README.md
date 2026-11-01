# BOX APPS

Каталог игр и ботов для Telegram, отобранных вручную. Без тапалок, казино, «заработка» и обязательных подписок.

Один и тот же `index.html` открывается и как мини-приложение в Telegram, и как обычный сайт.

## Устройство

- `index.html` — витрина: каталог игр и ботов, карточки, правила, форма заявки. Без сборки.
- `functions/_catalog.js` — **сам каталог**: категории, правила отбора и записи. Правьте здесь.
- `functions/tg/webhook.js` — бот: меню, разделы, категории, случайный выбор, поиск, заявки и модерация.
- `functions/tg/setup.js` — `GET /tg/setup?key=WEBHOOK_SECRET` один раз подключает вебхук, кнопку меню, команды и описание бота.
- `functions/api/catalog.js` — `GET /api/catalog` для сайта.
- `functions/api/submit.js` — `POST /api/submit`, заявки с сайта.
- `wrangler.toml` — KV `pult-store` как `STORE`: очередь заявок, одобренные проекты, шаги диалога.

## Запуск на Cloudflare Pages

1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → этот репозиторий. Build command пустой, output directory `.`.
2. Settings → Variables and Secrets (Production):
   - `BOT_TOKEN` — токен от @BotFather (как секрет);
   - `WEBHOOK_SECRET` — любая длинная случайная строка (как секрет);
   - `ADMIN_IDS` — Telegram ID редакторов через запятую (свой ID бот покажет по команде `/myid`).
3. Settings → Bindings: проверьте, что KV `STORE` привязан к `pult-store` (берётся из `wrangler.toml`).
4. После деплоя откройте `https://<проект>.pages.dev/tg/setup?key=<WEBHOOK_SECRET>`.
5. В @BotFather → Bot Settings → Configure Mini App → Enable, URL сайта. Тогда бот появится в разделе «Приложения» поиска Telegram.

Секреты в репозиторий не кладём.

## Команды бота

`/start` меню · `/games` · `/bots` · `/random` · `/search` · `/submit` · `/myid` · `/pending` (редакция).
Заявки из бота и с сайта приходят редакторам из `ADMIN_IDS` с кнопками «Добавить» и «Отклонить».
