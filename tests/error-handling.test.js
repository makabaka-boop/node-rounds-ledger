const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

describe('Error Handling & Middleware', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('Error response format', () => {
    it('should return standard error format for not found', async () => {
      const res = await request(app).get('/api/v1/devices/nonexistent-id');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error_code');
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('details');
      expect(typeof res.body.error_code).toBe('string');
      expect(typeof res.body.message).toBe('string');
      expect(typeof res.body.details).toBe('object');
    });

    it('should return 404 for non-existent routes', async () => {
      const res = await request(app).get('/api/v1/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error_code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid JSON', async () => {
      const res = await request(app)
        .post('/api/v1/devices')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('INVALID_JSON');
    });
  });

  describe('State machine rules', () => {
    it('should reject direct scheduled -> closed transition', async () => {
      const deviceRes = await request(app).post('/api/v1/devices').send({
        device_code: 'SM-001',
        device_name: '状态机测试',
        area: 'A区',
        device_type: 'pump',
        risk_level: 'low',
      });

      const checklistRes = await request(app).post('/api/v1/checklists').send({
        checklist_name: '状态机清单',
        device_type: 'pump',
        items: ['项目1'],
        cycle_days: 7,
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: deviceRes.body.id,
        checklist_id: checklistRes.body.id,
        planned_start_at: new Date().toISOString(),
        owner_name: '测试',
      });

      const closeRes = await request(app).post(
        `/api/v1/rounds/${genRes.body.id}/close`
      );
      expect(closeRes.status).toBe(409);
      expect(closeRes.body.error_code).toBe('INVALID_STATE_TRANSITION');
      expect(closeRes.body.details.allowed_transitions).toBeDefined();
      expect(closeRes.body.details.allowed_transitions).toContain('in_progress');
    });
  });
});
