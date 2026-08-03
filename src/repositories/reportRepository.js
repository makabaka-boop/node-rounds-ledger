class ReportRepository {
  constructor(db) {
    this.db = db;
  }

  areaRiskSummary() {
    return this.db.prepare(`
      SELECT
        d.area AS area,
        COUNT(DISTINCT d.id) AS device_count,
        SUM(CASE WHEN d.risk_level = 'critical' THEN 1 ELSE 0 END) AS critical_devices,
        SUM(CASE WHEN d.risk_level = 'high' THEN 1 ELSE 0 END) AS high_devices,
        SUM(CASE WHEN d.risk_level = 'medium' THEN 1 ELSE 0 END) AS medium_devices,
        SUM(CASE WHEN d.risk_level = 'low' THEN 1 ELSE 0 END) AS low_devices,
        (
          SELECT COUNT(*) FROM rounds r2
          WHERE r2.device_id IN (SELECT id FROM devices d2 WHERE d2.area = d.area)
            AND r2.round_status != 'closed'
        ) AS open_rounds,
        (
          SELECT COUNT(*) FROM anomaly_reviews ar
          JOIN round_results rr ON rr.id = ar.result_id
          JOIN rounds r3 ON r3.id = ar.round_id
          JOIN devices d3 ON d3.id = r3.device_id
          WHERE d3.area = d.area
            AND rr.result_value = 'fault'
            AND ar.review_status = 'pending'
        ) AS pending_faults,
        (
          SELECT COUNT(*) FROM anomaly_reviews ar
          JOIN round_results rr ON rr.id = ar.result_id
          JOIN rounds r4 ON r4.id = ar.round_id
          JOIN devices d4 ON d4.id = r4.device_id
          WHERE d4.area = d.area
            AND rr.result_value = 'attention'
            AND ar.review_status = 'pending'
        ) AS pending_attentions
      FROM devices d
      GROUP BY d.area
      ORDER BY d.area ASC
    `).all();
  }

  anomaliesByRiskLevel(risk_level) {
    return this.db.prepare(`
      SELECT
        ar.id AS review_id,
        ar.review_status,
        ar.reviewer_name,
        ar.review_note,
        ar.reviewed_at,
        ar.created_at AS review_created_at,
        rr.id AS result_id,
        rr.item_name,
        rr.result_value,
        rr.note AS result_note,
        rr.submitted_at,
        r.id AS round_id,
        r.round_status,
        d.id AS device_id,
        d.device_code,
        d.device_name,
        d.area,
        d.risk_level
      FROM anomaly_reviews ar
      JOIN round_results rr ON rr.id = ar.result_id
      JOIN rounds r ON r.id = ar.round_id
      JOIN devices d ON d.id = r.device_id
      WHERE d.risk_level = ? AND rr.result_value IN ('attention', 'fault')
      ORDER BY
        CASE rr.result_value WHEN 'fault' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END,
        ar.created_at DESC,
        ar.id DESC
    `).all(risk_level);
  }

  riskSummary(filters = {}) {
    const clauses = [];
    const params = [];
    if (filters.area) {
      clauses.push('d.area = ?');
      params.push(filters.area);
    }
    if (filters.risk_level) {
      clauses.push('d.risk_level = ?');
      params.push(filters.risk_level);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    return this.db.prepare(`
      SELECT
        d.area AS area,
        d.risk_level AS risk_level,
        COUNT(DISTINCT d.id) AS device_count,
        COUNT(DISTINCT CASE WHEN r.round_status != 'closed' THEN r.id END) AS unclosed_round_count,
        COUNT(DISTINCT CASE WHEN r.round_status = 'closed' THEN r.id END) AS closed_round_count,
        COUNT(DISTINCT CASE
          WHEN r.round_status != 'closed' AND r.planned_end_at IS NOT NULL
               AND datetime(r.planned_end_at) < datetime('now')
          THEN r.id END) AS overdue_round_count,
        COUNT(DISTINCT CASE WHEN rr.result_value IN ('attention', 'fault') THEN rr.id END) AS anomaly_result_count,
        COUNT(DISTINCT CASE WHEN ar.review_status = 'pending' THEN ar.id END) AS pending_review_count
      FROM devices d
      LEFT JOIN rounds r ON r.device_id = d.id
      LEFT JOIN round_results rr ON rr.round_id = r.id
      LEFT JOIN anomaly_reviews ar ON ar.result_id = rr.id
      ${where}
      GROUP BY d.area, d.risk_level
      ORDER BY d.area ASC,
        CASE d.risk_level
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END ASC
    `).all(...params);
  }
}

module.exports = ReportRepository;
