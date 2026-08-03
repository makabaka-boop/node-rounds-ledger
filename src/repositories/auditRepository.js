function insert(db, event) {
  const info = db
    .prepare(
      `INSERT INTO audit_events (event_type, entity_type, entity_id, actor, detail, created_at)
       VALUES (@event_type, @entity_type, @entity_id, @actor, @detail, @created_at)`
    )
    .run(event);
  return info.lastInsertRowid;
}

function list(db, filters) {
  const where = [];
  const params = [];
  if (filters.event_type) {
    where.push('event_type = ?');
    params.push(filters.event_type);
  }
  if (filters.entity_type) {
    where.push('entity_type = ?');
    params.push(filters.entity_type);
  }
  if (filters.entity_id) {
    where.push('entity_id = ?');
    params.push(Number(filters.entity_id));
  }
  if (filters.from) {
    where.push('created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('created_at <= ?');
    params.push(filters.to);
  }
  const limit = Math.min(Number(filters.limit) || 100, 500);
  const sql = `SELECT * FROM audit_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT ?`;
  return db.prepare(sql).all(...params, limit);
}

module.exports = { insert, list };
