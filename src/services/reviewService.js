const { getDb } = require('../db/connection');
const roundRepo = require('../repositories/roundRepository');
const resultRepo = require('../repositories/resultRepository');
const reviewRepo = require('../repositories/reviewRepository');
const auditRepo = require('../repositories/auditRepository');
const { REVIEW_CONCLUSIONS } = require('../domain/constants');
const { isAbnormal } = require('../domain/reviewPolicy');
const { notFound, conflict, validationError } = require('../utils/errors');
const {
  requireBody,
  requireFields,
  assertEnum,
  assertString,
  nowIso,
} = require('../utils/validate');

// 提交异常复核结论：confirmed / ignored / resolved
function submitReview(roundId, body) {
  requireBody(body);
  requireFields(body, ['result_id', 'review_status', 'reviewer_name']);
  assertEnum(body.review_status, REVIEW_CONCLUSIONS, 'review_status');
  assertString(body.reviewer_name, 'reviewer_name');
  if (body.review_note !== undefined && typeof body.review_note !== 'string') {
    throw validationError('字段 review_note 必须是字符串', {
      field: 'review_note',
    });
  }

  const db = getDb();
  const round = roundRepo.findById(db, roundId);
  if (!round) {
    throw notFound(`轮次不存在: ${roundId}`, { round_id: roundId });
  }
  const result = resultRepo.findById(db, Number(body.result_id));
  if (!result || result.round_id !== roundId) {
    throw notFound(`轮次 ${roundId} 下不存在结果: ${body.result_id}`, {
      round_id: roundId,
      result_id: body.result_id,
    });
  }
  if (!isAbnormal(result.result_value)) {
    throw validationError('仅异常结果（attention/fault）需要复核', {
      result_id: result.id,
      result_value: result.result_value,
    });
  }
  const review = reviewRepo.findByResultId(db, result.id);
  if (!review) {
    throw notFound('该结果缺少待复核记录', { result_id: result.id });
  }
  // ignored/resolved 为终态不可再改；confirmed 仅表示确认存在，允许继续复核为 ignored/resolved
  if (['ignored', 'resolved'].includes(review.review_status)) {
    throw conflict(`该异常已复核闭环（${review.review_status}），不能重复复核`, {
      review_id: review.id,
      review_status: review.review_status,
    });
  }
  if (review.review_status === 'confirmed' && body.review_status === 'confirmed') {
    throw conflict('该异常已处于 confirmed 状态', {
      review_id: review.id,
      review_status: review.review_status,
    });
  }

  const now = nowIso();
  const tx = db.transaction(() => {
    reviewRepo.conclude(
      db,
      review.id,
      body.review_status,
      body.reviewer_name,
      body.review_note ?? null,
      now
    );
    auditRepo.insert(db, {
      event_type: 'review.submitted',
      entity_type: 'round',
      entity_id: roundId,
      actor: body.reviewer_name,
      detail: JSON.stringify({
        review_id: review.id,
        result_id: result.id,
        item_name: result.item_name,
        review_status: body.review_status,
        description: `复核轮次 #${roundId} 异常项「${result.item_name}」：${body.review_status}`,
      }),
      created_at: now,
    });
  });
  tx();
  return reviewRepo.findById(db, review.id);
}

module.exports = { submitReview };
