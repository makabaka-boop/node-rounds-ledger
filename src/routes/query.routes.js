const express = require('express');
const { queryService } = require('../services');

const router = express.Router();

router.get('/devices/:deviceId/recent-rounds', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const rounds = queryService.getRecentRoundsByDevice(req.params.deviceId, limit);
    res.json(rounds);
  } catch (err) {
    next(err);
  }
});

router.get('/rounds/:roundId/details', (req, res, next) => {
  try {
    const details = queryService.getRoundDetails(req.params.roundId);
    res.json(details);
  } catch (err) {
    next(err);
  }
});

router.get('/areas/:area/open-rounds', (req, res, next) => {
  try {
    const rounds = queryService.getOpenRoundsByArea(req.params.area);
    res.json(rounds);
  } catch (err) {
    next(err);
  }
});

router.get('/exceptions/by-risk/:riskLevel', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const exceptions = queryService.getExceptionsByRiskLevel(req.params.riskLevel, limit);
    res.json(exceptions);
  } catch (err) {
    next(err);
  }
});

router.get('/areas/risk-summary', (req, res, next) => {
  try {
    const summary = queryService.getAreaRiskSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get('/risk-summary', (req, res, next) => {
  try {
    const summary = queryService.getRiskSummaryByAreaAndLevel();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
