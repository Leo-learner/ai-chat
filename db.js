const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./lib/migrations');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'chat.db');

// Ensure data directory
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Migration system ─────────────────────────────────────
runMigrations(db, path.join(__dirname, 'db', 'migrations'));

// ── User queries ────────────────────────────────────────
const userQueries = {
  create: db.prepare(`
    INSERT INTO users (id, username, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `),
  findByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  findByEmail:    db.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`),
  findById:       db.prepare(`SELECT id, username, email, avatar, role, created_at FROM users WHERE id = ?`),
  // Same safe fields plus token_version, which authRequired compares with the JWT.
  findAuthById:   db.prepare(`SELECT id, username, email, avatar, role, created_at, token_version FROM users WHERE id = ?`),
  // Includes the password hash — used only server-side to verify the current
  // password before a self-service username/password change. Never returned to clients.
  findWithPasswordById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  updateUsername: db.prepare(`UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?`),
  // A password change always revokes every previously issued token.
  updatePassword: db.prepare(`UPDATE users SET password = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`),
  bumpTokenVersion: db.prepare(`UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`),
};

// Explicit deletes instead of relying on ON DELETE CASCADE, which databases
// created by older schemas may not have.
const deleteUserStatements = [
  db.prepare(`DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id = ?)`),
  db.prepare(`DELETE FROM chats WHERE user_id = ?`),
  db.prepare(`DELETE FROM user_memories WHERE user_id = ?`),
  db.prepare(`DELETE FROM user_daily_usage WHERE user_id = ?`),
  db.prepare(`DELETE FROM users WHERE id = ?`),
];
const deleteUserAccount = db.transaction((userId) => {
  for (const statement of deleteUserStatements) statement.run(userId);
});

// ── Chat queries ────────────────────────────────────────
const chatQueries = {
  create: db.prepare(`
    INSERT INTO chats (id, user_id, title, model)
    VALUES (?, ?, ?, ?)
  `),
  // List view: no system_prompt, bounded row count.
  findByUser: db.prepare(`
    SELECT id, user_id, title, model, created_at, updated_at
    FROM chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?
  `),
  countByUser: db.prepare(`SELECT COUNT(*) AS count FROM chats WHERE user_id = ?`),
  findById: db.prepare(`SELECT * FROM chats WHERE id = ?`),
  updateTitle: db.prepare(`UPDATE chats SET title = ?, updated_at = datetime('now') WHERE id = ?`),
  touch: db.prepare(`UPDATE chats SET updated_at = datetime('now') WHERE id = ?`),
  delete: db.prepare(`DELETE FROM chats WHERE id = ?`),
  updateModel: db.prepare(`UPDATE chats SET model = ? WHERE id = ?`),
  updateSystem: db.prepare(`UPDATE chats SET system_prompt = ? WHERE id = ?`),
};

// ── Message queries ─────────────────────────────────────
const messageQueries = {
  add: db.prepare(`
    INSERT INTO messages (id, chat_id, role, content, tokens)
    VALUES (?, ?, ?, ?, ?)
  `),
  findByChat: db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? ORDER BY datetime(created_at) ASC, rowid ASC
  `),
  deleteByChat: db.prepare(`DELETE FROM messages WHERE chat_id = ?`),
  deleteFromMessageInChat: db.prepare(`
    DELETE FROM messages
    WHERE chat_id = ?
      AND rowid >= (
        SELECT rowid FROM messages
        WHERE id = ? AND chat_id = ?
      )
  `),
};

// ── Usage queries ───────────────────────────────────────
const usageQueries = {
  getDaily: db.prepare(`SELECT messages FROM user_daily_usage WHERE user_id = ? AND day = ?`),
  incrementDaily: db.prepare(`
    INSERT INTO user_daily_usage (user_id, day, messages) VALUES (?, ?, 1)
    ON CONFLICT(user_id, day) DO UPDATE SET messages = messages + 1
  `),
};

module.exports = { db, DB_PATH, userQueries, chatQueries, messageQueries, usageQueries, deleteUserAccount };
