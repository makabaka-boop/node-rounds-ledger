const express = require('express');
const { auditService } = require('../services');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const filters = {};
    if (req.query.event_type) filters.event_type = req.query.event_type;
    if (req.query.entity_type) filters.entity_type = req.query.entity_type;
    if (req.query.entity_id) filters.entity_id = req.query.entity_id;
    if (req.query.operator_name) filters.operator_name = req.query.operator_name;
    if (req.query.start_date) filters.start_date = req.query.start_date;
    if (req.query.end_date) filters.end_date = req.query.end_date;
    if (req.query.limit) filters.limit = parseInt(req.query.limit, 10);

    const events = auditService.query(filters);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
