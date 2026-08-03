const { AppError } = require('../errors/AppError');

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error_code: err.errorCode,
      message: err.message,
      details: err.details || {}
    });
  }

  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error_code: 'INVALID_JSON',
      message: 'Request body is not valid JSON',
      details: {}
    });
  }

  return res.status(500).json({
    error_code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    details: {}
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error_code: 'ROUTE_NOT_FOUND',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    details: {}
  });
}

module.exports = { errorHandler, notFoundHandler };
