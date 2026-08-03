const path = require('path');

const config = {
  port: parseInt(process.env.PORT, 10) || 18102,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'ledger.db'),
  apiPrefix: '/api/v1'
};

module.exports = config;
