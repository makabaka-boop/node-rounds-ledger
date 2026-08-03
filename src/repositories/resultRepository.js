function insert(db, result) {
  const stmt = db.prepare(
    `INSERT INTO results (round_id, item_name, result_value, note, submitted_at)
     VALUES (@round_id, @item_name, @result_value, @note, @submitted_at)`
  );
  const info = stmt.run(result);
  return info.lastInsertRowid;
}

function update(db, id, resultValue, note, submittedAt) {
  db.prepare(
    'UPDATE results SET result_value = ?, note = ?, submitted_at = ? WHERE id = ?'
  ).run(resultValue, note, submittedAt, id);
}

function findById(db, id) {
  return db.prepare('SELECT * FROM results WHERE id = ?').get(id);
}

function findByRoundAndItem(db, roundId, itemName) {
  return db
    .prepare('SELECT * FROM results WHERE round_id = ? AND item_name = ?')
    .get(roundId, itemName);
}

function listByRound(db, roundId) {
  return db
    .prepare('SELECT * FROM results WHERE round_id = ? ORDER BY id ASC')
    .all(roundId);
}

// 按设备风险等级查询异常结果（attention/fault），附带轮次、设备与复核信息
function listAbnormalByRisk(db, riskLevel) {
  const base = `SELECT res.id AS result_id, res.round_id, res.item_name, res.result_value, res.note, res.submitted_at,
                       d.id AS device_id, d.device_code, d.device_name, d.area, d.risk_level,
                       rv.id AS review_id, rv.review_status, rv.reviewer_name, rv.reviewed_at
                FROM results res
                JOIN rounds r ON r.id = res.round_id
                JOIN devices d ON d.id = r.device_id
                LEFT JOIN reviews rv ON rv.result_id = res.id
                WHERE res.result_value IN ('attention', 'fault')`;
  if (riskLevel) {
    return db.prepare(`${base} AND d.risk_level = ? ORDER BY res.id DESC`).all(riskLevel);
  }
  return db.prepare(`${base} ORDER BY res.id DESC`).all();
}

module.exports = {
  insert,
  update,
  findById,
  findByRoundAndItem,
  listByRound,
  listAbnormalByRisk,
};
