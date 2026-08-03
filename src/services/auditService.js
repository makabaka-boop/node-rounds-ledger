class AuditService {
  constructor(auditRepository) {
    this.auditRepository = auditRepository;
  }

  record(event_type, entity_type, entity_id, operator_name, payload) {
    return this.auditRepository.create({
      event_type,
      entity_type,
      entity_id,
      operator_name: operator_name || null,
      payload: payload || {}
    });
  }

  list(query) {
    return this.auditRepository.list(query);
  }
}

module.exports = AuditService;
