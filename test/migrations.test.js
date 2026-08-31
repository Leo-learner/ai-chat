const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { runMigrations } = require('../lib/migrations');

const projectRoot = path.join(__dirname, '..');

function initialize(dbPath) {
  const result = spawnSync(process.execPath, ['-e', 'const { db } = require("./db"); db.close();'], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function migrationIds(db) {
  return db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(row => row.id);
}

test('fresh database applies every migration exactly once', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-migration-fresh-'));
  try {
    const dbPath = path.join(tempRoot, 'chat.db');
    initialize(dbPath);
    initialize(dbPath);

    const db = new Database(dbPath, { readonly: true });
    assert.deepEqual(migrationIds(db), [1, 2]);
    const roleColumn = db.prepare('PRAGMA table_info(users)').all().find(column => column.name === 'role');
    assert.ok(roleColumn);
    assert.equal(roleColumn.dflt_value, "'user'");
    for (const table of ['users', 'chats', 'messages', 'user_memories']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
    db.close();
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('legacy database gains role metadata without losing existing users', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-migration-legacy-'));
  try {
    const dbPath = path.join(tempRoot, 'chat.db');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO users (id, username, email, password)
      VALUES ('legacy-id', 'legacy-user', 'legacy@example.test', 'hash');
    `);
    legacy.close();

    initialize(dbPath);
    initialize(dbPath);

    const migrated = new Database(dbPath, { readonly: true });
    assert.deepEqual(migrationIds(migrated), [1, 2]);
    assert.deepEqual(migrated.prepare('SELECT id, username, role FROM users WHERE id = ?').get('legacy-id'), {
      id: 'legacy-id',
      username: 'legacy-user',
      role: 'user',
    });
    migrated.close();
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('legacy role column without migration metadata is reconciled explicitly', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-migration-role-'));
  try {
    const dbPath = path.join(tempRoot, 'chat.db');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user'))
      );
    `);
    legacy.close();

    initialize(dbPath);
    const migrated = new Database(dbPath, { readonly: true });
    assert.deepEqual(migrationIds(migrated), [1, 2]);
    assert.equal(migrated.prepare('PRAGMA table_info(users)').all().filter(column => column.name === 'role').length, 1);
    migrated.close();
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('failed multi-statement migration rolls back schema and migration metadata', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-migration-atomic-'));
  try {
    const migrationsDir = path.join(tempRoot, 'migrations');
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(path.join(migrationsDir, '001_base.sql'), 'CREATE TABLE base (id INTEGER PRIMARY KEY);');
    fs.writeFileSync(path.join(migrationsDir, '003_partial.sql'), `
      CREATE TABLE should_rollback (id INTEGER PRIMARY KEY);
      INSERT INTO missing_table (id) VALUES (1);
    `);

    const db = new Database(path.join(tempRoot, 'chat.db'));
    assert.throws(() => runMigrations(db, migrationsDir), /missing_table/);
    assert.deepEqual(migrationIds(db), [1]);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='should_rollback'").get(), undefined);
    db.close();
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
