const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

describe('Audit Events API', () => {
  it('should record audit events when devices are created', async () => {
    await request(app)
      .post('/api/v1/devices')
      .set('x-operator', 'audit-tester')
      .send({
        device_code: 'AUDIT-001',
        device_name: '审计设备',
        area: '审计区',
        device_type: 'pump',
        risk_level: 'low',
      });

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({ entity_type: 'device', limit: 10 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].event_type).toBe('device.created');
    expect(res.body[0].operator_name).toBe('audit-tester');
  });

  it('should record audit events for round lifecycle', async () => {
    const deviceRes = await request(app).post('/api/v1/devices').send({
      device_code: 'AUDIT-ROUND-001',
      device_name: '审计轮次设备',
      area: '审计区',
      device_type: 'motor',
      risk_level: 'medium',
    });

    const checklistRes = await request(app).post('/api/v1/checklists').send({
      checklist_name: '审计清单',
      device_type: 'motor',
      items: ['检查A'],
      cycle_days: 30,
    });

    const genRes = await request(app)
      .post('/api/v1/rounds/generate')
      .set('x-operator', 'planner')
      .send({
        device_id: deviceRes.body.id,
        checklist_id: checklistRes.body.id,
        planned_start_at: new Date().toISOString(),
        owner_name: '执行人',
      });

    await request(app)
      .post(`/api/v1/rounds/${genRes.body.id}/start`)
      .set('x-operator', 'executor');

    await request(app)
      .post(`/api/v1/rounds/${genRes.body.id}/submit`)
      .set('x-operator', 'executor')
      .send({
        results: [{ item_name: '检查A', result_value: 'normal' }],
      });

    await request(app)
      .post(`/api/v1/rounds/${genRes.body.id}/close`)
      .set('x-operator', 'supervisor');

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({ entity_type: 'round', limit: 50 });

    expect(res.status).toBe(200);
    const eventTypes = res.body.map(e => e.event_type);
    expect(eventTypes).toContain('round.generated');
    expect(eventTypes).toContain('round.started');
    expect(eventTypes).toContain('round.results_submitted');
    expect(eventTypes).toContain('round.closed');
  });

  it('should filter audit events by event_type', async () => {
    await request(app).post('/api/v1/devices').send({
      device_code: 'AUDIT-FILTER-001',
      device_name: '过滤设备',
      area: 'A区',
      device_type: 'pump',
      risk_level: 'low',
    });

    const res = await request(app)
      .get('/api/v1/audit-events')
      .query({ event_type: 'device.created' });

    expect(res.status).toBe(200);
    expect(res.body.every(e => e.event_type === 'device.created')).toBe(true);
  });
});
