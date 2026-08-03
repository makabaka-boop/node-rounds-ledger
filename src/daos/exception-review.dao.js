const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/connection');

class ExceptionReviewDao {
  create(data) {
    const db = getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO exception_reviews (id, round_id, result_id, review_status, reviewer_name, review_note, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      data.round_id,
      data.result_id,
      data.review_status || 'pending',
      data.reviewer_name || '',
      data.review_note || '',
      data.reviewed_at || null
    );
    return this.findById(id);
  }

  findById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM exception_reviews WHERE id = ?').get(id);
  }

  findByResultId(resultId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM exception_reviews WHERE result_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(resultId);
  }

  findByRoundId(roundId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM exception_reviews WHERE round_id = ? ORDER BY created_at ASC'
    ).all(roundId);
  }

  findPendingByRoundId(roundId) {
    const db = getDb();
    return db.prepare(
      `SELECT * FROM exception_reviews WHERE round_id = ? AND review_status = 'pending'`
    ).all(roundId);
  }

  hasPendingFaultReviews(roundId) {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM exception_reviews er
      JOIN round_results rr ON er.result_id = rr.id
      WHERE er.round_id = ?
        AND rr.result_value = 'fault'
        AND er.review_status = 'pending'
    `).get(roundId);
    return row.count > 0;
  }

  hasBlockingReviews(roundId) {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM exception_reviews er
      WHERE er.round_id = ?
        AND er.review_status NOT IN ('ignored', 'resolved')
    `).get(roundId);
    return row.count > 0;
  }

  getBlockingReviews(roundId) {
    const db = getDb();
    return db.prepare(`
      SELECT er.*, rr.item_name, rr.result_value
      FROM exception_reviews er
      JOIN round_results rr ON er.result_id = rr.id
      WHERE er.round_id = ?
        AND er.review_status NOT IN ('ignored', 'resolved')
      ORDER BY er.created_at ASC
    `).all(roundId);
  }

  update(id, data) {
    const db = getDb();
    const fields = [];
    const params = [];

    if (data.review_status !== undefined) {
      fields.push('review_status = ?');
      params.push(data.review_status);
    }
    if (data.reviewer_name !== undefined) {
      fields.push('reviewer_name = ?');
      params.push(data.reviewer_name);
    }
    if (data.review_note !== undefined) {
      fields.push('review_note = ?');
      params.push(data.review_note);
    }
    if (data.reviewed_at !== undefined) {
      fields.push('reviewed_at = ?');
      params.push(data.reviewed_at);
    }

    fields.push('updated_at = datetime(\'now\')');
    params.push(id);

    db.prepare(`UPDATE exception_reviews SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }
}

module.exports = new ExceptionReviewDao();
