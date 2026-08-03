'use strict';

const { getDb } = require('../db');

/**
 * 巡检轮次数据访问层。
 */

function nowIso() {
  return new Date().toISOString();
}

function create({ device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, owner_name }) {
  const db = getDb();
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO rounds (device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, round_status, owner_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)
  `);
  const info = stmt.run(device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, owner_name, ts, ts);
  return findById(Number(info.lastInsertRowid));
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM rounds WHERE id = ?').get(id) || null;
}

// 更新状态并按需写入时间戳字段
function updateStatus(id, status, extra = {}) {
  const db = getDb();
  const fields = ['round_status = ?', 'updated_at = ?'];
  const values = [status, nowIso()];
  for (const [k, v] of Object.entries(extra)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  values.push(id);
  db.prepare(`UPDATE rounds SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return findById(id);
}

// 某设备最近的若干轮次（按计划开始时间倒序）
function findRecentByDevice(deviceId, limit = 10) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM rounds WHERE device_id = ? ORDER BY planned_start_at DESC, id DESC LIMIT ?',
  ).all(deviceId, limit);
}

// 按区域查未关闭轮次（round_status != closed），联表带出设备信息
function findOpenByArea(area) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, d.device_code, d.device_name, d.area, d.risk_level
    FROM rounds r
    JOIN devices d ON d.id = r.device_id
    WHERE d.area = ? AND r.round_status != 'closed'
    ORDER BY r.planned_start_at ASC, r.id ASC
  `).all(area);
}

// 所有轮次联表设备信息（用于区域风险汇总的轮次口径统计）
function findAllWithDevice() {
  const db = getDb();
  return db.prepare(`
    SELECT r.id, r.round_status, r.planned_end_at,
           d.area, d.risk_level
    FROM rounds r
    JOIN devices d ON d.id = r.device_id
  `).all();
}

module.exports = { create, findById, updateStatus, findRecentByDevice, findOpenByArea, findAllWithDevice };
