const { getDb } = require('../db/connection');
const checklistRepo = require('../repositories/checklistRepository');
const auditRepo = require('../repositories/auditRepository');
const { normalizeItems } = require('../domain/snapshot');
const { notFound, conflict } = require('../utils/errors');
const {
  requireBody,
  requireFields,
  assertString,
  assertPositiveInt,
  nowIso,
} = require('../utils/validate');

function toJson(row) {
  return { ...row, enabled: !!row.enabled, items: JSON.parse(row.items) };
}

function createChecklist(body) {
  requireBody(body);
  requireFields(body, ['checklist_name', 'device_type', 'items', 'cycle_days']);
  assertString(body.checklist_name, 'checklist_name');
  assertString(body.device_type, 'device_type');
  assertPositiveInt(body.cycle_days, 'cycle_days');
  const version = body.version === undefined ? 1 : body.version;
  assertPositiveInt(version, 'version');
  const items = normalizeItems(body.items);

  const db = getDb();
  if (checklistRepo.findByNameVersion(db, body.checklist_name, version)) {
    throw conflict(
      `清单 ${body.checklist_name} 的版本 ${version} 已存在`,
      { checklist_name: body.checklist_name, version }
    );
  }

  const now = nowIso();
  const checklist = {
    checklist_name: body.checklist_name,
    device_type: body.device_type,
    items: JSON.stringify(items),
    cycle_days: body.cycle_days,
    version,
    enabled: body.enabled === undefined ? 1 : body.enabled ? 1 : 0,
  };

  const tx = db.transaction(() => {
    const id = checklistRepo.insert(db, checklist, now);
    auditRepo.insert(db, {
      event_type: 'checklist.created',
      entity_type: 'checklist',
      entity_id: id,
      actor: body.operator_name ?? null,
      detail: JSON.stringify({ checklist_name: checklist.checklist_name, version }),
      created_at: now,
    });
    return id;
  });
  return toJson(checklistRepo.findById(db, tx()));
}

// 复制清单生成新版本：默认 version+1，可覆盖 items / cycle_days / enabled
function copyChecklist(id, body) {
  const db = getDb();
  const source = checklistRepo.findById(db, id);
  if (!source) {
    throw notFound(`清单不存在: ${id}`, { checklist_id: id });
  }
  if (!source.enabled) {
    throw conflict(
      `清单已禁用，不能复制新版本: ${source.checklist_name} v${source.version}`,
      { checklist_id: id }
    );
  }
  requireBody(body ?? {});
  const version =
    body && body.version !== undefined ? body.version : source.version + 1;
  assertPositiveInt(version, 'version');
  if (checklistRepo.findByNameVersion(db, source.checklist_name, version)) {
    throw conflict(
      `清单 ${source.checklist_name} 的版本 ${version} 已存在`,
      { checklist_name: source.checklist_name, version }
    );
  }

  const items =
    body && body.items !== undefined
      ? normalizeItems(body.items)
      : JSON.parse(source.items);
  const cycleDays =
    body && body.cycle_days !== undefined ? body.cycle_days : source.cycle_days;
  assertPositiveInt(cycleDays, 'cycle_days');

  const now = nowIso();
  const checklist = {
    checklist_name: source.checklist_name,
    device_type: source.device_type,
    items: JSON.stringify(items),
    cycle_days: cycleDays,
    version,
    enabled: body && body.enabled !== undefined ? (body.enabled ? 1 : 0) : source.enabled,
  };

  const tx = db.transaction(() => {
    const newId = checklistRepo.insert(db, checklist, now);
    auditRepo.insert(db, {
      event_type: 'checklist.copied',
      entity_type: 'checklist',
      entity_id: newId,
      actor: body?.operator_name ?? null,
      detail: JSON.stringify({
        source_checklist_id: id,
        checklist_name: source.checklist_name,
        from_version: source.version,
        to_version: version,
        description: `复制清单「${source.checklist_name}」v${source.version} 生成新版本 v${version}`,
      }),
      created_at: now,
    });
    return newId;
  });
  return toJson(checklistRepo.findById(db, tx()));
}

module.exports = { createChecklist, copyChecklist };
