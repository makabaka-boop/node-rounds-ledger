const { checklistDao, checklistSnapshotDao } = require('../daos');
const { ValidationError, NotFoundError, ConflictError, BusinessRuleError } = require('../errors');
const auditService = require('./audit.service');

class ChecklistService {
  create(data, operator = '') {
    this._validateChecklistData(data);

    const existing = checklistDao.findByNameAndDeviceType(
      data.checklist_name,
      data.device_type
    );
    if (existing) {
      throw new ConflictError(
        `清单名称 ${data.checklist_name} 在设备类型 ${data.device_type} 下已存在`,
        { checklist_name: data.checklist_name, device_type: data.device_type }
      );
    }

    const checklist = checklistDao.create({
      checklist_name: data.checklist_name,
      device_type: data.device_type,
      items: data.items || [],
      cycle_days: data.cycle_days,
      version: 1,
      enabled: data.enabled !== false,
    });

    auditService.log('checklist.created', 'checklist', checklist.id, operator, {
      checklist_name: checklist.checklist_name,
      version: checklist.version,
      device_type: checklist.device_type,
    }, `创建清单 ${checklist.checklist_name} v${checklist.version}`);

    return checklist;
  }

  getById(id) {
    const checklist = checklistDao.findById(id);
    if (!checklist) {
      throw new NotFoundError(`清单 ${id} 不存在`, { checklist_id: id });
    }
    return checklist;
  }

  list(filters = {}) {
    return checklistDao.findAll(filters);
  }

  update(id, data, operator = '') {
    const checklist = checklistDao.findById(id);
    if (!checklist) {
      throw new NotFoundError(`清单 ${id} 不存在`, { checklist_id: id });
    }

    const updated = checklistDao.update(id, data);

    auditService.log('checklist.updated', 'checklist', id, operator, data,
      `更新清单 ${checklist.checklist_name}`);

    return updated;
  }

  copyVersion(sourceChecklistId, newItems, operator = '') {
    const source = checklistDao.findById(sourceChecklistId);
    if (!source) {
      throw new NotFoundError(`源清单 ${sourceChecklistId} 不存在`, {
        checklist_id: sourceChecklistId,
      });
    }
    if (!source.enabled) {
      throw new BusinessRuleError('清单已停用，无法复制新版本', {
        checklist_id: sourceChecklistId,
      });
    }

    const maxVersion = checklistDao.getMaxVersion(
      source.checklist_name,
      source.device_type
    );
    const newVersion = maxVersion + 1;

    const items = newItems || source.items;

    this._validateChecklistData({
      checklist_name: source.checklist_name,
      device_type: source.device_type,
      items,
      cycle_days: source.cycle_days,
    });

    const newChecklist = checklistDao.create({
      checklist_name: source.checklist_name,
      device_type: source.device_type,
      items,
      cycle_days: source.cycle_days,
      version: newVersion,
      enabled: true,
    });

    auditService.log(
      'checklist.version_copied',
      'checklist',
      newChecklist.id,
      operator,
      {
        source_checklist_id: sourceChecklistId,
        source_version: source.version,
        new_version: newVersion,
        checklist_name: source.checklist_name,
      },
      `复制清单 ${source.checklist_name} v${source.version} -> v${newVersion}`
    );

    return newChecklist;
  }

  createSnapshot(checklistId) {
    const checklist = checklistDao.findById(checklistId);
    if (!checklist) {
      throw new NotFoundError(`清单 ${checklistId} 不存在`, {
        checklist_id: checklistId,
      });
    }

    const snapshot = checklistSnapshotDao.create({
      checklist_id: checklist.id,
      checklist_name: checklist.checklist_name,
      device_type: checklist.device_type,
      items: checklist.items,
      cycle_days: checklist.cycle_days,
      version: checklist.version,
    });

    return snapshot;
  }

  getSnapshotById(snapshotId) {
    const snapshot = checklistSnapshotDao.findById(snapshotId);
    if (!snapshot) {
      throw new NotFoundError(`清单快照 ${snapshotId} 不存在`, {
        snapshot_id: snapshotId,
      });
    }
    return snapshot;
  }

  _validateChecklistData(data) {
    const errors = {};

    if (!data.checklist_name || typeof data.checklist_name !== 'string') {
      errors.checklist_name = 'checklist_name 为必填项';
    }
    if (!data.device_type || typeof data.device_type !== 'string') {
      errors.device_type = 'device_type 为必填项';
    }
    if (!Array.isArray(data.items)) {
      errors.items = 'items 必须是数组';
    } else if (data.items.length === 0) {
      errors.items = 'items 不能为空';
    } else {
      data.items.forEach((item, idx) => {
        if (typeof item !== 'string' && typeof item !== 'object') {
          errors[`items[${idx}]`] = '清单项必须是字符串或对象';
        }
      });
    }
    if (
      data.cycle_days === undefined ||
      data.cycle_days === null ||
      typeof data.cycle_days !== 'number' ||
      data.cycle_days <= 0
    ) {
      errors.cycle_days = 'cycle_days 必须是正整数';
    }

    if (Object.keys(errors).length > 0) {
      throw new ValidationError('清单数据校验失败', errors);
    }
  }
}

module.exports = new ChecklistService();
