const { getDb } = require('../db/connection');
const auditRepo = require('../repositories/auditRepository');

function listAuditEvents(query) {
  const rows = auditRepo.list(getDb(), query || {});
  return rows.map((r) => ({
    ...r,
    detail: r.detail ? JSON.parse(r.detail) : null,
  }));
}

module.exports = { listAuditEvents };
