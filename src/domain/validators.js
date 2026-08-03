'use strict';

/**
 * 通用输入校验辅助。抛出的都是 VALIDATION_ERROR。
 */
const { validation } = require('./errors');

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validation('请求体必须是 JSON 对象');
  }
  return body;
}

function requireString(value, field, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw validation(`字段 ${field} 必须是长度 ${min}-${max} 的字符串`, { field });
  }
  return value.trim();
}

function optionalString(value, field, opts = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, field, opts);
}

function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw validation(`字段 ${field} 取值不合法`, { field, allowed, received: value });
  }
  return value;
}

function requireInt(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw validation(`字段 ${field} 必须是 ${min}-${max} 的整数`, { field });
  }
  return n;
}

function requireBool(value, field) {
  if (typeof value !== 'boolean') {
    throw validation(`字段 ${field} 必须是布尔值`, { field });
  }
  return value;
}

function optionalBool(value, field, def = true) {
  if (value === undefined || value === null) return def;
  return requireBool(value, field);
}

function requireArray(value, field, { min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    throw validation(`字段 ${field} 必须是至少 ${min} 项的数组`, { field });
  }
  return value;
}

// ISO-8601 时间字符串校验，返回毫秒时间戳
function requireDateTime(value, field) {
  const s = requireString(value, field, { max: 40 });
  const ts = Date.parse(s);
  if (Number.isNaN(ts)) {
    throw validation(`字段 ${field} 必须是合法的时间字符串（ISO-8601）`, { field, received: value });
  }
  return { iso: s, ts };
}

module.exports = {
  requireObject,
  requireString,
  optionalString,
  requireEnum,
  requireInt,
  requireBool,
  optionalBool,
  requireArray,
  requireDateTime,
};
