'use strict';

const { createServer } = require('./app');
const { init } = require('./db');
const config = require('./config');

/**
 * 服务入口。初始化数据库并监听端口。
 */
init();

const server = createServer();
server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`node-rounds-ledger 服务已启动，监听端口 ${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`API 前缀：${config.apiPrefix}`);
});

module.exports = server;
