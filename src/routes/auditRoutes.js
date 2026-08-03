const { Router } = require('express');
const auditService = require('../services/auditService');

const router = Router();

// 审计事件查询：event_type / entity_type / entity_id / from / to / limit
router.get('/audit-events', (req, res) => {
  res.json(auditService.listAuditEvents(req.query));
});

module.exports = router;
