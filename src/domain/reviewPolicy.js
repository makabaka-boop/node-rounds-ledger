'use strict';

const { ANOMALY_RESULT_VALUES } = require('./enums');

/**
 * 异常复核闭环策略。
 *
 * 规则：
 * - 结果项为 attention / fault 时，自动生成一条 pending 待复核异常记录。
 * - 关闭轮次的前置条件：所有异常都必须已被 ignored 或 resolved。
 *   pending（未复核）与 confirmed（已确认问题存在）都不满足闭环，均阻止关闭。
 *   即 confirmed 只表示"问题确认存在"，不能作为关闭条件。
 */

function isAnomaly(resultValue) {
  return ANOMALY_RESULT_VALUES.includes(resultValue);
}

// 视为"已闭环"的复核结论
const CLOSED_REVIEW_STATUSES = ['ignored', 'resolved'];

/**
 * 判断是否可以关闭轮次。
 * @param {Array<{result_value:string, review_status:string, result_id:number}>} anomalyRows
 *   该轮次下所有异常结果及其复核状态的联合视图。
 * @returns {{ok:boolean, blocking:Array}}
 */
function canCloseRound(anomalyRows) {
  const blocking = anomalyRows.filter(
    (row) => !CLOSED_REVIEW_STATUSES.includes(row.review_status),
  );
  return { ok: blocking.length === 0, blocking };
}

module.exports = { isAnomaly, canCloseRound, CLOSED_REVIEW_STATUSES };
