'use strict';

const roundService = require('../services/roundService');
const reviewService = require('../services/reviewService');
const { requireInt } = require('../domain/validators');

/**
 * 巡检轮次相关路由。
 * 注意：更具体的静态路径（/rounds/open）需先于 /rounds/:id 注册以避免被参数捕获。
 */
function register(router) {
  // 生成计划轮次
  router.post('/rounds', async (ctx) => ({
    status: 201,
    body: roundService.generateRound(ctx.body, ctx.actor),
  }));

  // 按区域查未关闭轮次（静态路径，先注册）
  router.get('/rounds/open', async (ctx) => ({
    status: 200,
    body: { items: roundService.listOpenByArea(ctx.query.area) },
  }));

  // 开始巡检
  router.post('/rounds/:id/start', async (ctx) => ({
    status: 200,
    body: roundService.startRound(requireInt(ctx.params.id, 'id', { min: 1 }), ctx.actor),
  }));

  // 提交结果
  router.post('/rounds/:id/results', async (ctx) => ({
    status: 200,
    body: roundService.submitResults(requireInt(ctx.params.id, 'id', { min: 1 }), ctx.body, ctx.actor),
  }));

  // 关闭轮次
  router.post('/rounds/:id/close', async (ctx) => ({
    status: 200,
    body: roundService.closeRound(requireInt(ctx.params.id, 'id', { min: 1 }), ctx.actor),
  }));

  // 查询某轮次复核列表
  router.get('/rounds/:id/reviews', async (ctx) => ({
    status: 200,
    body: { items: reviewService.listByRound(requireInt(ctx.params.id, 'id', { min: 1 })) },
  }));

  // 查询轮次详情（含快照、结果、复核）
  router.get('/rounds/:id', async (ctx) => ({
    status: 200,
    body: roundService.getRoundDetail(requireInt(ctx.params.id, 'id', { min: 1 })),
  }));
}

module.exports = { register };
