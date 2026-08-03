const express = require('express');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'node-rounds-ledger', version: '1.0.0' });
  });

  app.use('/api/v1', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
