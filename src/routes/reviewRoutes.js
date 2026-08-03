'use strict';

const reviewService = require('../services/reviewService');
const { requireInt } = require('../domain/validators');

/**
 * 异常复核相关路由。
 */
function register(router) {
  // 提交异常复核结论
  router.post('/reviews/:id', async (ctx) => ({
    status: 200,
    body: reviewService.submitReview(requireInt(ctx.params.id, 'id', { min: 1 }), ctx.body, ctx.actor),
  }));
}

module.exports = { register };
