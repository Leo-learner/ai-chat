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
  findByEmail:    db.prepare(`SELECT * FROM users WHERE email = ?`),
  findById:       db.prepare(`SELECT id, username, email, avatar, role, created_at FROM users WHERE id = ?`),
  // Includes the password hash — used only server-side to verify the current
  // password before a self-service username/password change. Never returned to clients.
  findWithPasswordById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  updateUsername: db.prepare(`UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?`),
  updatePassword: db.prepare(`UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?`),
};

// ── Chat queries ────────────────────────────────────────
const chatQueries = {
  create: db.prepare(`
    INSERT INTO chats (id, user_id, title, model)
    VALUES (?, ?, ?, ?)
  `),
  findByUser: db.prepare(`
    SELECT * FROM chats WHERE user_id = ? ORDER BY updated_at DESC
  `),
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

module.exports = { db, DB_PATH, userQueries, chatQueries, messageQueries };
