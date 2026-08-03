'use strict';

const { getDb } = require('../db');

/**
 * 审计事件数据访问层。
 * 每个关键动作都写一条审计：actor / event_type / entity_type / entity_id / detail。
 */

function record({ actor, event_type, entity_type, entity_id, detail }) {
  const db = getDb();
  const ts = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO audit_events (actor, event_type, entity_type, entity_id, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    actor || 'system',
    event_type,
    entity_type,
    entity_id ?? null,
    detail ? JSON.stringify(detail) : null,
    ts,
  );
  return findById(Number(info.lastInsertRowid));
}

function rowToEvent(row) {
  if (!row) return null;
  return { ...row, detail: row.detail ? JSON.parse(row.detail) : null };
}

function findById(id) {
  const db = getDb();
  return rowToEvent(db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id));
}

// 支持按 entity_type / entity_id / event_type 过滤查询
function query({ entity_type, entity_id, event_type, limit = 100 } = {}) {
  const db = getDb();
  const clauses = [];
  const values = [];
  if (entity_type) { clauses.push('entity_type = ?'); values.push(entity_type); }
  if (entity_id !== undefined && entity_id !== null) { clauses.push('entity_id = ?'); values.push(entity_id); }
  if (event_type) { clauses.push('event_type = ?'); values.push(event_type); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);
  return db.prepare(`SELECT * FROM audit_events ${where} ORDER BY id DESC LIMIT ?`).all(...values).map(rowToEvent);
}

module.exports = { record, findById, query };
