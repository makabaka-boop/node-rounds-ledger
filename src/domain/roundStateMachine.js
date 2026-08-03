const { invalidTransition } = require('../utils/errors');

// 轮次状态机：scheduled -> in_progress -> submitted -> closed
// 不允许 scheduled 直接到 closed，也不允许跨级或回退
const TRANSITIONS = {
  scheduled: ['in_progress'],
  in_progress: ['submitted'],
  submitted: ['closed'],
  closed: [],
};

function assertTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw invalidTransition(
      `轮次状态不允许从 ${from} 变更为 ${to}`,
      { from, to, allowed }
    );
  }
}

module.exports = { TRANSITIONS, assertTransition };
