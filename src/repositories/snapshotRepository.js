function insert(db, snapshot, now) {
  const stmt = db.prepare(
    `INSERT INTO checklist_snapshots (checklist_id, checklist_name, device_type, version, cycle_days, items_json, created_at)
     VALUES (@checklist_id, @checklist_name, @device_type, @version, @cycle_days, @items_json, @now)`
  );
  const info = stmt.run({ ...snapshot, now });
  return info.lastInsertRowid;
}

function findById(db, id) {
  return db.prepare('SELECT * FROM checklist_snapshots WHERE id = ?').get(id);
}

module.exports = { insert, findById };
