const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

async function createDevice(overrides = {}) {
  const res = await request(app).post('/api/v1/devices').send({
    device_code: 'Q-DEV',
    device_name: '查询测试设备',
    area: 'A区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides,
  });
  return res.body;
}

async function createChecklist(overrides = {}) {
  const res = await request(app).post('/api/v1/checklists').send({
    checklist_name: '查询清单',
    device_type: 'pump',
    items: ['检查A', '检查B'],
    cycle_days: 7,
    ...overrides,
  });
  return res.body;
}

async function createSubmittedRound(device, checklist, results) {
  const gen = await request(app).post('/api/v1/rounds/generate').send({
    device_id: device.id,
    checklist_id: checklist.id,
    planned_start_at: new Date().toISOString(),
    owner_name: '测试员',
  });
  await request(app).post(`/api/v1/rounds/${gen.body.id}/start`);
  await request(app)
    .post(`/api/v1/rounds/${gen.body.id}/submit`)
    .send({ results });
  return gen.body;
}

describe('Query API', () => {
  describe('GET /api/v1/queries/devices/:deviceId/recent-rounds', () => {
    it('should return recent rounds for a device', async () => {
      const device = await createDevice({ device_code: 'Q-RECENT' });
      const checklist = await createChecklist({
        checklist_name: '近期轮次清单',
        device_type: 'pump',
      });

      await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: '张三',
      });

      const res = await request(app).get(
        `/api/v1/queries/devices/${device.id}/recent-rounds?limit=5`
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].device_id).toBe(device.id);
    });
  });

  describe('GET /api/v1/queries/rounds/:roundId/details', () => {
    it('should return full round details with snapshot and results', async () => {
      const device = await createDevice({ device_code: 'Q-DET' });
      const checklist = await createChecklist({
        checklist_name: '详情清单',
        items: ['油位', '温度'],
      });
      const round = await createSubmittedRound(device, checklist, [
        { item_name: '油位', result_value: 'normal' },
        { item_name: '温度', result_value: 'fault', note: '过热' },
      ]);

      const res = await request(app).get(
        `/api/v1/queries/rounds/${round.id}/details`
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(round.id);
      expect(res.body.device).toBeTruthy();
      expect(res.body.device.device_code).toBe('Q-DET');
      expect(res.body.snapshot).toBeTruthy();
      expect(res.body.snapshot.items).toEqual(['油位', '温度']);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.round_status).toBe('submitted');
    });
  });

  describe('GET /api/v1/queries/areas/:area/open-rounds', () => {
    it('should return unclosed rounds for an area', async () => {
      const device = await createDevice({
        device_code: 'Q-AREA',
        area: '装配车间',
      });
      const checklist = await createChecklist({
        checklist_name: '车间清单',
        device_type: 'pump',
      });

      await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: '巡检员',
      });

      const res = await request(app).get(
        `/api/v1/queries/areas/${encodeURIComponent('装配车间')}/open-rounds`
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body.every(r => r.round_status !== 'closed')).toBe(true);
    });
  });

  describe('GET /api/v1/queries/exceptions/by-risk/:riskLevel', () => {
    it('should return exceptions filtered by device risk level', async () => {
      const device = await createDevice({
        device_code: 'Q-RISK',
        risk_level: 'critical',
      });
      const checklist = await createChecklist({
        checklist_name: '风险查询清单',
      });
      await createSubmittedRound(device, checklist, [
        { item_name: '检查A', result_value: 'fault', note: '故障' },
        { item_name: '检查B', result_value: 'normal' },
      ]);

      const res = await request(app).get(
        '/api/v1/queries/exceptions/by-risk/critical'
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(['fault', 'attention']).toContain(res.body[0].result_value);
      expect(res.body[0].risk_level).toBe('critical');
    });
  });

  describe('GET /api/v1/queries/areas/risk-summary', () => {
    it('should return risk summary grouped by area', async () => {
      await createDevice({
        device_code: 'Q-SUM-1',
        area: '焊接区',
        risk_level: 'high',
      });
      await createDevice({
        device_code: 'Q-SUM-2',
        area: '焊接区',
        risk_level: 'medium',
      });

      const res = await request(app).get(
        '/api/v1/queries/areas/risk-summary'
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const weldingArea = res.body.find(a => a.area === '焊接区');
      expect(weldingArea).toBeTruthy();
      expect(weldingArea.total_devices).toBe(2);
      expect(weldingArea.risk_distribution.high).toBe(1);
      expect(weldingArea.risk_distribution.medium).toBe(1);
    });
  });
});
