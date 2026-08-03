class ApiError extends Error {
  constructor(status, errorCode, message, details = {}) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const validationError = (message, details = {}) =>
  new ApiError(400, 'validation_error', message, details);

const notFound = (message, details = {}) =>
  new ApiError(404, 'not_found', message, details);

const conflict = (message, details = {}) =>
  new ApiError(409, 'conflict', message, details);

const invalidTransition = (message, details = {}) =>
  new ApiError(409, 'invalid_transition', message, details);

const unresolvedAnomalies = (message, details = {}) =>
  new ApiError(409, 'unresolved_anomalies', message, details);

module.exports = {
  ApiError,
  validationError,
  notFound,
  conflict,
  invalidTransition,
  unresolvedAnomalies,
};
