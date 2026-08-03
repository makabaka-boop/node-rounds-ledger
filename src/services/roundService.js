const { getDb } = require('../db/connection');
const deviceRepo = require('../repositories/deviceRepository');
const checklistRepo = require('../repositories/checklistRepository');
const snapshotRepo = require('../repositories/snapshotRepository');
const roundRepo = require('../repositories/roundRepository');
const resultRepo = require('../repositories/resultRepository');
const reviewRepo = require('../repositories/reviewRepository');
const auditRepo = require('../repositories/auditRepository');
const { buildSnapshot, snapshotItemNames } = require('../domain/snapshot');
const { assertTransition } = require('../domain/roundStateMachine');
const { isAbnormal, assertAllAnomaliesConcluded } = require('../domain/reviewPolicy');
const { RESULT_VALUES } = require('../domain/constants');
const {
  notFound,
  conflict,
  validationError,
  unresolvedAnomalies,
} = require('../utils/errors');
const {
  requireBody,
  requireFields,
  assertEnum,
  assertIsoDate,
  assertString,
  nowIso,
} = require('../utils/validate');

function recordAudit(db, eventType, entityId, actor, detail, now) {
  auditRepo.insert(db, {
    event_type: eventType,
    entity_type: 'round',
    entity_id: entityId,
    actor: actor ?? null,
    detail: JSON.stringify(detail ?? {}),
    created_at: now,
  });
}

// 生成计划轮次：保存清单版本 + items JSON 快照，后续清单变更不影响本轮校验
function generateRound(body) {
  requireBody(body);
  requireFields(body, ['device_id', 'checklist_id', 'planned_start_at', 'owner_name']);
  assertIsoDate(body.planned_start_at, 'planned_start_at');
  assertString(body.owner_name, 'owner_name');
  if (body.planned_end_at !== undefined) {
    assertIsoDate(body.planned_end_at, 'planned_end_at');
  }

  const db = getDb();
  const device = deviceRepo.findById(db, Number(body.device_id));
  if (!device) {
    throw notFound(`设备不存在: ${body.device_id}`, { device_id: body.device_id });
  }
  if (!device.enabled) {
    throw conflict(`设备已停用，不能生成轮次: ${device.device_code}`, {
      device_id: device.id,
    });
  }
  const checklist = checklistRepo.findById(db, Number(body.checklist_id));
  if (!checklist) {
    throw notFound(`清单不存在: ${body.checklist_id}`, {
      checklist_id: body.checklist_id,
    });
  }
  if (!checklist.enabled) {
    throw conflict(`清单已停用: ${checklist.checklist_name} v${checklist.version}`, {
      checklist_id: checklist.id,
    });
  }
  if (device.device_type !== checklist.device_type) {
    throw validationError('设备类型与清单类型不匹配', {
      device_type: device.device_type,
      checklist_device_type: checklist.device_type,
    });
  }

  const startAt = new Date(body.planned_start_at);
  const endAt = body.planned_end_at
    ? new Date(body.planned_end_at)
    : new Date(startAt.getTime() + checklist.cycle_days * 24 * 3600 * 1000);
  if (endAt < startAt) {
    throw validationError('planned_end_at 不能早于 planned_start_at', {
      planned_start_at: body.planned_start_at,
      planned_end_at: body.planned_end_at ?? endAt.toISOString(),
    });
  }

  const now = nowIso();
  const snapshot = buildSnapshot(checklist);
  const tx = db.transaction(() => {
    const snapshotId = snapshotRepo.insert(db, snapshot, now);
    const roundId = roundRepo.insert(
      db,
      {
        device_id: device.id,
        checklist_id: checklist.id,
        checklist_snapshot_id: snapshotId,
        planned_start_at: startAt.toISOString(),
        planned_end_at: endAt.toISOString(),
        round_status: 'scheduled',
        owner_name: body.owner_name,
      },
      now
    );
    recordAudit(db, 'round.created', roundId, body.owner_name, {
      device_id: device.id,
      checklist_id: checklist.id,
      checklist_version: checklist.version,
      checklist_snapshot_id: snapshotId,
    }, now);
    return roundId;
  });
  return getRoundDetail(tx());
}

function mustGetRound(db, id) {
  const round = roundRepo.findById(db, id);
  if (!round) {
    throw notFound(`轮次不存在: ${id}`, { round_id: id });
  }
  return round;
}

function startRound(id, body) {
  const db = getDb();
  const round = mustGetRound(db, id);
  assertTransition(round.round_status, 'in_progress');
  const now = nowIso();
  const operator = body?.operator_name ?? null;
  const tx = db.transaction(() => {
    roundRepo.updateStatus(db, id, 'in_progress', now);
    recordAudit(db, 'round.started', id, operator, {
      description: `开始巡检轮次 #${id}（设备 #${round.device_id}）`,
    }, now);
  });
  tx();
  return getRoundDetail(id);
}

// 提交执行结果：数量、顺序、名称必须与轮次清单快照完全一致，
// 不多传、不少传、不改名；attention/fault 自动生成待复核记录，提交成功即进入 submitted
function submitResults(id, body) {
  requireBody(body);
  requireFields(body, ['results']);
  if (!Array.isArray(body.results) || body.results.length === 0) {
    throw validationError('字段 results 必须是非空数组', { field: 'results' });
  }

  const db = getDb();
  const round = mustGetRound(db, id);
  if (round.round_status !== 'in_progress') {
    assertTransition(round.round_status, 'submitted'); // 抛出标准非法流转错误
  }
  const snapshot = snapshotRepo.findById(db, round.checklist_snapshot_id);
  const expectedItems = snapshotItemNames(snapshot); // 快照中的有序项目名

  const items = body.results.map((r, idx) => {
    if (r === null || typeof r !== 'object') {
      throw validationError(`results[${idx}] 必须是对象`, { index: idx });
    }
    requireFields(r, ['item_name', 'result_value']);
    assertEnum(r.result_value, RESULT_VALUES, 'result_value');
    return {
      item_name: r.item_name,
      result_value: r.result_value,
      note: r.note ?? null,
    };
  });

  // 数量一致：不能多传、少传
  if (items.length !== expectedItems.length) {
    throw validationError('结果项数量与清单快照不一致', {
      expected_count: expectedItems.length,
      received_count: items.length,
      expected_items: expectedItems,
    });
  }
  // 顺序与名称一致：不能乱序、改名
  for (let i = 0; i < expectedItems.length; i++) {
    if (items[i].item_name !== expectedItems[i]) {
      throw validationError('结果项名称或顺序与清单快照不一致', {
        index: i,
        expected_item: expectedItems[i],
        received_item: items[i].item_name,
        expected_items: expectedItems,
      });
    }
  }

  const now = nowIso();
  const tx = db.transaction(() => {
    for (const item of items) {
      const existing = resultRepo.findByRoundAndItem(db, id, item.item_name);
      let resultId;
      if (existing) {
        resultRepo.update(db, existing.id, item.result_value, item.note, now);
        resultId = existing.id;
      } else {
        resultId = resultRepo.insert(db, {
          round_id: id,
          item_name: item.item_name,
          result_value: item.result_value,
          note: item.note,
          submitted_at: now,
        });
      }
      // 异常复核闭环：异常结果必须有 pending 复核；转为正常/跳过则清理未复核记录
      const review = reviewRepo.findByResultId(db, resultId);
      if (isAbnormal(item.result_value)) {
        if (!review) {
          reviewRepo.insertPending(db, id, resultId, now);
        }
      } else if (review && review.review_status === 'pending') {
        reviewRepo.deletePendingByResult(db, resultId);
      }
    }

    roundRepo.updateStatus(db, id, 'submitted', now);
    recordAudit(db, 'round.submitted', id, body.submitter_name ?? null, {
      result_count: items.length,
      description: `轮次 #${id} 提交 ${items.length} 项巡检结果`,
    }, now);
  });
  tx();
  return getRoundDetail(id);
}

// 关闭轮次：所有异常必须被 ignored 或 resolved；confirmed 仅表示确认存在，不能作为关闭条件
function closeRound(id, body) {
  const db = getDb();
  const round = mustGetRound(db, id);
  assertTransition(round.round_status, 'closed');
  assertAllAnomaliesConcluded(db, id, unresolvedAnomalies);
  const now = nowIso();
  const tx = db.transaction(() => {
    roundRepo.updateStatus(db, id, 'closed', now, now);
    recordAudit(db, 'round.closed', id, body?.operator_name ?? null, {
      description: `关闭轮次 #${id}，全部异常已复核闭环`,
    }, now);
  });
  tx();
  return getRoundDetail(id);
}

function getRoundDetail(id) {
  const db = getDb();
  const round = mustGetRound(db, id);
  const device = deviceRepo.findById(db, round.device_id);
  const snapshot = snapshotRepo.findById(db, round.checklist_snapshot_id);
  const results = resultRepo.listByRound(db, id).map((r) => {
    const review = reviewRepo.findByResultId(db, r.id);
    return { ...r, review: review ?? null };
  });
  return {
    ...round,
    device: device ? { ...device, enabled: !!device.enabled } : null,
    checklist_snapshot: snapshot
      ? { ...snapshot, items: JSON.parse(snapshot.items_json) }
      : null,
    results,
  };
}

function latestRoundForDevice(deviceId) {
  const db = getDb();
  const device = deviceRepo.findById(db, deviceId);
  if (!device) {
    throw notFound(`设备不存在: ${deviceId}`, { device_id: deviceId });
  }
  const round = roundRepo.latestByDevice(db, deviceId);
  if (!round) {
    throw notFound(`设备暂无巡检轮次: ${device.device_code}`, {
      device_id: deviceId,
    });
  }
  return getRoundDetail(round.id);
}

// 未关闭轮次列表：附带待复核异常数量与逾期标记（实时计算，不改写数据库状态）
function listOpenRounds(area) {
  const db = getDb();
  const now = Date.now();
  return roundRepo.listOpen(db, area ?? null).map((r) => ({
    ...r,
    overdue: Date.parse(r.planned_end_at) < now,
  }));
}

module.exports = {
  generateRound,
  startRound,
  submitResults,
  closeRound,
  getRoundDetail,
  latestRoundForDevice,
  listOpenRounds,
};
