'use strict';

const deviceService = require('../services/deviceService');
const { requireInt } = require('../domain/validators');

/**
 * 设备相关路由。
 */
function register(router) {
  // 创建设备
  router.post('/devices', async (ctx) => ({
    status: 201,
    body: deviceService.createDevice(ctx.body, ctx.actor),
  }));

  // 停用设备
  router.post('/devices/:id/disable', async (ctx) => ({
    status: 200,
    body: deviceService.disableDevice(requireInt(ctx.params.id, 'id', { min: 1 }), ctx.actor),
  }));

  // 设备列表
  router.get('/devices', async () => ({
    status: 200,
    body: { items: deviceService.listDevices() },
  }));

  // 设备详情
  router.get('/devices/:id', async (ctx) => ({
    status: 200,
    body: deviceService.getDevice(requireInt(ctx.params.id, 'id', { min: 1 })),
  }));

  // 查询设备最近轮次
  router.get('/devices/:id/rounds', async (ctx) => {
    const limit = ctx.query.limit ? requireInt(ctx.query.limit, 'limit', { min: 1, max: 100 }) : 10;
    return {
      status: 200,
      body: deviceService.recentRounds(requireInt(ctx.params.id, 'id', { min: 1 }), limit),
    };
  });
}

module.exports = { register };
