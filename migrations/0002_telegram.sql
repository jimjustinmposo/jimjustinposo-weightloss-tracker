-- Telegram integration (additive only — no existing tables are modified).

-- Secure mapping between a Telegram user and an application user.
CREATE TABLE IF NOT EXISTS telegram_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL UNIQUE,
  application_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_telegram_users_app ON telegram_users(application_user_id);

-- Short-lived codes generated in the web app (Profile page) to link a Telegram account.
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  application_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pending meal analyses awaiting Confirm/Cancel (or food/prep disambiguation).
CREATE TABLE IF NOT EXISTS telegram_pending_meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL,
  application_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL, -- JSON: { chat_id, meal, stage, items:[...] }
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pending_meals_tg ON telegram_pending_meals(telegram_user_id);

-- Idempotency guard against Telegram's webhook retries.
CREATE TABLE IF NOT EXISTS telegram_processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);