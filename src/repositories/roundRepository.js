function insert(db, round, now) {
  const stmt = db.prepare(
    `INSERT INTO rounds (device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, round_status, owner_name, created_at, updated_at)
     VALUES (@device_id, @checklist_id, @checklist_snapshot_id, @planned_start_at, @planned_end_at, @round_status, @owner_name, @now, @now)`
  );
  const info = stmt.run({ ...round, now });
  return info.lastInsertRowid;
}

function findById(db, id) {
  return db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
}

function updateStatus(db, id, status, now, closedAt = null) {
  db.prepare(
    'UPDATE rounds SET round_status = ?, updated_at = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?'
  ).run(status, now, closedAt, id);
}

function latestByDevice(db, deviceId) {
  return db
    .prepare('SELECT * FROM rounds WHERE device_id = ? ORDER BY id DESC LIMIT 1')
    .get(deviceId);
}

// 未关闭轮次（round_status != closed），可按区域过滤；附带该轮待复核异常数量
function listOpen(db, area) {
  const base = `SELECT r.*, d.device_code, d.device_name, d.area, d.risk_level,
                       (SELECT COUNT(*) FROM reviews rv
                        WHERE rv.round_id = r.id AND rv.review_status = 'pending') AS pending_review_count
                FROM rounds r JOIN devices d ON d.id = r.device_id
                WHERE r.round_status != 'closed'`;
  if (area) {
    return db.prepare(`${base} AND d.area = ? ORDER BY r.id DESC`).all(area);
  }
  return db.prepare(`${base} ORDER BY r.id DESC`).all();
}

module.exports = { insert, findById, updateStatus, latestByDevice, listOpen };
