'use strict';

const reviewRepository = require('../repositories/reviewRepository');
const roundRepository = require('../repositories/roundRepository');
const { RISK_LEVELS } = require('../domain/enums');
const { requireEnum } = require('../domain/validators');

/**
 * 报表服务：按风险等级查异常、区域风险汇总。
 */

/** 按风险等级查异常（risk_level 可选，不传则返回全部） */
function anomaliesByRisk(riskLevel) {
  if (riskLevel !== undefined && riskLevel !== null && riskLevel !== '') {
    requireEnum(riskLevel, 'risk_level', RISK_LEVELS);
    return reviewRepository.findAnomaliesByRisk(riskLevel);
  }
  return reviewRepository.findAnomaliesByRisk(null);
}

/**
 * 区域风险汇总：按 area + risk_level 统计
 * - open_round_count      未关闭轮次数量（round_status != closed）
 * - anomaly_item_count    异常检查项数量（attention/fault 的结果项）
 * - pending_review_count  待复核异常数量（review_status = pending）
 * - overdue_round_count   逾期轮次数量（未关闭且当前时间 > planned_end_at）
 * - closed_round_count    已关闭轮次数量（round_status = closed）
 */
function riskSummary() {
  const rounds = roundRepository.findAllWithDevice();
  const anomalies = reviewRepository.findAnomaliesByRisk(null);

  const map = new Map(); // key: area||risk_level
  const keyOf = (area, risk) => `${area}||${risk}`;
  const now = Date.now();

  const ensure = (area, risk_level) => {
    const key = keyOf(area, risk_level);
    if (!map.has(key)) {
      map.set(key, {
        area,
        risk_level,
        open_round_count: 0,
        anomaly_item_count: 0,
        pending_review_count: 0,
        overdue_round_count: 0,
        closed_round_count: 0,
      });
    }
    return map.get(key);
  };

  // 轮次口径：未关闭 / 已关闭 / 逾期
  for (const r of rounds) {
    const bucket = ensure(r.area, r.risk_level);
    if (r.round_status === 'closed') {
      bucket.closed_round_count += 1;
    } else {
      bucket.open_round_count += 1;
      if (now > Date.parse(r.planned_end_at)) {
        bucket.overdue_round_count += 1;
      }
    }
  }

  // 异常口径：异常检查项数 / 待复核数
  for (const a of anomalies) {
    const bucket = ensure(a.area, a.risk_level);
    bucket.anomaly_item_count += 1;
    if (a.review_status === 'pending') bucket.pending_review_count += 1;
  }

  return Array.from(map.values()).sort(
    (x, y) => (x.area === y.area
      ? x.risk_level.localeCompare(y.risk_level)
      : x.area.localeCompare(y.area)),
  );
}

module.exports = { anomaliesByRisk, riskSummary };
