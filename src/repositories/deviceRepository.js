function insert(db, device, now) {
  const stmt = db.prepare(
    `INSERT INTO devices (device_code, device_name, area, device_type, risk_level, enabled, maintenance_note, created_at, updated_at)
     VALUES (@device_code, @device_name, @area, @device_type, @risk_level, @enabled, @maintenance_note, @now, @now)`
  );
  const info = stmt.run({ ...device, now });
  return info.lastInsertRowid;
}

function findById(db, id) {
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
}

function findByCode(db, deviceCode) {
  return db.prepare('SELECT * FROM devices WHERE device_code = ?').get(deviceCode);
}

function setEnabled(db, id, enabled, now) {
  db.prepare('UPDATE devices SET enabled = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    now,
    id
  );
}

module.exports = { insert, findById, findByCode, setEnabled };
