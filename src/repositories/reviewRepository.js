class ReviewRepository {
  constructor(db) {
    this.db = db;
  }

  create({ round_id, result_id, review_status = 'pending' }) {
    const stmt = this.db.prepare(`
      INSERT INTO anomaly_reviews (round_id, result_id, review_status)
      VALUES (?, ?, ?)
    `);
    const info = stmt.run(round_id, result_id, review_status);
    return this.findById(info.lastInsertRowid);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM anomaly_reviews WHERE id = ?').get(id);
  }

  findByResultId(result_id) {
    return this.db.prepare('SELECT * FROM anomaly_reviews WHERE result_id = ?').get(result_id);
  }

  findByRoundId(round_id) {
    return this.db.prepare('SELECT * FROM anomaly_reviews WHERE round_id = ? ORDER BY id ASC').all(round_id);
  }

  updateReview(id, { review_status, reviewer_name, review_note = '', reviewed_at }) {
    const stmt = this.db.prepare(`
      UPDATE anomaly_reviews
      SET review_status = ?, reviewer_name = ?, review_note = ?, reviewed_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(review_status, reviewer_name, review_note || '', reviewed_at, id);
    return this.findById(id);
  }

  countUnreviewedFaultsByRoundId(round_id) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM anomaly_reviews ar
      JOIN round_results rr ON rr.id = ar.result_id
      WHERE ar.round_id = ? AND rr.result_value = 'fault' AND ar.review_status = 'pending'
    `).get(round_id);
    return row.cnt;
  }

  countPendingByRoundId(round_id) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM anomaly_reviews
      WHERE round_id = ? AND review_status = 'pending'
    `).get(round_id);
    return row.cnt;
  }

  countBlockingByRoundId(round_id) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM anomaly_reviews
      WHERE round_id = ? AND review_status IN ('pending', 'confirmed')
    `).get(round_id);
    return row.cnt;
  }

  countByRoundId(round_id) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS cnt FROM anomaly_reviews
      WHERE round_id = ?
    `).get(round_id);
    return row.cnt;
  }

  findAnomaliesByRiskLevel(risk_level) {
    return this.db.prepare(`
      SELECT ar.*, rr.item_name, rr.result_value, rr.note AS result_note,
             d.id AS device_id, d.device_code, d.device_name, d.area, d.risk_level,
             r.round_status, r.id AS round_id
      FROM anomaly_reviews ar
      JOIN round_results rr ON rr.id = ar.result_id
      JOIN rounds r ON r.id = ar.round_id
      JOIN devices d ON d.id = r.device_id
      WHERE d.risk_level = ? AND rr.result_value IN ('attention', 'fault')
      ORDER BY ar.created_at DESC, ar.id DESC
    `).all(risk_level);
  }
}

module.exports = ReviewRepository;
