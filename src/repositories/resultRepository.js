'use strict';

const { getDb } = require('../db');

/**
 * 执行结果数据访问层。
 */

function insertMany(roundId, items) {
  const db = getDb();
  const ts = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO results (round_id, item_name, result_value, note, submitted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const inserted = [];
  for (const it of items) {
    const info = stmt.run(roundId, it.item_name, it.result_value, it.note ?? null, it.submitted_at, ts);
    inserted.push(findById(Number(info.lastInsertRowid)));
  }
  return inserted;
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM results WHERE id = ?').get(id) || null;
}

function findByRound(roundId) {
  const db = getDb();
  return db.prepare('SELECT * FROM results WHERE round_id = ? ORDER BY id').all(roundId);
}

function deleteByRound(roundId) {
  const db = getDb();
  db.prepare('DELETE FROM results WHERE round_id = ?').run(roundId);
}

module.exports = { insertMany, findById, findByRound, deleteByRound };
