const { NotFoundError, ConflictError, ValidationError, StateTransitionError } = require('../errors/AppError');
const { RESULT_VALUES } = require('../constants');
const { requireFields, validateEnum, validateISODate } = require('../utils/validators');
const { assertTransition } = require('../stateMachine/roundStateMachine');

class RoundService {
  constructor(deps) {
    this.db = deps.db;
    this.deviceRepo = deps.deviceRepo;
    this.checklistRepo = deps.checklistRepo;
    this.roundRepo = deps.roundRepo;
    this.resultRepo = deps.resultRepo;
    this.reviewRepo = deps.reviewRepo;
    this.snapshotService = deps.snapshotService;
    this.auditService = deps.auditService;
  }

  generate(input, operator_name) {
    requireFields(input, ['device_id', 'planned_start_at', 'planned_end_at']);
    validateISODate(input.planned_start_at, 'planned_start_at');
    validateISODate(input.planned_end_at, 'planned_end_at');

    if (new Date(input.planned_end_at) < new Date(input.planned_start_at)) {
      throw new ValidationError('planned_end_at cannot be earlier than planned_start_at', {
        field: 'planned_end_at'
      });
    }

    const device = this.deviceRepo.findById(input.device_id);
    if (!device) {
      throw new NotFoundError('device', input.device_id);
    }
    if (!device.enabled) {
      throw new ConflictError('Cannot generate round for a disabled device', { device_id: device.id });
    }

    let checklist;
    if (input.checklist_id) {
      checklist = this.checklistRepo.findById(input.checklist_id);
      if (!checklist) {
        throw new NotFoundError('checklist', input.checklist_id);
      }
      if (checklist.device_type !== device.device_type) {
        throw new ConflictError('Checklist device_type does not match device device_type', {
          device_id: device.id,
          checklist_id: checklist.id,
          device_device_type: device.device_type,
          checklist_device_type: checklist.device_type
        });
      }
    } else {
      checklist = this.checklistRepo.findLatestEnabledByDeviceType(device.device_type);
      if (!checklist) {
        throw new NotFoundError('enabled checklist for device_type', device.device_type);
      }
    }

    if (!checklist.enabled) {
      throw new ConflictError('Cannot generate round from a disabled checklist', { checklist_id: checklist.id });
    }

    const tx = this.db.transaction(() => {
      const snapshot = this.snapshotService.createFromChecklist(checklist);
      const round = this.roundRepo.create({
        device_id: device.id,
        checklist_id: checklist.id,
        checklist_snapshot_id: snapshot.id,
        planned_start_at: input.planned_start_at,
        planned_end_at: input.planned_end_at,
        owner_name: input.owner_name || null,
        round_status: 'scheduled'
      });
      this.auditService.record('round.generated', 'round', round.id, operator_name, {
        device_id: device.id,
        checklist_id: checklist.id,
        checklist_snapshot_id: snapshot.id
      });
      return round;
    });

    const round = tx();
    return this.getDetail(round.id);
  }

  start(id, input = {}, operator_name) {
    const round = this.roundRepo.findById(id);
    if (!round) {
      throw new NotFoundError('round', id);
    }
    assertTransition(round.round_status, 'in_progress');

    const updated = this.roundRepo.updateStatus(id, 'in_progress', {
      started_at: new Date().toISOString(),
      owner_name: input.owner_name !== undefined ? input.owner_name : round.owner_name
    });
    this.auditService.record('round.started', 'round', id, operator_name, {
      action: 'start_round',
      operator_name: operator_name || null,
      entity_type: 'round',
      entity_id: id,
      description: `轮次 #${id} 已开始巡检，负责人：${(input.owner_name !== undefined ? input.owner_name : round.owner_name) || '未指派'}，操作人：${operator_name || '未知'}`
    });
    return this.getDetail(updated.id);
  }

  submitResults(id, input, operator_name) {
    requireFields(input, ['results']);
    if (!Array.isArray(input.results) || input.results.length === 0) {
      throw new ValidationError('results must be a non-empty array', { field: 'results' });
    }

    const round = this.roundRepo.findById(id);
    if (!round) {
      throw new NotFoundError('round', id);
    }

    if (round.round_status !== 'in_progress' && round.round_status !== 'submitted') {
      throw new StateTransitionError(
        `Results can only be submitted when round is in_progress or submitted, current status is ${round.round_status}`,
        { current_status: round.round_status }
      );
    }

    const snapshot = this._requireSnapshot(round);
    const items = this.snapshotService.parseItems(snapshot);
    const expectedItemNames = items.map(it => it.item_name);

    if (input.results.length !== expectedItemNames.length) {
      throw new ValidationError('Submission item count does not match checklist snapshot', {
        expected_item_count: expectedItemNames.length,
        received_item_count: input.results.length,
        expected_items: expectedItemNames
      });
    }

    const submittedItemNames = [];
    input.results.forEach((r, index) => {
      if (!r || typeof r !== 'object') {
        throw new ValidationError(`results[${index}] must be an object`, { field: `results[${index}]` });
      }
      if (!r.item_name) {
        throw new ValidationError(`results[${index}].item_name is required`, { field: `results[${index}].item_name` });
      }
      validateEnum(r.result_value, RESULT_VALUES, `results[${index}].result_value`);

      const expectedName = expectedItemNames[index];
      if (r.item_name !== expectedName) {
        throw new ValidationError(
          `results[${index}].item_name must be "${expectedName}" but received "${r.item_name}" (items must match snapshot order and name)`,
          {
            field: `results[${index}].item_name`,
            expected_item_name: expectedName,
            received_item_name: r.item_name,
            expected_items_in_order: expectedItemNames
          }
        );
      }
      submittedItemNames.push(r.item_name);
    });

    if (submittedItemNames.length !== new Set(submittedItemNames).size) {
      throw new ValidationError('Duplicate item_name in submission', {
        submitted_items: submittedItemNames
      });
    }

    const submittedAt = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.resultRepo.deleteByRoundId(id);

      const createdResults = [];
      let faultCount = 0;
      let attentionCount = 0;
      for (const r of input.results) {
        const result = this.resultRepo.create({
          round_id: id,
          item_name: r.item_name,
          result_value: r.result_value,
          note: r.note || '',
          submitted_at: submittedAt
        });
        createdResults.push(result);

        if (r.result_value === 'fault') {
          faultCount += 1;
        } else if (r.result_value === 'attention') {
          attentionCount += 1;
        }

        if (r.result_value === 'fault' || r.result_value === 'attention') {
          const existing = this.reviewRepo.findByResultId(result.id);
          if (!existing) {
            this.reviewRepo.create({
              round_id: id,
              result_id: result.id,
              review_status: 'pending'
            });
          }
        }
      }

      const updated = this.roundRepo.updateStatus(id, 'submitted', { submitted_at: submittedAt });
      this.auditService.record('round.submitted', 'round', id, operator_name, {
        action: 'submit_round_results',
        operator_name: operator_name || null,
        entity_type: 'round',
        entity_id: id,
        result_count: createdResults.length,
        fault_count: faultCount,
        attention_count: attentionCount,
        auto_generated_review_count: faultCount + attentionCount,
        description: `轮次 #${id} 提交 ${createdResults.length} 项巡检结果，其中 fault ${faultCount} 项、attention ${attentionCount} 项，已自动生成待复核异常，操作人：${operator_name || '未知'}`
      });
      return updated;
    });

    const updated = tx();
    return this.getDetail(updated.id);
  }

  close(id, operator_name) {
    const round = this.roundRepo.findById(id);
    if (!round) {
      throw new NotFoundError('round', id);
    }

    assertTransition(round.round_status, 'closed');

    const blockingReviews = this.reviewRepo.countBlockingByRoundId(id);
    if (blockingReviews > 0) {
      const pendingCount = this.reviewRepo.countPendingByRoundId(id);
      const confirmedCount = blockingReviews - pendingCount;
      throw new ConflictError(
        'Cannot close round until all anomaly reviews are ignored or resolved',
        {
          round_id: id,
          blocking_review_count: blockingReviews,
          pending_review_count: pendingCount,
          confirmed_review_count: confirmedCount
        }
      );
    }

    const updated = this.roundRepo.updateStatus(id, 'closed', { closed_at: new Date().toISOString() });
    this.auditService.record('round.closed', 'round', id, operator_name, {
      action: 'close_round',
      operator_name: operator_name || null,
      entity_type: 'round',
      entity_id: id,
      description: `轮次 #${id} 已关闭，操作人：${operator_name || '未知'}`
    });
    return this.getDetail(updated.id);
  }

  getDetail(id) {
    const round = this.roundRepo.findById(id);
    if (!round) {
      throw new NotFoundError('round', id);
    }
    const device = this.deviceRepo.findById(round.device_id);
    const checklist = this.checklistRepo.findById(round.checklist_id);
    const snapshot = this._requireSnapshot(round);
    const results = this.resultRepo.findByRoundId(id);
    const reviews = this.reviewRepo.findByRoundId(id);

    return {
      id: round.id,
      device_id: round.device_id,
      device: device ? this._serializeDevice(device) : null,
      checklist_id: round.checklist_id,
      checklist: checklist ? {
        id: checklist.id,
        checklist_name: checklist.checklist_name,
        device_type: checklist.device_type,
        version: checklist.version,
        cycle_days: checklist.cycle_days
      } : null,
      checklist_snapshot_id: round.checklist_snapshot_id,
      checklist_snapshot: {
        id: snapshot.id,
        checklist_id: snapshot.checklist_id,
        checklist_name: snapshot.checklist_name,
        device_type: snapshot.device_type,
        version: snapshot.version,
        cycle_days: snapshot.cycle_days,
        items: this.snapshotService.parseItems(snapshot),
        snapshot_at: snapshot.snapshot_at
      },
      planned_start_at: round.planned_start_at,
      planned_end_at: round.planned_end_at,
      round_status: round.round_status,
      owner_name: round.owner_name,
      started_at: round.started_at,
      submitted_at: round.submitted_at,
      closed_at: round.closed_at,
      created_at: round.created_at,
      updated_at: round.updated_at,
      results: results.map(r => this._serializeResult(r)),
      anomaly_reviews: reviews.map(r => this._serializeReview(r))
    };
  }

  listByDevice(device_id) {
    return this.roundRepo.listByDeviceId(device_id).map(r => ({
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
      updated_at: r.updated_at
    }));
  }

  getLatestForDevice(device_id) {
    const device = this.deviceRepo.findById(device_id);
    if (!device) {
      throw new NotFoundError('device', device_id);
    }
    const round = this.roundRepo.findLatestByDeviceId(device_id);
    if (!round) {
      return null;
    }
    return this.getDetail(round.id);
  }

  findUnclosedByArea(area, now = new Date()) {
    const rounds = this.roundRepo.findUnclosedByArea(area);
    return rounds.map(r => {
      const detail = this.getDetail(r.id);
      const pendingReviewCount = this.reviewRepo.countPendingByRoundId(r.id);
      const overdue = r.round_status !== 'closed' &&
        r.planned_end_at != null &&
        new Date(r.planned_end_at).getTime() < now.getTime();
      return {
        ...detail,
        pending_review_count: pendingReviewCount,
        overdue
      };
    });
  }

  _requireSnapshot(round) {
    const snapshot = this.db.prepare('SELECT * FROM checklist_snapshots WHERE id = ?').get(round.checklist_snapshot_id);
    if (!snapshot) {
      throw new ConflictError('Checklist snapshot missing for round', { round_id: round.id });
    }
    return snapshot;
  }

  _serializeDevice(device) {
    return {
      id: device.id,
      device_code: device.device_code,
      device_name: device.device_name,
      area: device.area,
      device_type: device.device_type,
      risk_level: device.risk_level,
      enabled: !!device.enabled,
      maintenance_note: device.maintenance_note || ''
    };
  }

  _serializeResult(result) {
    return {
      id: result.id,
      round_id: result.round_id,
      item_name: result.item_name,
      result_value: result.result_value,
      note: result.note || '',
      submitted_at: result.submitted_at
    };
  }

  _serializeReview(review) {
    return {
      id: review.id,
      round_id: review.round_id,
      result_id: review.result_id,
      review_status: review.review_status,
      reviewer_name: review.reviewer_name,
      review_note: review.review_note || '',
      reviewed_at: review.reviewed_at,
      created_at: review.created_at,
      updated_at: review.updated_at
    };
  }
}

module.exports = RoundService;
