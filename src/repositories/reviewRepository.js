'use strict';

const { getDb } = require('../db');

/**
 * 异常复核数据访问层。
 */

function nowIso() {
  return new Date().toISOString();
}

function createPending(roundId, resultId) {
  const db = getDb();
  const ts = nowIso();
  const stmt = db.prepare(`
    INSERT INTO reviews (round_id, result_id, review_status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `);
  const info = stmt.run(roundId, resultId, ts, ts);
  return findById(Number(info.lastInsertRowid));
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) || null;
}

function findByRound(roundId) {
  const db = getDb();
  return db.prepare('SELECT * FROM reviews WHERE round_id = ? ORDER BY id').all(roundId);
}

function updateConclusion(id, { review_status, reviewer_name, review_note, reviewed_at }) {
  const db = getDb();
  db.prepare(`
    UPDATE reviews
    SET review_status = ?, reviewer_name = ?, review_note = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(review_status, reviewer_name, review_note ?? null, reviewed_at, nowIso(), id);
  return findById(id);
}

// 该轮次下所有异常结果与其复核状态的联合视图（用于关闭前置校验）
function findAnomalyViewByRound(roundId) {
  const db = getDb();
  return db.prepare(`
    SELECT rv.id AS review_id, rv.result_id, rv.review_status, rs.result_value, rs.item_name
    FROM reviews rv
    JOIN results rs ON rs.id = rv.result_id
    WHERE rv.round_id = ?
    ORDER BY rv.id
  `).all(roundId);
}

// 按风险等级查异常：联表 rounds/devices，可按 risk_level 过滤
function findAnomaliesByRisk(riskLevel) {
  const db = getDb();
  const base = `
    SELECT rv.id AS review_id, rv.review_status, rv.reviewer_name, rv.reviewed_at,
           rs.id AS result_id, rs.item_name, rs.result_value, rs.note, rs.submitted_at,
           r.id AS round_id, r.round_status,
           d.id AS device_id, d.device_code, d.device_name, d.area, d.risk_level
    FROM reviews rv
    JOIN results rs ON rs.id = rv.result_id
    JOIN rounds r ON r.id = rv.round_id
    JOIN devices d ON d.id = r.device_id
  `;
  if (riskLevel) {
    return db.prepare(`${base} WHERE d.risk_level = ? ORDER BY rv.id`).all(riskLevel);
  }
  return db.prepare(`${base} ORDER BY rv.id`).all();
}

// 待复核数量（pending）统计
function countPendingByRound(roundId) {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM reviews WHERE round_id = ? AND review_status = 'pending'",
  ).get(roundId);
  return row ? row.c : 0;
}

module.exports = {
  createPending,
  findById,
  findByRound,
  updateConclusion,
  findAnomalyViewByRound,
  findAnomaliesByRisk,
  countPendingByRound,
};
