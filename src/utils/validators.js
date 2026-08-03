const { ValidationError } = require('../errors/AppError');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireFields(body, fields) {
  const missing = [];
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new ValidationError('Missing required fields', { missing_fields: missing });
  }
}

function validateEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`Invalid value for ${fieldName}`, {
      field: fieldName,
      allowed_values: allowed,
      received: value
    });
  }
}

function validateISODate(value, fieldName) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`Invalid ISO date for ${fieldName}`, { field: fieldName, received: value });
  }
}

function validateChecklistItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items must be a non-empty array', { field: 'items' });
  }
  items.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new ValidationError(`items[${index}] must be an object`, { field: `items[${index}]` });
    }
    if (!isNonEmptyString(item.item_name)) {
      throw new ValidationError(`items[${index}].item_name is required`, { field: `items[${index}].item_name` });
    }
  });
}

module.exports = {
  isNonEmptyString,
  requireFields,
  validateEnum,
  validateISODate,
  validateChecklistItems
};
