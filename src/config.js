'use strict';

/**
 * 全局配置：端口与数据库路径均可通过环境变量覆盖，便于测试隔离。
 */
const path = require('node:path');

const config = {
  port: Number(process.env.PORT) || 18102,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ledger.db'),
  apiPrefix: '/api/v1',
};

module.exports = config;
