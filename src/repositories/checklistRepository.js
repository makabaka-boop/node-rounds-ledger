class ChecklistRepository {
  constructor(db) {
    this.db = db;
  }

  create({ checklist_name, device_type, items_json, cycle_days, version, enabled = 1, source_checklist_id = null }) {
    const stmt = this.db.prepare(`
      INSERT INTO checklists (checklist_name, device_type, items_json, cycle_days, version, enabled, source_checklist_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(checklist_name, device_type, items_json, cycle_days, version, enabled ? 1 : 0, source_checklist_id);
    return this.findById(info.lastInsertRowid);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM checklists WHERE id = ?').get(id);
  }

  setEnabled(id, enabled) {
    this.db.prepare(`
      UPDATE checklists SET enabled = ? WHERE id = ?
    `).run(enabled ? 1 : 0, id);
    return this.findById(id);
  }

  findLatestEnabledByDeviceType(device_type) {
    return this.db.prepare(`
      SELECT * FROM checklists
      WHERE device_type = ? AND enabled = 1
      ORDER BY version DESC, id DESC
      LIMIT 1
    `).get(device_type);
  }

  findLatestByNameAndDeviceType(checklist_name, device_type) {
    return this.db.prepare(`
      SELECT * FROM checklists
      WHERE checklist_name = ? AND device_type = ?
      ORDER BY version DESC, id DESC
      LIMIT 1
    `).get(checklist_name, device_type);
  }

  getMaxVersion(checklist_name, device_type) {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(version), 0) AS max_version
      FROM checklists WHERE checklist_name = ? AND device_type = ?
    `).get(checklist_name, device_type);
    return row.max_version;
  }

  list({ device_type, enabled } = {}) {
    const clauses = [];
    const params = [];
    if (device_type) {
      clauses.push('device_type = ?');
      params.push(device_type);
    }
    if (enabled !== undefined) {
      clauses.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM checklists ${where} ORDER BY device_type, checklist_name, version DESC`).all(...params);
  }
}

module.exports = ChecklistRepository;
