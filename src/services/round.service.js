const {
  roundDao,
  roundResultDao,
  exceptionReviewDao,
  deviceDao,
  checklistDao,
} = require('../daos');
const {
  ROUND_STATUS,
  RESULT_VALUE,
  RESULT_VALUES,
} = require('../constants');
const {
  ValidationError,
  NotFoundError,
  BusinessRuleError,
} = require('../errors');
const { validateTransition, assertNotClosed } = require('../state-machine/round.state-machine');
const checklistService = require('./checklist.service');
const auditService = require('./audit.service');
const { getDb } = require('../db/connection');

class RoundService {
  generate(data, operator = '') {
    const errors = {};
    if (!data.device_id) errors.device_id = 'device_id 为必填项';
    if (!data.checklist_id) errors.checklist_id = 'checklist_id 为必填项';
    if (!data.planned_start_at) errors.planned_start_at = 'planned_start_at 为必填项';
    if (!data.owner_name) errors.owner_name = 'owner_name 为必填项';

    if (data.planned_start_at && isNaN(Date.parse(data.planned_start_at))) {
      errors.planned_start_at = 'planned_start_at 必须是有效的时间格式';
    }
    if (data.planned_end_at !== undefined && data.planned_end_at !== null) {
      if (isNaN(Date.parse(data.planned_end_at))) {
        errors.planned_end_at = 'planned_end_at 必须是有效的时间格式';
      } else if (
        data.planned_start_at &&
        !isNaN(Date.parse(data.planned_start_at)) &&
        new Date(data.planned_end_at) < new Date(data.planned_start_at)
      ) {
        errors.planned_end_at = 'planned_end_at 不能早于 planned_start_at';
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new ValidationError('生成轮次参数校验失败', errors);
    }

    const device = deviceDao.findById(data.device_id);
    if (!device) {
      throw new NotFoundError(`设备 ${data.device_id} 不存在`, {
        device_id: data.device_id,
      });
    }
    if (!device.enabled) {
      throw new BusinessRuleError('设备已停用，无法生成巡检轮次', {
        device_id: data.device_id,
      });
    }

    const checklist = checklistDao.findById(data.checklist_id);
    if (!checklist) {
      throw new NotFoundError(`清单 ${data.checklist_id} 不存在`, {
        checklist_id: data.checklist_id,
      });
    }
    if (!checklist.enabled) {
      throw new BusinessRuleError('清单已停用，无法生成巡检轮次', {
        checklist_id: data.checklist_id,
      });
    }

    if (device.device_type !== checklist.device_type) {
      throw new BusinessRuleError(
        `设备类型 ${device.device_type} 与清单适用类型 ${checklist.device_type} 不匹配`,
        {
          device_type: device.device_type,
          checklist_device_type: checklist.device_type,
        }
      );
    }

    const snapshot = checklistService.createSnapshot(data.checklist_id);

    const plannedEndAt = data.planned_end_at || this._calculateEndAt(
      data.planned_start_at,
      checklist.cycle_days
    );

    if (roundDao.hasOverlappingRound(data.device_id, data.planned_start_at, plannedEndAt)) {
      throw new BusinessRuleError('该设备在计划时间内已有未关闭的轮次', {
        device_id: data.device_id,
        planned_start_at: data.planned_start_at,
      });
    }

    const round = roundDao.create({
      device_id: data.device_id,
      checklist_id: data.checklist_id,
      checklist_snapshot_id: snapshot.id,
      planned_start_at: data.planned_start_at,
      planned_end_at: plannedEndAt,
      round_status: ROUND_STATUS.SCHEDULED,
      owner_name: data.owner_name,
    });

    auditService.log('round.generated', 'round', round.id, operator, {
      device_id: round.device_id,
      checklist_snapshot_id: snapshot.id,
      version: snapshot.version,
      planned_start_at: round.planned_start_at,
      planned_end_at: round.planned_end_at,
      owner_name: round.owner_name,
    }, `生成巡检轮次，设备ID=${round.device_id}，清单版本v${snapshot.version}，负责人=${round.owner_name}`);

    return this._formatRound(round, snapshot, device, checklist);
  }

  start(roundId, operator = '') {
    const round = this._getRoundOrThrow(roundId);
    assertNotClosed(round.round_status);
    validateTransition(round.round_status, ROUND_STATUS.IN_PROGRESS);

    const now = new Date().toISOString();
    const updated = roundDao.updateStatus(roundId, ROUND_STATUS.IN_PROGRESS, {
      started_at: now,
    });

    auditService.log('round.started', 'round', roundId, operator, {
      started_at: now,
    }, `开始巡检轮次 ${roundId}`);

    return this._formatRound(updated);
  }

  submitResults(roundId, results, operator = '') {
    const round = this._getRoundOrThrow(roundId);
    assertNotClosed(round.round_status);

    if (round.round_status !== ROUND_STATUS.IN_PROGRESS &&
        round.round_status !== ROUND_STATUS.SUBMITTED) {
      throw new BusinessRuleError(
        `只有进行中或已提交的轮次可以提交结果，当前状态: ${round.round_status}`,
        { current_status: round.round_status }
      );
    }

    if (!Array.isArray(results) || results.length === 0) {
      throw new ValidationError('结果列表不能为空', { results: '必须是非空数组' });
    }

    const snapshot = checklistService.getSnapshotById(round.checklist_snapshot_id);
    const snapshotItemNames = snapshot.items.map(item =>
      typeof item === 'string' ? item : item.name
    );

    const validationErrors = {};

    if (results.length !== snapshotItemNames.length) {
      validationErrors.results = `结果项数量(${results.length})与清单快照数量(${snapshotItemNames.length})不一致，必须完全匹配`;
    }

    results.forEach((r, idx) => {
      if (!r.item_name) {
        validationErrors[`results[${idx}].item_name`] = 'item_name 为必填项';
      }
      if (!RESULT_VALUES.includes(r.result_value)) {
        validationErrors[`results[${idx}].result_value`] =
          `result_value 必须是: ${RESULT_VALUES.join(', ')}`;
      }
      if (r.item_name && idx < snapshotItemNames.length) {
        if (r.item_name !== snapshotItemNames[idx]) {
          validationErrors[`results[${idx}].item_name`] =
            `第 ${idx + 1} 项应为 "${snapshotItemNames[idx]}"，实际收到 "${r.item_name}"，检查项顺序和名称必须与清单快照完全一致`;
        }
      } else if (r.item_name && idx >= snapshotItemNames.length) {
        validationErrors[`results[${idx}].item_name`] =
          `多余的检查项 "${r.item_name}"，不在清单快照中`;
      }
    });

    if (Object.keys(validationErrors).length > 0) {
      throw new ValidationError('结果校验失败：检查项数量、顺序和名称必须与清单快照完全一致', validationErrors);
    }

    const db = getDb();
    const executeTransaction = db.transaction(() => {
      if (round.round_status === ROUND_STATUS.SUBMITTED) {
        roundResultDao.deleteByRoundId(roundId);
      }

      const createdResults = [];
      for (const r of results) {
        const result = roundResultDao.create({
          round_id: roundId,
          item_name: r.item_name,
          result_value: r.result_value,
          note: r.note || '',
        });
        createdResults.push(result);

        if (r.result_value === RESULT_VALUE.FAULT ||
            r.result_value === RESULT_VALUE.ATTENTION) {
          const existingReview = exceptionReviewDao.findByResultId(result.id);
          if (!existingReview) {
            exceptionReviewDao.create({
              round_id: roundId,
              result_id: result.id,
              review_status: 'pending',
            });
          }
        }
      }

      const now = new Date().toISOString();
      roundDao.updateStatus(roundId, ROUND_STATUS.SUBMITTED, {
        submitted_at: now,
      });

      return createdResults;
    });

    const createdResults = executeTransaction();

    auditService.log('round.results_submitted', 'round', roundId, operator, {
      result_count: createdResults.length,
      fault_count: createdResults.filter(r => r.result_value === RESULT_VALUE.FAULT).length,
      attention_count: createdResults.filter(r => r.result_value === RESULT_VALUE.ATTENTION).length,
    }, `提交轮次 ${roundId} 巡检结果，共${createdResults.length}项，` +
      `故障${createdResults.filter(r => r.result_value === RESULT_VALUE.FAULT).length}项，` +
      `关注${createdResults.filter(r => r.result_value === RESULT_VALUE.ATTENTION).length}项`);

    return {
      round_id: roundId,
      round_status: ROUND_STATUS.SUBMITTED,
      results: createdResults,
    };
  }

  close(roundId, operator = '') {
    const round = this._getRoundOrThrow(roundId);

    if (round.round_status === ROUND_STATUS.CLOSED) {
      throw new BusinessRuleError('轮次已关闭', { round_id: roundId });
    }

    validateTransition(round.round_status, ROUND_STATUS.CLOSED);

    const blockingReviews = exceptionReviewDao.getBlockingReviews(roundId);
    if (blockingReviews.length > 0) {
      const pendingCount = blockingReviews.filter(r => r.review_status === 'pending').length;
      const confirmedCount = blockingReviews.filter(r => r.review_status === 'confirmed').length;
      const details = {
        round_id: roundId,
        blocking_count: blockingReviews.length,
        pending_count: pendingCount,
        confirmed_count: confirmedCount,
        blocking_items: blockingReviews.map(r => ({
          review_id: r.id,
          item_name: r.item_name,
          result_value: r.result_value,
          review_status: r.review_status,
        })),
      };
      throw new BusinessRuleError(
        '存在未闭环的异常（pending 或 confirmed），所有异常必须为 ignored 或 resolved 后才能关闭轮次',
        details
      );
    }

    const now = new Date().toISOString();
    const updated = roundDao.updateStatus(roundId, ROUND_STATUS.CLOSED, {
      closed_at: now,
    });

    auditService.log('round.closed', 'round', roundId, operator, {
      closed_at: now,
    }, `关闭巡检轮次 ${roundId}`);

    return this._formatRound(updated);
  }

  getById(roundId) {
    const round = this._getRoundOrThrow(roundId);
    const snapshot = checklistService.getSnapshotById(round.checklist_snapshot_id);
    const device = deviceDao.findById(round.device_id);
    const checklist = checklistDao.findById(round.checklist_id);
    return this._formatRound(round, snapshot, device, checklist);
  }

  _getRoundOrThrow(roundId) {
    const round = roundDao.findById(roundId);
    if (!round) {
      throw new NotFoundError(`轮次 ${roundId} 不存在`, { round_id: roundId });
    }
    return round;
  }

  _calculateEndAt(startAt, cycleDays) {
    const start = new Date(startAt);
    start.setDate(start.getDate() + cycleDays);
    return start.toISOString();
  }

  _formatRound(round, snapshot = null, device = null, checklist = null) {
    const formatted = {
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
    };

    if (snapshot) {
      formatted.snapshot = snapshot;
    }
    if (device) {
      formatted.device = {
        id: device.id,
        device_code: device.device_code,
        device_name: device.device_name,
        area: device.area,
        device_type: device.device_type,
        risk_level: device.risk_level,
      };
    }
    if (checklist) {
      formatted.checklist = {
        id: checklist.id,
        checklist_name: checklist.checklist_name,
        version: checklist.version,
      };
    }

    return formatted;
  }
}

module.exports = new RoundService();
