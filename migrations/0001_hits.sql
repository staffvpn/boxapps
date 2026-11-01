-- Счётчик просмотров страницы проекта и переходов по кнопке «Играть / Открыть» по дням.
CREATE TABLE IF NOT EXISTS hits (
  id TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  opens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, day)
);
