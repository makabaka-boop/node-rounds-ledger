const { ROUND_STATUS, ALLOWED_ROUND_TRANSITIONS } = require('../constants');
const { StateTransitionError } = require('../errors');

function canTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_ROUND_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

function validateTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    throw new StateTransitionError(
      `轮次状态已经是 ${toStatus}`,
      { current_status: fromStatus, target_status: toStatus }
    );
  }

  if (!canTransition(fromStatus, toStatus)) {
    throw new StateTransitionError(
      `不允许从 ${fromStatus} 转换到 ${toStatus}`,
      {
        current_status: fromStatus,
        target_status: toStatus,
        allowed_transitions: ALLOWED_ROUND_TRANSITIONS[fromStatus] || [],
      }
    );
  }
}

function assertNotClosed(status) {
  if (status === ROUND_STATUS.CLOSED) {
    throw new StateTransitionError(
      '轮次已关闭，无法执行此操作',
      { current_status: status }
    );
  }
}

module.exports = {
  canTransition,
  validateTransition,
  assertNotClosed,
};
