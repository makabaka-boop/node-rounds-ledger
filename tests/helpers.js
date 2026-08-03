function getTestApp() {
  const { createApp } = require('../src/app');
  return createApp();
}

module.exports = { getTestApp };
