'use strict';

/**
 * 清单快照工具。
 * 生成轮次时把"当时的清单版本 + items 数组"固化成快照，
 * 后续清单变化不能影响旧轮次的校验（快照隔离）。
 */

/**
 * 规范化 items 为稳定的字符串数组，用于快照与后续结果校验。
 * 允许传入字符串数组，或 [{item_name:...}] 对象数组。
 */
function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    if (typeof it === 'string') return it.trim();
    if (it && typeof it === 'object' && typeof it.item_name === 'string') {
      return it.item_name.trim();
    }
    return String(it).trim();
  }).filter((s) => s.length > 0);
}

/**
 * 由清单实体构建快照负载（写入 checklist_snapshots 表）。
 */
function buildSnapshotPayload(checklist) {
  const items = normalizeItems(JSON.parse(checklist.items));
  return {
    checklist_id: checklist.id,
    checklist_name: checklist.checklist_name,
    device_type: checklist.device_type,
    version: checklist.version,
    cycle_days: checklist.cycle_days,
    items_json: JSON.stringify(items),
  };
}

/**
 * 从快照行解析出 item_name 集合，用于提交结果时的一致性校验。
 */
function snapshotItemNames(snapshotRow) {
  try {
    const arr = JSON.parse(snapshotRow.items_json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

module.exports = { normalizeItems, buildSnapshotPayload, snapshotItemNames };
