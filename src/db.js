'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

/**
 * 数据库单例封装。使用 Node 内置的 node:sqlite（无第三方依赖）。
 * 提供 init（建表）、getDb（获取连接）、resetForTest（测试用内存库）。
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  area TEXT NOT NULL,
  device_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  maintenance_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  items TEXT NOT NULL,          -- JSON 数组字符串
  cycle_days INTEGER NOT NULL,
  version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (checklist_name, version)
);

CREATE TABLE IF NOT EXISTS checklist_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL,
  checklist_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  cycle_days INTEGER NOT NULL,
  items_json TEXT NOT NULL,     -- 固化的 items 数组 JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (checklist_id) REFERENCES checklists(id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  checklist_id INTEGER NOT NULL,
  checklist_snapshot_id INTEGER NOT NULL,
  planned_start_at TEXT NOT NULL,
  planned_end_at TEXT NOT NULL,
  round_status TEXT NOT NULL DEFAULT 'scheduled',
  owner_name TEXT NOT NULL,
  started_at TEXT,
  submitted_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id),
  FOREIGN KEY (checklist_id) REFERENCES checklists(id),
  FOREIGN KEY (checklist_snapshot_id) REFERENCES checklist_snapshots(id)
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  result_value TEXT NOT NULL,
  note TEXT,
  submitted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (round_id) REFERENCES rounds(id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL UNIQUE,
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewer_name TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (round_id) REFERENCES rounds(id),
  FOREIGN KEY (result_id) REFERENCES results(id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT,                  -- JSON 字符串
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rounds_device ON rounds(device_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(round_status);
CREATE INDEX IF NOT EXISTS idx_results_round ON results(round_id);
CREATE INDEX IF NOT EXISTS idx_reviews_round ON reviews(round_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
`;

let dbInstance = null;

function applySchema(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
}

function init() {
  if (dbInstance) return dbInstance;
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbInstance = new DatabaseSync(config.dbPath);
  applySchema(dbInstance);
  return dbInstance;
}

function getDb() {
  if (!dbInstance) return init();
  return dbInstance;
}

// 测试用：使用内存库并重建 schema
function resetForTest() {
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
  }
  dbInstance = new DatabaseSync(':memory:');
  applySchema(dbInstance);
  return dbInstance;
}

module.exports = { init, getDb, resetForTest };
