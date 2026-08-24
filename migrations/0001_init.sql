-- WeightLoss Tracker — initial schema (Cloudflare D1 / SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  age INTEGER,
  gender TEXT CHECK (gender IN ('male','female','other')),
  height_cm REAL,
  activity_level TEXT CHECK (activity_level IN ('sedentary','light','moderate','active','athlete')),
  start_weight REAL,
  current_weight REAL,
  goal_type TEXT NOT NULL DEFAULT 'lose' CHECK (goal_type IN ('lose','maintain','gain')),
  weekly_goal_kg REAL NOT NULL DEFAULT 0.5,
  step_goal INTEGER NOT NULL DEFAULT 10000,
  bmr REAL,
  tdee REAL,
  bmi REAL,
  bmi_category TEXT,
  calorie_target INTEGER,
  protein_target INTEGER,
  carb_target INTEGER,
  fat_target INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  serving_grams REAL NOT NULL DEFAULT 100,
  calories_per_100g REAL NOT NULL DEFAULT 0,
  protein_per_100g REAL NOT NULL DEFAULT 0,
  carbs_per_100g REAL NOT NULL DEFAULT 0,
  fat_per_100g REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS food_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  meal TEXT NOT NULL DEFAULT 'snack' CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  grams REAL NOT NULL,
  calories REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  log_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, log_date);

CREATE TABLE IF NOT EXISTS step_logs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  steps INTEGER NOT NULL DEFAULT 0,
  calories_burned REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, log_date)
);

CREATE TABLE IF NOT EXISTS weight_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  weight REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_weight_logs_user ON weight_logs(user_id, log_date);
