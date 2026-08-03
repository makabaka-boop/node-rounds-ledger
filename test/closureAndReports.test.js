const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildApp } = require('./helpers');

const PREFIX = '/api/v1';

function devicePayload(overrides = {}) {
  return {
    device_code: 'DEV-CLOSE-01',
    device_name: '闭环泵',
    area: 'A区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides
  };
}

function checklistPayload(overrides = {}) {
  return {
    checklist_name: '闭环清单',
    device_type: 'pump',
    cycle_days: 7,
    items: [
      { item_name: '检查油位' },
      { item_name: '听异响' }
    ],
    ...overrides
  };
}

async function setup(app, deviceOverrides = {}) {
  const deviceRes = await request(app).post(`${PREFIX}/devices`).send(devicePayload(deviceOverrides));
  const checklistRes = await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());
  return { deviceId: deviceRes.body.id, checklistId: checklistRes.body.id };
}

async function createSubmittedRoundWithFault(app, deviceId, planned) {
  const gen = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: planned.start,
    planned_end_at: planned.end
  });
  assert.equal(gen.status, 201, JSON.stringify(gen.body));
  await request(app).post(`${PREFIX}/rounds/${gen.body.id}/start`).send({ operator_name: '张三' });
  const submit = await request(app).post(`${PREFIX}/rounds/${gen.body.id}/submit-results`).send({
    operator_name: '张三',
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'fault', note: '有异响' }
    ]
  });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  return submit.body;
}

test('round with unreviewed fault cannot be closed', async () => {
  const { app } = buildApp();
  const { deviceId } = await setup(app);
  const round = await createSubmittedRoundWithFault(app, deviceId, {
    start: '2026-08-01T08:00:00.000Z',
    end: '2026-08-01T18:00:00.000Z'
  });

  const res = await request(app).post(`${PREFIX}/rounds/${round.id}/close`).send({ operator_name: '张三' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error_code, 'CONFLICT');
  assert.equal(res.body.details.pending_review_count, 1);
  assert.equal(res.body.details.confirmed_review_count, 0);
});

test('confirmed review does not satisfy close condition', async () => {
  const { app } = buildApp();
  const { deviceId } = await setup(app);
  const round = await createSubmittedRoundWithFault(app, deviceId, {
    start: '2026-08-01T08:00:00.000Z',
    end: '2026-08-01T18:00:00.000Z'
  });

  const reviewId = round.anomaly_reviews[0].id;
  const confirmed = await request(app).post(`${PREFIX}/anomaly-reviews/${reviewId}/review`).send({
    review_status: 'confirmed',
    reviewer_name: '李工',
    review_note: '问题确认存在'
  });
  assert.equal(confirmed.status, 200);

  const res = await request(app).post(`${PREFIX}/rounds/${round.id}/close`).send({ operator_name: '李工' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error_code, 'CONFLICT');
  assert.equal(res.body.details.pending_review_count, 0);
  assert.equal(res.body.details.confirmed_review_count, 1);
});

test('ignored review allows closure', async () => {
  const { app } = buildApp();
  const { deviceId } = await setup(app);
  const round = await createSubmittedRoundWithFault(app, deviceId, {
    start: '2026-08-01T08:00:00.000Z',
    end: '2026-08-01T18:00:00.000Z'
  });

  const reviewId = round.anomaly_reviews[0].id;
  await request(app).post(`${PREFIX}/anomaly-reviews/${reviewId}/review`).send({
    review_status: 'ignored',
    reviewer_name: '李工',
    review_note: '误报，忽略'
  });

  const closed = await request(app).post(`${PREFIX}/rounds/${round.id}/close`).send({ operator_name: '李工' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.round_status, 'closed');
});

test('resolved review allows closure (full success path)', async () => {
  const { app } = buildApp();
  const { deviceId } = await setup(app);
  const round = await createSubmittedRoundWithFault(app, deviceId, {
    start: '2026-08-01T08:00:00.000Z',
    end: '2026-08-01T18:00:00.000Z'
  });

  const reviewId = round.anomaly_reviews[0].id;
  const reviewed = await request(app).post(`${PREFIX}/anomaly-reviews/${reviewId}/review`).send({
    review_status: 'resolved',
    reviewer_name: '李工',
    review_note: '已维修'
  });
  assert.equal(reviewed.status, 200);

  const closed = await request(app).post(`${PREFIX}/rounds/${round.id}/close`).send({ operator_name: '李工' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.round_status, 'closed');
  assert.ok(closed.body.closed_at);
});

test('round with no anomalies (all normal) can be closed directly', async () => {
  const { app } = buildApp();
  const { deviceId } = await setup(app);
  const gen = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${gen.body.id}/start`).send({});
  await request(app).post(`${PREFIX}/rounds/${gen.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'normal' }
    ]
  });

  const closed = await request(app).post(`${PREFIX}/rounds/${gen.body.id}/close`).send({});
  assert.equal(closed.status, 200);
  assert.equal(closed.body.round_status, 'closed');
});

test('risk summary groups by area and risk_level with correct counts', async () => {
  const { app } = buildApp();

  const d1 = await request(app).post(`${PREFIX}/devices`).send(devicePayload({ device_code: 'D1', area: 'A区', risk_level: 'high' }));
  const d2 = await request(app).post(`${PREFIX}/devices`).send(devicePayload({ device_code: 'D2', area: 'A区', risk_level: 'critical' }));
  const d3 = await request(app).post(`${PREFIX}/devices`).send(devicePayload({ device_code: 'D3', area: 'B区', risk_level: 'low' }));
  await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());

  const r1 = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: d1.body.id,
    planned_start_at: '2020-01-01T08:00:00.000Z',
    planned_end_at: '2020-01-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${r1.body.id}/start`).send({});
  await request(app).post(`${PREFIX}/rounds/${r1.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'fault' },
      { item_name: '听异响', result_value: 'normal' }
    ]
  });

  const r2 = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: d2.body.id,
    planned_start_at: '2099-01-01T08:00:00.000Z',
    planned_end_at: '2099-01-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${r2.body.id}/start`).send({});
  await request(app).post(`${PREFIX}/rounds/${r2.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'attention' },
      { item_name: '听异响', result_value: 'normal' }
    ]
  });

  const r3 = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: d3.body.id,
    planned_start_at: '2099-02-01T08:00:00.000Z',
    planned_end_at: '2099-02-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${r3.body.id}/start`).send({});
  await request(app).post(`${PREFIX}/rounds/${r3.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'normal' }
    ]
  });
  await request(app).post(`${PREFIX}/rounds/${r3.body.id}/close`).send({});

  const res = await request(app).get(`${PREFIX}/reports/risk-summary`);
  assert.equal(res.status, 200);
  const items = res.body.items;

  const aHigh = items.find(i => i.area === 'A区' && i.risk_level === 'high');
  assert.ok(aHigh, 'A区 high row missing');
  assert.equal(aHigh.device_count, 1);
  assert.equal(aHigh.unclosed_round_count, 1);
  assert.equal(aHigh.closed_round_count, 0);
  assert.equal(aHigh.overdue_round_count, 1);
  assert.equal(aHigh.anomaly_result_count, 1);
  assert.equal(aHigh.pending_review_count, 1);

  const aCritical = items.find(i => i.area === 'A区' && i.risk_level === 'critical');
  assert.ok(aCritical);
  assert.equal(aCritical.unclosed_round_count, 1);
  assert.equal(aCritical.overdue_round_count, 0);
  assert.equal(aCritical.anomaly_result_count, 1);
  assert.equal(aCritical.pending_review_count, 1);

  const bLow = items.find(i => i.area === 'B区' && i.risk_level === 'low');
  assert.ok(bLow);
  assert.equal(bLow.unclosed_round_count, 0);
  assert.equal(bLow.closed_round_count, 1);
  assert.equal(bLow.overdue_round_count, 0);
  assert.equal(bLow.anomaly_result_count, 0);
  assert.equal(bLow.pending_review_count, 0);

  const filtered = await request(app).get(`${PREFIX}/reports/risk-summary?area=A区&risk_level=high`);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.items[0].area, 'A区');
  assert.equal(filtered.body.items[0].risk_level, 'high');
});

test('audit events record operator, action, entity_type and description for required operations', async () => {
  const { app } = buildApp();
  const { deviceId, checklistId } = await setup(app);

  await request(app).post(`${PREFIX}/devices/${deviceId}/disable`).send({ operator_name: '设备管理员' });

  const copied = await request(app).post(`${PREFIX}/checklists/${checklistId}/copy-version`).send({
    operator_name: '清单管理员',
    items: [
      { item_name: '检查油位' },
      { item_name: '听异响' },
      { item_name: '测温升' }
    ]
  });
  assert.equal(copied.status, 201);

  const d2 = await request(app).post(`${PREFIX}/devices`).send(devicePayload({ device_code: 'DEV-AUDIT-02', area: 'A区' }));
  const gen2 = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: d2.body.id,
    planned_start_at: '2026-08-02T08:00:00.000Z',
    planned_end_at: '2026-08-02T18:00:00.000Z'
  });
  assert.equal(gen2.status, 201, JSON.stringify(gen2.body));
  await request(app).post(`${PREFIX}/rounds/${gen2.body.id}/start`).send({ operator_name: '巡检员张三' });
  const submit = await request(app).post(`${PREFIX}/rounds/${gen2.body.id}/submit-results`).send({
    operator_name: '巡检员张三',
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'fault' },
      { item_name: '测温升', result_value: 'normal' }
    ]
  });
  assert.equal(submit.status, 200, JSON.stringify(submit.body));
  const reviewId = submit.body.anomaly_reviews[0].id;
  await request(app).post(`${PREFIX}/anomaly-reviews/${reviewId}/review`).send({
    review_status: 'resolved',
    reviewer_name: '复核员李四',
    review_note: '已处理'
  });
  await request(app).post(`${PREFIX}/rounds/${gen2.body.id}/close`).send({ operator_name: '复核员李四' });

  const events = await request(app).get(`${PREFIX}/reports/audit-events?limit=200`);
  assert.equal(events.status, 200);
  const items = events.body.items;

  function findEvent(action) {
    return items.find(e => e.payload && e.payload.action === action);
  }

  const deviceDisabled = findEvent('disable_device');
  assert.ok(deviceDisabled, 'device disable audit missing');
  assert.equal(deviceDisabled.operator_name, '设备管理员');
  assert.equal(deviceDisabled.entity_type, 'device');
  assert.equal(deviceDisabled.payload.entity_type, 'device');
  assert.equal(typeof deviceDisabled.payload.description, 'string');
  assert.match(deviceDisabled.payload.description, /设备管理员/);

  const checklistCopied = findEvent('copy_checklist_version');
  assert.ok(checklistCopied, 'checklist copy audit missing');
  assert.equal(checklistCopied.operator_name, '清单管理员');
  assert.equal(checklistCopied.entity_type, 'checklist');
  assert.equal(checklistCopied.payload.entity_type, 'checklist');
  assert.equal(checklistCopied.payload.new_version, 2);
  assert.match(checklistCopied.payload.description, /清单管理员/);

  const roundStarted = findEvent('start_round');
  assert.ok(roundStarted, 'round start audit missing');
  assert.equal(roundStarted.operator_name, '巡检员张三');
  assert.equal(roundStarted.entity_type, 'round');
  assert.equal(roundStarted.payload.entity_type, 'round');
  assert.match(roundStarted.payload.description, /巡检员张三/);

  const roundSubmitted = findEvent('submit_round_results');
  assert.ok(roundSubmitted, 'round submit audit missing');
  assert.equal(roundSubmitted.operator_name, '巡检员张三');
  assert.equal(roundSubmitted.entity_type, 'round');
  assert.equal(roundSubmitted.payload.entity_type, 'round');
  assert.equal(roundSubmitted.payload.fault_count, 1);
  assert.equal(roundSubmitted.payload.auto_generated_review_count, 1);
  assert.match(roundSubmitted.payload.description, /fault/);

  const anomalyReviewed = findEvent('review_anomaly');
  assert.ok(anomalyReviewed, 'anomaly review audit missing');
  assert.equal(anomalyReviewed.operator_name, '复核员李四');
  assert.equal(anomalyReviewed.entity_type, 'anomaly_review');
  assert.equal(anomalyReviewed.payload.entity_type, 'anomaly_review');
  assert.equal(anomalyReviewed.payload.review_status, 'resolved');
  assert.match(anomalyReviewed.payload.description, /复核员李四/);

  const roundClosed = findEvent('close_round');
  assert.ok(roundClosed, 'round close audit missing');
  assert.equal(roundClosed.operator_name, '复核员李四');
  assert.equal(roundClosed.entity_type, 'round');
  assert.equal(roundClosed.payload.entity_type, 'round');
  assert.match(roundClosed.payload.description, /轮次/);
});
