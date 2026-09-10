CREATE TABLE IF NOT EXISTS pushup_logs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  pushups INTEGER NOT NULL DEFAULT 0,
  calories_burned REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_pushup_logs_user ON pushup_logs(user_id, log_date);