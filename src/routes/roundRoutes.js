const { Router } = require('express');
const roundService = require('../services/roundService');
const reviewService = require('../services/reviewService');
const { parseIdParam } = require('../utils/validate');

const router = Router();

// 按区域查未关闭轮次（area 为空时返回全部未关闭）
// 注意：必须注册在 /:id 之前
router.get('/open', (req, res) => {
  res.json(roundService.listOpenRounds(req.query.area));
});

// 生成计划轮次（含清单快照）
router.post('/', (req, res) => {
  res.status(201).json(roundService.generateRound(req.body));
});

// 查询轮次详情与清单快照
router.get('/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json(roundService.getRoundDetail(id));
});

// 开始巡检（body 可传 operator_name 记录操作者）
router.post('/:id/start', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json(roundService.startRound(id, req.body ?? {}));
});

// 提交执行结果（异常自动生成待复核记录）
router.post('/:id/results', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json(roundService.submitResults(id, req.body));
});

// 提交异常复核
router.post('/:id/reviews', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json(reviewService.submitReview(id, req.body));
});

// 关闭轮次（所有异常须 ignored/resolved；body 可传 operator_name 记录操作者）
router.post('/:id/close', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json(roundService.closeRound(id, req.body ?? {}));
});

module.exports = router;
