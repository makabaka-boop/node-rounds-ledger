const ROUND_STATUS = {
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  CLOSED: 'closed',
};

const RESULT_VALUE = {
  NORMAL: 'normal',
  ATTENTION: 'attention',
  FAULT: 'fault',
  SKIPPED: 'skipped',
};

const REVIEW_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IGNORED: 'ignored',
  RESOLVED: 'resolved',
};

const RISK_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

const ALLOWED_ROUND_TRANSITIONS = {
  [ROUND_STATUS.SCHEDULED]: [ROUND_STATUS.IN_PROGRESS],
  [ROUND_STATUS.IN_PROGRESS]: [ROUND_STATUS.SUBMITTED],
  [ROUND_STATUS.SUBMITTED]: [ROUND_STATUS.CLOSED, ROUND_STATUS.IN_PROGRESS],
  [ROUND_STATUS.CLOSED]: [],
};

const RESULT_VALUES = Object.values(RESULT_VALUE);
const REVIEW_STATUSES = Object.values(REVIEW_STATUS);
const ROUND_STATUSES = Object.values(ROUND_STATUS);
const RISK_LEVELS = Object.values(RISK_LEVEL);

module.exports = {
  ROUND_STATUS,
  RESULT_VALUE,
  REVIEW_STATUS,
  RISK_LEVEL,
  ALLOWED_ROUND_TRANSITIONS,
  RESULT_VALUES,
  REVIEW_STATUSES,
  ROUND_STATUSES,
  RISK_LEVELS,
};
