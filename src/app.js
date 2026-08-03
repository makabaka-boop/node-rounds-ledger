const express = require('express');
const { createContainer } = require('./container');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const config = require('./config');
const createDeviceRouter = require('./routes/deviceRoutes');
const createChecklistRouter = require('./routes/checklistRoutes');
const createRoundRouter = require('./routes/roundRoutes');
const createReviewRouter = require('./routes/reviewRoutes');
const createReportRouter = require('./routes/reportRoutes');

function createApp(options = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const container = options.container || createContainer(options.containerOptions);
  app.locals.container = container;

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'node-rounds-ledger' });
  });

  const apiRouter = express.Router();
  apiRouter.use('/devices', createDeviceRouter(container));
  apiRouter.use('/checklists', createChecklistRouter(container));
  apiRouter.use('/rounds', createRoundRouter(container));
  apiRouter.use('/anomaly-reviews', createReviewRouter(container));
  apiRouter.use('/reports', createReportRouter(container));

  app.use(config.apiPrefix, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
