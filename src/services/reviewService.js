'use strict';

const reviewRepository = require('../repositories/reviewRepository');
const roundRepository = require('../repositories/roundRepository');
const auditService = require('./auditService');
const { REVIEW_CONCLUSIONS } = require('../domain/enums');
const {
  requireObject, requireString, optionalString, requireEnum,
} = require('../domain/validators');
const { notFound, stateConflict } = require('../domain/errors');

/**
 * 异常复核服务：提交异常复核结论。
 * 只允许对 pending 记录提交 confirmed / ignored / resolved。
 */
function submitReview(reviewId, body, actor = 'system') {
  requireObject(body);
  const review = reviewRepository.findById(reviewId);
  if (!review) throw notFound('复核记录不存在', { id: reviewId });
  if (review.review_status !== 'pending') {
    throw stateConflict('该异常已复核，不能重复提交', {
      id: reviewId, current_status: review.review_status,
    });
  }

  const review_status = requireEnum(body.review_status, 'review_status', REVIEW_CONCLUSIONS);
  const reviewer_name = requireString(body.reviewer_name, 'reviewer_name', { max: 64 });
  const review_note = optionalString(body.review_note, 'review_note', { max: 500 });
  const reviewed_at = new Date().toISOString();

  const updated = reviewRepository.updateConclusion(reviewId, {
    review_status, reviewer_name, review_note, reviewed_at,
  });

  auditService.log({
    actor,
    event_type: 'review_submitted',
    entity_type: 'review',
    entity_id: reviewId,
    description: `提交异常复核结论 ${review_status}`,
    round_id: review.round_id,
    result_id: review.result_id,
  });
  return updated;
}

/** 查询某轮次的复核列表 */
function listByRound(roundId) {
  if (!roundRepository.findById(roundId)) throw notFound('轮次不存在', { id: roundId });
  return reviewRepository.findByRound(roundId);
}

module.exports = { submitReview, listByRound };
