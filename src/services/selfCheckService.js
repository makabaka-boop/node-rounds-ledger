'use strict';

const selfCheckRepository = require('../repositories/selfCheckRepository');

/**
 * 数据自检服务：巡检链路一致性诊断。
 * 返回统一 JSON：{ passed, total_issues, checks: [{ name, passed, issue_count, details }] }
 */

// items_json 必须是 JSON 数组
function invalidSnapshotItems() {
  const rows = selfCheckRepository.allSnapshots();
  const bad = [];
  for (const row of rows) {
    let ok = false;
    try {
      ok = Array.isArray(JSON.parse(row.items_json));
    } catch {
      ok = false;
    }
    if (!ok) {
      bad.push({ snapshot_id: row.id, checklist_id: row.checklist_id, items_json: row.items_json });
    }
  }
  return bad;
}

function buildCheck(name, description, details) {
  return {
    name,
    description,
    passed: details.length === 0,
    issue_count: details.length,
    details,
  };
}

function run() {
  const checks = [
    buildCheck(
      'round_status_result_mismatch',
      '轮次状态与结果记录不匹配（已提交/关闭却无结果，或计划中却已有结果）',
      selfCheckRepository.roundStatusResultMismatch(),
    ),
    buildCheck(
      'fault_missing_review',
      '存在 fault 但缺少复核记录',
      selfCheckRepository.faultMissingReview(),
    ),
    buildCheck(
      'closed_round_pending_review',
      '已关闭轮次仍有待复核（pending）异常',
      selfCheckRepository.closedRoundPendingReview(),
    ),
    buildCheck(
      'round_snapshot_missing',
      '轮次快照缺失',
      selfCheckRepository.roundSnapshotMissing(),
    ),
    buildCheck(
      'disabled_device_new_round',
      '设备停用后仍生成新轮次',
      selfCheckRepository.disabledDeviceNewRound(),
    ),
    buildCheck(
      'snapshot_items_not_array',
      '清单快照中的 items 不是 JSON 数组',
      invalidSnapshotItems(),
    ),
    buildCheck(
      'audit_event_missing',
      '关键动作缺少审计事件（已关闭轮次缺 round_closed 审计）',
      selfCheckRepository.closedRoundMissingAudit(),
    ),
  ];

  const total_issues = checks.reduce((sum, c) => sum + c.issue_count, 0);
  return {
    passed: total_issues === 0,
    total_issues,
    checked_at: new Date().toISOString(),
    checks,
  };
}

module.exports = { run };
