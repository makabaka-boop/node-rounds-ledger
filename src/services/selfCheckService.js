const { getDb } = require('../db/connection');

function buildCheck(checkName, issues) {
  return {
    check_name: checkName,
    passed: issues.length === 0,
    issue_count: issues.length,
    issues,
  };
}

function issue(entityType, entityId, message, extra = {}) {
  return { entity_type: entityType, entity_id: entityId, message, ...extra };
}

// 1. 轮次状态与结果记录是否匹配：
//    scheduled 不应有结果；submitted/closed 的结果数必须等于快照项目数
function checkRoundResultsMatch(db) {
  const rows = db
    .prepare(
      `SELECT r.id, r.round_status, s.items_json, COUNT(res.id) AS result_count
       FROM rounds r
       LEFT JOIN checklist_snapshots s ON s.id = r.checklist_snapshot_id
       LEFT JOIN results res ON res.round_id = r.id
       GROUP BY r.id`
    )
    .all();
  const issues = [];
  for (const row of rows) {
    let expected = null;
    try {
      const items = JSON.parse(row.items_json);
      if (Array.isArray(items)) expected = items.length;
    } catch {
      // 快照内容非法由 snapshot_items_not_json_array 检查报告
    }
    if (expected === null) continue;
    if (row.round_status === 'scheduled' && row.result_count > 0) {
      issues.push(
        issue('round', row.id, 'scheduled 状态轮次不应存在结果记录', {
          round_status: row.round_status,
          expected_count: 0,
          actual_count: row.result_count,
        })
      );
    }
    if (
      ['submitted', 'closed'].includes(row.round_status) &&
      row.result_count !== expected
    ) {
      issues.push(
        issue('round', row.id, '轮次结果数量与清单快照项目数不一致', {
          round_status: row.round_status,
          expected_count: expected,
          actual_count: row.result_count,
        })
      );
    }
  }
  return buildCheck('round_results_match', issues);
}

// 2. 存在 fault 但缺少复核记录
function checkFaultWithoutReview(db) {
  const rows = db
    .prepare(
      `SELECT res.id, res.round_id, res.item_name
       FROM results res
       LEFT JOIN reviews rv ON rv.result_id = res.id
       WHERE res.result_value = 'fault' AND rv.id IS NULL`
    )
    .all();
  return buildCheck(
    'fault_without_review',
    rows.map((r) =>
      issue('result', r.id, 'fault 结果缺少复核记录', {
        round_id: r.round_id,
        item_name: r.item_name,
      })
    )
  );
}

// 3. 已关闭轮次仍有待复核异常
function checkClosedRoundPendingReviews(db) {
  const rows = db
    .prepare(
      `SELECT r.id AS round_id, COUNT(rv.id) AS pending_count
       FROM rounds r
       JOIN reviews rv ON rv.round_id = r.id AND rv.review_status = 'pending'
       WHERE r.round_status = 'closed'
       GROUP BY r.id`
    )
    .all();
  return buildCheck(
    'closed_round_pending_reviews',
    rows.map((r) =>
      issue('round', r.round_id, '已关闭轮次仍存在待复核异常', {
        pending_count: r.pending_count,
      })
    )
  );
}

// 4. 轮次快照缺失
function checkRoundSnapshotMissing(db) {
  const rows = db
    .prepare(
      `SELECT r.id, r.checklist_snapshot_id
       FROM rounds r
       LEFT JOIN checklist_snapshots s ON s.id = r.checklist_snapshot_id
       WHERE s.id IS NULL`
    )
    .all();
  return buildCheck(
    'round_snapshot_missing',
    rows.map((r) =>
      issue('round', r.id, '轮次引用的清单快照不存在', {
        checklist_snapshot_id: r.checklist_snapshot_id,
      })
    )
  );
}

// 5. 设备停用后仍生成新轮次（轮次创建时间晚于设备最近停用时间）
function checkRoundsOnDisabledDevice(db) {
  const rows = db
    .prepare(
      `SELECT r.id, r.device_id, d.device_code, r.created_at AS round_created_at, d.updated_at AS device_disabled_at
       FROM rounds r
       JOIN devices d ON d.id = r.device_id
       WHERE d.enabled = 0 AND r.created_at > d.updated_at`
    )
    .all();
  return buildCheck(
    'rounds_on_disabled_device',
    rows.map((r) =>
      issue('round', r.id, '设备停用后仍生成了新轮次', {
        device_id: r.device_id,
        device_code: r.device_code,
        round_created_at: r.round_created_at,
        device_disabled_at: r.device_disabled_at,
      })
    )
  );
}

// 6. 清单快照中的 items 不是 JSON 数组
function checkSnapshotItemsValid(db) {
  const rows = db.prepare('SELECT id, checklist_name, version, items_json FROM checklist_snapshots').all();
  const issues = [];
  for (const row of rows) {
    let bad = false;
    try {
      const items = JSON.parse(row.items_json);
      bad =
        !Array.isArray(items) ||
        items.some((i) => !i || typeof i.item_name !== 'string');
    } catch {
      bad = true;
    }
    if (bad) {
      issues.push(
        issue('checklist_snapshot', row.id, '清单快照 items 不是合法的 JSON 数组', {
          checklist_name: row.checklist_name,
          version: row.version,
        })
      );
    }
  }
  return buildCheck('snapshot_items_not_json_array', issues);
}

// 7. 审计事件缺失：按轮次当前状态推导必须存在的审计事件
const REQUIRED_EVENTS_BY_STATUS = {
  scheduled: ['round.created'],
  in_progress: ['round.created', 'round.started'],
  submitted: ['round.created', 'round.started', 'round.submitted'],
  closed: ['round.created', 'round.started', 'round.submitted', 'round.closed'],
};

function checkAuditEventsMissing(db) {
  const rounds = db.prepare('SELECT id, round_status FROM rounds').all();
  const events = db
    .prepare(`SELECT entity_id, event_type FROM audit_events WHERE entity_type = 'round'`)
    .all();
  const eventSet = new Set(events.map((e) => `${e.entity_id}|${e.event_type}`));
  const issues = [];
  for (const round of rounds) {
    const required = REQUIRED_EVENTS_BY_STATUS[round.round_status] || [];
    const missing = required.filter((t) => !eventSet.has(`${round.id}|${t}`));
    if (missing.length > 0) {
      issues.push(
        issue('round', round.id, '轮次缺少与状态匹配的审计事件', {
          round_status: round.round_status,
          missing_events: missing,
        })
      );
    }
  }
  return buildCheck('audit_events_missing', issues);
}

// 数据自检：返回统一 JSON，按 checks 数组列出检查名称、通过状态、问题数量和明细
function runSelfCheck() {
  const db = getDb();
  const checks = [
    checkRoundResultsMatch(db),
    checkFaultWithoutReview(db),
    checkClosedRoundPendingReviews(db),
    checkRoundSnapshotMissing(db),
    checkRoundsOnDisabledDevice(db),
    checkSnapshotItemsValid(db),
    checkAuditEventsMissing(db),
  ];
  return {
    passed: checks.every((c) => c.passed),
    check_count: checks.length,
    checks,
  };
}

module.exports = { runSelfCheck };
