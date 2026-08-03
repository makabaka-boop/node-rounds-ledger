'use strict';

const { getDb } = require('../db');

/**
 * 清单快照数据访问层。快照一经写入不可变，实现轮次与清单变化的隔离。
 */

function create({ checklist_id, checklist_name, device_type, version, cycle_days, items_json }) {
  const db = getDb();
  const ts = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO checklist_snapshots (checklist_id, checklist_name, device_type, version, cycle_days, items_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(checklist_id, checklist_name, device_type, version, cycle_days, items_json, ts);
  return findById(Number(info.lastInsertRowid));
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM checklist_snapshots WHERE id = ?').get(id) || null;
}

module.exports = { create, findById };
