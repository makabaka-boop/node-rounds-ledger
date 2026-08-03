class AuditRepository {
  constructor(db) {
    this.db = db;
  }

  create({ event_type, entity_type, entity_id = null, operator_name = null, payload = {} }) {
    const payload_json = JSON.stringify(payload || {});
    const stmt = this.db.prepare(`
      INSERT INTO audit_events (event_type, entity_type, entity_id, operator_name, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(event_type, entity_type, entity_id, operator_name, payload_json);
    return this.findById(info.lastInsertRowid);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id);
  }

  list({ event_type, entity_type, entity_id, limit = 100, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (event_type) {
      clauses.push('event_type = ?');
      params.push(event_type);
    }
    if (entity_type) {
      clauses.push('entity_type = ?');
      params.push(entity_type);
    }
    if (entity_id !== undefined && entity_id !== null) {
      clauses.push('entity_id = ?');
      params.push(entity_id);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.min(parseInt(limit, 10) || 100, 500);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    return this.db.prepare(
      `SELECT * FROM audit_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...params, safeLimit, safeOffset);
  }
}

module.exports = AuditRepository;
