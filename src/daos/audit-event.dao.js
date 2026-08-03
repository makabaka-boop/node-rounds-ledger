const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class AuditEventDao {
  create(data) {
    const db = getDb();
    const id = uuidv4();
    const event_data = JSON.stringify(data.event_data || {});

    const stmt = db.prepare(`
      INSERT INTO audit_events (id, event_type, entity_type, entity_id, operator_name, event_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      data.event_type,
      data.entity_type,
      data.entity_id || null,
      data.operator_name || '',
      event_data
    );
    return this.findById(id);
  }

  findById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id);
    if (row) {
      row.event_data = JSON.parse(row.event_data);
    }
    return row;
  }

  findAll(filters = {}) {
    const db = getDb();
    let sql = 'SELECT * FROM audit_events WHERE 1=1';
    const params = [];

    if (filters.event_type) {
      sql += ' AND event_type = ?';
      params.push(filters.event_type);
    }
    if (filters.entity_type) {
      sql += ' AND entity_type = ?';
      params.push(filters.entity_type);
    }
    if (filters.entity_id) {
      sql += ' AND entity_id = ?';
      params.push(filters.entity_id);
    }
    if (filters.operator_name) {
      sql += ' AND operator_name = ?';
      params.push(filters.operator_name);
    }
    if (filters.start_date) {
      sql += ' AND created_at >= ?';
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      sql += ' AND created_at <= ?';
      params.push(filters.end_date);
    }

    sql += ' ORDER BY created_at DESC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(row => ({
      ...row,
      event_data: JSON.parse(row.event_data),
    }));
  }
}

module.exports = new AuditEventDao();
