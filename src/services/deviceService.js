const { ConflictError, NotFoundError, ValidationError } = require('../errors/AppError');
const { RISK_LEVELS } = require('../constants');
const { requireFields, validateEnum } = require('../utils/validators');

class DeviceService {
  constructor(deviceRepository, auditService) {
    this.deviceRepository = deviceRepository;
    this.auditService = auditService;
  }

  create(input, operator_name) {
    requireFields(input, ['device_code', 'device_name', 'area', 'device_type', 'risk_level']);
    validateEnum(input.risk_level, RISK_LEVELS, 'risk_level');

    const existing = this.deviceRepository.findByCode(input.device_code);
    if (existing) {
      throw new ConflictError('device_code already exists', { device_code: input.device_code });
    }

    const device = this.deviceRepository.create({
      device_code: input.device_code,
      device_name: input.device_name,
      area: input.area,
      device_type: input.device_type,
      risk_level: input.risk_level,
      maintenance_note: input.maintenance_note || ''
    });

    this.auditService.record('device.created', 'device', device.id, operator_name, { device_code: device.device_code });
    return this.serialize(device);
  }

  disable(id, operator_name) {
    const device = this.deviceRepository.findById(id);
    if (!device) {
      throw new NotFoundError('device', id);
    }
    if (!device.enabled) {
      throw new ValidationError('device is already disabled', { device_id: id });
    }
    const updated = this.deviceRepository.setEnabled(id, false);
    this.auditService.record('device.disabled', 'device', id, operator_name, {
      action: 'disable_device',
      operator_name: operator_name || null,
      entity_type: 'device',
      entity_id: id,
      description: `设备 ${updated.device_code}（${updated.device_name}）已停用，操作人：${operator_name || '未知'}`
    });
    return this.serialize(updated);
  }

  getById(id) {
    const device = this.deviceRepository.findById(id);
    if (!device) {
      throw new NotFoundError('device', id);
    }
    return this.serialize(device);
  }

  list(query = {}) {
    const filters = {};
    if (query.area) filters.area = query.area;
    if (query.device_type) filters.device_type = query.device_type;
    if (query.enabled !== undefined) {
      filters.enabled = query.enabled === 'true' || query.enabled === '1';
    }
    return this.deviceRepository.list(filters).map(d => this.serialize(d));
  }

  serialize(device) {
    return {
      id: device.id,
      device_code: device.device_code,
      device_name: device.device_name,
      area: device.area,
      device_type: device.device_type,
      risk_level: device.risk_level,
      enabled: !!device.enabled,
      maintenance_note: device.maintenance_note || '',
      created_at: device.created_at,
      updated_at: device.updated_at
    };
  }
}

module.exports = DeviceService;
