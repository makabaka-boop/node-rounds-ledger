const request = require('supertest');
const { getTestApp } = require('./helpers');

const app = getTestApp();

async function createDevice(overrides = {}) {
  const res = await request(app).post('/api/v1/devices').send({
    device_code: 'VAL-DEV',
    device_name: '校验测试设备',
    area: '测试区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides,
  });
  return res.body;
}

async function createChecklist(overrides = {}) {
  const res = await request(app).post('/api/v1/checklists').send({
    checklist_name: '校验测试清单',
    device_type: 'pump',
    items: ['检查油位', '检查温度', '检查密封', '听运行声音'],
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
    owner_name: '测试员',
    ...overrides,
  });
  return res;
}

function validResults() {
  return [
    { item_name: '检查油位', result_value: 'normal' },
    { item_name: '检查温度', result_value: 'normal' },
    { item_name: '检查密封', result_value: 'normal' },
    { item_name: '听运行声音', result_value: 'normal' },
  ];
}

describe('Stricter Validation Rules', () => {
  describe('planned_end_at validation', () => {
    it('should reject when planned_end_at is earlier than planned_start_at', async () => {
      const device = await createDevice({ device_code: `TIME-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `时间清单-${Date.now()}`,
      });

      const start = new Date('2024-06-15T10:00:00.000Z');
      const end = new Date('2024-06-10T10:00:00.000Z');

      const res = await generateRound(device, checklist, {
        planned_start_at: start.toISOString(),
        planned_end_at: end.toISOString(),
      });

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('VALIDATION_ERROR');
      expect(res.body.details.planned_end_at).toContain('不能早于');
    });

    it('should reject invalid planned_start_at format', async () => {
      const device = await createDevice({ device_code: `BADTIME-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `坏时间清单-${Date.now()}`,
      });

      const res = await generateRound(device, checklist, {
        planned_start_at: 'not-a-date',
      });

      expect(res.status).toBe(400);
      expect(res.body.details.planned_start_at).toBeDefined();
    });

    it('should accept equal planned_start_at and planned_end_at', async () => {
      const device = await createDevice({ device_code: `EQTIME-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `等时清单-${Date.now()}`,
      });

      const time = new Date('2024-06-15T10:00:00.000Z').toISOString();
      const res = await generateRound(device, checklist, {
        planned_start_at: time,
        planned_end_at: time,
      });

      expect(res.status).toBe(201);
      expect(res.body.planned_start_at).toBe(time);
      expect(res.body.planned_end_at).toBe(time);
    });

    it('should accept planned_end_at later than planned_start_at', async () => {
      const device = await createDevice({ device_code: `LATETIME-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `晚时清单-${Date.now()}`,
      });

      const res = await generateRound(device, checklist, {
        planned_start_at: '2024-06-15T10:00:00.000Z',
        planned_end_at: '2024-06-22T10:00:00.000Z',
      });

      expect(res.status).toBe(201);
    });
  });

  describe('Deactivated device cannot generate rounds', () => {
    it('should reject round generation for deactivated device', async () => {
      const device = await createDevice({ device_code: `DEACT-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `停用设备清单-${Date.now()}`,
      });

      await request(app)
        .post(`/api/v1/devices/${device.id}/deactivate`)
        .set('x-operator', 'admin');

      const res = await generateRound(device, checklist);

      expect(res.status).toBe(422);
      expect(res.body.error_code).toBe('BUSINESS_RULE_VIOLATION');
      expect(res.body.message).toContain('停用');
    });
  });

  describe('Disabled checklist restrictions', () => {
    it('should reject round generation when checklist is disabled', async () => {
      const device = await createDevice({ device_code: `DISCHK-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `禁用清单-${Date.now()}`,
      });

      await request(app)
        .patch(`/api/v1/checklists/${checklist.id}`)
        .send({ enabled: false })
        .set('x-operator', 'admin');

      const res = await generateRound(device, checklist);

      expect(res.status).toBe(422);
      expect(res.body.error_code).toBe('BUSINESS_RULE_VIOLATION');
      expect(res.body.message).toContain('停用');
    });

    it('should reject copy-version when source checklist is disabled', async () => {
      const checklist = await createChecklist({
        checklist_name: `禁用复制清单-${Date.now()}`,
      });

      await request(app)
        .patch(`/api/v1/checklists/${checklist.id}`)
        .send({ enabled: false })
        .set('x-operator', 'admin');

      const res = await request(app)
        .post(`/api/v1/checklists/${checklist.id}/copy-version`)
        .send({ items: ['新项目'] })
        .set('x-operator', 'admin');

      expect(res.status).toBe(422);
      expect(res.body.error_code).toBe('BUSINESS_RULE_VIOLATION');
      expect(res.body.message).toContain('停用');
    });
  });

  describe('Strict result validation against snapshot', () => {
    let device, checklist, round;

    beforeEach(async () => {
      device = await createDevice({ device_code: `STRICT-${Date.now()}` });
      checklist = await createChecklist({
        checklist_name: `严格校验清单-${Date.now()}`,
      });
      const genRes = await generateRound(device, checklist);
      round = genRes.body;
      await request(app).post(`/api/v1/rounds/${round.id}/start`);
    });

    it('should reject when result count is less than snapshot items', async () => {
      const res = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查油位', result_value: 'normal' },
            { item_name: '检查温度', result_value: 'normal' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('VALIDATION_ERROR');
      expect(res.body.details.results).toContain('数量');
    });

    it('should reject when result count is more than snapshot items', async () => {
      const res = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查油位', result_value: 'normal' },
            { item_name: '检查温度', result_value: 'normal' },
            { item_name: '检查密封', result_value: 'normal' },
            { item_name: '听运行声音', result_value: 'normal' },
            { item_name: '多余项目', result_value: 'normal' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.details.results).toContain('数量');
      expect(res.body.details['results[4].item_name']).toContain('多余');
    });

    it('should reject when item order is different', async () => {
      const res = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查温度', result_value: 'normal' },
            { item_name: '检查油位', result_value: 'normal' },
            { item_name: '检查密封', result_value: 'normal' },
            { item_name: '听运行声音', result_value: 'normal' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.details['results[0].item_name']).toContain('检查油位');
    });

    it('should reject when an item name is changed', async () => {
      const res = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查油位', result_value: 'normal' },
            { item_name: '检查温度（改）', result_value: 'normal' },
            { item_name: '检查密封', result_value: 'normal' },
            { item_name: '听运行声音', result_value: 'normal' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.details['results[1].item_name']).toContain('检查温度');
    });

    it('should accept results when count, order and names all match exactly', async () => {
      const res = await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({ results: validResults() });

      expect(res.status).toBe(200);
      expect(res.body.round_status).toBe('submitted');
      expect(res.body.results).toHaveLength(4);
    });
  });

  describe('Snapshot isolation across checklist versions', () => {
    it('should validate old rounds against original snapshot even after checklist version changes', async () => {
      const device = await createDevice({ device_code: `ISO-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `隔离清单-${Date.now()}`,
        items: ['原始项A', '原始项B'],
      });

      const oldStart = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const oldEnd = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString();
      const genRes = await generateRound(device, checklist, {
        planned_start_at: oldStart,
        planned_end_at: oldEnd,
      });
      const oldRound = genRes.body;

      await request(app).post(`/api/v1/rounds/${oldRound.id}/start`);

      const copyRes = await request(app)
        .post(`/api/v1/checklists/${checklist.id}/copy-version`)
        .send({ items: ['新清单项X', '新清单项Y', '新增项Z'] });

      expect(copyRes.status).toBe(201);
      expect(copyRes.body.version).toBe(2);

      const newStart = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
      const newEnd = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
      const newGenRes = await generateRound(device, copyRes.body, {
        planned_start_at: newStart,
        planned_end_at: newEnd,
      });
      const newRound = newGenRes.body;
      await request(app).post(`/api/v1/rounds/${newRound.id}/start`);

      const oldRoundWithOldItems = await request(app)
        .post(`/api/v1/rounds/${oldRound.id}/submit`)
        .send({
          results: [
            { item_name: '原始项A', result_value: 'normal' },
            { item_name: '原始项B', result_value: 'normal' },
          ],
        });
      expect(oldRoundWithOldItems.status).toBe(200);

      const newRoundWithNewItems = await request(app)
        .post(`/api/v1/rounds/${newRound.id}/submit`)
        .send({
          results: [
            { item_name: '新清单项X', result_value: 'normal' },
            { item_name: '新清单项Y', result_value: 'normal' },
            { item_name: '新增项Z', result_value: 'normal' },
          ],
        });
      expect(newRoundWithNewItems.status).toBe(200);

      const oldRoundWithNewItems = await request(app)
        .post(`/api/v1/rounds/${oldRound.id}/submit`)
        .send({
          results: [
            { item_name: '新清单项X', result_value: 'normal' },
            { item_name: '新清单项Y', result_value: 'normal' },
            { item_name: '新增项Z', result_value: 'normal' },
          ],
        });
      expect(oldRoundWithNewItems.status).toBe(400);
      expect(oldRoundWithNewItems.body.details.results).toContain('数量');
    });
  });

  describe('Overdue field in area open rounds query', () => {
    it('should mark overdue: true when current time exceeds planned_end_at and round is not closed', async () => {
      const device = await createDevice({
        device_code: `OVERDUE-${Date.now()}`,
        area: '逾期测试区',
      });
      const checklist = await createChecklist({
        checklist_name: `逾期清单-${Date.now()}`,
      });

      const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const pastEnd = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      await generateRound(device, checklist, {
        planned_start_at: pastStart,
        planned_end_at: pastEnd,
      });

      const res = await request(app).get(
        `/api/v1/queries/areas/${encodeURIComponent('逾期测试区')}/open-rounds`
      );

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const overdueRounds = res.body.filter(r => r.overdue === true);
      expect(overdueRounds.length).toBeGreaterThanOrEqual(1);
      expect(overdueRounds[0].overdue).toBe(true);
    });

    it('should mark overdue: false when planned_end_at is in the future', async () => {
      const device = await createDevice({
        device_code: `FUTURE-${Date.now()}`,
        area: '未来测试区',
      });
      const checklist = await createChecklist({
        checklist_name: `未来清单-${Date.now()}`,
      });

      const futureStart = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
      const futureEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await generateRound(device, checklist, {
        planned_start_at: futureStart,
        planned_end_at: futureEnd,
      });

      const res = await request(app).get(
        `/api/v1/queries/areas/${encodeURIComponent('未来测试区')}/open-rounds`
      );

      expect(res.status).toBe(200);
      const futureRounds = res.body.filter(r => r.device_id === device.id);
      expect(futureRounds.length).toBe(1);
      expect(futureRounds[0].overdue).toBe(false);
    });

    it('should include pending_review_count in area open rounds response', async () => {
      const device = await createDevice({
        device_code: `PENDCNT-${Date.now()}`,
        area: '待复核计数区',
      });
      const checklist = await createChecklist({
        checklist_name: `待复核清单-${Date.now()}`,
        items: ['检查A', '检查B'],
      });

      const genRes = await generateRound(device, checklist, {
        planned_start_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        planned_end_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const round = genRes.body;
      await request(app).post(`/api/v1/rounds/${round.id}/start`);
      await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查A', result_value: 'fault', note: '故障' },
            { item_name: '检查B', result_value: 'attention', note: '关注' },
          ],
        });

      const res = await request(app).get(
        `/api/v1/queries/areas/${encodeURIComponent('待复核计数区')}/open-rounds`
      );

      expect(res.status).toBe(200);
      const targetRound = res.body.find(r => r.id === round.id);
      expect(targetRound).toBeTruthy();
      expect(targetRound.pending_review_count).toBe(2);
      expect(targetRound.overdue).toBe(false);
    });

    it('should not modify database round_status when computing overdue', async () => {
      const device = await createDevice({
        device_code: `DBSTATUS-${Date.now()}`,
        area: '状态不变区',
      });
      const checklist = await createChecklist({
        checklist_name: `状态清单-${Date.now()}`,
      });

      const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const pastEnd = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      const genRes = await generateRound(device, checklist, {
        planned_start_at: pastStart,
        planned_end_at: pastEnd,
      });

      await request(app).get(
        `/api/v1/queries/areas/${encodeURIComponent('状态不变区')}/open-rounds`
      );

      const detailRes = await request(app).get(
        `/api/v1/rounds/${genRes.body.id}`
      );
      expect(detailRes.body.round_status).toBe('scheduled');
    });

    it('should return overdue: false for closed rounds even if past end date', async () => {
      const device = await createDevice({
        device_code: `CLOSED-${Date.now()}`,
        area: '已关闭区',
      });
      const checklist = await createChecklist({
        checklist_name: `关闭清单-${Date.now()}`,
        items: ['检查A', '检查B'],
      });

      const pastStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const pastEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

      const genRes = await generateRound(device, checklist, {
        planned_start_at: pastStart,
        planned_end_at: pastEnd,
      });
      const round = genRes.body;
      await request(app).post(`/api/v1/rounds/${round.id}/start`);
      await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [
            { item_name: '检查A', result_value: 'normal' },
            { item_name: '检查B', result_value: 'normal' },
          ],
        });
      await request(app).post(`/api/v1/rounds/${round.id}/close`);

      const res = await request(app).get(
        `/api/v1/queries/areas/${encodeURIComponent('已关闭区')}/open-rounds`
      );

      expect(res.status).toBe(200);
      expect(res.body.find(r => r.id === round.id)).toBeUndefined();
    });
  });
});
