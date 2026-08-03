const { getDb } = require('../db/connection');
const resultRepo = require('../repositories/resultRepository');
const { RISK_LEVELS } = require('../domain/constants');
const { assertEnum } = require('../utils/validate');

// 按风险等级查询异常结果（attention/fault），risk_level 为空时返回全部
function listAnomalies(riskLevel) {
  if (riskLevel !== undefined && riskLevel !== null && riskLevel !== '') {
    assertEnum(riskLevel, RISK_LEVELS, 'risk_level');
    return resultRepo.listAbnormalByRisk(getDb(), riskLevel);
  }
  return resultRepo.listAbnormalByRisk(getDb(), null);
}

// 区域风险汇总：设备数（按风险等级）、未关闭轮次、待复核异常/fault 数
function areaRiskSummary() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT d.area,
              COUNT(DISTINCT d.id) AS device_count,
              SUM(CASE WHEN d.risk_level = 'low' THEN 1 ELSE 0 END) AS low_devices,
              SUM(CASE WHEN d.risk_level = 'medium' THEN 1 ELSE 0 END) AS medium_devices,
              SUM(CASE WHEN d.risk_level = 'high' THEN 1 ELSE 0 END) AS high_devices,
              SUM(CASE WHEN d.risk_level = 'critical' THEN 1 ELSE 0 END) AS critical_devices,
              SUM(CASE WHEN r.id IS NOT NULL AND r.round_status != 'closed' THEN 1 ELSE 0 END) AS open_rounds
       FROM devices d
       LEFT JOIN rounds r ON r.device_id = d.id
       GROUP BY d.area
       ORDER BY d.area`
    )
    .all();

  const anomalyRows = db
    .prepare(
      `SELECT d.area,
              SUM(CASE WHEN rv.review_status = 'pending' THEN 1 ELSE 0 END) AS pending_anomalies,
              SUM(CASE WHEN rv.review_status = 'pending' AND res.result_value = 'fault' THEN 1 ELSE 0 END) AS pending_faults
       FROM results res
       JOIN rounds r ON r.id = res.round_id
       JOIN devices d ON d.id = r.device_id
       LEFT JOIN reviews rv ON rv.result_id = res.id
       WHERE res.result_value IN ('attention', 'fault')
       GROUP BY d.area`
    )
    .all();
  const anomalyMap = new Map(anomalyRows.map((r) => [r.area, r]));

  return rows.map((row) => {
    const a = anomalyMap.get(row.area) || {
      pending_anomalies: 0,
      pending_faults: 0,
    };
    return {
      area: row.area,
      device_count: row.device_count,
      risk_level_devices: {
        low: row.low_devices,
        medium: row.medium_devices,
        high: row.high_devices,
        critical: row.critical_devices,
      },
      open_rounds: row.open_rounds,
      pending_anomalies: a.pending_anomalies,
      pending_faults: a.pending_faults,
    };
  });
}

// 风险汇总：按 area + risk_level 分组统计
// 未关闭轮次、异常检查项数量、待复核异常数量、逾期轮次数量（实时计算）、已关闭轮次数量
function riskSummary(filters = {}) {
  const db = getDb();
  const conds = [];
  const params = [];
  if (filters.area) {
    conds.push('d.area = ?');
    params.push(filters.area);
  }
  if (filters.risk_level) {
    assertEnum(filters.risk_level, RISK_LEVELS, 'risk_level');
    conds.push('d.risk_level = ?');
    params.push(filters.risk_level);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const now = new Date().toISOString();

  const roundRows = db
    .prepare(
      `SELECT d.area, d.risk_level,
              SUM(CASE WHEN r.id IS NOT NULL AND r.round_status != 'closed' THEN 1 ELSE 0 END) AS open_rounds,
              SUM(CASE WHEN r.id IS NOT NULL AND r.round_status = 'closed' THEN 1 ELSE 0 END) AS closed_rounds,
              SUM(CASE WHEN r.id IS NOT NULL AND r.round_status != 'closed' AND r.planned_end_at < ? THEN 1 ELSE 0 END) AS overdue_rounds
       FROM devices d
       LEFT JOIN rounds r ON r.device_id = d.id
       ${where}
       GROUP BY d.area, d.risk_level
       ORDER BY d.area, d.risk_level`
    )
    .all(now, ...params);

  const anomalyRows = db
    .prepare(
      `SELECT d.area, d.risk_level,
              COUNT(res.id) AS abnormal_results,
              SUM(CASE WHEN rv.review_status = 'pending' THEN 1 ELSE 0 END) AS pending_reviews
       FROM results res
       JOIN rounds r ON r.id = res.round_id
       JOIN devices d ON d.id = r.device_id
       LEFT JOIN reviews rv ON rv.result_id = res.id
       WHERE res.result_value IN ('attention', 'fault')
       ${conds.length ? `AND ${conds.join(' AND ')}` : ''}
       GROUP BY d.area, d.risk_level`
    )
    .all(...params);
  const anomalyMap = new Map(
    anomalyRows.map((r) => [`${r.area}|${r.risk_level}`, r])
  );

  return roundRows.map((row) => {
    const a = anomalyMap.get(`${row.area}|${row.risk_level}`) || {
      abnormal_results: 0,
      pending_reviews: 0,
    };
    return {
      area: row.area,
      risk_level: row.risk_level,
      open_rounds: row.open_rounds,
      abnormal_results: a.abnormal_results,
      pending_reviews: a.pending_reviews,
      overdue_rounds: row.overdue_rounds,
      closed_rounds: row.closed_rounds,
    };
  });
}

module.exports = { listAnomalies, areaRiskSummary, riskSummary };
