const { ABNORMAL_VALUES } = require('./constants');

function isAbnormal(resultValue) {
  return ABNORMAL_VALUES.includes(resultValue);
}

// 复核终态结论：达到这些状态的异常才允许轮次关闭
// confirmed 仅表示问题确认存在，不是关闭条件
const CLOSABLE_REVIEW_STATUSES = ['ignored', 'resolved'];

// 关闭轮次的前置校验：所有异常结果（attention/fault）都必须被 ignored 或 resolved，
// 存在 pending（未复核）或 confirmed（仅确认存在）的异常则抛出错误
function assertAllAnomaliesConcluded(db, roundId, unresolvedAnomalies) {
  const blocking = db
    .prepare(
      `SELECT rv.id AS review_id, rv.result_id, rv.review_status,
              res.item_name, res.result_value
       FROM reviews rv
       JOIN results res ON res.id = rv.result_id
       WHERE rv.round_id = ? AND rv.review_status NOT IN ('ignored', 'resolved')
       ORDER BY rv.id`
    )
    .all(roundId);
  if (blocking.length > 0) {
    throw unresolvedAnomalies(
      '存在未闭环的异常（pending 未复核或 confirmed 未处置），不允许关闭轮次',
      { round_id: roundId, blocking_reviews: blocking }
    );
  }
}

module.exports = { isAbnormal, assertAllAnomaliesConcluded, CLOSABLE_REVIEW_STATUSES };
