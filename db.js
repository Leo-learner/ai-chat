const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'chat.db');

// Ensure data directory
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Migration system ─────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT DEFAULT (datetime('now'))
  );
`);

function runMigrations() {
  const migrationsDir = path.join(__dirname, 'db', 'migrations');
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(r => r.id)
  );

  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.split('_')[0], 10);
      const numB = parseInt(b.split('_')[0], 10);
      return numA - numB;
    });

  for (const file of files) {
    const migrationId = parseInt(file.split('_')[0], 10);
    if (applied.has(migrationId)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(migrationId, file);
    } catch (err) {
      // If the migration is a no-op (e.g., column/table already exists from a
      // prior ensureColumn call), record it as applied anyway
      if (err.message.includes('duplicate column') ||
          err.message.includes('already exists')) {
        db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(migrationId, file);
        continue;
      }
      throw err;
    }
  }
}

runMigrations();

// ── User queries ────────────────────────────────────────
const userQueries = {
  create: db.prepare(`
    INSERT INTO users (id, username, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `),
  findByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  findByEmail:    db.prepare(`SELECT * FROM users WHERE email = ?`),
  findById:       db.prepare(`SELECT id, username, email, avatar, role, created_at FROM users WHERE id = ?`),
  setRoleByUsername: db.prepare(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE username = ?`),
};

const configuredAdminUsername = process.env.ADMIN_USERNAME || 'Leo';
if (configuredAdminUsername) {
  userQueries.setRoleByUsername.run('admin', configuredAdminUsername);
}

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
  lastByChat: db.prepare(`
    SELECT * FROM messages WHERE chat_id = ? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1
  `),
  deleteByChat: db.prepare(`DELETE FROM messages WHERE chat_id = ?`),
  deleteById:   db.prepare(`DELETE FROM messages WHERE id = ?`),
  deleteFromMessageInChat: db.prepare(`
    DELETE FROM messages
    WHERE chat_id = ?
      AND rowid >= (
        SELECT rowid FROM messages
        WHERE id = ? AND chat_id = ?
      )
  `),
};

// ── Memory queries ──────────────────────────────────────
const memoryQueries = {
  create: db.prepare(`
    INSERT INTO user_memories (
      id, user_id, title, content, embedding_json, embedding_model,
      embedding_dim, source_type, source_ref, enabled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listByUser: db.prepare(`
    SELECT id, title, content, embedding_model, embedding_dim, source_type,
           source_ref, enabled, created_at, updated_at
    FROM user_memories
    WHERE user_id = ?
    ORDER BY datetime(updated_at) DESC, rowid DESC
    LIMIT ?
  `),
  listByUserAndEnabled: db.prepare(`
    SELECT id, title, content, embedding_model, embedding_dim, source_type,
           source_ref, enabled, created_at, updated_at
    FROM user_memories
    WHERE user_id = ? AND enabled = ?
    ORDER BY datetime(updated_at) DESC, rowid DESC
    LIMIT ?
  `),
  searchListByUser: db.prepare(`
    SELECT id, title, content, embedding_model, embedding_dim, source_type,
           source_ref, enabled, created_at, updated_at
    FROM user_memories
    WHERE user_id = ? AND (title LIKE ? OR content LIKE ?)
    ORDER BY datetime(updated_at) DESC, rowid DESC
    LIMIT ?
  `),
  searchListByUserAndEnabled: db.prepare(`
    SELECT id, title, content, embedding_model, embedding_dim, source_type,
           source_ref, enabled, created_at, updated_at
    FROM user_memories
    WHERE user_id = ? AND enabled = ? AND (title LIKE ? OR content LIKE ?)
    ORDER BY datetime(updated_at) DESC, rowid DESC
    LIMIT ?
  `),
  enabledForSearch: db.prepare(`
    SELECT id, title, content, embedding_json, embedding_model, embedding_dim,
           source_type, source_ref, enabled, created_at, updated_at
    FROM user_memories
    WHERE user_id = ? AND enabled = 1
    ORDER BY datetime(updated_at) DESC, rowid DESC
    LIMIT ?
  `),
  findByUser: db.prepare(`
    SELECT id, user_id, title, content, embedding_json, embedding_model,
           embedding_dim, source_type, source_ref, enabled, created_at, updated_at
    FROM user_memories
    WHERE id = ? AND user_id = ?
  `),
  updateMeta: db.prepare(`
    UPDATE user_memories
    SET title = ?, enabled = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `),
  updateContent: db.prepare(`
    UPDATE user_memories
    SET title = ?, content = ?, embedding_json = ?, embedding_model = ?,
        embedding_dim = ?, enabled = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `),
  setEnabled: db.prepare(`
    UPDATE user_memories
    SET enabled = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `),
  deleteByUser: db.prepare(`DELETE FROM user_memories WHERE id = ? AND user_id = ?`),
};

module.exports = { db, DB_PATH, userQueries, chatQueries, messageQueries, memoryQueries };
