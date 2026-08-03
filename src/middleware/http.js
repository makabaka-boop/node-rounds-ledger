'use strict';

const { AppError } = require('../domain/errors');

/**
 * 统一响应与错误处理工具。
 * 错误响应固定为 {"error_code":"...","message":"...","details":{...}}。
 */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, err) {
  if (err instanceof AppError) {
    return sendJson(res, err.status, err.toResponse());
  }
  // 未预期错误统一包装成 INTERNAL_ERROR，避免泄漏堆栈
  // eslint-disable-next-line no-console
  console.error('[unhandled]', err);
  return sendJson(res, 500, {
    error_code: 'INTERNAL_ERROR',
    message: '服务器内部错误',
    details: {},
  });
}

module.exports = { sendJson, sendError };
