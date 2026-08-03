'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const config = require('./config');
const { Router } = require('./middleware/router');
const { parseBody } = require('./middleware/bodyParser');
const { sendJson, sendError } = require('./middleware/http');
const { notFound } = require('./domain/errors');

const deviceRoutes = require('./routes/deviceRoutes');
const checklistRoutes = require('./routes/checklistRoutes');
const roundRoutes = require('./routes/roundRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const reportRoutes = require('./routes/reportRoutes');
const selfCheckRoutes = require('./routes/selfCheckRoutes');

/**
 * 组装应用：注册全部路由并返回一个 http.Server（不自动 listen）。
 */
function buildRouter() {
  const router = new Router(config.apiPrefix);
  deviceRoutes.register(router);
  checklistRoutes.register(router);
  roundRoutes.register(router);
  reviewRoutes.register(router);
  reportRoutes.register(router);
  selfCheckRoutes.register(router);
  return router;
}

function createServer() {
  const router = buildRouter();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      // 健康检查
      if (pathname === '/health' && req.method === 'GET') {
        return sendJson(res, 200, { status: 'ok' });
      }

      const matched = router.match(req.method, pathname);
      if (!matched) {
        throw notFound('接口不存在', { path: pathname, method: req.method });
      }

      const query = Object.fromEntries(url.searchParams.entries());
      const body = (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')
        ? await parseBody(req)
        : {};
      const actor = req.headers['x-actor'] || 'system';

      const result = await matched.handler({
        req, res, params: matched.params, query, body, actor,
      });

      return sendJson(res, result.status || 200, result.body);
    } catch (err) {
      return sendError(res, err);
    }
  });
}

module.exports = { createServer, buildRouter };
