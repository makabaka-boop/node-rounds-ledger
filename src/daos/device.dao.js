const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class DeviceDao {
  create(data) {
    const db = getDb();
    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO devices (id, device_code, device_name, area, device_type, risk_level, enabled, maintenance_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      data.device_code,
      data.device_name,
      data.area,
      data.device_type,
      data.risk_level,
      data.enabled === false ? 0 : 1,
      data.maintenance_note || ''
    );
    return this.findById(id);
  }

  findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  }

  findByCode(deviceCode) {
    const db = getDb();
    return db.prepare('SELECT * FROM devices WHERE device_code = ?').get(deviceCode);
  }

  findAll(filters = {}) {
    const db = getDb();
    let sql = 'SELECT * FROM devices WHERE 1=1';
    const params = [];

    if (filters.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(filters.enabled ? 1 : 0);
    }
    if (filters.area) {
      sql += ' AND area = ?';
      params.push(filters.area);
    }
    if (filters.device_type) {
      sql += ' AND device_type = ?';
      params.push(filters.device_type);
    }
    if (filters.risk_level) {
      sql += ' AND risk_level = ?';
      params.push(filters.risk_level);
    }

    sql += ' ORDER BY created_at DESC';
    return db.prepare(sql).all(...params);
  }

  update(id, data) {
    const db = getDb();
    const fields = [];
    const params = [];

    if (data.device_name !== undefined) {
      fields.push('device_name = ?');
      params.push(data.device_name);
    }
    if (data.area !== undefined) {
      fields.push('area = ?');
      params.push(data.area);
    }
    if (data.device_type !== undefined) {
      fields.push('device_type = ?');
      params.push(data.device_type);
    }
    if (data.risk_level !== undefined) {
      fields.push('risk_level = ?');
      params.push(data.risk_level);
    }
    if (data.enabled !== undefined) {
      fields.push('enabled = ?');
      params.push(data.enabled ? 1 : 0);
    }
    if (data.maintenance_note !== undefined) {
      fields.push('maintenance_note = ?');
      params.push(data.maintenance_note);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = datetime(\'now\')');
    params.push(id);

    db.prepare(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  setEnabled(id, enabled) {
    return this.update(id, { enabled });
  }
}

module.exports = new DeviceDao();
