const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');

function createReviewRouter(container) {
  const router = express.Router();
  const reviewService = container.services.reviewService;

  router.post('/:id/review', asyncHandler(async (req, res) => {
    const review = reviewService.submit(
      Number(req.params.id),
      req.body || {},
      req.body && req.body.operator_name
    );
    res.status(200).json(review);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const review = reviewService.getById(Number(req.params.id));
    res.status(200).json(review);
  }));

  router.get('/round/:round_id', asyncHandler(async (req, res) => {
    const reviews = reviewService.listByRound(Number(req.params.round_id));
    res.status(200).json({ items: reviews, total: reviews.length });
  }));

  return router;
}

module.exports = createReviewRouter;
