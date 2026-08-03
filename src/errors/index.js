class AppError extends Error {
  constructor(error_code, message, details = {}, statusCode = 400) {
    super(message);
    this.error_code = error_code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super('VALIDATION_ERROR', message, details, 400);
  }
}

class NotFoundError extends AppError {
  constructor(message, details = {}) {
    super('NOT_FOUND', message, details, 404);
  }
}

class ConflictError extends AppError {
  constructor(message, details = {}) {
    super('CONFLICT', message, details, 409);
  }
}

class StateTransitionError extends AppError {
  constructor(message, details = {}) {
    super('INVALID_STATE_TRANSITION', message, details, 409);
  }
}

class BusinessRuleError extends AppError {
  constructor(message, details = {}) {
    super('BUSINESS_RULE_VIOLATION', message, details, 422);
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  StateTransitionError,
  BusinessRuleError,
};
