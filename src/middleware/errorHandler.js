const { ApiError } = require('../utils/errors');

// 统一错误格式：{"error_code":"...","message":"...","details":{...}}
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error_code: err.errorCode,
      message: err.message,
      details: err.details ?? {},
    });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error_code: 'validation_error',
      message: '请求体不是合法的 JSON',
      details: {},
    });
  }
  console.error('[internal_error]', err);
  return res.status(500).json({
    error_code: 'internal_error',
    message: '服务器内部错误',
    details: {},
  });
}

module.exports = { errorHandler };
