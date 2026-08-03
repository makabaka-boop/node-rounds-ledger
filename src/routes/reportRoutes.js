'use strict';

const reportService = require('../services/reportService');
const auditService = require('../services/auditService');
const { requireInt } = require('../domain/validators');

/**
 * 报表与审计相关路由。
 */
function register(router) {
  // 按风险等级查异常
  router.get('/reports/anomalies', async (ctx) => ({
    status: 200,
    body: { items: reportService.anomaliesByRisk(ctx.query.risk_level) },
  }));

  // 区域风险汇总
  router.get('/reports/risk-summary', async () => ({
    status: 200,
    body: { items: reportService.riskSummary() },
  }));

  // 审计事件查询
  router.get('/audit-events', async (ctx) => {
    const filters = {
      entity_type: ctx.query.entity_type,
      event_type: ctx.query.event_type,
    };
    if (ctx.query.entity_id !== undefined) {
      filters.entity_id = requireInt(ctx.query.entity_id, 'entity_id', { min: 1 });
    }
    if (ctx.query.limit !== undefined) {
      filters.limit = requireInt(ctx.query.limit, 'limit', { min: 1, max: 1000 });
    }
    return { status: 200, body: { items: auditService.query(filters) } };
  });
}

module.exports = { register };
