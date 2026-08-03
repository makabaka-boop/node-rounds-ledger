const { StateTransitionError } = require('../errors/AppError');
const { ROUND_STATUSES } = require('../constants');

const ALLOWED_TRANSITIONS = Object.freeze({
  scheduled: ['in_progress'],
  in_progress: ['submitted'],
  submitted: ['closed', 'in_progress'],
  closed: []
});

function assertTransition(currentStatus, nextStatus) {
  if (!ROUND_STATUSES.includes(nextStatus)) {
    throw new StateTransitionError(`Unknown target round status: ${nextStatus}`, {
      current_status: currentStatus,
      target_status: nextStatus,
      allowed_statuses: ROUND_STATUSES
    });
  }

  if (currentStatus === nextStatus) {
    throw new StateTransitionError(`Round is already in status ${currentStatus}`, {
      current_status: currentStatus,
      target_status: nextStatus
    });
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new StateTransitionError(
      `Cannot transition round from ${currentStatus} to ${nextStatus}`,
      {
        current_status: currentStatus,
        target_status: nextStatus,
        allowed_targets: allowed
      }
    );
  }
}

module.exports = {
  ALLOWED_TRANSITIONS,
  assertTransition
};
