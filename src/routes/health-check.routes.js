const express = require('express');
const { healthCheckService } = require('../services');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const report = healthCheckService.runAllChecks();
    const statusCode = report.overall_status === 'passed' ? 200 : 200;
    res.status(statusCode).json(report);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
