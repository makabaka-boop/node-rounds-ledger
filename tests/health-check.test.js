const request = require('supertest');
const { getTestApp } = require('./helpers');
const { getDb } = require('../src/db/connection');

const app = getTestApp();

async function createDevice(overrides = {}) {
  const res = await request(app).post('/api/v1/devices').send({
    device_code: 'HC-DEV',
    device_name: '自检测试设备',
    area: '自检区',
    device_type: 'pump',
    risk_level: 'high',
    ...overrides,
  });
  return res.body;
}

async function createChecklist(overrides = {}) {
  const res = await request(app).post('/api/v1/checklists').send({
    checklist_name: '自检测试清单',
    device_type: 'pump',
    items: ['检查A', '检查B', '检查C'],
    cycle_days: 7,
    ...overrides,
  });
  return res.body;
}

async function fullCleanLifecycle() {
  const device = await createDevice({ device_code: `HC-CLEAN-${Date.now()}` });
  const checklist = await createChecklist({
    checklist_name: `自检清洁清单-${Date.now()}`,
  });

  const genRes = await request(app).post('/api/v1/rounds/generate').send({
    device_id: device.id,
    checklist_id: checklist.id,
    planned_start_at: new Date().toISOString(),
    owner_name: 'tester',
  });
  const round = genRes.body;

  await request(app).post(`/api/v1/rounds/${round.id}/start`);

  const submitRes = await request(app)
    .post(`/api/v1/rounds/${round.id}/submit`)
    .send({
      results: [
        { item_name: '检查A', result_value: 'fault', note: '故障' },
        { item_name: '检查B', result_value: 'normal' },
        { item_name: '检查C', result_value: 'normal' },
      ],
    });

  const details = await request(app).get(`/api/v1/rounds/${round.id}`);
  const faultReview = details.body.results.find(
    r => r.result_value === 'fault'
  ).review;

  await request(app)
    .post(`/api/v1/exception-reviews/${faultReview.id}/review`)
    .send({
      review_status: 'resolved',
      reviewer_name: 'engineer',
      review_note: 'fixed',
    });

  await request(app).post(`/api/v1/rounds/${round.id}/close`);

  return { device, checklist, round };
}

describe('Data Health Check API', () => {
  describe('GET /api/v1/health-check', () => {
    it('should return all checks passing after a clean lifecycle', async () => {
      await fullCleanLifecycle();

      const res = await request(app).get('/api/v1/health-check');

      expect(res.status).toBe(200);
      expect(res.body.overall_status).toBe('passed');
      expect(res.body.total_checks).toBe(7);
      expect(res.body.total_issues).toBe(0);
      expect(Array.isArray(res.body.checks)).toBe(true);
      expect(res.body.checks).toHaveLength(7);

      res.body.checks.forEach(check => {
        expect(check).toHaveProperty('check_name');
        expect(check).toHaveProperty('check_label');
        expect(check).toHaveProperty('passed');
        expect(check).toHaveProperty('issue_count');
        expect(check).toHaveProperty('details');
        expect(check.passed).toBe(true);
        expect(check.issue_count).toBe(0);
        expect(Array.isArray(check.details)).toBe(true);
      });
    });

    it('should detect fault results missing review records', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-FAULT-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检故障清单-${Date.now()}`,
        items: ['X'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;
      await request(app).post(`/api/v1/rounds/${round.id}/start`);

      await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [{ item_name: 'X', result_value: 'fault', note: 'bad' }],
        });

      const details = await request(app).get(`/api/v1/rounds/${round.id}`);
      const resultId = details.body.results[0].id;
      const reviewId = details.body.results[0].review.id;

      db.prepare('DELETE FROM exception_reviews WHERE id = ?').run(reviewId);

      const res = await request(app).get('/api/v1/health-check');

      expect(res.status).toBe(200);
      expect(res.body.overall_status).toBe('failed');

      const check = res.body.checks.find(
        c => c.check_name === 'fault_missing_review'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
      expect(check.issue_count).toBeGreaterThanOrEqual(1);
      expect(check.details.some(d => d.result_id === resultId)).toBe(true);
    });

    it('should detect closed rounds with pending/confirmed reviews', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-CLOSED-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检关闭清单-${Date.now()}`,
        items: ['Y'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;
      await request(app).post(`/api/v1/rounds/${round.id}/start`);
      await request(app)
        .post(`/api/v1/rounds/${round.id}/submit`)
        .send({
          results: [{ item_name: 'Y', result_value: 'fault', note: 'bad' }],
        });

      const details = await request(app).get(`/api/v1/rounds/${round.id}`);
      const reviewId = details.body.results[0].review.id;

      await request(app)
        .post(`/api/v1/exception-reviews/${reviewId}/review`)
        .send({
          review_status: 'confirmed',
          reviewer_name: 'reviewer',
        });

      db.prepare("UPDATE rounds SET round_status = 'closed', closed_at = datetime('now') WHERE id = ?")
        .run(round.id);

      const res = await request(app).get('/api/v1/health-check');

      const check = res.body.checks.find(
        c => c.check_name === 'closed_round_pending_reviews'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
      expect(check.issue_count).toBeGreaterThanOrEqual(1);
      expect(check.details[0].round_id).toBe(round.id);
    });

    it('should detect rounds with missing snapshots', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-SNAP-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检快照清单-${Date.now()}`,
        items: ['Z'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;

      db.pragma('foreign_keys = OFF');
      db.prepare('DELETE FROM checklist_snapshots WHERE id = ?').run(
        round.checklist_snapshot_id
      );
      db.pragma('foreign_keys = ON');

      const res = await request(app).get('/api/v1/health-check');

      const check = res.body.checks.find(
        c => c.check_name === 'missing_snapshot'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
      expect(check.issue_count).toBeGreaterThanOrEqual(1);
      expect(check.details[0].round_id).toBe(round.id);
    });

    it('should detect rounds linked to disabled devices', async () => {
      const device = await createDevice({ device_code: `HC-DIS-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检停用清单-${Date.now()}`,
        items: ['W'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;

      await request(app)
        .post(`/api/v1/devices/${device.id}/deactivate`)
        .set('x-operator', 'admin');

      const res = await request(app).get('/api/v1/health-check');

      const check = res.body.checks.find(
        c => c.check_name === 'rounds_for_disabled_devices'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
      expect(check.issue_count).toBeGreaterThanOrEqual(1);
      expect(check.details.some(d => d.round_id === round.id)).toBe(true);
      expect(check.details.some(d => d.device_code === device.device_code)).toBe(true);
    });

    it('should detect invalid snapshot items JSON', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-JSON-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检JSON清单-${Date.now()}`,
        items: ['Q'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;

      db.prepare("UPDATE checklist_snapshots SET items = 'not json at all' WHERE id = ?")
        .run(round.checklist_snapshot_id);

      const res = await request(app).get('/api/v1/health-check');

      const check = res.body.checks.find(
        c => c.check_name === 'snapshot_items_valid_json'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
      expect(check.issue_count).toBeGreaterThanOrEqual(1);
    });

    it('should detect snapshot items that parse to non-array', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-ARR-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检数组清单-${Date.now()}`,
        items: ['M'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;

      db.prepare('UPDATE checklist_snapshots SET items = ? WHERE id = ?')
        .run(JSON.stringify({ not: 'an array' }), round.checklist_snapshot_id);

      const res = await request(app).get('/api/v1/health-check');

      const check = res.body.checks.find(
        c => c.check_name === 'snapshot_items_valid_json'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
      expect(check.details[0].actual_type).toBe('object');
    });

    it('should detect missing audit events for rounds', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-AUD-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检审计清单-${Date.now()}`,
        items: ['N'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;

      db.prepare("DELETE FROM audit_events WHERE entity_type = 'round' AND entity_id = ?")
        .run(round.id);

      const res = await request(app).get('/api/v1/health-check');

      const check = res.body.checks.find(
        c => c.check_name === 'missing_audit_events'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
      expect(
        check.details.some(
          d => d.round_id === round.id && d.missing_event === 'round.generated'
        )
      ).toBe(true);
    });

    it('should detect submitted rounds without results', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-SUB-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检提交清单-${Date.now()}`,
        items: ['O'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;

      db.prepare("UPDATE rounds SET round_status = 'submitted', submitted_at = datetime('now') WHERE id = ?")
        .run(round.id);

      const res = await request(app).get('/api/v1/health-check');

      const check = res.body.checks.find(
        c => c.check_name === 'round_status_result_consistency'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
      expect(
        check.details.some(d => d.round_id === round.id && d.round_status === 'submitted')
      ).toBe(true);
    });

    it('should detect in-progress rounds with stray results', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-PROG-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检进行清单-${Date.now()}`,
        items: ['P'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;
      await request(app).post(`/api/v1/rounds/${round.id}/start`);

      db.prepare("INSERT INTO round_results (id, round_id, item_name, result_value) VALUES (?, ?, ?, ?)")
        .run(
          require('crypto').randomUUID(),
          round.id,
          'P',
          'normal'
        );

      const res = await request(app).get('/api/v1/health-check');

      const check = res.body.checks.find(
        c => c.check_name === 'round_status_result_consistency'
      );
      expect(check).toBeTruthy();
      expect(check.passed).toBe(false);
    });
  });

  describe('snake_case compliance', () => {
    it('should use snake_case for all top-level response fields', async () => {
      await fullCleanLifecycle();

      const res = await request(app).get('/api/v1/health-check');
      const body = res.body;

      const topLevelKeys = Object.keys(body);
      topLevelKeys.forEach(key => {
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
      });

      expect(body).toHaveProperty('overall_status');
      expect(body).toHaveProperty('total_checks');
      expect(body).toHaveProperty('total_issues');
      expect(body).toHaveProperty('checked_at');
      expect(body).toHaveProperty('checks');
    });

    it('should use snake_case for all check object fields', async () => {
      await fullCleanLifecycle();

      const res = await request(app).get('/api/v1/health-check');

      res.body.checks.forEach(check => {
        Object.keys(check).forEach(key => {
          expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
        });
        expect(check).toHaveProperty('check_name');
        expect(check).toHaveProperty('check_label');
        expect(check).toHaveProperty('passed');
        expect(check).toHaveProperty('issue_count');
        expect(check).toHaveProperty('details');
      });
    });

    it('should use snake_case for all detail fields', async () => {
      const db = getDb();
      const device = await createDevice({ device_code: `HC-SC-${Date.now()}` });
      const checklist = await createChecklist({
        checklist_name: `自检验证清单-${Date.now()}`,
        items: ['SC'],
      });

      const genRes = await request(app).post('/api/v1/rounds/generate').send({
        device_id: device.id,
        checklist_id: checklist.id,
        planned_start_at: new Date().toISOString(),
        owner_name: 'tester',
      });
      const round = genRes.body;

      db.pragma('foreign_keys = OFF');
      db.prepare('DELETE FROM checklist_snapshots WHERE id = ?').run(
        round.checklist_snapshot_id
      );
      db.pragma('foreign_keys = ON');

      const res = await request(app).get('/api/v1/health-check');

      res.body.checks.forEach(check => {
        check.details.forEach(detail => {
          Object.keys(detail).forEach(key => {
            expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
          });
        });
      });
    });
  });
});
