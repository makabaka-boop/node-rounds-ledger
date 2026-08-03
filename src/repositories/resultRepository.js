class ResultRepository {
  constructor(db) {
    this.db = db;
  }

  create({ round_id, item_name, result_value, note = '', submitted_at }) {
    const stmt = this.db.prepare(`
      INSERT INTO round_results (round_id, item_name, result_value, note, submitted_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(round_id, item_name, result_value, note || '', submitted_at || new Date().toISOString());
    return this.findById(info.lastInsertRowid);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM round_results WHERE id = ?').get(id);
  }

  findByRoundId(round_id) {
    return this.db.prepare('SELECT * FROM round_results WHERE round_id = ? ORDER BY id ASC').all(round_id);
  }

  deleteByRoundId(round_id) {
    this.db.prepare('DELETE FROM round_results WHERE round_id = ?').run(round_id);
  }
}

module.exports = ResultRepository;
