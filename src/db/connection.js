const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const SCHEMA_SQL = require('./schema.sql');
const config = require('../config');

let dbInstance = null;

function ensureDirectoryForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDb(options = {}) {
  if (dbInstance && !options.forceNew) {
    return dbInstance;
  }

  const dbPath = options.path || config.dbPath;
  const inMemory = options.inMemory || dbPath === ':memory:';

  if (!inMemory) {
    ensureDirectoryForFile(dbPath);
  }

  const db = new Database(inMemory ? ':memory:' : dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  if (!options.forceNew) {
    dbInstance = db;
  }
  return db;
}

function closeDb(db) {
  const target = db || dbInstance;
  if (target) {
    target.close();
  }
  if (!db) {
    dbInstance = null;
  }
}

function resetForTesting() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { getDb, closeDb, resetForTesting };
