'use strict';

const { getDb } = require('../db');

/**
 * 数据自检数据访问层：集中所有诊断类查询。
 * 每个方法返回"存在问题"的明细行数组，服务层据此组装 checks。
 */

// 1) 轮次状态与结果记录不匹配：
//    - submitted/closed 状态却没有任何结果记录
//    - scheduled 状态却已有结果记录
function roundStatusResultMismatch() {
  const db = getDb();
  return db.prepare(`
    SELECT r.id AS round_id, r.round_status, COUNT(rs.id) AS result_count
    FROM rounds r
    LEFT JOIN results rs ON rs.round_id = r.id
    GROUP BY r.id
    HAVING (r.round_status IN ('submitted','closed') AND result_count = 0)
        OR (r.round_status = 'scheduled' AND result_count > 0)
  `).all();
}

// 2) 存在 fault 但缺少复核记录
function faultMissingReview() {
  const db = getDb();
  return db.prepare(`
    SELECT rs.id AS result_id, rs.round_id, rs.item_name
    FROM results rs
    LEFT JOIN reviews rv ON rv.result_id = rs.id
    WHERE rs.result_value = 'fault' AND rv.id IS NULL
  `).all();
}

// 3) 已关闭轮次仍有待复核（pending）异常
function closedRoundPendingReview() {
  const db = getDb();
  return db.prepare(`
    SELECT rv.id AS review_id, rv.round_id, rv.result_id, rv.review_status
    FROM reviews rv
    JOIN rounds r ON r.id = rv.round_id
    WHERE r.round_status = 'closed' AND rv.review_status = 'pending'
  `).all();
}

// 4) 轮次快照缺失：checklist_snapshot_id 指向的快照不存在
function roundSnapshotMissing() {
  const db = getDb();
  return db.prepare(`
    SELECT r.id AS round_id, r.checklist_snapshot_id
    FROM rounds r
    LEFT JOIN checklist_snapshots s ON s.id = r.checklist_snapshot_id
    WHERE s.id IS NULL
  `).all();
}

// 5) 设备停用后仍生成新轮次：
//    设备当前已停用（enabled=0），且轮次创建时间不早于设备最近一次更新（停用）时间
function disabledDeviceNewRound() {
  const db = getDb();
  return db.prepare(`
    SELECT r.id AS round_id, r.device_id, r.created_at AS round_created_at,
           d.device_code, d.updated_at AS device_updated_at
    FROM rounds r
    JOIN devices d ON d.id = r.device_id
    WHERE d.enabled = 0 AND r.created_at >= d.updated_at
  `).all();
}

// 6) 清单快照中的 items 不是 JSON 数组（返回全部快照，由服务层解析判断）
function allSnapshots() {
  const db = getDb();
  return db.prepare('SELECT id, checklist_id, items_json FROM checklist_snapshots').all();
}

// 7) 审计事件缺失：已关闭轮次缺少 round_closed 审计事件
function closedRoundMissingAudit() {
  const db = getDb();
  return db.prepare(`
    SELECT r.id AS round_id
    FROM rounds r
    WHERE r.round_status = 'closed'
      AND NOT EXISTS (
        SELECT 1 FROM audit_events a
        WHERE a.entity_type = 'round' AND a.entity_id = r.id AND a.event_type = 'round_closed'
      )
  `).all();
}

module.exports = {
  roundStatusResultMismatch,
  faultMissingReview,
  closedRoundPendingReview,
  roundSnapshotMissing,
  disabledDeviceNewRound,
  allSnapshots,
  closedRoundMissingAudit,
};
