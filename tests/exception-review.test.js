const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

async function createDevice(overrides = {}) {
  const res = await request(app).post('/api/v1/devices').send({
    device_code: 'ER-DEV-001',
    device_name: '复核测试设备',
    area: '甲区',
    device_type: 'pump',
    risk_level: 'critical',
    ...overrides,
  });
  return res.body;
}

async function createChecklist(overrides = {}) {
  const res = await request(app).post('/api/v1/checklists').send({
    checklist_name: '复核测试清单',
    device_type: 'pump',
    items: ['项目A', '项目B', '项目C'],
    cycle_days: 7,
    ...overrides,
  });
  return res.body;
}

async function createFaultRound() {
  const device = await createDevice({ device_code: `ER-${Date.now()}` });
  const checklist = await createChecklist({
    checklist_name: `复核清单-${Date.now()}`,
  });

  const genRes = await request(app).post('/api/v1/rounds/generate').send({
    device_id: device.id,
    checklist_id: checklist.id,
    planned_start_at: new Date().toISOString(),
    owner_name: '巡检员',
  });

  await request(app).post(`/api/v1/rounds/${genRes.body.id}/start`);
  await request(app)
    .post(`/api/v1/rounds/${genRes.body.id}/submit`)
    .send({
      results: [
        { item_name: '项目A', result_value: 'fault', note: '异常振动' },
        { item_name: '项目B', result_value: 'attention', note: '温度偏高' },
        { item_name: '项目C', result_value: 'normal' },
      ],
    });

  const details = await request(app).get(`/api/v1/rounds/${genRes.body.id}`);
  return { device, checklist, round: details.body };
}

describe('Exception Review API', () => {
  describe('POST /api/v1/exception-reviews/:id/review', () => {
    it('should submit a confirmed review', async () => {
      const { round } = await createFaultRound();
      const faultReview = round.results.find(r => r.result_value === 'fault').review;

      const res = await request(app)
        .post(`/api/v1/exception-reviews/${faultReview.id}/review`)
        .send({
          review_status: 'confirmed',
          reviewer_name: '李工程师',
          review_note: '确认故障存在',
        });

      expect(res.status).toBe(200);
      expect(res.body.review_status).toBe('confirmed');
      expect(res.body.reviewer_name).toBe('李工程师');
      expect(res.body.reviewed_at).toBeDefined();
    });

    it('should submit a resolved review', async () => {
      const { round } = await createFaultRound();
      const faultReview = round.results.find(r => r.result_value === 'fault').review;

      const res = await request(app)
        .post(`/api/v1/exception-reviews/${faultReview.id}/review`)
        .send({
          review_status: 'resolved',
          reviewer_name: '维修组',
          review_note: '已修复',
        });

      expect(res.status).toBe(200);
      expect(res.body.review_status).toBe('resolved');
    });

    it('should submit an ignored review', async () => {
      const { round } = await createFaultRound();
      const attentionReview = round.results.find(
        r => r.result_value === 'attention'
      ).review;

      const res = await request(app)
        .post(`/api/v1/exception-reviews/${attentionReview.id}/review`)
        .send({
          review_status: 'ignored',
          reviewer_name: '主管',
          review_note: '误报',
        });

      expect(res.status).toBe(200);
      expect(res.body.review_status).toBe('ignored');
    });

    it('should reject re-reviewing an already reviewed exception', async () => {
      const { round } = await createFaultRound();
      const faultReview = round.results.find(r => r.result_value === 'fault').review;

      await request(app)
        .post(`/api/v1/exception-reviews/${faultReview.id}/review`)
        .send({
          review_status: 'confirmed',
          reviewer_name: '张工',
        });

      const res = await request(app)
        .post(`/api/v1/exception-reviews/${faultReview.id}/review`)
        .send({
          review_status: 'resolved',
          reviewer_name: '李工',
        });

      expect(res.status).toBe(422);
      expect(res.body.error_code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('should reject invalid review_status', async () => {
      const { round } = await createFaultRound();
      const faultReview = round.results.find(r => r.result_value === 'fault').review;

      const res = await request(app)
        .post(`/api/v1/exception-reviews/${faultReview.id}/review`)
        .send({
          review_status: 'pending',
          reviewer_name: '张工',
        });

      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent review', async () => {
      const res = await request(app)
        .post('/api/v1/exception-reviews/nonexistent/review')
        .send({ review_status: 'confirmed', reviewer_name: '张工' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/rounds/:id/reviews', () => {
    it('should list all reviews for a round', async () => {
      const { round } = await createFaultRound();

      const res = await request(app).get(`/api/v1/rounds/${round.id}/reviews`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body.every(r => r.review_status === 'pending')).toBe(true);
    });
  });
});
