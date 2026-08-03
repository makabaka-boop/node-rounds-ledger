const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

describe('Device API', () => {
  describe('POST /api/v1/devices', () => {
    it('should create a device successfully', async () => {
      const res = await request(app)
        .post('/api/v1/devices')
        .set('x-operator', 'test-admin')
        .send({
          device_code: 'DEV-001',
          device_name: '离心泵A',
          area: '生产一区',
          device_type: 'pump',
          risk_level: 'high',
          maintenance_note: '每月检查密封件',
        });

      expect(res.status).toBe(201);
      expect(res.body.device_code).toBe('DEV-001');
      expect(res.body.device_name).toBe('离心泵A');
      expect(res.body.area).toBe('生产一区');
      expect(res.body.device_type).toBe('pump');
      expect(res.body.risk_level).toBe('high');
      expect(res.body.enabled).toBe(true);
      expect(res.body.maintenance_note).toBe('每月检查密封件');
      expect(res.body.id).toBeDefined();
    });

    it('should reject duplicate device_code', async () => {
      await request(app)
        .post('/api/v1/devices')
        .send({
          device_code: 'DEV-DUP',
          device_name: '设备1',
          area: 'A区',
          device_type: 'pump',
          risk_level: 'low',
        });

      const res = await request(app)
        .post('/api/v1/devices')
        .send({
          device_code: 'DEV-DUP',
          device_name: '设备2',
          area: 'B区',
          device_type: 'motor',
          risk_level: 'high',
        });

      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe('CONFLICT');
    });

    it('should validate required fields', async () => {
      const res = await request(app)
        .post('/api/v1/devices')
        .send({ device_name: '不完整设备' });

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('VALIDATION_ERROR');
      expect(res.body.details.device_code).toBeDefined();
      expect(res.body.details.area).toBeDefined();
      expect(res.body.details.device_type).toBeDefined();
      expect(res.body.details.risk_level).toBeDefined();
    });

    it('should reject invalid risk_level', async () => {
      const res = await request(app)
        .post('/api/v1/devices')
        .send({
          device_code: 'DEV-BAD',
          device_name: '坏设备',
          area: 'A区',
          device_type: 'pump',
          risk_level: 'super-high',
        });

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/devices', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/devices').send({
        device_code: 'GET-001',
        device_name: '设备A',
        area: '东区',
        device_type: 'pump',
        risk_level: 'high',
      });
      await request(app).post('/api/v1/devices').send({
        device_code: 'GET-002',
        device_name: '设备B',
        area: '西区',
        device_type: 'motor',
        risk_level: 'low',
      });
    });

    it('should list all devices', async () => {
      const res = await request(app).get('/api/v1/devices');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by area', async () => {
      const res = await request(app).get(`/api/v1/devices?area=${encodeURIComponent('东区')}`);
      expect(res.status).toBe(200);
      expect(res.body.every(d => d.area === '东区')).toBe(true);
    });

    it('should filter by risk_level', async () => {
      const res = await request(app).get('/api/v1/devices?risk_level=high');
      expect(res.status).toBe(200);
      expect(res.body.every(d => d.risk_level === 'high')).toBe(true);
    });
  });

  describe('POST /api/v1/devices/:id/deactivate', () => {
    it('should deactivate a device', async () => {
      const createRes = await request(app).post('/api/v1/devices').send({
        device_code: 'DEACT-001',
        device_name: '待停用',
        area: 'A区',
        device_type: 'pump',
        risk_level: 'low',
      });

      const res = await request(app)
        .post(`/api/v1/devices/${createRes.body.id}/deactivate`)
        .set('x-operator', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it('should return 404 for non-existent device', async () => {
      const res = await request(app).post('/api/v1/devices/nonexistent/deactivate');
      expect(res.status).toBe(404);
    });
  });
});
