-- 004: Per-user daily usage counters and case-insensitive email lookups

CREATE TABLE IF NOT EXISTS user_daily_usage (
  user_id   TEXT NOT NULL,
  day       TEXT NOT NULL,
  messages  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_email_nocase ON users(email COLLATE NOCASE);
