const express = require('express');
const deviceRoutes = require('./device.routes');
const checklistRoutes = require('./checklist.routes');
const roundRoutes = require('./round.routes');
const exceptionReviewRoutes = require('./exception-review.routes');
const queryRoutes = require('./query.routes');
const auditRoutes = require('./audit.routes');
const healthCheckRoutes = require('./health-check.routes');

const router = express.Router();

router.use('/devices', deviceRoutes);
router.use('/checklists', checklistRoutes);
router.use('/rounds', roundRoutes);
router.use('/exception-reviews', exceptionReviewRoutes);
router.use('/queries', queryRoutes);
router.use('/audit-events', auditRoutes);
router.use('/health-check', healthCheckRoutes);

module.exports = router;
