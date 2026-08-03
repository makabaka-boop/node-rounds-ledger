const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildApp } = require('./helpers');

const PREFIX = '/api/v1';

function devicePayload(overrides = {}) {
  return {
    device_code: 'DEV-STRICT-01',
    device_name: '严格校验泵',
    area: 'A区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides
  };
}

function checklistPayload(overrides = {}) {
  return {
    checklist_name: '严格校验清单',
    device_type: 'pump',
    cycle_days: 7,
    items: [
      { item_name: '检查油位' },
      { item_name: '听异响' },
      { item_name: '测振动' }
    ],
    ...overrides
  };
}

async function seed(app) {
  const deviceRes = await request(app).post(`${PREFIX}/devices`).send(devicePayload());
  const checklistRes = await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());
  return { deviceId: deviceRes.body.id, checklistId: checklistRes.body.id };
}

async function generateAndStartRound(app, deviceId, overrides = {}) {
  const generated = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z',
    ...overrides
  });
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  await request(app).post(`${PREFIX}/rounds/${generated.body.id}/start`).send({});
  return generated.body;
}

test('planned_end_at earlier than planned_start_at is rejected', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);
  const res = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: '2026-08-02T18:00:00.000Z',
    planned_end_at: '2026-08-02T08:00:00.000Z'
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error_code, 'VALIDATION_ERROR');
  assert.match(res.body.message, /planned_end_at/);
});

test('planned_end_at equal to planned_start_at is allowed', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);
  const res = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: '2026-08-02T08:00:00.000Z',
    planned_end_at: '2026-08-02T08:00:00.000Z'
  });
  assert.equal(res.status, 201);
});

test('cannot generate round for disabled device', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);
  const disableRes = await request(app).post(`${PREFIX}/devices/${deviceId}/disable`).send({});
  assert.equal(disableRes.status, 200);
  const res = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error_code, 'CONFLICT');
});

test('cannot copy a disabled checklist', async () => {
  const { app } = buildApp();
  const { checklistId } = await seed(app);
  const disableRes = await request(app).post(`${PREFIX}/checklists/${checklistId}/disable`).send({});
  assert.equal(disableRes.status, 200);
  const res = await request(app).post(`${PREFIX}/checklists/${checklistId}/copy-version`).send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.error_code, 'CONFLICT');
});

test('cannot generate round using explicitly disabled checklist', async () => {
  const { app } = buildApp();
  const { deviceId, checklistId } = await seed(app);
  const disableRes = await request(app).post(`${PREFIX}/checklists/${checklistId}/disable`).send({});
  assert.equal(disableRes.status, 200);
  const res = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    checklist_id: checklistId,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error_code, 'CONFLICT');
});

test('result count must match snapshot: fewer items rejected', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);
  const round = await generateAndStartRound(app, deviceId);
  const res = await request(app).post(`${PREFIX}/rounds/${round.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'normal' }
    ]
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error_code, 'VALIDATION_ERROR');
  assert.equal(res.body.details.expected_item_count, 3);
  assert.equal(res.body.details.received_item_count, 2);
});

test('result count must match snapshot: extra items rejected', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);
  const round = await generateAndStartRound(app, deviceId);
  const res = await request(app).post(`${PREFIX}/rounds/${round.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'normal' },
      { item_name: '测振动', result_value: 'normal' },
      { item_name: '额外项', result_value: 'normal' }
    ]
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error_code, 'VALIDATION_ERROR');
  assert.equal(res.body.details.expected_item_count, 3);
  assert.equal(res.body.details.received_item_count, 4);
});

test('result order must match snapshot: swapped order rejected', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);
  const round = await generateAndStartRound(app, deviceId);
  const res = await request(app).post(`${PREFIX}/rounds/${round.id}/submit-results`).send({
    results: [
      { item_name: '听异响', result_value: 'normal' },
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '测振动', result_value: 'normal' }
    ]
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error_code, 'VALIDATION_ERROR');
  assert.equal(res.body.details.index !== undefined ? res.body.details.index : res.body.details.field, 'results[0].item_name');
  assert.equal(res.body.details.expected_item_name, '检查油位');
  assert.equal(res.body.details.received_item_name, '听异响');
});

test('renamed item is rejected against snapshot', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);
  const round = await generateAndStartRound(app, deviceId);
  const res = await request(app).post(`${PREFIX}/rounds/${round.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '已改名项', result_value: 'normal' },
      { item_name: '测振动', result_value: 'normal' }
    ]
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error_code, 'VALIDATION_ERROR');
  assert.equal(res.body.details.expected_item_name, '听异响');
  assert.equal(res.body.details.received_item_name, '已改名项');
});

test('exact match in correct order succeeds', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);
  const round = await generateAndStartRound(app, deviceId);
  const res = await request(app).post(`${PREFIX}/rounds/${round.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'attention' },
      { item_name: '测振动', result_value: 'fault' }
    ]
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.round_status, 'submitted');
  assert.equal(res.body.results.length, 3);
});

test('old round is not affected by a new checklist version', async () => {
  const { app, container } = buildApp();
  const { deviceId, checklistId } = await seed(app);

  const round1 = await generateAndStartRound(app, deviceId);
  assert.deepEqual(
    round1.checklist_snapshot.items.map(i => i.item_name),
    ['检查油位', '听异响', '测振动']
  );
  assert.equal(round1.checklist_snapshot.version, 1);

  const copied = await request(app).post(`${PREFIX}/checklists/${checklistId}/copy-version`).send({
    items: [
      { item_name: '检查油位' },
      { item_name: '听异响' },
      { item_name: '测振动' },
      { item_name: '测温升' }
    ]
  });
  assert.equal(copied.status, 201);
  assert.equal(copied.body.version, 2);

  const oldRound = await request(app).get(`${PREFIX}/rounds/${round1.id}`);
  assert.equal(oldRound.body.checklist_snapshot.version, 1);
  assert.equal(oldRound.body.checklist_snapshot.items.length, 3);

  const submitOld = await request(app).post(`${PREFIX}/rounds/${round1.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'normal' },
      { item_name: '测振动', result_value: 'normal' }
    ]
  });
  assert.equal(submitOld.status, 200);

  const round2 = await generateAndStartRound(app, deviceId, {
    planned_start_at: '2026-08-08T08:00:00.000Z',
    planned_end_at: '2026-08-08T18:00:00.000Z'
  });
  assert.equal(round2.checklist_snapshot.version, 2);
  assert.equal(round2.checklist_snapshot.items.length, 4);

  const submitNewWithOldItems = await request(app).post(`${PREFIX}/rounds/${round2.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'normal' },
      { item_name: '测振动', result_value: 'normal' }
    ]
  });
  assert.equal(submitNewWithOldItems.status, 400);
  assert.equal(submitNewWithOldItems.body.details.expected_item_count, 4);
});

test('unclosed rounds by area return pending_review_count and overdue', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);

  const overdueRound = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: '2020-01-01T08:00:00.000Z',
    planned_end_at: '2020-01-01T18:00:00.000Z'
  });
  assert.equal(overdueRound.status, 201);
  await request(app).post(`${PREFIX}/rounds/${overdueRound.body.id}/start`).send({});

  const futureRound = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: '2099-01-01T08:00:00.000Z',
    planned_end_at: '2099-01-01T18:00:00.000Z'
  });
  assert.equal(futureRound.status, 201);

  const submittedOverdue = await request(app).post(`${PREFIX}/rounds/${overdueRound.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'fault' },
      { item_name: '听异响', result_value: 'normal' },
      { item_name: '测振动', result_value: 'attention' }
    ]
  });
  assert.equal(submittedOverdue.status, 200);

  const res = await request(app).get(`${PREFIX}/rounds/area/A区/unclosed`);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);

  const overdueItem = res.body.items.find(i => i.id === overdueRound.body.id);
  const futureItem = res.body.items.find(i => i.id === futureRound.body.id);

  assert.equal(overdueItem.overdue, true);
  assert.equal(overdueItem.pending_review_count, 2);

  assert.equal(futureItem.overdue, false);
  assert.equal(futureItem.pending_review_count, 0);
});

test('overdue is false for a closed round even if planned_end_at is in the past', async () => {
  const { app } = buildApp();
  const { deviceId } = await seed(app);

  const round = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: deviceId,
    planned_start_at: '2020-01-01T08:00:00.000Z',
    planned_end_at: '2020-01-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${round.body.id}/start`).send({});
  const submitted = await request(app).post(`${PREFIX}/rounds/${round.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'normal' },
      { item_name: '测振动', result_value: 'normal' }
    ]
  });
  assert.equal(submitted.status, 200);
  const closed = await request(app).post(`${PREFIX}/rounds/${round.body.id}/close`).send({});
  assert.equal(closed.status, 200);

  const res = await request(app).get(`${PREFIX}/rounds/area/A区/unclosed`);
  assert.equal(res.body.total, 0);
});
