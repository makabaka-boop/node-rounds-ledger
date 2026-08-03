const { getDb } = require('../db/connection');
const { ROUND_STATUS } = require('../constants');

class HealthCheckService {
  runAllChecks() {
    const checks = [
      this._checkRoundStatusResultConsistency(),
      this._checkFaultMissingReview(),
      this._checkClosedRoundHasPendingReviews(),
      this._checkMissingSnapshot(),
      this._checkRoundsForDisabledDevices(),
      this._checkSnapshotItemsValidJson(),
      this._checkMissingAuditEvents(),
    ];

    const totalIssues = checks.reduce((sum, c) => sum + c.issue_count, 0);
    const allPassed = checks.every(c => c.passed);

    return {
      overall_status: allPassed ? 'passed' : 'failed',
      total_checks: checks.length,
      total_issues: totalIssues,
      checked_at: new Date().toISOString(),
      checks,
    };
  }

  _checkRoundStatusResultConsistency() {
    const db = getDb();
    const issues = [];

    const roundsWithResultsButNotSubmitted = db.prepare(`
      SELECT r.id, r.round_status, COUNT(rr.id) as result_count
      FROM rounds r
      LEFT JOIN round_results rr ON rr.round_id = r.id
      WHERE r.round_status IN (?, ?)
      GROUP BY r.id
      HAVING result_count > 0
    `).all(ROUND_STATUS.SCHEDULED, ROUND_STATUS.IN_PROGRESS);

    roundsWithResultsButNotSubmitted.forEach(r => {
      issues.push({
        round_id: r.id,
        round_status: r.round_status,
        result_count: r.result_count,
        issue: `轮次状态为 ${r.round_status}，但已存在 ${r.result_count} 条结果记录`,
      });
    });

    const submittedWithoutResults = db.prepare(`
      SELECT r.id, r.round_status
      FROM rounds r
      LEFT JOIN round_results rr ON rr.round_id = r.id
      WHERE r.round_status IN (?, ?)
      GROUP BY r.id
      HAVING COUNT(rr.id) = 0
    `).all(ROUND_STATUS.SUBMITTED, ROUND_STATUS.CLOSED);

    submittedWithoutResults.forEach(r => {
      issues.push({
        round_id: r.id,
        round_status: r.round_status,
        issue: `轮次状态为 ${r.round_status}，但没有任何结果记录`,
      });
    });

    return this._formatCheck(
      'round_status_result_consistency',
      '轮次状态与结果记录一致性',
      issues
    );
  }

  _checkFaultMissingReview() {
    const db = getDb();
    const issues = [];

    const faultResultsWithoutReview = db.prepare(`
      SELECT rr.id as result_id, rr.round_id, rr.item_name, rr.result_value
      FROM round_results rr
      LEFT JOIN exception_reviews er ON er.result_id = rr.id
      WHERE rr.result_value IN ('fault', 'attention')
        AND er.id IS NULL
    `).all();

    faultResultsWithoutReview.forEach(r => {
      issues.push({
        result_id: r.result_id,
        round_id: r.round_id,
        item_name: r.item_name,
        result_value: r.result_value,
        issue: `${r.result_value} 类型结果缺少复核记录`,
      });
    });

    return this._formatCheck(
      'fault_missing_review',
      'fault/attention 结果缺少复核记录',
      issues
    );
  }

  _checkClosedRoundHasPendingReviews() {
    const db = getDb();
    const issues = [];

    const closedWithBlocking = db.prepare(`
      SELECT
        r.id as round_id,
        COUNT(er.id) as blocking_count,
        GROUP_CONCAT(er.review_status) as statuses
      FROM rounds r
      JOIN exception_reviews er ON er.round_id = r.id
      WHERE r.round_status = 'closed'
        AND er.review_status NOT IN ('ignored', 'resolved')
      GROUP BY r.id
    `).all();

    closedWithBlocking.forEach(r => {
      issues.push({
        round_id: r.round_id,
        blocking_count: r.blocking_count,
        blocking_statuses: r.statuses,
        issue: `已关闭轮次仍存在 ${r.blocking_count} 条未闭环复核记录（${r.statuses}）`,
      });
    });

    return this._formatCheck(
      'closed_round_pending_reviews',
      '已关闭轮次存在未闭环复核记录',
      issues
    );
  }

  _checkMissingSnapshot() {
    const db = getDb();
    const issues = [];

    const roundsMissingSnapshot = db.prepare(`
      SELECT r.id as round_id, r.checklist_snapshot_id
      FROM rounds r
      LEFT JOIN checklist_snapshots cs ON r.checklist_snapshot_id = cs.id
      WHERE cs.id IS NULL
    `).all();

    roundsMissingSnapshot.forEach(r => {
      issues.push({
        round_id: r.round_id,
        checklist_snapshot_id: r.checklist_snapshot_id,
        issue: '轮次引用的清单快照不存在',
      });
    });

    return this._formatCheck(
      'missing_snapshot',
      '轮次清单快照缺失',
      issues
    );
  }

  _checkRoundsForDisabledDevices() {
    const db = getDb();
    const issues = [];

    const roundsForDisabled = db.prepare(`
      SELECT r.id as round_id, r.round_status, r.created_at,
             d.id as device_id, d.device_code, d.device_name
      FROM rounds r
      JOIN devices d ON r.device_id = d.id
      WHERE d.enabled = 0
      ORDER BY r.created_at DESC
    `).all();

    roundsForDisabled.forEach(r => {
      issues.push({
        round_id: r.round_id,
        round_status: r.round_status,
        device_id: r.device_id,
        device_code: r.device_code,
        device_name: r.device_name,
        issue: `停用设备 ${r.device_code} 仍关联轮次（状态: ${r.round_status}），疑似停用后生成`,
      });
    });

    return this._formatCheck(
      'rounds_for_disabled_devices',
      '停用设备关联轮次检查',
      issues
    );
  }

  _checkSnapshotItemsValidJson() {
    const db = getDb();
    const issues = [];

    const snapshots = db.prepare(`
      SELECT id, checklist_id, items, version
      FROM checklist_snapshots
    `).all();

    snapshots.forEach(s => {
      let parsed;
      try {
        parsed = JSON.parse(s.items);
      } catch (e) {
        issues.push({
          snapshot_id: s.id,
          checklist_id: s.checklist_id,
          version: s.version,
          issue: `清单快照 items 不是合法 JSON: ${e.message}`,
        });
        return;
      }

      if (!Array.isArray(parsed)) {
        issues.push({
          snapshot_id: s.id,
          checklist_id: s.checklist_id,
          version: s.version,
          actual_type: typeof parsed,
          issue: `清单快照 items 解析后类型为 ${typeof parsed}，不是数组`,
        });
      } else if (parsed.length === 0) {
        issues.push({
          snapshot_id: s.id,
          checklist_id: s.checklist_id,
          version: s.version,
          issue: '清单快照 items 数组为空',
        });
      }
    });

    return this._formatCheck(
      'snapshot_items_valid_json',
      '清单快照 items JSON 数组合法性',
      issues
    );
  }

  _checkMissingAuditEvents() {
    const db = getDb();
    const issues = [];

    const roundsWithoutGenEvent = db.prepare(`
      SELECT r.id as round_id, r.created_at
      FROM rounds r
      LEFT JOIN audit_events ae
        ON ae.entity_type = 'round'
        AND ae.entity_id = r.id
        AND ae.event_type = 'round.generated'
      WHERE ae.id IS NULL
    `).all();

    roundsWithoutGenEvent.forEach(r => {
      issues.push({
        round_id: r.round_id,
        missing_event: 'round.generated',
        issue: `轮次 ${r.round_id} 缺少 round.generated 审计事件`,
      });
    });

    const closedWithoutCloseEvent = db.prepare(`
      SELECT r.id as round_id
      FROM rounds r
      LEFT JOIN audit_events ae
        ON ae.entity_type = 'round'
        AND ae.entity_id = r.id
        AND ae.event_type = 'round.closed'
      WHERE r.round_status = 'closed' AND ae.id IS NULL
    `).all();

    closedWithoutCloseEvent.forEach(r => {
      issues.push({
        round_id: r.round_id,
        missing_event: 'round.closed',
        issue: `已关闭轮次 ${r.round_id} 缺少 round.closed 审计事件`,
      });
    });

    const reviewsWithoutEvent = db.prepare(`
      SELECT er.id as review_id, er.round_id, er.review_status
      FROM exception_reviews er
      LEFT JOIN audit_events ae
        ON ae.entity_type = 'exception_review'
        AND ae.entity_id = er.id
        AND ae.event_type = 'exception.reviewed'
      WHERE er.review_status != 'pending' AND ae.id IS NULL
    `).all();

    reviewsWithoutEvent.forEach(r => {
      issues.push({
        review_id: r.review_id,
        round_id: r.round_id,
        missing_event: 'exception.reviewed',
        issue: `已复核记录 ${r.review_id}（${r.review_status}）缺少 exception.reviewed 审计事件`,
      });
    });

    const deactivatedDevicesWithoutEvent = db.prepare(`
      SELECT d.id as device_id, d.device_code
      FROM devices d
      LEFT JOIN audit_events ae
        ON ae.entity_type = 'device'
        AND ae.entity_id = d.id
        AND ae.event_type = 'device.deactivated'
      WHERE d.enabled = 0 AND ae.id IS NULL
    `).all();

    deactivatedDevicesWithoutEvent.forEach(r => {
      issues.push({
        device_id: r.device_id,
        device_code: r.device_code,
        missing_event: 'device.deactivated',
        issue: `停用设备 ${r.device_code} 缺少 device.deactivated 审计事件`,
      });
    });

    return this._formatCheck(
      'missing_audit_events',
      '关键操作审计事件完整性',
      issues
    );
  }

  _formatCheck(check_name, check_label, issues) {
    return {
      check_name,
      check_label,
      passed: issues.length === 0,
      issue_count: issues.length,
      details: issues,
    };
  }
}

module.exports = new HealthCheckService();
