const { ConflictError, NotFoundError, ValidationError } = require('../errors/AppError');
const { requireFields, validateChecklistItems } = require('../utils/validators');

class ChecklistService {
  constructor(checklistRepository, auditService) {
    this.checklistRepository = checklistRepository;
    this.auditService = auditService;
  }

  create(input, operator_name) {
    requireFields(input, ['checklist_name', 'device_type', 'items', 'cycle_days']);
    validateChecklistItems(input.items);
    const cycle_days = Number(input.cycle_days);
    if (!Number.isInteger(cycle_days) || cycle_days <= 0) {
      throw new ValidationError('cycle_days must be a positive integer', { field: 'cycle_days' });
    }

    const latest = this.checklistRepository.findLatestByNameAndDeviceType(input.checklist_name, input.device_type);
    const version = (latest ? latest.version : 0) + 1;

    const checklist = this.checklistRepository.create({
      checklist_name: input.checklist_name,
      device_type: input.device_type,
      items_json: JSON.stringify(input.items),
      cycle_days,
      version,
      enabled: true
    });

    this.auditService.record('checklist.created', 'checklist', checklist.id, operator_name, {
      checklist_name: checklist.checklist_name,
      device_type: checklist.device_type,
      version: checklist.version
    });

    return this.serialize(checklist);
  }

  copyVersion(sourceId, overrides = {}, operator_name) {
    const source = this.checklistRepository.findById(sourceId);
    if (!source) {
      throw new NotFoundError('checklist', sourceId);
    }
    if (!source.enabled) {
      throw new ConflictError('Cannot copy a disabled checklist', {
        checklist_id: source.id,
        checklist_name: source.checklist_name
      });
    }

    let items;
    if (overrides.items !== undefined) {
      validateChecklistItems(overrides.items);
      items = overrides.items;
    } else {
      items = JSON.parse(source.items_json);
    }

    const cycle_days = overrides.cycle_days !== undefined
      ? Number(overrides.cycle_days)
      : source.cycle_days;

    if (!Number.isInteger(cycle_days) || cycle_days <= 0) {
      throw new ValidationError('cycle_days must be a positive integer', { field: 'cycle_days' });
    }

    const checklistName = overrides.checklist_name || source.checklist_name;
    const deviceType = overrides.device_type || source.device_type;

    const latest = this.checklistRepository.findLatestByNameAndDeviceType(checklistName, deviceType);
    const version = (latest ? latest.version : 0) + 1;

    const checklist = this.checklistRepository.create({
      checklist_name: checklistName,
      device_type: deviceType,
      items_json: JSON.stringify(items),
      cycle_days,
      version,
      enabled: true,
      source_checklist_id: source.id
    });

    this.auditService.record('checklist.version_copied', 'checklist', checklist.id, operator_name, {
      action: 'copy_checklist_version',
      operator_name: operator_name || null,
      entity_type: 'checklist',
      entity_id: checklist.id,
      source_checklist_id: source.id,
      source_version: source.version,
      new_version: version,
      description: `清单“${checklistName}”（设备类型 ${deviceType}）从 v${source.version} 复制生成 v${version}，操作人：${operator_name || '未知'}`
    });

    return this.serialize(checklist);
  }

  getById(id) {
    const checklist = this.checklistRepository.findById(id);
    if (!checklist) {
      throw new NotFoundError('checklist', id);
    }
    return this.serialize(checklist);
  }

  disable(id, operator_name) {
    const checklist = this.checklistRepository.findById(id);
    if (!checklist) {
      throw new NotFoundError('checklist', id);
    }
    if (!checklist.enabled) {
      throw new ValidationError('checklist is already disabled', { checklist_id: id });
    }
    const updated = this.checklistRepository.setEnabled(id, false);
    this.auditService.record('checklist.disabled', 'checklist', id, operator_name, {
      checklist_name: updated.checklist_name,
      version: updated.version
    });
    return this.serialize(updated);
  }

  list(query = {}) {
    const filters = {};
    if (query.device_type) filters.device_type = query.device_type;
    if (query.enabled !== undefined) {
      filters.enabled = query.enabled === 'true' || query.enabled === '1';
    }
    return this.checklistRepository.list(filters).map(c => this.serialize(c));
  }

  serialize(checklist) {
    let items = [];
    try {
      items = JSON.parse(checklist.items_json);
    } catch (err) {
      items = [];
    }
    return {
      id: checklist.id,
      checklist_name: checklist.checklist_name,
      device_type: checklist.device_type,
      items,
      cycle_days: checklist.cycle_days,
      version: checklist.version,
      enabled: !!checklist.enabled,
      source_checklist_id: checklist.source_checklist_id,
      created_at: checklist.created_at
    };
  }
}

module.exports = ChecklistService;
