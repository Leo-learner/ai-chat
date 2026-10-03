const fs = require('fs');
const path = require('path');

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column);
}

function runMigrations(db, migrationsDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  if (!fs.existsSync(migrationsDir)) return;

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(row => row.id)
  );
  const files = fs.readdirSync(migrationsDir)
    .filter(file => /^\d+_.*\.sql$/.test(file))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  const seen = new Set();

  for (const file of files) {
    const migrationId = Number.parseInt(file, 10);
    if (seen.has(migrationId)) throw new Error(`Duplicate migration id ${migrationId}`);
    seen.add(migrationId);
    if (applied.has(migrationId)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      // Migration 002 predates the migration table on some installations.
      // Reconcile that one known legacy state explicitly instead of treating
      // arbitrary "already exists" errors as successful migrations.
      if (migrationId !== 2 || !hasColumn(db, 'users', 'role')) {
        db.exec(sql);
      }
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(migrationId, file);
    })();
    applied.add(migrationId);
  }
}

module.exports = { hasColumn, runMigrations };
