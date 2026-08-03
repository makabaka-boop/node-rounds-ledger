const { Router } = require('express');
const reportService = require('../services/reportService');

const router = Router();

// 按风险等级查异常
router.get('/anomalies', (req, res) => {
  res.json(reportService.listAnomalies(req.query.risk_level));
});

// 区域风险汇总
router.get('/reports/area-risk-summary', (req, res) => {
  res.json(reportService.areaRiskSummary());
});

// 风险汇总：按 area + risk_level 统计（均支持可选过滤）
router.get('/reports/risk-summary', (req, res) => {
  res.json(reportService.riskSummary(req.query));
});

module.exports = router;
