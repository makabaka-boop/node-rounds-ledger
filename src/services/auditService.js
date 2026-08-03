'use strict';

const auditRepository = require('../repositories/auditRepository');

/**
 * 审计服务：封装写入与查询。detail 中约定包含 description 字段便于阅读。
 */

function log({ actor, event_type, entity_type, entity_id, description, ...rest }) {
  const detail = { description, ...rest };
  return auditRepository.record({ actor, event_type, entity_type, entity_id, detail });
}

function query(filters) {
  return auditRepository.query(filters);
}

module.exports = { log, query };
