const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');

function createReportRouter(container) {
  const router = express.Router();
  const reportService = container.services.reportService;
  const auditService = container.services.auditService;
  const selfCheckService = container.services.selfCheckService;

  router.get('/area-risk-summary', asyncHandler(async (req, res) => {
    const summary = reportService.getAreaRiskSummary();
    res.status(200).json({ items: summary, total: summary.length });
  }));

  router.get('/risk-summary', asyncHandler(async (req, res) => {
    const summary = reportService.getRiskSummary(req.query || {});
    res.status(200).json({ items: summary, total: summary.length });
  }));

  router.get('/self-check', asyncHandler(async (req, res) => {
    const report = selfCheckService.run();
    res.status(200).json(report);
  }));

  router.get('/anomalies/by-risk/:risk_level', asyncHandler(async (req, res) => {
    const items = reportService.getAnomaliesByRiskLevel(req.params.risk_level);
    res.status(200).json({ items, total: items.length });
  }));

  router.get('/audit-events', asyncHandler(async (req, res) => {
    const query = {
      event_type: req.query.event_type,
      entity_type: req.query.entity_type,
      entity_id: req.query.entity_id ? Number(req.query.entity_id) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined
    };
    const events = auditService.list(query);
    const items = events.map(e => ({
      ...e,
      payload: safeParse(e.payload_json)
    }));
    res.status(200).json({ items, total: items.length });
  }));

  return router;
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch (err) {
    return {};
  }
}

module.exports = createReportRouter;
