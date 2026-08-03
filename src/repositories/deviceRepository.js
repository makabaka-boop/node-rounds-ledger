'use strict';

const { getDb } = require('../db');

/**
 * 设备数据访问层。所有 SQL 都集中在仓库内，服务层不直接触碰数据库。
 */

function nowIso() {
  return new Date().toISOString();
}

function rowToDevice(row) {
  if (!row) return null;
  return { ...row, enabled: !!row.enabled };
}

function create({ device_code, device_name, area, device_type, risk_level, enabled, maintenance_note }) {
  const db = getDb();
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO devices (device_code, device_name, area, device_type, risk_level, enabled, maintenance_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(device_code, device_name, area, device_type, risk_level, enabled ? 1 : 0, maintenance_note, ts, ts);
  return findById(Number(info.lastInsertRowid));
}

function findById(id) {
  const db = getDb();
  return rowToDevice(db.prepare('SELECT * FROM devices WHERE id = ?').get(id));
}

function findByCode(code) {
  const db = getDb();
  return rowToDevice(db.prepare('SELECT * FROM devices WHERE device_code = ?').get(code));
}

function setEnabled(id, enabled) {
  const db = getDb();
  db.prepare('UPDATE devices SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, nowIso(), id);
  return findById(id);
}

function list() {
  const db = getDb();
  return db.prepare('SELECT * FROM devices ORDER BY id').all().map(rowToDevice);
}

module.exports = { create, findById, findByCode, setEnabled, list };
