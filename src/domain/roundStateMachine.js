'use strict';

const { ROUND_TRANSITIONS } = require('./enums');
const { invalidTransition } = require('./errors');

/**
 * 轮次状态机。
 * canTransition 判断迁移是否合法；assertTransition 非法时抛出 AppError。
 */
function canTransition(from, to) {
  const allowed = ROUND_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw invalidTransition(
      `轮次状态不允许从 ${from} 迁移到 ${to}`,
      { from, to, allowed: ROUND_TRANSITIONS[from] || [] },
    );
  }
}

module.exports = { canTransition, assertTransition };
