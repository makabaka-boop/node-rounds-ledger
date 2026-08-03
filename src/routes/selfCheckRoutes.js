'use strict';

const selfCheckService = require('../services/selfCheckService');

/**
 * 数据自检路由。
 */
function register(router) {
  // 数据自检：检查巡检链路的一致性问题
  router.get('/self-check', async () => ({
    status: 200,
    body: selfCheckService.run(),
  }));
}

module.exports = { register };
