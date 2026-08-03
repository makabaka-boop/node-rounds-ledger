const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class ChecklistDao {
  create(data) {
    const db = getDb();
    const id = uuidv4();
    const items = JSON.stringify(data.items || []);
    const version = data.version || 1;

    const stmt = db.prepare(`
      INSERT INTO checklists (id, checklist_name, device_type, items, cycle_days, version, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      data.checklist_name,
      data.device_type,
      items,
      data.cycle_days,
      version,
      data.enabled === false ? 0 : 1
    );
    return this.findById(id);
  }

  findById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM checklists WHERE id = ?').get(id);
    if (row) {
      row.items = JSON.parse(row.items);
      row.enabled = row.enabled === 1;
    }
    return row;
  }

  findByNameAndDeviceType(checklist_name, device_type) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM checklists WHERE checklist_name = ? AND device_type = ? ORDER BY version DESC LIMIT 1'
    ).get(checklist_name, device_type);
  }

  findAll(filters = {}) {
    const db = getDb();
    let sql = 'SELECT * FROM checklists WHERE 1=1';
    const params = [];

    if (filters.device_type) {
      sql += ' AND device_type = ?';
      params.push(filters.device_type);
    }
    if (filters.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(filters.enabled ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...params);
    return rows.map(row => ({
      ...row,
      items: JSON.parse(row.items),
      enabled: row.enabled === 1,
    }));
  }

  getMaxVersion(checklist_name, device_type) {
    const db = getDb();
    const row = db.prepare(
      'SELECT MAX(version) as max_version FROM checklists WHERE checklist_name = ? AND device_type = ?'
    ).get(checklist_name, device_type);
    return row ? row.max_version || 0 : 0;
  }

  update(id, data) {
    const db = getDb();
    const fields = [];
    const params = [];

    if (data.checklist_name !== undefined) {
      fields.push('checklist_name = ?');
      params.push(data.checklist_name);
    }
    if (data.items !== undefined) {
      fields.push('items = ?');
      params.push(JSON.stringify(data.items));
    }
    if (data.cycle_days !== undefined) {
      fields.push('cycle_days = ?');
      params.push(data.cycle_days);
    }
    if (data.enabled !== undefined) {
      fields.push('enabled = ?');
      params.push(data.enabled ? 1 : 0);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = datetime(\'now\')');
    params.push(id);

    db.prepare(`UPDATE checklists SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }
}

module.exports = new ChecklistDao();
