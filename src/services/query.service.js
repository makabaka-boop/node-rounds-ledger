const { getDb } = require('../db/connection');
const {
  roundDao,
  roundResultDao,
  exceptionReviewDao,
  deviceDao,
} = require('../daos');
const checklistService = require('./checklist.service');
const { NotFoundError } = require('../errors');

class QueryService {
  getRecentRoundsByDevice(deviceId, limit = 10) {
    const device = deviceDao.findById(deviceId);
    if (!device) {
      throw new NotFoundError(`设备 ${deviceId} 不存在`, { device_id: deviceId });
    }

    const rounds = roundDao.findByDeviceId(deviceId, limit);
    return rounds.map(r => this._formatRoundListItem(r));
  }

  getRoundDetails(roundId) {
    const round = roundDao.findById(roundId);
    if (!round) {
      throw new NotFoundError(`轮次 ${roundId} 不存在`, { round_id: roundId });
    }

    const snapshot = checklistService.getSnapshotById(round.checklist_snapshot_id);
    const device = deviceDao.findById(round.device_id);
    const results = roundResultDao.findByRoundId(roundId);
    const reviews = exceptionReviewDao.findByRoundId(roundId);

    const reviewMap = {};
    reviews.forEach(r => {
      reviewMap[r.result_id] = r;
    });

    const resultsWithReviews = results.map(r => ({
      ...r,
      review: reviewMap[r.id]
        ? {
            id: reviewMap[r.id].id,
            review_status: reviewMap[r.id].review_status,
            reviewer_name: reviewMap[r.id].reviewer_name,
            review_note: reviewMap[r.id].review_note,
            reviewed_at: reviewMap[r.id].reviewed_at,
          }
        : null,
    }));

    return {
      id: round.id,
      device_id: round.device_id,
      checklist_id: round.checklist_id,
      checklist_snapshot_id: round.checklist_snapshot_id,
      planned_start_at: round.planned_start_at,
      planned_end_at: round.planned_end_at,
      round_status: round.round_status,
      owner_name: round.owner_name,
      started_at: round.started_at,
      submitted_at: round.submitted_at,
      closed_at: round.closed_at,
      created_at: round.created_at,
      updated_at: round.updated_at,
      device: device
        ? {
            id: device.id,
            device_code: device.device_code,
            device_name: device.device_name,
            area: device.area,
            device_type: device.device_type,
            risk_level: device.risk_level,
          }
        : null,
      snapshot: {
        id: snapshot.id,
        checklist_name: snapshot.checklist_name,
        device_type: snapshot.device_type,
        items: snapshot.items,
        cycle_days: snapshot.cycle_days,
        version: snapshot.version,
      },
      results: resultsWithReviews,
    };
  }

  getOpenRoundsByArea(area) {
    const rounds = roundDao.findOpenByArea(area);
    const now = Date.now();
    return rounds.map(r => ({
      id: r.id,
      device_id: r.device_id,
      checklist_id: r.checklist_id,
      checklist_snapshot_id: r.checklist_snapshot_id,
      planned_start_at: r.planned_start_at,
      planned_end_at: r.planned_end_at,
      round_status: r.round_status,
      owner_name: r.owner_name,
      started_at: r.started_at,
      submitted_at: r.submitted_at,
      closed_at: r.closed_at,
      created_at: r.created_at,
      device_code: r.device_code,
      device_name: r.device_name,
      risk_level: r.risk_level,
      pending_review_count: r.pending_review_count || 0,
      overdue: this._isOverdue(r, now),
    }));
  }

  _isOverdue(round, now = Date.now()) {
    if (!round.planned_end_at) return false;
    if (round.round_status === 'closed') return false;
    return now > new Date(round.planned_end_at).getTime();
  }

  getExceptionsByRiskLevel(riskLevel, limit = 50) {
    return roundResultDao.findByRiskLevel(riskLevel, limit);
  }

  getAreaRiskSummary() {
    const db = getDb();
    const areas = db.prepare(`
      SELECT DISTINCT area FROM devices WHERE enabled = 1
    `).all();

    return areas.map(({ area }) => {
      const deviceStats = db.prepare(`
        SELECT
          COUNT(*) as total_devices,
          SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_count,
          SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_count,
          SUM(CASE WHEN risk_level = 'medium' THEN 1 ELSE 0 END) as medium_count,
          SUM(CASE WHEN risk_level = 'low' THEN 1 ELSE 0 END) as low_count
        FROM devices WHERE area = ? AND enabled = 1
      `).get(area);

      const roundStats = db.prepare(`
        SELECT
          COUNT(DISTINCT r.id) as open_rounds,
          SUM(CASE WHEN rr.result_value = 'fault' AND er.review_status = 'pending' THEN 1 ELSE 0 END) as pending_faults,
          SUM(CASE WHEN rr.result_value = 'attention' AND er.review_status = 'pending' THEN 1 ELSE 0 END) as pending_attentions
        FROM rounds r
        JOIN devices d ON r.device_id = d.id
        LEFT JOIN round_results rr ON rr.round_id = r.id
        LEFT JOIN exception_reviews er ON er.result_id = rr.id
        WHERE d.area = ? AND r.round_status != 'closed'
      `).get(area);

      return {
        area,
        total_devices: deviceStats.total_devices,
        risk_distribution: {
          critical: deviceStats.critical_count,
          high: deviceStats.high_count,
          medium: deviceStats.medium_count,
          low: deviceStats.low_count,
        },
        open_rounds: roundStats.open_rounds,
        pending_faults: roundStats.pending_faults,
        pending_attentions: roundStats.pending_attentions,
      };
    });
  }

  getRiskSummaryByAreaAndLevel() {
    const db = getDb();
    const now = new Date().toISOString();

    const rows = db.prepare(`
      SELECT
        d.area,
        d.risk_level,
        COUNT(DISTINCT CASE WHEN r.round_status != 'closed' THEN r.id END) as open_rounds_count,
        COUNT(DISTINCT CASE WHEN r.round_status = 'closed' THEN r.id END) as closed_rounds_count,
        COUNT(DISTINCT CASE WHEN r.round_status != 'closed' AND r.planned_end_at IS NOT NULL AND r.planned_end_at < ? THEN r.id END) as overdue_rounds_count,
        COUNT(CASE WHEN r.round_status != 'closed' AND rr.result_value IN ('fault', 'attention') THEN rr.id END) as exception_items_count,
        COUNT(CASE WHEN r.round_status != 'closed' AND er.review_status = 'pending' THEN er.id END) as pending_review_count
      FROM devices d
      LEFT JOIN rounds r ON r.device_id = d.id
      LEFT JOIN round_results rr ON rr.round_id = r.id
      LEFT JOIN exception_reviews er ON er.result_id = rr.id
      WHERE d.enabled = 1
      GROUP BY d.area, d.risk_level
      ORDER BY d.area,
        CASE d.risk_level
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END
    `).all(now);

    return rows.map(row => ({
      area: row.area,
      risk_level: row.risk_level,
      open_rounds_count: row.open_rounds_count || 0,
      closed_rounds_count: row.closed_rounds_count || 0,
      overdue_rounds_count: row.overdue_rounds_count || 0,
      exception_items_count: row.exception_items_count || 0,
      pending_review_count: row.pending_review_count || 0,
    }));
  }

  _formatRoundListItem(round) {
    return {
      id: round.id,
      device_id: round.device_id,
      checklist_id: round.checklist_id,
      checklist_snapshot_id: round.checklist_snapshot_id,
      planned_start_at: round.planned_start_at,
      planned_end_at: round.planned_end_at,
      round_status: round.round_status,
      owner_name: round.owner_name,
      started_at: round.started_at,
      submitted_at: round.submitted_at,
      closed_at: round.closed_at,
      created_at: round.created_at,
    };
  }
}

module.exports = new QueryService();
