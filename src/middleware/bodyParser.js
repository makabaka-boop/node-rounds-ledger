'use strict';

const { validation } = require('../domain/errors');

/**
 * 读取并解析 JSON 请求体。空体返回 {}。超限或非法 JSON 抛 VALIDATION_ERROR。
 */
const MAX_BODY = 1 * 1024 * 1024; // 1MB

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(validation('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        return resolve(JSON.parse(raw));
      } catch {
        return reject(validation('请求体不是合法的 JSON'));
      }
    });
    req.on('error', (e) => reject(e));
  });
}

module.exports = { parseBody };
