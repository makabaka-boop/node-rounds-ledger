const express = require('express');
const { roundService, queryService } = require('../services');

const router = express.Router();

router.post('/generate', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const round = roundService.generate(req.body, operator);
    res.status(201).json(round);
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const filters = {};
    if (req.query.device_id) filters.device_id = req.query.device_id;
    if (req.query.round_status) filters.round_status = req.query.round_status;
    if (req.query.owner_name) filters.owner_name = req.query.owner_name;
    if (req.query.limit) filters.limit = parseInt(req.query.limit, 10);

    const { roundDao } = require('../daos');
    const rounds = roundDao.findAll(filters);
    res.json(rounds);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const details = queryService.getRoundDetails(req.params.id);
    res.json(details);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/start', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const round = roundService.start(req.params.id, operator);
    res.json(round);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/submit', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const results = roundService.submitResults(
      req.params.id,
      req.body.results || req.body,
      operator
    );
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/close', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const round = roundService.close(req.params.id, operator);
    res.json(round);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/reviews', (req, res, next) => {
  try {
    const { exceptionReviewService } = require('../services');
    const reviews = exceptionReviewService.getByRoundId(req.params.id);
    res.json(reviews);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
