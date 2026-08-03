const { Router } = require('express');
const deviceRoutes = require('./deviceRoutes');
const checklistRoutes = require('./checklistRoutes');
const roundRoutes = require('./roundRoutes');
const reportRoutes = require('./reportRoutes');
const auditRoutes = require('./auditRoutes');
const selfCheckRoutes = require('./selfCheckRoutes');

const router = Router();

router.use('/devices', deviceRoutes);
router.use('/checklists', checklistRoutes);
router.use('/rounds', roundRoutes);
router.use(reportRoutes);
router.use(auditRoutes);
router.use(selfCheckRoutes);

module.exports = router;
