class SelfCheckRepository {
  constructor(db) {
    this.db = db;
  }

  roundsWithStatusResultMismatch() {
    return this.db.prepare(`
      SELECT r.id AS round_id, r.round_status,
             COUNT(rr.id) AS result_count
      FROM rounds r
      LEFT JOIN round_results rr ON rr.round_id = r.id
      WHERE r.round_status = 'in_progress'
        AND rr.id IS NOT NULL
      GROUP BY r.id
      UNION ALL
      SELECT r.id AS round_id, r.round_status,
             COUNT(rr.id) AS result_count
      FROM rounds r
      LEFT JOIN round_results rr ON rr.round_id = r.id
      WHERE r.round_status IN ('submitted', 'closed')
        AND rr.id IS NULL
      GROUP BY r.id
      ORDER BY round_id
    `).all();
  }

  faultsMissingReview() {
    return this.db.prepare(`
      SELECT rr.id AS result_id, rr.round_id, rr.item_name, rr.result_value
      FROM round_results rr
      LEFT JOIN anomaly_reviews ar ON ar.result_id = rr.id
      WHERE rr.result_value = 'fault' AND ar.id IS NULL
      ORDER BY rr.round_id, rr.id
    `).all();
  }

  closedRoundsWithPendingReviews() {
    return this.db.prepare(`
      SELECT r.id AS round_id, r.round_status,
             COUNT(ar.id) AS pending_review_count
      FROM rounds r
      JOIN anomaly_reviews ar ON ar.round_id = r.id
      WHERE r.round_status = 'closed'
        AND ar.review_status IN ('pending', 'confirmed')
      GROUP BY r.id
      ORDER BY r.id
    `).all();
  }

  roundsMissingSnapshot() {
    return this.db.prepare(`
      SELECT r.id AS round_id, r.checklist_snapshot_id
      FROM rounds r
      LEFT JOIN checklist_snapshots cs ON cs.id = r.checklist_snapshot_id
      WHERE cs.id IS NULL
      ORDER BY r.id
    `).all();
  }

  disabledDevicesWithRoundsAfterDisable() {
    return this.db.prepare(`
      SELECT r.id AS round_id, r.device_id, r.created_at AS round_created_at,
             d.device_code, d.device_name, d.updated_at AS device_updated_at
      FROM rounds r
      JOIN devices d ON d.id = r.device_id
      WHERE d.enabled = 0
        AND datetime(r.created_at) > datetime(d.updated_at)
      ORDER BY r.id
    `).all();
  }

  snapshotsWithInvalidItemsJson() {
    return this.db.prepare(`
      SELECT id AS snapshot_id, checklist_id, version, items_json
      FROM checklist_snapshots
      ORDER BY id
    `).all();
  }

  auditEventSummary() {
    return this.db.prepare(`
      SELECT r.id AS round_id, r.round_status,
        SUM(CASE WHEN ae.event_type = 'round.started' THEN 1 ELSE 0 END) AS has_started,
        SUM(CASE WHEN ae.event_type = 'round.submitted' THEN 1 ELSE 0 END) AS has_submitted,
        SUM(CASE WHEN ae.event_type = 'round.closed' THEN 1 ELSE 0 END) AS has_closed
      FROM rounds r
      LEFT JOIN audit_events ae ON ae.entity_type = 'round' AND ae.entity_id = r.id
      GROUP BY r.id
      HAVING (r.round_status IN ('in_progress','submitted','closed') AND has_started = 0)
          OR (r.round_status IN ('submitted','closed') AND has_submitted = 0)
          OR (r.round_status = 'closed' AND has_closed = 0)
      ORDER BY r.id
    `).all();
  }

  roundsWithClosedStatusButNoClosedAt() {
    return this.db.prepare(`
      SELECT id AS round_id, round_status, closed_at
      FROM rounds
      WHERE round_status = 'closed' AND (closed_at IS NULL OR closed_at = '')
      ORDER BY id
    `).all();
  }
}

module.exports = SelfCheckRepository;
