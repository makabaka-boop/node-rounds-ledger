const { Router } = require('express');
const deviceService = require('../services/deviceService');
const roundService = require('../services/roundService');
const { parseIdParam } = require('../utils/validate');

const router = Router();

// 创建设备
router.post('/', (req, res) => {
  res.status(201).json(deviceService.createDevice(req.body));
});

// 停用设备（body 可传 operator_name 记录操作者）
router.post('/:id/disable', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json(deviceService.disableDevice(id, req.body ?? {}));
});

// 查询设备最近轮次
router.get('/:id/latest-round', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json(roundService.latestRoundForDevice(id));
});

module.exports = router;
