class AppError extends Error {
  constructor(errorCode, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'AppError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends AppError {
  constructor(resource, id) {
    super('NOT_FOUND', `${resource} not found`, 404, { resource, id });
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message, details = {}) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

class StateTransitionError extends AppError {
  constructor(message, details = {}) {
    super('INVALID_STATE_TRANSITION', message, 409, details);
    this.name = 'StateTransitionError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  StateTransitionError
};
