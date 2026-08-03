class SelfCheckService {
  constructor(selfCheckRepository) {
    this.repo = selfCheckRepository;
  }

  run() {
    const checks = [
      this._checkRoundStatusResultMatch(),
      this._checkFaultMissingReview(),
      this._checkClosedRoundsWithPendingReviews(),
      this._checkRoundsMissingSnapshot(),
      this._checkDisabledDevicesWithRounds(),
      this._checkSnapshotItemsJsonArray(),
      this._checkAuditEventsPresent(),
      this._checkClosedRoundsHaveClosedAt()
    ];

    const issues = checks.reduce((sum, check) => sum + check.issue_count, 0);
    return {
      generated_at: new Date().toISOString(),
      overall_passed: issues === 0,
      total_issues: issues,
      checks
    };
  }

  _build(name, passed, details) {
    return {
      check_name: name,
      passed,
      issue_count: details.length,
      details
    };
  }

  _checkRoundStatusResultMatch() {
    const name = 'round_status_result_match';
    const rows = this.repo.roundsWithStatusResultMismatch();
    const details = rows.map(row => ({
      round_id: row.round_id,
      round_status: row.round_status,
      result_count: row.result_count,
      message: row.round_status === 'in_progress'
        ? 'in_progress round already has results but is not submitted'
        : `${row.round_status} round has no result records`
    }));
    return this._build(name, details.length === 0, details);
  }

  _checkFaultMissingReview() {
    const name = 'fault_missing_review';
    const rows = this.repo.faultsMissingReview();
    const details = rows.map(row => ({
      result_id: row.result_id,
      round_id: row.round_id,
      item_name: row.item_name,
      result_value: row.result_value,
      message: 'fault result has no anomaly review record'
    }));
    return this._build(name, details.length === 0, details);
  }

  _checkClosedRoundsWithPendingReviews() {
    const name = 'closed_round_with_pending_review';
    const rows = this.repo.closedRoundsWithPendingReviews();
    const details = rows.map(row => ({
      round_id: row.round_id,
      pending_review_count: row.pending_review_count,
      message: 'closed round still has pending or confirmed anomaly reviews'
    }));
    return this._build(name, details.length === 0, details);
  }

  _checkRoundsMissingSnapshot() {
    const name = 'round_missing_snapshot';
    const rows = this.repo.roundsMissingSnapshot();
    const details = rows.map(row => ({
      round_id: row.round_id,
      checklist_snapshot_id: row.checklist_snapshot_id,
      message: 'round references a checklist snapshot that does not exist'
    }));
    return this._build(name, details.length === 0, details);
  }

  _checkDisabledDevicesWithRounds() {
    const name = 'disabled_device_with_new_round';
    const rows = this.repo.disabledDevicesWithRoundsAfterDisable();
    const details = rows.map(row => ({
      round_id: row.round_id,
      device_id: row.device_id,
      device_code: row.device_code,
      round_created_at: row.round_created_at,
      device_updated_at: row.device_updated_at,
      message: 'round was created after the device was disabled'
    }));
    return this._build(name, details.length === 0, details);
  }

  _checkSnapshotItemsJsonArray() {
    const name = 'snapshot_items_is_json_array';
    const rows = this.repo.snapshotsWithInvalidItemsJson();
    const details = [];
    for (const row of rows) {
      let parsed;
      let invalidReason = null;
      try {
        parsed = JSON.parse(row.items_json);
        if (!Array.isArray(parsed)) {
          invalidReason = 'items_json is not a JSON array';
        }
      } catch (err) {
        invalidReason = 'items_json is not valid JSON';
      }
      if (invalidReason) {
        details.push({
          snapshot_id: row.snapshot_id,
          checklist_id: row.checklist_id,
          version: row.version,
          message: invalidReason
        });
      }
    }
    return this._build(name, details.length === 0, details);
  }

  _checkAuditEventsPresent() {
    const name = 'audit_events_present';
    const rows = this.repo.auditEventSummary();
    const details = rows.map(row => {
      const missing = [];
      if (['in_progress', 'submitted', 'closed'].includes(row.round_status) && !row.has_started) {
        missing.push('round.started');
      }
      if (['submitted', 'closed'].includes(row.round_status) && !row.has_submitted) {
        missing.push('round.submitted');
      }
      if (row.round_status === 'closed' && !row.has_closed) {
        missing.push('round.closed');
      }
      return {
        round_id: row.round_id,
        round_status: row.round_status,
        missing_event_types: missing,
        message: `round #${row.round_id} is ${row.round_status} but missing audit events: ${missing.join(', ')}`
      };
    }).filter(d => d.missing_event_types.length > 0);
    return this._build(name, details.length === 0, details);
  }

  _checkClosedRoundsHaveClosedAt() {
    const name = 'closed_round_has_closed_at';
    const rows = this.repo.roundsWithClosedStatusButNoClosedAt();
    const details = rows.map(row => ({
      round_id: row.round_id,
      message: 'round status is closed but closed_at is missing'
    }));
    return this._build(name, details.length === 0, details);
  }
}

module.exports = SelfCheckService;
