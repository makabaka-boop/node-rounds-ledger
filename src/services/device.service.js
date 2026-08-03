const { deviceDao } = require('../daos');
const { RISK_LEVELS } = require('../constants');
const { ValidationError, NotFoundError, ConflictError } = require('../errors');
const auditService = require('./audit.service');

class DeviceService {
  create(data, operator = '') {
    this._validateDeviceData(data);

    const existing = deviceDao.findByCode(data.device_code);
    if (existing) {
      throw new ConflictError(
        `设备编码 ${data.device_code} 已存在`,
        { device_code: data.device_code }
      );
    }

    const device = deviceDao.create({
      device_code: data.device_code,
      device_name: data.device_name,
      area: data.area,
      device_type: data.device_type,
      risk_level: data.risk_level,
      enabled: data.enabled !== false,
      maintenance_note: data.maintenance_note || '',
    });

    auditService.log('device.created', 'device', device.id, operator, {
      device_code: device.device_code,
      device_name: device.device_name,
      area: device.area,
      risk_level: device.risk_level,
    }, `创建设备 ${device.device_code}（${device.device_name}）`);

    return this._formatDevice(device);
  }

  getById(id) {
    const device = deviceDao.findById(id);
    if (!device) {
      throw new NotFoundError(`设备 ${id} 不存在`, { device_id: id });
    }
    return this._formatDevice(device);
  }

  list(filters = {}) {
    const devices = deviceDao.findAll(filters);
    return devices.map(d => this._formatDevice(d));
  }

  deactivate(id, operator = '') {
    const device = deviceDao.findById(id);
    if (!device) {
      throw new NotFoundError(`设备 ${id} 不存在`, { device_id: id });
    }

    if (!device.enabled) {
      throw new ConflictError('设备已停用', { device_id: id });
    }

    const updated = deviceDao.setEnabled(id, false);
    auditService.log('device.deactivated', 'device', id, operator, {
      device_code: device.device_code,
      device_name: device.device_name,
    }, `停用设备 ${device.device_code}（${device.device_name}）`);

    return this._formatDevice(updated);
  }

  update(id, data, operator = '') {
    const device = deviceDao.findById(id);
    if (!device) {
      throw new NotFoundError(`设备 ${id} 不存在`, { device_id: id });
    }

    if (data.risk_level && !RISK_LEVELS.includes(data.risk_level)) {
      throw new ValidationError(
        `风险等级必须是: ${RISK_LEVELS.join(', ')}`,
        { risk_level: data.risk_level }
      );
    }

    const updated = deviceDao.update(id, data);
    auditService.log('device.updated', 'device', id, operator, data,
      `更新设备 ${device.device_code}`);

    return this._formatDevice(updated);
  }

  _validateDeviceData(data) {
    const errors = {};

    if (!data.device_code || typeof data.device_code !== 'string') {
      errors.device_code = 'device_code 为必填项';
    }
    if (!data.device_name || typeof data.device_name !== 'string') {
      errors.device_name = 'device_name 为必填项';
    }
    if (!data.area || typeof data.area !== 'string') {
      errors.area = 'area 为必填项';
    }
    if (!data.device_type || typeof data.device_type !== 'string') {
      errors.device_type = 'device_type 为必填项';
    }
    if (!data.risk_level || !RISK_LEVELS.includes(data.risk_level)) {
      errors.risk_level = `risk_level 必须是: ${RISK_LEVELS.join(', ')}`;
    }

    if (Object.keys(errors).length > 0) {
      throw new ValidationError('设备数据校验失败', errors);
    }
  }

  _formatDevice(device) {
    return {
      id: device.id,
      device_code: device.device_code,
      device_name: device.device_name,
      area: device.area,
      device_type: device.device_type,
      risk_level: device.risk_level,
      enabled: device.enabled === 1 || device.enabled === true,
      maintenance_note: device.maintenance_note || '',
      created_at: device.created_at,
      updated_at: device.updated_at,
    };
  }
}

module.exports = new DeviceService();
