const { validationError } = require('./errors');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function requireBody(body) {
  if (!isPlainObject(body)) {
    throw validationError('请求体必须是 JSON 对象');
  }
  return body;
}

function requireFields(body, fields) {
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ''
  );
  if (missing.length > 0) {
    throw validationError(`缺少必填字段: ${missing.join(', ')}`, {
      missing_fields: missing,
    });
  }
}

function assertEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw validationError(
      `字段 ${fieldName} 取值非法，允许值: ${allowed.join(', ')}`,
      { field: fieldName, allowed, received: value }
    );
  }
}

function assertString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validationError(`字段 ${fieldName} 必须是非空字符串`, {
      field: fieldName,
    });
  }
}

function assertPositiveInt(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw validationError(`字段 ${fieldName} 必须是正整数`, {
      field: fieldName,
      received: value,
    });
  }
}

function assertIsoDate(value, fieldName) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw validationError(`字段 ${fieldName} 必须是合法的日期时间字符串`, {
      field: fieldName,
      received: value,
    });
  }
}

function parseIdParam(raw, name = 'id') {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw validationError(`路径参数 ${name} 必须是正整数`, { received: raw });
  }
  return id;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  requireBody,
  requireFields,
  assertEnum,
  assertString,
  assertPositiveInt,
  assertIsoDate,
  parseIdParam,
  nowIso,
  isPlainObject,
};
