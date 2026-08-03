'use strict';

/**
 * 统一应用错误类型。
 * 错误响应固定为 {"error_code":"...","message":"...","details":{...}}。
 * 每个错误码映射一个 HTTP 状态码。
 */

const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  DUPLICATE: 409,
  INVALID_STATE_TRANSITION: 409,
  STATE_CONFLICT: 409,
  DEVICE_DISABLED: 409,
  CHECKLIST_DISABLED: 409,
  DEVICE_TYPE_MISMATCH: 409,
  ROUND_HAS_UNREVIEWED_FAULT: 409,
  SNAPSHOT_MISMATCH: 422,
  INTERNAL_ERROR: 500,
};

class AppError extends Error {
  constructor(errorCode, message, details = {}) {
    super(message);
    this.name = 'AppError';
    this.errorCode = errorCode;
    this.status = STATUS_BY_CODE[errorCode] || 500;
    this.details = details;
  }

  toResponse() {
    return {
      error_code: this.errorCode,
      message: this.message,
      details: this.details || {},
    };
  }
}

// 便捷构造函数
const validation = (message, details) => new AppError('VALIDATION_ERROR', message, details);
const notFound = (message, details) => new AppError('NOT_FOUND', message, details);
const duplicate = (message, details) => new AppError('DUPLICATE', message, details);
const invalidTransition = (message, details) => new AppError('INVALID_STATE_TRANSITION', message, details);
const stateConflict = (message, details) => new AppError('STATE_CONFLICT', message, details);

module.exports = {
  AppError,
  STATUS_BY_CODE,
  validation,
  notFound,
  duplicate,
  invalidTransition,
  stateConflict,
};
