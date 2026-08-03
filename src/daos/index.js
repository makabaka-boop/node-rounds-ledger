const deviceDao = require('./device.dao');
const checklistDao = require('./checklist.dao');
const checklistSnapshotDao = require('./checklist-snapshot.dao');
const roundDao = require('./round.dao');
const roundResultDao = require('./round-result.dao');
const exceptionReviewDao = require('./exception-review.dao');
const auditEventDao = require('./audit-event.dao');

module.exports = {
  deviceDao,
  checklistDao,
  checklistSnapshotDao,
  roundDao,
  roundResultDao,
  exceptionReviewDao,
  auditEventDao,
};
