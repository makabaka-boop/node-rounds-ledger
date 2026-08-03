const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

async function createDevice(overrides = {}) {
  const res = await request(app).post('/api/v1/devices').send({
    device_code: 'R-DEV-001',
    device_name: '轮次测试设备',
    area: '生产区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides,
  });
  return res.body;
}

async function createChecklist(overrides = {}) {
  const res = await request(app).post('/api/v1/checklists').send({
    checklist_name: '测试巡检清单',
    device_type: 'pump',
    items: ['检查油位', '检查温度', '检查密封'],
    cycle_days: 7,
    ...overrides,
  });
  return res.body;
}

async function generateRound(device, checklist, overrides = {}) {
  const res = await request(app).post('/api/v1/rounds/generate').send({
    device_id: device.id,
    checklist_id: checklist.id,
    planned_start_at: new Date().toISOString(),
    owner_name: '张三',
    ...overrides,
  });
  return res.body;
}

describe('Round Lifecycle API', () => {
  let device, checklist;

  beforeEach(async () => {
    device = await createDevice({ device_code: `R-DEV-${Date.now()}` });
    checklist = await createChecklist({
      checklist_name: `清单-${Date.now()}`,
    });
  });

  describe('POST /api/v1/rounds/generate', () => {
    it('should generate a scheduled round with snapshot', async () => {
      const round = await generateRound(device, checklist);

      expect(round.id).toBeDefined();
      expect(round.device_id).toBe(device.id);
      expect(round.checklist_id).toBe(checklist.id);
      expect(round.checklist_snapshot_id).toBeDefined();
      expect(round.round_status).toBe('scheduled');
      expect(round.owner_name).toBe('张三');
      expect(round.snapshot).toBeDefined();
      expect(round.snapshot.items).toEqual(checklist.items);
      expect(round.snapshot.version).toBe(1);
    });

    it('should reject if device type does not match checklist type', async () => {
      const wrongDevice = await createDevice({
        device_code: 'WRONG-TYPE',
        device_type: 'compressor',
      });

      const res = await request(app).post('/api/v1/rounds/generate').send({
        device_id: wrongDevice.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: '李四',
      });

      expect(res.status).toBe(422);
      expect(res.body.error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('should reject for deactivated device', async () => {
      await request(app).post(`/api/v1/devices/${device.id}/deactivate`);

      const res = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: '李四',
      });

      expect(res.status).toBe(422);
    });
  });

  describe('Round Status Transitions', () => {
    it('should not allow scheduled -> closed directly', async () => {
      const round = await generateRound(device, checklist);

      const res = await request(app).post(`/api/v1/rounds/${round.id}/close`);

      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe('INVALID_STATE_TRANSITION');
    });

    it('should transition scheduled -> in_progress -> submitted -> closed', async () => {
      const round = await generateRound(device, checklist);

      const startRes = await request(app).post(
        `/api/v1/rounds/${round.id}/start`
      );
      expect(startRes.status).toBe(200);
      expect(startRes.body.round_status).toBe('in_progress');
      expect(startRes.body.started_at).toBeDefined();

      const submitRes = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查油位', result_value: 'normal', note: '正常' },
            { item_name: '检查温度', result_value: 'normal', note: '' },
            { item_name: '检查密封', result_value: 'normal', note: '' },
          ],
        });
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.round_status).toBe('submitted');

      const closeRes = await request(app).post(
        `/api/v1/rounds/${round.id}/close`
      );
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.round_status).toBe('closed');
      expect(closeRes.body.closed_at).toBeDefined();
    });

    it('should reject starting an already closed round', async () => {
      const round = await generateRound(device, checklist);
      await request(app).post(`/api/v1/rounds/${round.id}/start`);
      await request(app).post(`/api/v1/rounds/${round.id}/submit`).send({
        results: [
          { item_name: '检查油位', result_value: 'normal' },
          { item_name: '检查温度', result_value: 'normal' },
          { item_name: '检查密封', result_value: 'normal' },
        ],
      });
      await request(app).post(`/api/v1/rounds/${round.id}/close`);

      const res = await request(app).post(`/api/v1/rounds/${round.id}/start`);
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/v1/rounds/:id/submit', () => {
    it('should validate result items against snapshot', async () => {
      const round = await generateRound(device, checklist);
      await request(app).post(`/api/v1/rounds/${round.id}/start`);

      const res = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '不存在的项目', result_value: 'normal' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid result_value', async () => {
      const round = await generateRound(device, checklist);
      await request(app).post(`/api/v1/rounds/${round.id}/start`);

      const res = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查油位', result_value: 'bad_value' },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('should auto-generate pending exceptions for fault and attention results', async () => {
      const round = await generateRound(device, checklist);
      await request(app).post(`/api/v1/rounds/${round.id}/start`);

      await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查油位', result_value: 'normal' },
            { item_name: '检查温度', result_value: 'attention', note: '温度偏高' },
            { item_name: '检查密封', result_value: 'fault', note: '泄漏' },
          ],
        });

      const detailsRes = await request(app).get(
        `/api/v1/rounds/${round.id}`
      );
      const results = detailsRes.body.results;

      const faultResult = results.find(r => r.result_value === 'fault');
      const attentionResult = results.find(r => r.result_value === 'attention');
      const normalResult = results.find(r => r.result_value === 'normal');

      expect(faultResult.review).toBeTruthy();
      expect(faultResult.review.review_status).toBe('pending');
      expect(attentionResult.review).toBeTruthy();
      expect(attentionResult.review.review_status).toBe('pending');
      expect(normalResult.review).toBeNull();
    });
  });

  describe('Close with pending faults', () => {
    it('should not close round when there are unreviewed fault results', async () => {
      const round = await generateRound(device, checklist);
      await request(app).post(`/api/v1/rounds/${round.id}/start`);
      await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查油位', result_value: 'fault', note: '严重泄漏' },
            { item_name: '检查温度', result_value: 'normal' },
            { item_name: '检查密封', result_value: 'normal' },
          ],
        });

      const closeRes = await request(app).post(
        `/api/v1/rounds/${round.id}/close`
      );
      expect(closeRes.status).toBe(422);
      expect(closeRes.body.error_code).toBe('BUSINESS_RULE_VIOLATION');
      expect(closeRes.body.message).toContain('未闭环');
    });

    it('should allow closing after all faults are reviewed', async () => {
      const round = await generateRound(device, checklist);
      await request(app).post(`/api/v1/rounds/${round.id}/start`);
      const submitRes = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查油位', result_value: 'fault', note: '泄漏' },
            { item_name: '检查温度', result_value: 'normal' },
            { item_name: '检查密封', result_value: 'normal' },
          ],
        });

      const detailsRes = await request(app).get(`/api/v1/rounds/${round.id}`);
      const faultResult = detailsRes.body.results.find(
        r => r.result_value === 'fault'
      );

      await request(app)
        .post(`/api/v1/exception-reviews/${faultResult.review.id}/review`)
        .send({
          review_status: 'resolved',
          reviewer_name: '王工',
          review_note: '已更换密封件',
        });

      const closeRes = await request(app).post(
        `/api/v1/rounds/${round.id}/close`
      );
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.round_status).toBe('closed');
    });
  });
});
