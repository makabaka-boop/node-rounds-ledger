const { validationError } = require('../utils/errors');
const { isPlainObject } = require('../utils/validate');

// 将清单 items 归一化为 [{ item_name, description }]
// 入参允许字符串数组或对象数组
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw validationError('字段 items 必须是非空数组', { field: 'items' });
  }
  const seen = new Set();
  const normalized = items.map((item, idx) => {
    let name;
    let description = '';
    if (typeof item === 'string') {
      name = item.trim();
    } else if (isPlainObject(item)) {
      name = typeof item.item_name === 'string' ? item.item_name.trim() : '';
      description = typeof item.description === 'string' ? item.description : '';
    } else {
      name = '';
    }
    if (!name) {
      throw validationError(`items[${idx}] 缺少有效的 item_name`, {
        field: 'items',
        index: idx,
      });
    }
    if (seen.has(name)) {
      throw validationError(`items 中存在重复的 item_name: ${name}`, {
        field: 'items',
        item_name: name,
      });
    }
    seen.add(name);
    return { item_name: name, description };
  });
  return normalized;
}

// 基于当前清单生成不可变快照（版本 + items JSON 数组）
function buildSnapshot(checklist) {
  return {
    checklist_id: checklist.id,
    checklist_name: checklist.checklist_name,
    device_type: checklist.device_type,
    version: checklist.version,
    cycle_days: checklist.cycle_days,
    items_json: JSON.stringify(normalizeItems(JSON.parse(checklist.items))),
  };
}

function snapshotItemNames(snapshot) {
  return JSON.parse(snapshot.items_json).map((i) => i.item_name);
}

module.exports = { normalizeItems, buildSnapshot, snapshotItemNames };
