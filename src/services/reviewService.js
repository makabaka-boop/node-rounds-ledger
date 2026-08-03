const { NotFoundError, ConflictError, ValidationError } = require('../errors/AppError');
const { REVIEW_CONCLUSIONS } = require('../constants');
const { requireFields, validateEnum } = require('../utils/validators');

class ReviewService {
  constructor(deps) {
    this.roundRepo = deps.roundRepo;
    this.resultRepo = deps.resultRepo;
    this.reviewRepo = deps.reviewRepo;
    this.auditService = deps.auditService;
  }

  submit(reviewId, input, operator_name) {
    requireFields(input, ['review_status']);
    validateEnum(input.review_status, REVIEW_CONCLUSIONS, 'review_status');

    const review = this.reviewRepo.findById(reviewId);
    if (!review) {
      throw new NotFoundError('anomaly_review', reviewId);
    }

    if (review.review_status !== 'pending') {
      throw new ConflictError('Anomaly review has already been submitted', {
        review_id: reviewId,
        current_status: review.review_status
      });
    }

    const result = this.resultRepo.findById(review.result_id);
    if (!result) {
      throw new NotFoundError('round_result', review.result_id);
    }

    if (result.result_value !== 'fault' && result.result_value !== 'attention') {
      throw new ValidationError('Only fault or attention results can be reviewed', {
        result_id: result.id,
        result_value: result.result_value
      });
    }

    const reviewerName = input.reviewer_name || operator_name;
    if (!reviewerName) {
      throw new ValidationError('reviewer_name is required', { field: 'reviewer_name' });
    }

    const updated = this.reviewRepo.updateReview(reviewId, {
      review_status: input.review_status,
      reviewer_name: reviewerName,
      review_note: input.review_note || '',
      reviewed_at: new Date().toISOString()
    });

    this.auditService.record('anomaly.reviewed', 'anomaly_review', reviewId, reviewerName, {
      action: 'review_anomaly',
      operator_name: reviewerName,
      entity_type: 'anomaly_review',
      entity_id: reviewId,
      round_id: review.round_id,
      result_id: review.result_id,
      review_status: input.review_status,
      description: `异常复核 #${reviewId}（轮次 #${review.round_id}，检查项“${result.item_name}”，结果 ${result.result_value}）结论为 ${input.review_status}，复核人：${reviewerName}`
    });

    return this.serialize(updated, result);
  }

  getById(reviewId) {
    const review = this.reviewRepo.findById(reviewId);
    if (!review) {
      throw new NotFoundError('anomaly_review', reviewId);
    }
    const result = this.resultRepo.findById(review.result_id);
    return this.serialize(review, result);
  }

  listByRound(roundId) {
    const round = this.roundRepo.findById(roundId);
    if (!round) {
      throw new NotFoundError('round', roundId);
    }
    const reviews = this.reviewRepo.findByRoundId(roundId);
    return reviews.map(r => {
      const result = this.resultRepo.findById(r.result_id);
      return this.serialize(r, result);
    });
  }

  serialize(review, result) {
    return {
      id: review.id,
      round_id: review.round_id,
      result_id: review.result_id,
      review_status: review.review_status,
      reviewer_name: review.reviewer_name,
      review_note: review.review_note || '',
      reviewed_at: review.reviewed_at,
      created_at: review.created_at,
      updated_at: review.updated_at,
      result: result ? {
        id: result.id,
        item_name: result.item_name,
        result_value: result.result_value,
        note: result.note || '',
        submitted_at: result.submitted_at
      } : null
    };
  }
}

module.exports = ReviewService;
