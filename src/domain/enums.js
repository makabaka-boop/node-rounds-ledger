'use strict';

/**
 * 领域枚举与状态机定义。
 * 这些常量是业务规则的单一事实来源，服务层、仓库层与测试都引用它们。
 */

// 巡检结果项取值
const RESULT_VALUES = Object.freeze(['normal', 'attention', 'fault', 'skipped']);

// 视为"异常"的结果项（需要进入复核闭环）
const ANOMALY_RESULT_VALUES = Object.freeze(['attention', 'fault']);

// 复核结论（对外只允许提交这三种；pending 为系统内部初始态）
const REVIEW_CONCLUSIONS = Object.freeze(['confirmed', 'ignored', 'resolved']);
const REVIEW_STATUSES = Object.freeze(['pending', ...REVIEW_CONCLUSIONS]);

// 轮次状态
const ROUND_STATUSES = Object.freeze(['scheduled', 'in_progress', 'submitted', 'closed']);

// 设备风险等级
const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

/**
 * 轮次状态机：仅允许下列迁移。
 * 特别地，scheduled 不能直接跳到 closed（表里没有该条边）。
 */
const ROUND_TRANSITIONS = Object.freeze({
  scheduled: ['in_progress'],
  in_progress: ['submitted'],
  submitted: ['closed'],
  closed: [],
});

module.exports = {
  RESULT_VALUES,
  ANOMALY_RESULT_VALUES,
  REVIEW_CONCLUSIONS,
  REVIEW_STATUSES,
  ROUND_STATUSES,
  RISK_LEVELS,
  ROUND_TRANSITIONS,
};
