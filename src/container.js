const { getDb } = require('./db/connection');
const DeviceRepository = require('./repositories/deviceRepository');
const ChecklistRepository = require('./repositories/checklistRepository');
const SnapshotRepository = require('./repositories/snapshotRepository');
const RoundRepository = require('./repositories/roundRepository');
const ResultRepository = require('./repositories/resultRepository');
const ReviewRepository = require('./repositories/reviewRepository');
const AuditRepository = require('./repositories/auditRepository');
const ReportRepository = require('./repositories/reportRepository');
const SelfCheckRepository = require('./repositories/selfCheckRepository');

const SnapshotService = require('./services/snapshotService');
const AuditService = require('./services/auditService');
const DeviceService = require('./services/deviceService');
const ChecklistService = require('./services/checklistService');
const RoundService = require('./services/roundService');
const ReviewService = require('./services/reviewService');
const ReportService = require('./services/reportService');
const SelfCheckService = require('./services/selfCheckService');

function createContainer(options = {}) {
  const db = options.db || getDb(options.dbOptions || {});

  const deviceRepo = new DeviceRepository(db);
  const checklistRepo = new ChecklistRepository(db);
  const snapshotRepo = new SnapshotRepository(db);
  const roundRepo = new RoundRepository(db);
  const resultRepo = new ResultRepository(db);
  const reviewRepo = new ReviewRepository(db);
  const auditRepo = new AuditRepository(db);
  const reportRepo = new ReportRepository(db);
  const selfCheckRepo = new SelfCheckRepository(db);

  const snapshotService = new SnapshotService(snapshotRepo);
  const auditService = new AuditService(auditRepo);

  const deviceService = new DeviceService(deviceRepo, auditService);
  const checklistService = new ChecklistService(checklistRepo, auditService);
  const roundService = new RoundService({
    db,
    deviceRepo,
    checklistRepo,
    roundRepo,
    resultRepo,
    reviewRepo,
    snapshotService,
    auditService
  });
  const reviewService = new ReviewService({
    roundRepo,
    resultRepo,
    reviewRepo,
    auditService
  });
  const reportService = new ReportService({
    deviceRepo,
    roundRepo,
    reviewRepo,
    reportRepo
  });
  const selfCheckService = new SelfCheckService(selfCheckRepo);

  return {
    db,
    repositories: {
      deviceRepo,
      checklistRepo,
      snapshotRepo,
      roundRepo,
      resultRepo,
      reviewRepo,
      auditRepo,
      reportRepo,
      selfCheckRepo
    },
    services: {
      snapshotService,
      auditService,
      deviceService,
      checklistService,
      roundService,
      reviewService,
      reportService,
      selfCheckService
    }
  };
}

module.exports = { createContainer };
