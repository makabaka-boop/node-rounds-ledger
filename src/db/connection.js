const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { migrate } = require('./schema');

let db = null;

function getDb() {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'ledger.db');
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

// 仅用于测试注入内存库
function setDb(instance) {
  db = instance;
}

module.exports = { getDb, setDb };
