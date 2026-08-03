function insert(db, checklist, now) {
  const stmt = db.prepare(
    `INSERT INTO checklists (checklist_name, device_type, items, cycle_days, version, enabled, created_at, updated_at)
     VALUES (@checklist_name, @device_type, @items, @cycle_days, @version, @enabled, @now, @now)`
  );
  const info = stmt.run({ ...checklist, now });
  return info.lastInsertRowid;
}

function findById(db, id) {
  return db.prepare('SELECT * FROM checklists WHERE id = ?').get(id);
}

function findByNameVersion(db, name, version) {
  return db
    .prepare('SELECT * FROM checklists WHERE checklist_name = ? AND version = ?')
    .get(name, version);
}

module.exports = { insert, findById, findByNameVersion };
