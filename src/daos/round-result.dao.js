const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class RoundResultDao {
  create(data) {
    const db = getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO round_results (id, round_id, item_name, result_value, note)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      data.round_id,
      data.item_name,
      data.result_value,
      data.note || ''
    );
    return this.findById(id);
  }

  findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM round_results WHERE id = ?').get(id);
  }

  findByRoundId(roundId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM round_results WHERE round_id = ? ORDER BY submitted_at ASC'
    ).all(roundId);
  }

  deleteByRoundId(roundId) {
    const db = getDb();
    db.prepare('DELETE FROM round_results WHERE round_id = ?').run(roundId);
  }

  findFaultsByRoundId(roundId) {
    const db = getDb();
    return db.prepare(
      `SELECT * FROM round_results WHERE round_id = ? AND result_value = 'fault'`
    ).all(roundId);
  }

  findByRiskLevel(riskLevel, limit = 50) {
    const db = getDb();
    return db.prepare(`
      SELECT rr.*, r.round_status, d.device_code, d.device_name, d.area, d.risk_level
      FROM round_results rr
      JOIN rounds r ON rr.round_id = r.id
      JOIN devices d ON r.device_id = d.id
      WHERE rr.result_value IN ('fault', 'attention')
        AND d.risk_level = ?
      ORDER BY rr.submitted_at DESC
      LIMIT ?
    `).all(riskLevel, limit);
  }
}

module.exports = new RoundResultDao();
