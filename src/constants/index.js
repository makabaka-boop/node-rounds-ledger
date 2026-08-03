const RESULT_VALUES = Object.freeze(['normal', 'attention', 'fault', 'skipped']);
const REVIEW_STATUSES = Object.freeze(['pending', 'confirmed', 'ignored', 'resolved']);
const REVIEW_CONCLUSIONS = Object.freeze(['confirmed', 'ignored', 'resolved']);
const ROUND_STATUSES = Object.freeze(['scheduled', 'in_progress', 'submitted', 'closed']);
const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);

module.exports = {
  RESULT_VALUES,
  REVIEW_STATUSES,
  REVIEW_CONCLUSIONS,
  ROUND_STATUSES,
  RISK_LEVELS
};
