'use strict';

const roundRepository = require('../repositories/roundRepository');
const deviceRepository = require('../repositories/deviceRepository');
const checklistRepository = require('../repositories/checklistRepository');
const snapshotRepository = require('../repositories/snapshotRepository');
const resultRepository = require('../repositories/resultRepository');
const reviewRepository = require('../repositories/reviewRepository');
const auditService = require('./auditService');

const { assertTransition } = require('../domain/roundStateMachine');
const { buildSnapshotPayload, snapshotItemNames } = require('../domain/snapshot');
const { isAnomaly, canCloseRound } = require('../domain/reviewPolicy');
const { RESULT_VALUES } = require('../domain/enums');
const {
  requireObject, requireInt, requireString, optionalString, requireEnum, requireArray, requireDateTime,
} = require('../domain/validators');
const {
  notFound, validation, stateConflict, AppError,
} = require('../domain/errors');

/**
 * 巡检轮次服务：生成计划轮次、开始巡检、提交结果、关闭轮次、查询详情等。
 */

/**
 * 生成计划轮次。
 * - 设备与清单必须存在且启用
 * - 设备类型与清单类型必须一致
 * - 生成时固化清单版本 + items 数组快照（快照隔离）
 */
function generateRound(body, actor = 'system') {
  requireObject(body);
  const device_id = requireInt(body.device_id, 'device_id', { min: 1 });
  const checklist_id = requireInt(body.checklist_id, 'checklist_id', { min: 1 });
  const owner_name = requireString(body.owner_name, 'owner_name', { max: 64 });
  const start = requireDateTime(body.planned_start_at, 'planned_start_at');
  const end = requireDateTime(body.planned_end_at, 'planned_end_at');
  if (end.ts <= start.ts) {
    throw validation('planned_end_at 必须晚于 planned_start_at', {
      planned_start_at: start.iso, planned_end_at: end.iso,
    });
  }

  const device = deviceRepository.findById(device_id);
  if (!device) throw notFound('设备不存在', { device_id });
  if (!device.enabled) {
    throw new AppError('DEVICE_DISABLED', '设备已停用，不能生成巡检轮次', { device_id });
  }

  const checklist = checklistRepository.findById(checklist_id);
  if (!checklist) throw notFound('清单不存在', { checklist_id });
  if (!checklist.enabled) {
    throw new AppError('CHECKLIST_DISABLED', '清单已禁用，不能生成巡检轮次', { checklist_id });
  }

  if (device.device_type !== checklist.device_type) {
    throw new AppError('DEVICE_TYPE_MISMATCH', '设备类型与清单类型不一致', {
      device_type: device.device_type, checklist_device_type: checklist.device_type,
    });
  }

  // 固化快照
  const rawChecklist = checklistRepository.findRawById(checklist_id);
  const snapshot = snapshotRepository.create(buildSnapshotPayload(rawChecklist));

  const round = roundRepository.create({
    device_id,
    checklist_id,
    checklist_snapshot_id: snapshot.id,
    planned_start_at: start.iso,
    planned_end_at: end.iso,
    owner_name,
  });

  auditService.log({
    actor,
    event_type: 'round_generated',
    entity_type: 'round',
    entity_id: round.id,
    description: `为设备 ${device.device_code} 生成轮次`,
    checklist_snapshot_id: snapshot.id,
    checklist_version: snapshot.version,
  });
  return decorateRound(round);
}

/** 开始巡检：scheduled -> in_progress */
function startRound(id, actor = 'system') {
  const round = mustFind(id);
  assertTransition(round.round_status, 'in_progress');
  const updated = roundRepository.updateStatus(id, 'in_progress', { started_at: new Date().toISOString() });
  auditService.log({
    actor,
    event_type: 'round_started',
    entity_type: 'round',
    entity_id: id,
    description: '开始巡检',
  });
  return decorateRound(updated);
}

/**
 * 提交结果：in_progress -> submitted。
 * 严格快照边界校验（以首轮生成时固化的 checklist_snapshot 为唯一基准）：
 * - 数量必须一致：结果项数量必须等于快照检查项数量（不能多传、不能少传）
 * - 顺序必须一致：results[i].item_name 必须与 snapshot.items[i] 逐位相等（不能重排）
 * - 名称必须一致：不能改名（同上，逐位精确匹配）
 * - result_value 必须是合法枚举
 * - submitted_at 必须在计划时间窗内（含边界）
 * - 自动为 attention/fault 生成 pending 待复核异常
 * 任一校验失败则整体回滚（不落库），轮次保持 in_progress。
 */
function submitResults(id, body, actor = 'system') {
  requireObject(body);
  const round = mustFind(id);
  if (round.round_status !== 'in_progress') {
    // 状态机：只有 in_progress 才能提交
    assertTransition(round.round_status, 'submitted');
  }

  const rawResults = requireArray(body.results, 'results', { min: 1 });
  const snapshot = snapshotRepository.findById(round.checklist_snapshot_id);
  if (!snapshot) throw notFound('轮次快照丢失', { checklist_snapshot_id: round.checklist_snapshot_id });
  const snapshotItems = snapshotItemNames(snapshot);

  // 数量必须与快照完全一致（不能多传或少传）
  if (rawResults.length !== snapshotItems.length) {
    throw new AppError('SNAPSHOT_MISMATCH', '提交结果项数量与清单快照不一致', {
      expected_count: snapshotItems.length,
      received_count: rawResults.length,
      snapshot_items: snapshotItems,
    });
  }

  // 逐位（顺序 + 名称）严格比对
  const startTs = Date.parse(round.planned_start_at);
  const endTs = Date.parse(round.planned_end_at);
  const normalized = [];
  for (let i = 0; i < rawResults.length; i += 1) {
    const r = rawResults[i];
    requireObject(r);
    const item_name = requireString(r.item_name, `results[${i}].item_name`, { max: 128 });
    const result_value = requireEnum(r.result_value, `results[${i}].result_value`, RESULT_VALUES);
    const note = optionalString(r.note, `results[${i}].note`, { max: 500 });
    const submitted = requireDateTime(r.submitted_at, `results[${i}].submitted_at`);

    // 顺序 / 名称：必须与快照同一位置完全一致（不能改名、不能重排）
    if (item_name !== snapshotItems[i]) {
      throw new AppError('SNAPSHOT_MISMATCH', '提交检查项的顺序或名称与清单快照不一致', {
        index: i,
        expected_item_name: snapshotItems[i],
        received_item_name: item_name,
        snapshot_items: snapshotItems,
      });
    }

    // 时间窗校验（含边界）
    if (submitted.ts < startTs || submitted.ts > endTs) {
      throw validation('submitted_at 超出轮次计划时间窗', {
        item_name,
        submitted_at: submitted.iso,
        planned_start_at: round.planned_start_at,
        planned_end_at: round.planned_end_at,
      });
    }

    normalized.push({ item_name, result_value, note, submitted_at: submitted.iso });
  }

  // 校验全部通过后再落库：清理旧结果与复核，重新写入
  resultRepository.deleteByRound(id);
  const inserted = resultRepository.insertMany(id, normalized);

  // 自动生成待复核异常
  let anomalyCount = 0;
  for (const row of inserted) {
    if (isAnomaly(row.result_value)) {
      reviewRepository.createPending(id, row.id);
      anomalyCount += 1;
    }
  }

  const updated = roundRepository.updateStatus(id, 'submitted', { submitted_at: new Date().toISOString() });
  auditService.log({
    actor,
    event_type: 'results_submitted',
    entity_type: 'round',
    entity_id: id,
    description: `提交巡检结果 ${inserted.length} 项，生成待复核异常 ${anomalyCount} 项`,
    anomaly_count: anomalyCount,
  });
  return { round: decorateRound(updated), results: inserted, pending_reviews: anomalyCount };
}

/**
 * 关闭轮次：submitted -> closed。
 * 前置：所有异常都必须已被 ignored 或 resolved（pending / confirmed 均阻止关闭）。
 */
function closeRound(id, actor = 'system') {
  const round = mustFind(id);
  assertTransition(round.round_status, 'closed');

  const anomalyView = reviewRepository.findAnomalyViewByRound(id);
  const { ok, blocking } = canCloseRound(anomalyView);
  if (!ok) {
    throw new AppError('ROUND_HAS_UNREVIEWED_FAULT', '存在未闭环的异常（需全部 ignored 或 resolved），不能关闭轮次', {
      blocking_result_ids: blocking.map((b) => b.result_id),
      blocking_reviews: blocking.map((b) => ({ result_id: b.result_id, review_status: b.review_status })),
    });
  }

  const updated = roundRepository.updateStatus(id, 'closed', { closed_at: new Date().toISOString() });
  auditService.log({
    actor,
    event_type: 'round_closed',
    entity_type: 'round',
    entity_id: id,
    description: '关闭轮次',
  });
  return decorateRound(updated);
}

/** 查询轮次详情：含快照、结果、复核 */
function getRoundDetail(id) {
  const round = mustFind(id);
  const snapshot = snapshotRepository.findById(round.checklist_snapshot_id);
  const results = resultRepository.findByRound(id);
  const reviews = reviewRepository.findByRound(id);
  return {
    round: decorateRound(round),
    checklist_snapshot: snapshot
      ? { ...snapshot, items: snapshotItemNames(snapshot) }
      : null,
    results,
    reviews,
  };
}

/** 按区域查未关闭轮次，附带待复核数量 */
function listOpenByArea(area) {
  if (!area) throw validation('缺少 area 查询参数', { field: 'area' });
  const rows = roundRepository.findOpenByArea(area);
  return rows.map((r) => ({
    ...decorateRound(r),
    device_code: r.device_code,
    device_name: r.device_name,
    area: r.area,
    risk_level: r.risk_level,
    pending_reviews: reviewRepository.countPendingByRound(r.id),
  }));
}

// ---- helpers ----

function mustFind(id) {
  const round = roundRepository.findById(id);
  if (!round) throw notFound('轮次不存在', { id });
  return round;
}

/** 附加实时计算字段：overdue（未关闭且已过计划结束时间） */
function decorateRound(round) {
  const overdue = round.round_status !== 'closed'
    && Date.now() > Date.parse(round.planned_end_at);
  return { ...round, overdue };
}

module.exports = {
  generateRound,
  startRound,
  submitResults,
  closeRound,
  getRoundDetail,
  listOpenByArea,
};
