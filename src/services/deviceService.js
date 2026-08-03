'use strict';

const deviceRepository = require('../repositories/deviceRepository');
const roundRepository = require('../repositories/roundRepository');
const auditService = require('./auditService');
const { RISK_LEVELS } = require('../domain/enums');
const {
  requireObject, requireString, requireEnum, optionalBool, optionalString,
} = require('../domain/validators');
const { duplicate, notFound, stateConflict } = require('../domain/errors');

/**
 * 设备服务：创建设备、停用设备、查询设备最近轮次。
 */

function createDevice(body, actor = 'system') {
  requireObject(body);
  const device_code = requireString(body.device_code, 'device_code', { max: 64 });
  const device_name = requireString(body.device_name, 'device_name', { max: 128 });
  const area = requireString(body.area, 'area', { max: 64 });
  const device_type = requireString(body.device_type, 'device_type', { max: 64 });
  const risk_level = requireEnum(body.risk_level, 'risk_level', RISK_LEVELS);
  const enabled = optionalBool(body.enabled, 'enabled', true);
  const maintenance_note = optionalString(body.maintenance_note, 'maintenance_note', { max: 500 });

  if (deviceRepository.findByCode(device_code)) {
    throw duplicate('设备编码已存在', { device_code });
  }

  const device = deviceRepository.create({
    device_code, device_name, area, device_type, risk_level, enabled, maintenance_note,
  });

  auditService.log({
    actor,
    event_type: 'device_created',
    entity_type: 'device',
    entity_id: device.id,
    description: `创建设备 ${device_code}`,
  });
  return device;
}

function disableDevice(id, actor = 'system') {
  const device = deviceRepository.findById(id);
  if (!device) throw notFound('设备不存在', { id });
  if (!device.enabled) {
    throw stateConflict('设备已处于停用状态', { id });
  }
  const updated = deviceRepository.setEnabled(id, false);
  auditService.log({
    actor,
    event_type: 'device_disabled',
    entity_type: 'device',
    entity_id: id,
    description: `停用设备 ${device.device_code}`,
  });
  return updated;
}

function getDevice(id) {
  const device = deviceRepository.findById(id);
  if (!device) throw notFound('设备不存在', { id });
  return device;
}

function listDevices() {
  return deviceRepository.list();
}

function recentRounds(id, limit = 10) {
  const device = deviceRepository.findById(id);
  if (!device) throw notFound('设备不存在', { id });
  const rounds = roundRepository.findRecentByDevice(id, limit);
  return { device, rounds };
}

module.exports = { createDevice, disableDevice, getDevice, listDevices, recentRounds };
