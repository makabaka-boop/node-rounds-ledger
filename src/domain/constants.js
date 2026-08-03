const RESULT_VALUES = ['normal', 'attention', 'fault', 'skipped'];
const REVIEW_CONCLUSIONS = ['confirmed', 'ignored', 'resolved'];
const REVIEW_STATUSES = ['pending', ...REVIEW_CONCLUSIONS];
const ROUND_STATUSES = ['scheduled', 'in_progress', 'submitted', 'closed'];
const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
// 需要自动生成待复核记录的异常结果类型
const ABNORMAL_VALUES = ['attention', 'fault'];

module.exports = {
  RESULT_VALUES,
  REVIEW_CONCLUSIONS,
  REVIEW_STATUSES,
  ROUND_STATUSES,
  RISK_LEVELS,
  ABNORMAL_VALUES,
};
