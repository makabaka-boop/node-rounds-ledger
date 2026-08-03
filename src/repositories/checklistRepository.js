'use strict';

const { getDb } = require('../db');

/**
 * 巡检清单数据访问层。items 以 JSON 字符串存储。
 */

function nowIso() {
  return new Date().toISOString();
}

function rowToChecklist(row) {
  if (!row) return null;
  return { ...row, enabled: !!row.enabled, items: JSON.parse(row.items) };
}

function create({ checklist_name, device_type, items, cycle_days, version, enabled }) {
  const db = getDb();
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO checklists (checklist_name, device_type, items, cycle_days, version, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(checklist_name, device_type, JSON.stringify(items), cycle_days, version, enabled ? 1 : 0, ts, ts);
  return findById(Number(info.lastInsertRowid));
}

function findById(id) {
  const db = getDb();
  return rowToChecklist(db.prepare('SELECT * FROM checklists WHERE id = ?').get(id));
}

// 返回同名清单的最新版本（version 最大）
function findLatestByName(name) {
  const db = getDb();
  return rowToChecklist(
    db.prepare('SELECT * FROM checklists WHERE checklist_name = ? ORDER BY version DESC LIMIT 1').get(name),
  );
}

// 返回原始行（items 仍为字符串），供快照构建使用
function findRawById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM checklists WHERE id = ?').get(id) || null;
}

function list() {
  const db = getDb();
  return db.prepare('SELECT * FROM checklists ORDER BY id').all().map(rowToChecklist);
}

module.exports = { create, findById, findLatestByName, findRawById, list };
