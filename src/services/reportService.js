const { NotFoundError, ValidationError } = require('../errors/AppError');
const { RISK_LEVELS } = require('../constants');
const { validateEnum } = require('../utils/validators');

class ReportService {
  constructor(deps) {
    this.deviceRepo = deps.deviceRepo;
    this.roundRepo = deps.roundRepo;
    this.reviewRepo = deps.reviewRepo;
    this.reportRepo = deps.reportRepo;
  }

  getLatestRoundForDevice(device_id) {
    const device = this.deviceRepo.findById(device_id);
    if (!device) {
      throw new NotFoundError('device', device_id);
    }
    return this.roundRepo.findLatestByDeviceId(device_id);
  }

  getUnclosedRoundsByArea(area) {
    return this.roundRepo.findUnclosedByArea(area);
  }

  getAnomaliesByRiskLevel(risk_level) {
    validateEnum(risk_level, RISK_LEVELS, 'risk_level');
    return this.reportRepo.anomaliesByRiskLevel(risk_level).map(row => ({
      review_id: row.review_id,
      review_status: row.review_status,
      reviewer_name: row.reviewer_name,
      review_note: row.review_note,
      reviewed_at: row.reviewed_at,
      review_created_at: row.review_created_at,
      result_id: row.result_id,
      item_name: row.item_name,
      result_value: row.result_value,
      result_note: row.result_note,
      submitted_at: row.submitted_at,
      round_id: row.round_id,
      round_status: row.round_status,
      device: {
        id: row.device_id,
        device_code: row.device_code,
        device_name: row.device_name,
        area: row.area,
        risk_level: row.risk_level
      }
    }));
  }

  getAreaRiskSummary() {
    return this.reportRepo.areaRiskSummary().map(row => ({
      area: row.area,
      device_count: row.device_count,
      devices_by_risk: {
        critical: row.critical_devices,
        high: row.high_devices,
        medium: row.medium_devices,
        low: row.low_devices
      },
      open_rounds: row.open_rounds,
      pending_faults: row.pending_faults,
      pending_attentions: row.pending_attentions
    }));
  }

  getRiskSummary(query = {}) {
    const filters = {};
    if (query.area) filters.area = query.area;
    if (query.risk_level) {
      validateEnum(query.risk_level, RISK_LEVELS, 'risk_level');
      filters.risk_level = query.risk_level;
    }
    return this.reportRepo.riskSummary(filters).map(row => ({
      area: row.area,
      risk_level: row.risk_level,
      device_count: row.device_count,
      unclosed_round_count: row.unclosed_round_count,
      anomaly_result_count: row.anomaly_result_count,
      pending_review_count: row.pending_review_count,
      overdue_round_count: row.overdue_round_count,
      closed_round_count: row.closed_round_count
    }));
  }
}

module.exports = ReportService;
