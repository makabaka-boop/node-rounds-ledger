'use strict';

const checklistService = require('../services/checklistService');
const { requireInt } = require('../domain/validators');

/**
 * 巡检清单相关路由。
 */
function register(router) {
  // 创建清单
  router.post('/checklists', async (ctx) => ({
    status: 201,
    body: checklistService.createChecklist(ctx.body, ctx.actor),
  }));

  // 复制清单版本
  router.post('/checklists/:id/versions', async (ctx) => ({
    status: 201,
    body: checklistService.copyVersion(requireInt(ctx.params.id, 'id', { min: 1 }), ctx.body, ctx.actor),
  }));

  // 清单列表
  router.get('/checklists', async () => ({
    status: 200,
    body: { items: checklistService.listChecklists() },
  }));

  // 清单详情
  router.get('/checklists/:id', async (ctx) => ({
    status: 200,
    body: checklistService.getChecklist(requireInt(ctx.params.id, 'id', { min: 1 })),
  }));
}

module.exports = { register };
