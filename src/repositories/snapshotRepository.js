class SnapshotRepository {
  constructor(db) {
    this.db = db;
  }

  create({ checklist_id, checklist_name, device_type, items_json, cycle_days, version }) {
    const stmt = this.db.prepare(`
      INSERT INTO checklist_snapshots (checklist_id, checklist_name, device_type, items_json, cycle_days, version)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(checklist_id, checklist_name, device_type, items_json, cycle_days, version);
    return this.findById(info.lastInsertRowid);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM checklist_snapshots WHERE id = ?').get(id);
  }
}

module.exports = SnapshotRepository;
