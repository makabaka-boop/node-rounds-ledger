const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class RoundDao {
  create(data) {
    const db = getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO rounds (
        id, device_id, checklist_id, checklist_snapshot_id,
        planned_start_at, planned_end_at, round_status, owner_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      data.device_id,
      data.checklist_id,
      data.checklist_snapshot_id,
      data.planned_start_at,
      data.planned_end_at || null,
      data.round_status || 'scheduled',
      data.owner_name
    );
    return this.findById(id);
  }

  findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  }

  findByDeviceId(deviceId, limit = 10) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM rounds WHERE device_id = ? ORDER BY planned_start_at DESC LIMIT ?'
    ).all(deviceId, limit);
  }

  findOpenByArea(area) {
    const db = getDb();
    return db.prepare(`
      SELECT r.*, d.device_code, d.device_name, d.risk_level,
        COUNT(er.id) as pending_review_count
      FROM rounds r
      JOIN devices d ON r.device_id = d.id
      LEFT JOIN exception_reviews er
        ON er.round_id = r.id AND er.review_status = 'pending'
      WHERE d.area = ? AND r.round_status != 'closed'
      GROUP BY r.id
      ORDER BY r.planned_start_at ASC
    `).all(area);
  }

  findAll(filters = {}) {
    const db = getDb();
    let sql = `
      SELECT r.*, d.device_code, d.device_name, d.area, d.device_type, d.risk_level
      FROM rounds r
      JOIN devices d ON r.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.device_id) {
      sql += ' AND r.device_id = ?';
      params.push(filters.device_id);
    }
    if (filters.round_status) {
      sql += ' AND r.round_status = ?';
      params.push(filters.round_status);
    }
    if (filters.owner_name) {
      sql += ' AND r.owner_name = ?';
      params.push(filters.owner_name);
    }

    sql += ' ORDER BY r.created_at DESC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(sql).all(...params);
  }

  updateStatus(id, round_status, extraFields = {}) {
    const db = getDb();
    const fields = ['round_status = ?', 'updated_at = datetime(\'now\')'];
    const params = [round_status];

    if (extraFields.started_at) {
      fields.push('started_at = ?');
      params.push(extraFields.started_at);
    }
    if (extraFields.submitted_at) {
      fields.push('submitted_at = ?');
      params.push(extraFields.submitted_at);
    }
    if (extraFields.closed_at) {
      fields.push('closed_at = ?');
      params.push(extraFields.closed_at);
    }

    params.push(id);
    db.prepare(`UPDATE rounds SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  hasOverlappingRound(device_id, planned_start_at, planned_end_at) {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM rounds
      WHERE device_id = ?
        AND round_status != 'closed'
        AND planned_start_at < ?
        AND (planned_end_at > ? OR planned_end_at IS NULL)
    `).get(device_id, planned_end_at || planned_start_at, planned_start_at);
    return row.count > 0;
  }
}

module.exports = new RoundDao();
