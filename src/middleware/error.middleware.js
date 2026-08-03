const { AppError } = require('../errors');

function notFoundHandler(req, res, next) {
  res.status(404).json({
    error_code: 'NOT_FOUND',
    message: `路径 ${req.method} ${req.path} 不存在`,
    details: {
      method: req.method,
      path: req.path,
    },
  });
}

function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error_code: err.error_code,
      message: err.message,
      details: err.details,
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error_code: 'INVALID_JSON',
      message: '请求体 JSON 格式错误',
      details: {},
    });
  }

  console.error('Unhandled error:', err);

  return res.status(500).json({
    error_code: 'INTERNAL_ERROR',
    message: '服务器内部错误',
    details: {},
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
