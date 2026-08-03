const { Router } = require('express');
const checklistService = require('../services/checklistService');
const { parseIdParam } = require('../utils/validate');

const router = Router();

// 创建清单
router.post('/', (req, res) => {
  res.status(201).json(checklistService.createChecklist(req.body));
});

// 复制清单生成新版本
router.post('/:id/copy', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.status(201).json(checklistService.copyChecklist(id, req.body ?? {}));
});

module.exports = router;
