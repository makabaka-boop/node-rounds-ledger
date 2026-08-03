'use strict';

const { resetForTest, getDb } = require('../src/db');
const { createServer } = require('../src/app');

/**
 * 测试辅助：重置内存库、启动临时 server、封装 JSON 请求。
 */
function freshServer() {
  resetForTest();
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server));
  });
}

function baseUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function req(server, method, path, body, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl(server)}${path}`, opts);
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

module.exports = { freshServer, req, getDb };
