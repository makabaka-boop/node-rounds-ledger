const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

async function createDevice(overrides = {}) {
  const res = await request(app).post('/api/v1/devices').send({
    device_code: 'LOOP-DEV',
    device_name: '闭环测试设备',
    area: '闭环区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides,
  });
  return res.body;
}

async function createChecklist(overrides = {}) {
  const res = await request(app).post('/api/v1/checklists').send({
    checklist_name: '闭环测试清单',
    device_type: 'pump',
    items: ['检查A', '检查B', '检查C'],
    cycle_days: 7,
    ...overrides,
  });
  return res.body;
}

async function createSubmittedRoundWithFaults(device, checklist) {
  const genRes = await request(app).post('/api/v1/rounds/generate').send({
    device_id: device.id,
    checklist_id: checklist.id,
    planned_start_at: new Date().toISOString(),
    owner_name: '测试员',
  });
  const round = genRes.body;
  await request(app).post(`/api/v1/rounds/${round.id}/start`);
  await request(app)
    .post(`/api/v1/rounds/${round.id}/submit`)
    .send({
      results: [
        { item_name: '检查A', result_value: 'fault', note: '故障A' },
        { item_name: '检查B', result_value: 'fault', note: '故障B' },
        { item_name: '检查C', result_value: 'normal' },
      ],
    });
  return round;
}

async function getReviewIds(roundId) {
  const details = await request(app).get(`/api/v1/rounds/${roundId}`);
  const faultResults = details.body.results.filter(
    r => r.result_value === 'fault'
  );
  return faultResults.map(r => r.review.id);
}

describe('Exception Review Closure Loop', () => {
  let device, checklist;

  beforeEach(async () => {
    const ts = Date.now();
    device = await createDevice({ device_code: `LOOP-${ts}-${Math.random().toString(36).slice(2, 6)}` });
    checklist = await createChecklist({
      checklist_name: `闭环清单-${ts}-${Math.random().toString(36).slice(2, 6)}`,
    });
  });

  it('should not close round when exceptions are pending review', async () => {
    const round = await createSubmittedRoundWithFaults(device, checklist);

    const closeRes = await request(app).post(
      `/api/v1/rounds/${round.id}/close`
    );

    expect(closeRes.status).toBe(422);
    expect(closeRes.body.error_code).toBe('BUSINESS_RULE_VIOLATION');
    expect(closeRes.body.details.blocking_count).toBeGreaterThanOrEqual(1);
    expect(closeRes.body.details.pending_count).toBeGreaterThanOrEqual(1);
  });

  it('should not close round when exception is confirmed (confirmed is not a closure condition)', async () => {
    const round = await createSubmittedRoundWithFaults(device, checklist);
    const reviewIds = await getReviewIds(round.id);

    await request(app)
      .post(`/api/v1/exception-reviews/${reviewIds[0]}/review`)
      .send({
        review_status: 'confirmed',
        reviewer_name: '张工',
        review_note: '确认故障存在',
      });

    await request(app)
      .post(`/api/v1/exception-reviews/${reviewIds[1]}/review`)
      .send({
        review_status: 'resolved',
        reviewer_name: '李工',
        review_note: '已修复',
      });

    const closeRes = await request(app).post(
      `/api/v1/rounds/${round.id}/close`
    );

    expect(closeRes.status).toBe(422);
    expect(closeRes.body.error_code).toBe('BUSINESS_RULE_VIOLATION');
    expect(closeRes.body.details.confirmed_count).toBeGreaterThanOrEqual(1);
    expect(closeRes.body.message).toContain('confirmed');
  });

  it('should close round successfully when all exceptions are resolved', async () => {
    const round = await createSubmittedRoundWithFaults(device, checklist);
    const reviewIds = await getReviewIds(round.id);

    for (const reviewId of reviewIds) {
      await request(app)
        .post(`/api/v1/exception-reviews/${reviewId}/review`)
        .send({
          review_status: 'resolved',
          reviewer_name: '维修组',
          review_note: '已修复',
        });
    }

    const closeRes = await request(app).post(
      `/api/v1/rounds/${round.id}/close`
    );

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.round_status).toBe('closed');
    expect(closeRes.body.closed_at).toBeDefined();
  });

  it('should close round successfully when all exceptions are ignored', async () => {
    const round = await createSubmittedRoundWithFaults(device, checklist);
    const reviewIds = await getReviewIds(round.id);

    for (const reviewId of reviewIds) {
      await request(app)
        .post(`/api/v1/exception-reviews/${reviewId}/review`)
        .send({
          review_status: 'ignored',
          reviewer_name: '主管',
          review_note: '误报，忽略',
        });
    }

    const closeRes = await request(app).post(
      `/api/v1/rounds/${round.id}/close`
    );

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.round_status).toBe('closed');
  });

  it('should close round successfully with mixed ignored and resolved reviews', async () => {
    const round = await createSubmittedRoundWithFaults(device, checklist);
    const reviewIds = await getReviewIds(round.id);

    await request(app)
      .post(`/api/v1/exception-reviews/${reviewIds[0]}/review`)
      .send({
        review_status: 'ignored',
        reviewer_name: '主管',
        review_note: '误报',
      });

    await request(app)
      .post(`/api/v1/exception-reviews/${reviewIds[1]}/review`)
      .send({
        review_status: 'resolved',
        reviewer_name: '维修组',
        review_note: '已修复',
      });

    const closeRes = await request(app).post(
      `/api/v1/rounds/${round.id}/close`
    );

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.round_status).toBe('closed');
  });

  it('should close round with no exceptions (all normal results)', async () => {
    const genRes = await request(app).post('/api/v1/rounds/generate').send({
      device_id: device.id,
      checklist_id: checklist.id,
      planned_start_at: new Date().toISOString(),
      owner_name: '测试员',
    });
    const round = genRes.body;
    await request(app).post(`/api/v1/rounds/${round.id}/start`);
    await request(app)
      .post(`/api/v1/rounds/${round.id}/submit`)
      .send({
        results: [
          { item_name: '检查A', result_value: 'normal' },
          { item_name: '检查B', result_value: 'normal' },
          { item_name: '检查C', result_value: 'normal' },
        ],
      });

    const closeRes = await request(app).post(
      `/api/v1/rounds/${round.id}/close`
    );

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.round_status).toBe('closed');
  });

  it('should provide blocking item details when closure fails', async () => {
    const round = await createSubmittedRoundWithFaults(device, checklist);
    const reviewIds = await getReviewIds(round.id);

    await request(app)
      .post(`/api/v1/exception-reviews/${reviewIds[0]}/review`)
      .send({
        review_status: 'confirmed',
        reviewer_name: '张工',
      });

    const closeRes = await request(app).post(
      `/api/v1/rounds/${round.id}/close`
    );

    expect(closeRes.status).toBe(422);
    expect(Array.isArray(closeRes.body.details.blocking_items)).toBe(true);
    expect(closeRes.body.details.blocking_items.length).toBeGreaterThanOrEqual(1);
    const blockingItem = closeRes.body.details.blocking_items[0];
    expect(blockingItem).toHaveProperty('review_id');
    expect(blockingItem).toHaveProperty('item_name');
    expect(blockingItem).toHaveProperty('result_value');
    expect(blockingItem).toHaveProperty('review_status');
  });
});

describe('Risk Summary by Area and Risk Level', () => {
  it('should return risk summary grouped by area and risk_level', async () => {
    const device1 = await createDevice({
      device_code: `RS-1-${Date.now()}`,
      area: '甲区',
      risk_level: 'high',
    });
    await createDevice({
      device_code: `RS-2-${Date.now()}`,
      area: '甲区',
      risk_level: 'critical',
    });
    const device3 = await createDevice({
      device_code: `RS-3-${Date.now()}`,
      area: '乙区',
      risk_level: 'low',
    });

    const checklist1 = await createChecklist({
      checklist_name: `风险清单1-${Date.now()}`,
      items: ['X', 'Y'],
    });

    const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const gen1 = await request(app).post('/api/v1/rounds/generate').send({
      device_id: device1.id,
      checklist_id: checklist1.id,
      planned_start_at: pastStart,
      planned_end_at: pastEnd,
      owner_name: 'A',
    });
    await request(app).post(`/api/v1/rounds/${gen1.body.id}/start`);
    await request(app)
      .post(`/api/v1/rounds/${gen1.body.id}/submit`)
      .send({
        results: [
          { item_name: 'X', result_value: 'fault', note: '故障' },
          { item_name: 'Y', result_value: 'attention', note: '关注' },
        ],
      });

    const gen3 = await request(app).post('/api/v1/rounds/generate').send({
      device_id: device3.id,
      checklist_id: checklist1.id,
      planned_start_at: new Date().toISOString(),
      owner_name: 'C',
    });
    await request(app).post(`/api/v1/rounds/${gen3.body.id}/start`);
    await request(app)
      .post(`/api/v1/rounds/${gen3.body.id}/submit`)
      .send({
        results: [
          { item_name: 'X', result_value: 'normal' },
          { item_name: 'Y', result_value: 'normal' },
        ],
      });
    await request(app).post(`/api/v1/rounds/${gen3.body.id}/close`);

    const res = await request(app).get('/api/v1/queries/risk-summary');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const jiaQuHigh = res.body.find(
      r => r.area === '甲区' && r.risk_level === 'high'
    );
    expect(jiaQuHigh).toBeTruthy();
    expect(jiaQuHigh.open_rounds_count).toBeGreaterThanOrEqual(1);
    expect(jiaQuHigh.exception_items_count).toBeGreaterThanOrEqual(2);
    expect(jiaQuHigh.pending_review_count).toBeGreaterThanOrEqual(2);
    expect(jiaQuHigh.overdue_rounds_count).toBeGreaterThanOrEqual(1);

    const yiQuLow = res.body.find(
      r => r.area === '乙区' && r.risk_level === 'low'
    );
    expect(yiQuLow).toBeTruthy();
    expect(yiQuLow.closed_rounds_count).toBeGreaterThanOrEqual(1);
    expect(yiQuLow.open_rounds_count).toBe(0);
  });

  it('should return zero counts for devices with no rounds', async () => {
    await createDevice({
      device_code: `RS-NONE-${Date.now()}`,
      area: '空区',
      risk_level: 'medium',
    });

    const res = await request(app).get('/api/v1/queries/risk-summary');

    const emptyGroup = res.body.find(
      r => r.area === '空区' && r.risk_level === 'medium'
    );
    expect(emptyGroup).toBeTruthy();
    expect(emptyGroup.open_rounds_count).toBe(0);
    expect(emptyGroup.closed_rounds_count).toBe(0);
    expect(emptyGroup.overdue_rounds_count).toBe(0);
    expect(emptyGroup.exception_items_count).toBe(0);
    expect(emptyGroup.pending_review_count).toBe(0);
  });
});

describe('Audit Event Enrichment', () => {
  it('should record device deactivation with operator and description', async () => {
    const device = await createDevice({
      device_code: `AUDIT-DEV-${Date.now()}`,
    });

    await request(app)
      .post(`/api/v1/devices/${device.id}/deactivate`)
      .set('x-operator', 'deactivate-admin');

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({
        event_type: 'device.deactivated',
        entity_id: device.id,
      });

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const event = res.body[0];
    expect(event.operator_name).toBe('deactivate-admin');
    expect(event.entity_type).toBe('device');
    expect(event.event_data.description).toBeDefined();
    expect(event.event_data.description).toContain('停用');
  });

  it('should record checklist copy with operator and description', async () => {
    const checklist = await createChecklist({
      checklist_name: `审计复制清单-${Date.now()}`,
    });

    await request(app)
      .post(`/api/v1/checklists/${checklist.id}/copy-version`)
      .set('x-operator', 'checklist-admin')
      .send({ items: ['新项目'] });

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({ event_type: 'checklist.version_copied' });

    expect(res.status).toBe(200);
    const event = res.body.find(e => e.operator_name === 'checklist-admin');
    expect(event).toBeTruthy();
    expect(event.event_data.description).toContain('复制清单');
    expect(event.event_data.source_version).toBe(1);
    expect(event.event_data.new_version).toBe(2);
  });

  it('should record round start with operator and description', async () => {
    const device = await createDevice({
      device_code: `AUDIT-START-${Date.now()}`,
    });
    const checklist = await createChecklist({
      checklist_name: `审计开始清单-${Date.now()}`,
    });

    const genRes = await request(app).post('/api/v1/rounds/generate').send({
      device_id: device.id,
      checklist_id: checklist.id,
      planned_start_at: new Date().toISOString(),
      owner_name: 'executor',
    });

    await request(app)
      .post(`/api/v1/rounds/${genRes.body.id}/start`)
      .set('x-operator', 'round-starter');

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({ event_type: 'round.started' });

    expect(res.status).toBe(200);
    const event = res.body.find(e => e.operator_name === 'round-starter');
    expect(event).toBeTruthy();
    expect(event.entity_type).toBe('round');
    expect(event.event_data.description).toContain('开始巡检');
  });

  it('should record result submission with fault and attention counts', async () => {
    const device = await createDevice({
      device_code: `AUDIT-SUBMIT-${Date.now()}`,
    });
    const checklist = await createChecklist({
      checklist_name: `审计提交清单-${Date.now()}`,
      items: ['A', 'B', 'C'],
    });

    const genRes = await request(app).post('/api/v1/rounds/generate').send({
      device_id: device.id,
      checklist_id: checklist.id,
      planned_start_at: new Date().toISOString(),
      owner_name: 'submitter',
    });
    await request(app).post(`/api/v1/rounds/${genRes.body.id}/start`);
    await request(app)
      .post(`/api/v1/rounds/${genRes.body.id}/submit`)
      .set('x-operator', 'submit-operator')
      .send({
        results: [
          { item_name: 'A', result_value: 'fault' },
          { item_name: 'B', result_value: 'attention' },
          { item_name: 'C', result_value: 'normal' },
        ],
      });

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({ event_type: 'round.results_submitted' });

    expect(res.status).toBe(200);
    const event = res.body.find(e => e.operator_name === 'submit-operator');
    expect(event).toBeTruthy();
    expect(event.event_data.result_count).toBe(3);
    expect(event.event_data.fault_count).toBe(1);
    expect(event.event_data.attention_count).toBe(1);
    expect(event.event_data.description).toContain('故障1项');
    expect(event.event_data.description).toContain('关注1项');
  });

  it('should record exception review with operator and conclusion', async () => {
    const device = await createDevice({
      device_code: `AUDIT-REV-${Date.now()}`,
    });
    const checklist = await createChecklist({
      checklist_name: `审计复核清单-${Date.now()}`,
      items: ['X', 'Y'],
    });

    const genRes = await request(app).post('/api/v1/rounds/generate').send({
      device_id: device.id,
      checklist_id: checklist.id,
      planned_start_at: new Date().toISOString(),
      owner_name: 'executor',
    });
    await request(app).post(`/api/v1/rounds/${genRes.body.id}/start`);
    await request(app)
      .post(`/api/v1/rounds/${genRes.body.id}/submit`)
      .send({
        results: [
          { item_name: 'X', result_value: 'fault' },
          { item_name: 'Y', result_value: 'normal' },
        ],
      });

    const details = await request(app).get(
      `/api/v1/rounds/${genRes.body.id}`
    );
    const reviewId = details.body.results.find(
      r => r.result_value === 'fault'
    ).review.id;

    await request(app)
      .post(`/api/v1/exception-reviews/${reviewId}/review`)
      .set('x-operator', 'review-engineer')
      .send({
        review_status: 'resolved',
        reviewer_name: 'review-engineer',
        review_note: '已处理',
      });

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({ event_type: 'exception.reviewed' });

    expect(res.status).toBe(200);
    const event = res.body.find(e => e.operator_name === 'review-engineer');
    expect(event).toBeTruthy();
    expect(event.entity_type).toBe('exception_review');
    expect(event.event_data.review_status).toBe('resolved');
    expect(event.event_data.description).toContain('resolved');
    expect(event.event_data.description).toContain('review-engineer');
  });

  it('should record round close with operator and description', async () => {
    const device = await createDevice({
      device_code: `AUDIT-CLOSE-${Date.now()}`,
    });
    const checklist = await createChecklist({
      checklist_name: `审计关闭清单-${Date.now()}`,
      items: ['A'],
    });

    const genRes = await request(app).post('/api/v1/rounds/generate').send({
      device_id: device.id,
      checklist_id: checklist.id,
      planned_start_at: new Date().toISOString(),
      owner_name: 'executor',
    });
    await request(app).post(`/api/v1/rounds/${genRes.body.id}/start`);
    await request(app)
      .post(`/api/v1/rounds/${genRes.body.id}/submit`)
      .send({
        results: [{ item_name: 'A', result_value: 'normal' }],
      });

    await request(app)
      .post(`/api/v1/rounds/${genRes.body.id}/close`)
      .set('x-operator', 'close-supervisor');

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({ event_type: 'round.closed' });

    expect(res.status).toBe(200);
    const event = res.body.find(e => e.operator_name === 'close-supervisor');
    expect(event).toBeTruthy();
    expect(event.entity_type).toBe('round');
    expect(event.event_data.description).toContain('关闭');
    expect(event.event_data.closed_at).toBeDefined();
  });
});
