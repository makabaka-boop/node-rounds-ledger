const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class ChecklistSnapshotDao {
  create(data) {
    const db = getDb();
    const id = uuidv4();
    const items = JSON.stringify(data.items || []);

    const stmt = db.prepare(`
      INSERT INTO checklist_snapshots (id, checklist_id, checklist_name, device_type, items, cycle_days, version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      data.checklist_id,
      data.checklist_name,
      data.device_type,
      items,
      data.cycle_days,
      data.version
    );
    return this.findById(id);
  }

  findById(id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM checklist_snapshots WHERE id = ?').get(id);
    if (row) {
      row.items = JSON.parse(row.items);
    }
    return row;
  }

  findByChecklistId(checklistId) {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM checklist_snapshots WHERE checklist_id = ? ORDER BY version DESC'
    ).all(checklistId);
    return rows.map(row => ({
      ...row,
      items: JSON.parse(row.items),
    }));
  }
}

module.exports = new ChecklistSnapshotDao();
