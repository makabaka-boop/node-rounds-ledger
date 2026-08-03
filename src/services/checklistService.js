'use strict';

const checklistRepository = require('../repositories/checklistRepository');
const auditService = require('./auditService');
const { normalizeItems } = require('../domain/snapshot');
const {
  requireObject, requireString, requireInt, optionalBool, requireArray,
} = require('../domain/validators');
const { duplicate, notFound, validation, AppError } = require('../domain/errors');

/**
 * 巡检清单服务：创建清单、复制清单版本。
 */

function validateItems(rawItems) {
  const arr = requireArray(rawItems, 'items', { min: 1 });
  const items = normalizeItems(arr);
  if (items.length === 0) {
    throw validation('items 至少需要一个有效的检查项名称', { field: 'items' });
  }
  // 去重校验
  const seen = new Set();
  for (const name of items) {
    if (seen.has(name)) throw validation('items 存在重复的检查项名称', { item_name: name });
    seen.add(name);
  }
  return items;
}

function createChecklist(body, actor = 'system') {
  requireObject(body);
  const checklist_name = requireString(body.checklist_name, 'checklist_name', { max: 128 });
  const device_type = requireString(body.device_type, 'device_type', { max: 64 });
  const cycle_days = requireInt(body.cycle_days, 'cycle_days', { min: 1, max: 3650 });
  const enabled = optionalBool(body.enabled, 'enabled', true);
  const items = validateItems(body.items);
  // version 首个默认为 1；如显式传入则校验
  const version = body.version === undefined ? 1 : requireInt(body.version, 'version', { min: 1, max: 100000 });

  const existing = checklistRepository.findLatestByName(checklist_name);
  if (existing) {
    throw duplicate('同名清单已存在，请使用复制版本接口新增版本', { checklist_name });
  }

  const checklist = checklistRepository.create({
    checklist_name, device_type, items, cycle_days, version, enabled,
  });
  auditService.log({
    actor,
    event_type: 'checklist_created',
    entity_type: 'checklist',
    entity_id: checklist.id,
    description: `创建清单 ${checklist_name} v${version}`,
  });
  return checklist;
}

/**
 * 复制清单版本：基于源清单生成新版本（version+1），可覆盖 items/cycle_days。
 * 禁用的清单不允许复制。
 */
function copyVersion(sourceId, body, actor = 'system') {
  requireObject(body || {});
  const source = checklistRepository.findById(sourceId);
  if (!source) throw notFound('源清单不存在', { id: sourceId });
  if (!source.enabled) {
    throw new AppError('CHECKLIST_DISABLED', '已禁用的清单不允许复制版本', { id: sourceId });
  }

  const latest = checklistRepository.findLatestByName(source.checklist_name);
  const nextVersion = latest.version + 1;

  const items = body.items === undefined ? source.items : validateItems(body.items);
  const cycle_days = body.cycle_days === undefined
    ? source.cycle_days
    : requireInt(body.cycle_days, 'cycle_days', { min: 1, max: 3650 });
  const enabled = optionalBool(body.enabled, 'enabled', true);

  const created = checklistRepository.create({
    checklist_name: source.checklist_name,
    device_type: source.device_type,
    items,
    cycle_days,
    version: nextVersion,
    enabled,
  });
  auditService.log({
    actor,
    event_type: 'checklist_version_copied',
    entity_type: 'checklist',
    entity_id: created.id,
    description: `复制清单 ${source.checklist_name} 生成 v${nextVersion}`,
    source_checklist_id: sourceId,
  });
  return created;
}

function getChecklist(id) {
  const checklist = checklistRepository.findById(id);
  if (!checklist) throw notFound('清单不存在', { id });
  return checklist;
}

function listChecklists() {
  return checklistRepository.list();
}

module.exports = { createChecklist, copyVersion, getChecklist, listChecklists };
