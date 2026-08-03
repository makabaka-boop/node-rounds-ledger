const { createApp } = require('./app');
const config = require('./config');

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[node-rounds-ledger] listening on port ${config.port}`);
  console.log(`[node-rounds-ledger] API prefix: ${config.apiPrefix}`);
});

function shutdown(signal) {
  console.log(`[node-rounds-ledger] received ${signal}, shutting down`);
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
