class DeviceRepository {
  constructor(db) {
    this.db = db;
  }

  create({ device_code, device_name, area, device_type, risk_level, maintenance_note = '' }) {
    const stmt = this.db.prepare(`
      INSERT INTO devices (device_code, device_name, area, device_type, risk_level, enabled, maintenance_note)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    const info = stmt.run(device_code, device_name, area, device_type, risk_level, maintenance_note || '');
    return this.findById(info.lastInsertRowid);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  }

  findByCode(device_code) {
    return this.db.prepare('SELECT * FROM devices WHERE device_code = ?').get(device_code);
  }

  setEnabled(id, enabled) {
    const stmt = this.db.prepare(`
      UPDATE devices SET enabled = ?, updated_at = datetime('now') WHERE id = ?
    `);
    stmt.run(enabled ? 1 : 0, id);
    return this.findById(id);
  }

  list({ area, device_type, enabled } = {}) {
    const clauses = [];
    const params = [];
    if (area) {
      clauses.push('area = ?');
      params.push(area);
    }
    if (device_type) {
      clauses.push('device_type = ?');
      params.push(device_type);
    }
    if (enabled !== undefined) {
      clauses.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM devices ${where} ORDER BY id ASC`).all(...params);
  }
}

module.exports = DeviceRepository;
