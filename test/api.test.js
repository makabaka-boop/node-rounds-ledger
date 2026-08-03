const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildApp } = require('./helpers');

const PREFIX = '/api/v1';

function createDevicePayload(overrides = {}) {
  return {
    device_code: 'DEV-001',
    device_name: '主泵A',
    area: 'A区',
    device_type: 'pump',
    risk_level: 'high',
    maintenance_note: '定期巡检',
    ...overrides
  };
}

function createChecklistPayload(overrides = {}) {
  return {
    checklist_name: '泵类巡检清单',
    device_type: 'pump',
    cycle_days: 7,
    items: [
      { item_name: '检查油位', standard: '在刻度线之间' },
      { item_name: '听异响', standard: '无异常声响' }
    ],
    ...overrides
  };
}

test('POST /devices creates a device and returns snake_case fields', async () => {
  const { app } = buildApp();
  const res = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  assert.equal(res.status, 201);
  assert.equal(res.body.device_code, 'DEV-001');
  assert.equal(res.body.device_name, '主泵A');
  assert.equal(res.body.area, 'A区');
  assert.equal(res.body.risk_level, 'high');
  assert.equal(res.body.enabled, true);
  assert.ok(res.body.id);
});

test('POST /devices rejects duplicate device_code', async () => {
  const { app } = buildApp();
  await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  const res = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  assert.equal(res.status, 409);
  assert.equal(res.body.error_code, 'CONFLICT');
  assert.ok(res.body.message);
  assert.equal(typeof res.body.details, 'object');
});

test('POST /devices/:id/disable disables a device', async () => {
  const { app } = buildApp();
  const createRes = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  const res = await request(app).post(`${PREFIX}/devices/${createRes.body.id}/disable`).send();
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, false);
});

test('POST /checklists creates checklist with version 1', async () => {
  const { app } = buildApp();
  const res = await request(app).post(`${PREFIX}/checklists`).send(createChecklistPayload());
  assert.equal(res.status, 201);
  assert.equal(res.body.version, 1);
  assert.equal(res.body.items.length, 2);
});

test('POST /checklists/:id/copy-version creates new version with snapshot independence', async () => {
  const { app, container } = buildApp();
  const c1 = await request(app).post(`${PREFIX}/checklists`).send(createChecklistPayload());

  const device = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  const generated = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  assert.equal(generated.status, 201);
  const originalSnapshotItems = generated.body.checklist_snapshot.items;

  const copied = await request(app).post(`${PREFIX}/checklists/${c1.body.id}/copy-version`).send({
    items: [
      { item_name: '检查油位' },
      { item_name: '听异响' },
      { item_name: '新增振动检查' }
    ]
  });
  assert.equal(copied.status, 201);
  assert.equal(copied.body.version, 2);
  assert.equal(copied.body.items.length, 3);

  const oldRound = await request(app).get(`${PREFIX}/rounds/${generated.body.id}`);
  assert.equal(oldRound.status, 200);
  assert.deepEqual(oldRound.body.checklist_snapshot.items, originalSnapshotItems);
  assert.equal(oldRound.body.checklist_snapshot.version, 1);

  const generated2 = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-08T08:00:00.000Z',
    planned_end_at: '2026-08-08T18:00:00.000Z'
  });
  assert.equal(generated2.body.checklist_snapshot.version, 2);
  assert.equal(generated2.body.checklist_snapshot.items.length, 3);
});

test('round workflow: scheduled -> in_progress -> submitted -> closed with anomaly review', async () => {
  const { app } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  await request(app).post(`${PREFIX}/checklists`).send(createChecklistPayload());

  const generated = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z',
    owner_name: '张三'
  });
  assert.equal(generated.body.round_status, 'scheduled');

  const cannotCloseScheduled = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/close`).send();
  assert.equal(cannotCloseScheduled.status, 409);
  assert.equal(cannotCloseScheduled.body.error_code, 'INVALID_STATE_TRANSITION');

  const started = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/start`).send({ owner_name: '张三' });
  assert.equal(started.status, 200);
  assert.equal(started.body.round_status, 'in_progress');
  assert.ok(started.body.started_at);

  const submitted = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal', note: '油位正常' },
      { item_name: '听异响', result_value: 'fault', note: '发现异常声响' }
    ]
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.round_status, 'submitted');
  assert.equal(submitted.body.results.length, 2);
  assert.equal(submitted.body.anomaly_reviews.length, 1);
  assert.equal(submitted.body.anomaly_reviews[0].review_status, 'pending');

  const cannotClosePendingFault = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/close`).send();
  assert.equal(cannotClosePendingFault.status, 409);
  assert.equal(cannotClosePendingFault.body.error_code, 'CONFLICT');
  assert.equal(cannotClosePendingFault.body.details.blocking_review_count, 1);
  assert.equal(cannotClosePendingFault.body.details.pending_review_count, 1);

  const reviewId = submitted.body.anomaly_reviews[0].id;
  const reviewed = await request(app).post(`${PREFIX}/anomaly-reviews/${reviewId}/review`).send({
    review_status: 'resolved',
    reviewer_name: '李工',
    review_note: '已安排维修'
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.review_status, 'resolved');
  assert.equal(reviewed.body.result.result_value, 'fault');

  const closed = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/close`).send();
  assert.equal(closed.status, 200);
  assert.equal(closed.body.round_status, 'closed');
  assert.ok(closed.body.closed_at);
});

test('submitting result with unknown item_name is rejected against snapshot', async () => {
  const { app } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  await request(app).post(`${PREFIX}/checklists`).send(createChecklistPayload());
  const generated = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${generated.body.id}/start`).send();
  const res = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '不存在项', result_value: 'normal' }
    ]
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error_code, 'VALIDATION_ERROR');
});

test('invalid enum result_value is rejected', async () => {
  const { app } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  await request(app).post(`${PREFIX}/checklists`).send(createChecklistPayload());
  const generated = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${generated.body.id}/start`).send();
  const res = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'bad' },
      { item_name: '听异响', result_value: 'normal' }
    ]
  });
  assert.equal(res.status, 400);
});

test('query: latest round for device, unclosed by area, anomalies by risk, area risk summary', async () => {
  const { app } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload({ area: 'A区' }));
  const device2 = await request(app).post(`${PREFIX}/devices`).send(createDevicePayload({ device_code: 'DEV-002', area: 'A区', risk_level: 'critical' }));
  await request(app).post(`${PREFIX}/checklists`).send(createChecklistPayload());

  const r1 = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  const r2 = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device2.body.id,
    planned_start_at: '2026-08-02T08:00:00.000Z',
    planned_end_at: '2026-08-02T18:00:00.000Z'
  });

  const latest = await request(app).get(`${PREFIX}/rounds/device/${device.body.id}/latest`);
  assert.equal(latest.status, 200);
  assert.equal(latest.body.id, r1.body.id);

  const unclosed = await request(app).get(`${PREFIX}/rounds/area/A区/unclosed`);
  assert.equal(unclosed.status, 200);
  assert.equal(unclosed.body.total, 2);

  await request(app).post(`${PREFIX}/rounds/${r2.body.id}/start`).send();
  await request(app).post(`${PREFIX}/rounds/${r2.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'attention' },
      { item_name: '听异响', result_value: 'fault' }
    ]
  });

  const criticalAnomalies = await request(app).get(`${PREFIX}/reports/anomalies/by-risk/critical`);
  assert.equal(criticalAnomalies.status, 200);
  assert.equal(criticalAnomalies.body.total, 2);
  assert.equal(criticalAnomalies.body.items[0].result_value, 'fault');

  const summary = await request(app).get(`${PREFIX}/reports/area-risk-summary`);
  assert.equal(summary.status, 200);
  const areaA = summary.body.items.find(i => i.area === 'A区');
  assert.ok(areaA);
  assert.equal(areaA.device_count, 2);
  assert.equal(areaA.devices_by_risk.critical, 1);
  assert.equal(areaA.pending_faults, 1);
});

test('audit events are recorded and queryable', async () => {
  const { app } = buildApp();
  await request(app).post(`${PREFIX}/devices`).send(createDevicePayload());
  const res = await request(app).get(`${PREFIX}/reports/audit-events?entity_type=device`);
  assert.equal(res.status, 200);
  assert.ok(res.body.total >= 1);
  assert.equal(res.body.items[0].entity_type, 'device');
  assert.equal(typeof res.body.items[0].payload, 'object');
});

test('error response follows fixed shape for unknown routes', async () => {
  const { app } = buildApp();
  const res = await request(app).get(`${PREFIX}/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal(typeof res.body.error_code, 'string');
  assert.equal(typeof res.body.message, 'string');
  assert.equal(typeof res.body.details, 'object');
});

test('service listens on port 18102 via config', async () => {
  const config = require('../src/config');
  assert.equal(config.port, 18102);
  assert.equal(config.apiPrefix, '/api/v1');
});
