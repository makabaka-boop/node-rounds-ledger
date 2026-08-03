const express = require('express');
const { exceptionReviewService } = require('../services');

const router = express.Router();

router.get('/:id', (req, res, next) => {
  try {
    const review = exceptionReviewService.getById(req.params.id);
    res.json(review);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/review', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || req.body.reviewer_name || '';
    const review = exceptionReviewService.submitReview(
      req.params.id,
      req.body,
      operator
    );
    res.json(review);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
