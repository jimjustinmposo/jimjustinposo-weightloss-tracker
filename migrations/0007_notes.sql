-- Notes feature (additive only — no existing table is modified).
-- Relationship: users 1—N note_folders 1—N notes
-- (notes also carry user_id so every query can be scoped cheaply, like foods/food_logs).
-- client_id mirrors migration 0004's idempotency guard so offline retries never duplicate rows.

CREATE TABLE IF NOT EXISTS note_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_folders_client ON note_folders(client_id);
CREATE INDEX IF NOT EXISTS idx_note_folders_user ON note_folders(user_id, updated_at);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES note_folders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_client ON notes(client_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_folder ON notes(user_id, folder_id);
