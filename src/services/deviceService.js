const { getDb } = require('../db/connection');
const deviceRepo = require('../repositories/deviceRepository');
const auditRepo = require('../repositories/auditRepository');
const { RISK_LEVELS } = require('../domain/constants');
const { notFound, conflict } = require('../utils/errors');
const {
  requireBody,
  requireFields,
  assertEnum,
  assertString,
  nowIso,
} = require('../utils/validate');

function toJson(row) {
  return { ...row, enabled: !!row.enabled };
}

function createDevice(body) {
  requireBody(body);
  requireFields(body, ['device_code', 'device_name', 'area', 'device_type', 'risk_level']);
  ['device_code', 'device_name', 'area', 'device_type'].forEach((f) =>
    assertString(body[f], f)
  );
  assertEnum(body.risk_level, RISK_LEVELS, 'risk_level');
  if (body.maintenance_note !== undefined && body.maintenance_note !== null) {
    if (typeof body.maintenance_note !== 'string') {
      throw require('../utils/errors').validationError(
        '字段 maintenance_note 必须是字符串',
        { field: 'maintenance_note' }
      );
    }
  }

  const db = getDb();
  if (deviceRepo.findByCode(db, body.device_code)) {
    throw conflict(`设备编码已存在: ${body.device_code}`, {
      device_code: body.device_code,
    });
  }

  const now = nowIso();
  const device = {
    device_code: body.device_code,
    device_name: body.device_name,
    area: body.area,
    device_type: body.device_type,
    risk_level: body.risk_level,
    enabled: body.enabled === undefined ? 1 : body.enabled ? 1 : 0,
    maintenance_note: body.maintenance_note ?? null,
  };

  const tx = db.transaction(() => {
    const id = deviceRepo.insert(db, device, now);
    auditRepo.insert(db, {
      event_type: 'device.created',
      entity_type: 'device',
      entity_id: id,
      actor: body.operator_name ?? null,
      detail: JSON.stringify({ device_code: device.device_code }),
      created_at: now,
    });
    return id;
  });
  return toJson(deviceRepo.findById(db, tx()));
}

function disableDevice(id, body) {
  const db = getDb();
  const device = deviceRepo.findById(db, id);
  if (!device) {
    throw notFound(`设备不存在: ${id}`, { device_id: id });
  }
  const now = nowIso();
  const tx = db.transaction(() => {
    deviceRepo.setEnabled(db, id, false, now);
    auditRepo.insert(db, {
      event_type: 'device.disabled',
      entity_type: 'device',
      entity_id: id,
      actor: body?.operator_name ?? null,
      detail: JSON.stringify({
        device_code: device.device_code,
        description: `停用设备 ${device.device_code}（${device.device_name}）`,
      }),
      created_at: now,
    });
  });
  tx();
  return toJson(deviceRepo.findById(db, id));
}

module.exports = { createDevice, disableDevice };
