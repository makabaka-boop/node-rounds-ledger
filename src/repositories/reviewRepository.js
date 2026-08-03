function insertPending(db, roundId, resultId, now) {
  const info = db
    .prepare(
      `INSERT INTO reviews (round_id, result_id, review_status, created_at)
       VALUES (?, ?, 'pending', ?)`
    )
    .run(roundId, resultId, now);
  return info.lastInsertRowid;
}

function findById(db, id) {
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
}

function findByResultId(db, resultId) {
  return db.prepare('SELECT * FROM reviews WHERE result_id = ?').get(resultId);
}

function conclude(db, id, reviewStatus, reviewerName, reviewNote, reviewedAt) {
  db.prepare(
    `UPDATE reviews SET review_status = ?, reviewer_name = ?, review_note = ?, reviewed_at = ?
     WHERE id = ?`
  ).run(reviewStatus, reviewerName, reviewNote, reviewedAt, id);
}

// 结果从异常改为正常/跳过时，清理尚未复核的记录，避免误阻塞关闭
function deletePendingByResult(db, resultId) {
  db.prepare(
    `DELETE FROM reviews WHERE result_id = ? AND review_status = 'pending'`
  ).run(resultId);
}

module.exports = {
  insertPending,
  findById,
  findByResultId,
  conclude,
  deletePendingByResult,
};
