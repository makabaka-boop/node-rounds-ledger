const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { buildApp } = require('./helpers');

const PREFIX = '/api/v1';

function devicePayload(overrides = {}) {
  return {
    device_code: 'DEV-SC-01',
    device_name: '自检泵',
    area: 'A区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides
  };
}

function checklistPayload(overrides = {}) {
  return {
    checklist_name: '自检清单',
    device_type: 'pump',
    cycle_days: 7,
    items: [
      { item_name: '检查油位' },
      { item_name: '听异响' }
    ],
    ...overrides
  };
}

async function fullWorkflow(app) {
  const device = await request(app).post(`${PREFIX}/devices`).send(devicePayload());
  const checklist = await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());
  const gen = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z',
    owner_name: '张三'
  });
  await request(app).post(`${PREFIX}/rounds/${gen.body.id}/start`).send({ operator_name: '张三' });
  const submit = await request(app).post(`${PREFIX}/rounds/${gen.body.id}/submit-results`).send({
    operator_name: '张三',
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'fault', note: '有异响' }
    ]
  });
  const reviewId = submit.body.anomaly_reviews[0].id;
  await request(app).post(`${PREFIX}/anomaly-reviews/${reviewId}/review`).send({
    review_status: 'resolved',
    reviewer_name: '李工',
    review_note: '已维修'
  });
  await request(app).post(`${PREFIX}/rounds/${gen.body.id}/close`).send({ operator_name: '李工' });
  return { deviceId: device.body.id, checklistId: checklist.body.id, roundId: gen.body.id };
}

test('self-check returns overall_passed true with all checks after a clean workflow', async () => {
  const { app } = buildApp();
  await fullWorkflow(app);

  const res = await request(app).get(`${PREFIX}/reports/self-check`);
  assert.equal(res.status, 200);
  assert.equal(res.body.overall_passed, true);
  assert.equal(res.body.total_issues, 0);
  assert.ok(Array.isArray(res.body.checks));
  assert.ok(res.body.checks.length >= 7);

  for (const check of res.body.checks) {
    assert.equal(typeof check.check_name, 'string');
    assert.equal(typeof check.passed, 'boolean');
    assert.equal(typeof check.issue_count, 'number');
    assert.ok(Array.isArray(check.details));
    assert.equal(check.passed, true, `check ${check.check_name} should pass`);
    assert.equal(check.issue_count, 0);
  }

  const checkNames = res.body.checks.map(c => c.check_name);
  const expected = [
    'round_status_result_match',
    'fault_missing_review',
    'closed_round_with_pending_review',
    'round_missing_snapshot',
    'disabled_device_with_new_round',
    'snapshot_items_is_json_array',
    'audit_events_present',
    'closed_round_has_closed_at'
  ];
  for (const name of expected) {
    assert.ok(checkNames.includes(name), `missing check: ${name}`);
  }
});

test('self-check detects fault missing review and closed round with pending review', async () => {
  const { app, container } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(devicePayload());
  await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());
  const gen = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${gen.body.id}/start`).send({});
  const submit = await request(app).post(`${PREFIX}/rounds/${gen.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'fault' }
    ]
  });
  assert.equal(submit.status, 200);
  const resultId = submit.body.results.find(r => r.result_value === 'fault').id;

  container.db.prepare('DELETE FROM anomaly_reviews WHERE result_id = ?').run(resultId);
  container.db.prepare(`UPDATE rounds SET round_status = 'closed', closed_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), gen.body.id);
  container.db.prepare(`DELETE FROM audit_events WHERE event_type = 'round.closed' AND entity_id = ?`)
    .run(gen.body.id);

  const res = await request(app).get(`${PREFIX}/reports/self-check`);
  assert.equal(res.status, 200);
  assert.equal(res.body.overall_passed, false);
  assert.ok(res.body.total_issues > 0);

  const faultCheck = res.body.checks.find(c => c.check_name === 'fault_missing_review');
  assert.ok(faultCheck);
  assert.equal(faultCheck.passed, false);
  assert.equal(faultCheck.issue_count, 1);
  assert.equal(faultCheck.details[0].result_id, resultId);

  const auditCheck = res.body.checks.find(c => c.check_name === 'audit_events_present');
  assert.ok(auditCheck);
  assert.equal(auditCheck.passed, false);
  assert.ok(auditCheck.details.some(d => Array.isArray(d.missing_event_types) && d.missing_event_types.includes('round.closed')),
    'expected missing round.closed audit event');
});

test('self-check detects closed round with pending or confirmed review', async () => {
  const { app, container } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(devicePayload());
  await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());
  const gen = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });
  await request(app).post(`${PREFIX}/rounds/${gen.body.id}/start`).send({});
  const submit = await request(app).post(`${PREFIX}/rounds/${gen.body.id}/submit-results`).send({
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'fault' }
    ]
  });
  const reviewId = submit.body.anomaly_reviews[0].id;

  container.db.prepare('UPDATE rounds SET round_status = ?, closed_at = ? WHERE id = ?')
    .run('closed', new Date().toISOString(), gen.body.id);
  container.db.prepare('UPDATE anomaly_reviews SET review_status = ? WHERE id = ?')
    .run('confirmed', reviewId);

  const res = await request(app).get(`${PREFIX}/reports/self-check`);
  const check = res.body.checks.find(c => c.check_name === 'closed_round_with_pending_review');
  assert.ok(check);
  assert.equal(check.passed, false);
  assert.equal(check.issue_count, 1);
  assert.equal(check.details[0].round_id, gen.body.id);
});

test('self-check detects round with missing snapshot', async () => {
  const { app, container } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(devicePayload());
  await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());
  const gen = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });

  container.db.pragma('foreign_keys = OFF');
  container.db.prepare('UPDATE rounds SET checklist_snapshot_id = ? WHERE id = ?')
    .run(999999, gen.body.id);
  container.db.pragma('foreign_keys = ON');

  const res = await request(app).get(`${PREFIX}/reports/self-check`);
  const check = res.body.checks.find(c => c.check_name === 'round_missing_snapshot');
  assert.ok(check);
  assert.equal(check.passed, false);
  assert.equal(check.issue_count, 1);
  assert.equal(check.details[0].round_id, gen.body.id);
});

test('self-check detects snapshot items that are not JSON array', async () => {
  const { app, container } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(devicePayload());
  await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());
  const gen = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });

  container.db.prepare('UPDATE checklist_snapshots SET items_json = ? WHERE id = ?')
    .run('{"not":"an array"}', gen.body.checklist_snapshot_id);

  const res = await request(app).get(`${PREFIX}/reports/self-check`);
  const check = res.body.checks.find(c => c.check_name === 'snapshot_items_is_json_array');
  assert.ok(check);
  assert.equal(check.passed, false);
  assert.equal(check.issue_count, 1);
  assert.equal(check.details[0].snapshot_id, gen.body.checklist_snapshot_id);
});

test('self-check detects disabled device with newer round', async () => {
  const { app, container } = buildApp();
  const device = await request(app).post(`${PREFIX}/devices`).send(devicePayload());
  await request(app).post(`${PREFIX}/checklists`).send(checklistPayload());

  const gen = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z'
  });

  container.db.prepare('UPDATE devices SET enabled = 0, updated_at = ? WHERE id = ?')
    .run('2020-01-01 00:00:00', device.body.id);

  const res = await request(app).get(`${PREFIX}/reports/self-check`);
  const check = res.body.checks.find(c => c.check_name === 'disabled_device_with_new_round');
  assert.ok(check);
  assert.equal(check.passed, false);
  assert.equal(check.issue_count, 1);
  assert.equal(check.details[0].round_id, gen.body.id);
  assert.equal(check.details[0].device_code, 'DEV-SC-01');
});

test('README full operation flow is executable end-to-end', async () => {
  const { app } = buildApp();

  const device = await request(app).post(`${PREFIX}/devices`).send({
    device_code: 'PUMP-01',
    device_name: '主泵A',
    area: 'A区',
    device_type: 'pump',
    risk_level: 'high'
  });
  assert.equal(device.status, 201);
  assert.equal(device.body.device_code, 'PUMP-01');

  const checklist = await request(app).post(`${PREFIX}/checklists`).send({
    checklist_name: '泵类巡检清单',
    device_type: 'pump',
    cycle_days: 7,
    items: [
      { item_name: '检查油位' },
      { item_name: '听异响' }
    ]
  });
  assert.equal(checklist.status, 201);
  assert.equal(checklist.body.version, 1);

  const generated = await request(app).post(`${PREFIX}/rounds/generate`).send({
    device_id: device.body.id,
    planned_start_at: '2026-08-01T08:00:00.000Z',
    planned_end_at: '2026-08-01T18:00:00.000Z',
    owner_name: '张三'
  });
  assert.equal(generated.status, 201);
  assert.equal(generated.body.round_status, 'scheduled');
  assert.equal(generated.body.checklist_snapshot.items.length, 2);

  const started = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/start`).send({ operator_name: '张三' });
  assert.equal(started.status, 200);
  assert.equal(started.body.round_status, 'in_progress');

  const submitted = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/submit-results`).send({
    operator_name: '张三',
    results: [
      { item_name: '检查油位', result_value: 'normal' },
      { item_name: '听异响', result_value: 'fault', note: '发现异常声响' }
    ]
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.round_status, 'submitted');
  assert.equal(submitted.body.anomaly_reviews.length, 1);
  assert.equal(submitted.body.anomaly_reviews[0].review_status, 'pending');

  const reviewId = submitted.body.anomaly_reviews[0].id;
  const reviewed = await request(app).post(`${PREFIX}/anomaly-reviews/${reviewId}/review`).send({
    review_status: 'resolved',
    reviewer_name: '李工',
    review_note: '已安排维修'
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.review_status, 'resolved');

  const closed = await request(app).post(`${PREFIX}/rounds/${generated.body.id}/close`).send({ operator_name: '李工' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.round_status, 'closed');
  assert.ok(closed.body.closed_at);
});

test('all self-check and report endpoints return snake_case fields', async () => {
  const { app } = buildApp();
  await fullWorkflow(app);

  const res = await request(app).get(`${PREFIX}/reports/self-check`);
  assert.equal(res.status, 200);
  const topKeys = Object.keys(res.body);
  for (const key of topKeys) {
    assert.match(key, /^[a-z][a-z0-9_]*$/, `top-level field "${key}" is not snake_case`);
  }
  for (const check of res.body.checks) {
    for (const key of Object.keys(check)) {
      assert.match(key, /^[a-z][a-z0-9_]*$/, `check field "${key}" is not snake_case`);
    }
    for (const detail of check.details) {
      for (const key of Object.keys(detail)) {
        assert.match(key, /^[a-z][a-z0-9_]*$/, `detail field "${key}" is not snake_case`);
      }
    }
  }

  const risk = await request(app).get(`${PREFIX}/reports/risk-summary`);
  assert.equal(risk.status, 200);
  for (const item of risk.body.items) {
    for (const key of Object.keys(item)) {
      assert.match(key, /^[a-z][a-z0-9_]*$/, `risk item field "${key}" is not snake_case`);
    }
  }

  const summary = await request(app).get(`${PREFIX}/reports/area-risk-summary`);
  assert.equal(summary.status, 200);
  for (const item of summary.body.items) {
    for (const key of Object.keys(item)) {
      assert.match(key, /^[a-z][a-z0-9_]*$/, `summary field "${key}" is not snake_case`);
    }
  }

  const events = await request(app).get(`${PREFIX}/reports/audit-events?limit=5`);
  assert.equal(events.status, 200);
  for (const item of events.body.items) {
    for (const key of Object.keys(item)) {
      assert.match(key, /^[a-z][a-z0-9_]*$/, `audit field "${key}" is not snake_case`);
    }
  }
});
