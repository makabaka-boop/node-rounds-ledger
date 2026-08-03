const Database = require('better-sqlite3');
const path = require('path');
const { SCHEMA_SQL } = require('./schema');

let dbInstance = null;

function getDb(dbPath) {
  if (dbInstance) {
    return dbInstance;
  }

  const resolvedPath = dbPath || path.join(__dirname, '..', '..', 'data', 'rounds-ledger.db');

  const fs = require('fs');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbInstance = new Database(resolvedPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.exec(SCHEMA_SQL);

  return dbInstance;
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

function resetDb(dbPath) {
  closeDb();
  const resolvedPath = dbPath || path.join(__dirname, '..', '..', 'data', 'rounds-ledger.db');
  try {
    const fs = require('fs');
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }
    const walPath = resolvedPath + '-wal';
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
    const shmPath = resolvedPath + '-shm';
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath);
    }
  } catch (e) {
    // ignore
  }
  return getDb(dbPath);
}

module.exports = { getDb, closeDb, resetDb };
