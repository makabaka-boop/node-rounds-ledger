const {
  exceptionReviewDao,
  roundResultDao,
  roundDao,
} = require('../daos');
const { REVIEW_STATUS, REVIEW_STATUSES } = require('../constants');
const {
  ValidationError,
  NotFoundError,
  BusinessRuleError,
} = require('../errors');
const auditService = require('./audit.service');

const FINAL_REVIEW_STATUSES = [
  REVIEW_STATUS.CONFIRMED,
  REVIEW_STATUS.IGNORED,
  REVIEW_STATUS.RESOLVED,
];

class ExceptionReviewService {
  submitReview(reviewId, data, operator = '') {
    const errors = {};
    if (!data.review_status) errors.review_status = 'review_status 为必填项';
    else if (!REVIEW_STATUSES.includes(data.review_status)) {
      errors.review_status = `review_status 必须是: ${REVIEW_STATUSES.join(', ')}`;
    }
    if (!data.reviewer_name) errors.reviewer_name = 'reviewer_name 为必填项';

    if (Object.keys(errors).length > 0) {
      throw new ValidationError('复核参数校验失败', errors);
    }

    const review = exceptionReviewDao.findById(reviewId);
    if (!review) {
      throw new NotFoundError(`复核记录 ${reviewId} 不存在`, {
        review_id: reviewId,
      });
    }

    if (review.review_status !== REVIEW_STATUS.PENDING) {
      throw new BusinessRuleError(
        `该异常已经复核，当前状态: ${review.review_status}`,
        { current_status: review.review_status }
      );
    }

    if (!FINAL_REVIEW_STATUSES.includes(data.review_status)) {
      throw new ValidationError(
        `复核结论必须是: ${FINAL_REVIEW_STATUSES.join(', ')}`,
        { review_status: data.review_status }
      );
    }

    const now = new Date().toISOString();
    const updated = exceptionReviewDao.update(reviewId, {
      review_status: data.review_status,
      reviewer_name: data.reviewer_name,
      review_note: data.review_note || '',
      reviewed_at: now,
    });

    auditService.log('exception.reviewed', 'exception_review', reviewId, operator, {
      round_id: review.round_id,
      result_id: review.result_id,
      review_status: data.review_status,
      reviewer_name: data.reviewer_name,
      review_note: data.review_note || '',
    }, `复核异常记录 ${reviewId}，轮次=${review.round_id}，结论=${data.review_status}，复核人=${data.reviewer_name}`);

    return this._formatReview(updated);
  }

  getByRoundId(roundId) {
    const reviews = exceptionReviewDao.findByRoundId(roundId);
    return reviews.map(r => this._formatReview(r));
  }

  getById(reviewId) {
    const review = exceptionReviewDao.findById(reviewId);
    if (!review) {
      throw new NotFoundError(`复核记录 ${reviewId} 不存在`, {
        review_id: reviewId,
      });
    }
    return this._formatReview(review);
  }

  listPending(roundId) {
    const reviews = exceptionReviewDao.findPendingByRoundId(roundId);
    return reviews.map(r => this._formatReview(r));
  }

  _formatReview(review) {
    return {
      id: review.id,
      round_id: review.round_id,
      result_id: review.result_id,
      review_status: review.review_status,
      reviewer_name: review.reviewer_name || '',
      review_note: review.review_note || '',
      reviewed_at: review.reviewed_at,
      created_at: review.created_at,
      updated_at: review.updated_at,
    };
  }
}

module.exports = new ExceptionReviewService();
