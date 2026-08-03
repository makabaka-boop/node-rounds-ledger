class RoundRepository {
  constructor(db) {
    this.db = db;
  }

  create({ device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, owner_name = null, round_status = 'scheduled' }) {
    const stmt = this.db.prepare(`
      INSERT INTO rounds (device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, round_status, owner_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, round_status, owner_name);
    return this.findById(info.lastInsertRowid);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  }

  updateStatus(id, round_status, extra = {}) {
    const fields = ['round_status = ?', "updated_at = datetime('now')"];
    const params = [round_status];
    if (extra.started_at) {
      fields.push('started_at = ?');
      params.push(extra.started_at);
    }
    if (extra.submitted_at) {
      fields.push('submitted_at = ?');
      params.push(extra.submitted_at);
    }
    if (extra.closed_at) {
      fields.push('closed_at = ?');
      params.push(extra.closed_at);
    }
    if (extra.owner_name !== undefined) {
      fields.push('owner_name = ?');
      params.push(extra.owner_name);
    }
    params.push(id);
    this.db.prepare(`UPDATE rounds SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  findLatestByDeviceId(device_id) {
    return this.db.prepare(`
      SELECT * FROM rounds WHERE device_id = ?
      ORDER BY planned_start_at DESC, id DESC LIMIT 1
    `).get(device_id);
  }

  findUnclosedByArea(area) {
    return this.db.prepare(`
      SELECT r.* FROM rounds r
      JOIN devices d ON d.id = r.device_id
      WHERE d.area = ? AND r.round_status != 'closed'
      ORDER BY r.planned_start_at ASC, r.id ASC
    `).all(area);
  }

  listByDeviceId(device_id) {
    return this.db.prepare('SELECT * FROM rounds WHERE device_id = ? ORDER BY planned_start_at DESC, id DESC').all(device_id);
  }

  countActiveForDevice(device_id) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM rounds
      WHERE device_id = ? AND round_status IN ('scheduled', 'in_progress')
    `).get(device_id);
    return row.cnt;
  }
}

module.exports = RoundRepository;
