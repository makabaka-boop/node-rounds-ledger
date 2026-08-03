const test = require('node:test');
const assert = require('node:assert/strict');
const { createContainer } = require('../src/container');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db/connection');

function buildApp() {
  const db = getDb({ inMemory: true, forceNew: true });
  const container = createContainer({ db });
  const app = createApp({ container });
  return { app, container, db };
}

module.exports = { buildApp };
