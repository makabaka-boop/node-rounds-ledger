const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

async function createDevice(overrides = {}) {
  const res = await request(app).post('/api/v1/devices').send({
    device_code: 'CL-DEV-001',
    device_name: '测试设备',
    area: '测试区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides,
  });
  return res.body;
}

async function createChecklist(overrides = {}) {
  const res = await request(app).post('/api/v1/checklists').send({
    checklist_name: '日常巡检清单',
    device_type: 'pump',
    items: ['检查油位', '检查温度', '听运行声音'],
    cycle_days: 7,
    ...overrides,
  });
  return res.body;
}

describe('Checklist API', () => {
  describe('POST /api/v1/checklists', () => {
    it('should create a checklist successfully', async () => {
      const res = await request(app).post('/api/v1/checklists').send({
        checklist_name: '周巡检清单',
        device_type: 'pump',
        items: ['检查密封', '检查振动'],
        cycle_days: 7,
      });

      expect(res.status).toBe(201);
      expect(res.body.checklist_name).toBe('周巡检清单');
      expect(res.body.device_type).toBe('pump');
      expect(res.body.items).toEqual(['检查密封', '检查振动']);
      expect(res.body.cycle_days).toBe(7);
      expect(res.body.version).toBe(1);
      expect(res.body.enabled).toBe(true);
    });

    it('should reject empty items', async () => {
      const res = await request(app).post('/api/v1/checklists').send({
        checklist_name: '空清单',
        device_type: 'pump',
        items: [],
        cycle_days: 7,
      });

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('VALIDATION_ERROR');
    });

    it('should reject duplicate name+device_type', async () => {
      await createChecklist({ checklist_name: '重复清单' });
      const res = await request(app).post('/api/v1/checklists').send({
        checklist_name: '重复清单',
        device_type: 'pump',
        items: ['项目A'],
        cycle_days: 30,
      });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/v1/checklists/:id/copy-version', () => {
    it('should create a new version with incremented version number', async () => {
      const original = await createChecklist({ checklist_name: '版本测试清单' });

      const res = await request(app)
        .post(`/api/v1/checklists/${original.id}/copy-version`)
        .send({
          items: ['新增项目1', '新增项目2', '保留项目'],
        });

      expect(res.status).toBe(201);
      expect(res.body.version).toBe(2);
      expect(res.body.checklist_name).toBe('版本测试清单');
      expect(res.body.items).toEqual(['新增项目1', '新增项目2', '保留项目']);
    });

    it('should copy without changes when no items provided', async () => {
      const original = await createChecklist({ checklist_name: '无变更复制' });

      const res = await request(app)
        .post(`/api/v1/checklists/${original.id}/copy-version`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.version).toBe(2);
      expect(res.body.items).toEqual(original.items);
    });

    it('should return 404 for non-existent source', async () => {
      const res = await request(app)
        .post('/api/v1/checklists/nonexistent/copy-version')
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe('Checklist Snapshot Immutability', () => {
    it('should preserve items in snapshot when checklist is later updated', async () => {
      const device = await createDevice();
      const checklist = await createChecklist({
        checklist_name: '快照不变性测试',
        items: ['原始项目A', '原始项目B'],
      });

      const generateRes = await request(app)
        .post('/api/v1/rounds/generate')
        .send({
          device_id: device.id,
          checklist_id: checklist.id,
          planned_start_at: new Date().toISOString(),
          owner_name: '张三',
        });

      expect(generateRes.status).toBe(201);
      const snapshotId = generateRes.body.checklist_snapshot_id;

      const v2Res = await request(app)
        .post(`/api/v1/checklists/${checklist.id}/copy-version`)
        .send({ items: ['新版本项目X'] });

      expect(v2Res.status).toBe(201);

      const snapshotRes = await request(app).get(
        `/api/v1/checklists/snapshots/${snapshotId}`
      );
      expect(snapshotRes.status).toBe(200);
      expect(snapshotRes.body.items).toEqual(['原始项目A', '原始项目B']);
      expect(snapshotRes.body.version).toBe(1);
    });
  });
});
