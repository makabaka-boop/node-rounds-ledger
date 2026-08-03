const { Router } = require('express');
const selfCheckService = require('../services/selfCheckService');

const router = Router();

// 数据自检：巡检链路一致性检查
router.get('/self-check', (req, res) => {
  res.json(selfCheckService.runSelfCheck());
});

module.exports = router;
