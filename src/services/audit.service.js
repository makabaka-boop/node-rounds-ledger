const { auditEventDao } = require('../daos');

class AuditService {
  log(event_type, entity_type, entity_id, operator_name = '', event_data = {}, description = '') {
    const data = { ...event_data };
    if (description) {
      data.description = description;
    }
    return auditEventDao.create({
      event_type,
      entity_type,
      entity_id,
      operator_name,
      event_data: data,
    });
  }

  query(filters = {}) {
    return auditEventDao.findAll(filters);
  }
}

module.exports = new AuditService();
