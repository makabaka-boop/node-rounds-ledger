'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { freshServer, req, getDb } = require('./helpers');

/**
 * 数据自检接口测试。既覆盖"全部通过"，也覆盖注入不一致后"能发现问题"。
 */

const START = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const END = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const NOW = new Date().toISOString();

async function seed(server) {
  const device = await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-SC', device_name: '空压机', area: 'A区', device_type: 'compressor', risk_level: 'high',
  });
  const checklist = await req(server, 'POST', '/api/v1/checklists', {
    checklist_name: '空压机日检', device_type: 'compressor',
    items: ['油位检查', '温度检查', '异响检查'], cycle_days: 1,
  });
  return { device: device.body, checklist: checklist.body };
}

// 走完整闭环：生成 -> 开始 -> 提交(fault) -> 复核 resolved -> 关闭
async function fullClosedFlow(server) {
  const { device, checklist } = await seed(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const rid = round.body.id;
  await req(server, 'POST', `/api/v1/rounds/${rid}/start`);
  await req(server, 'POST', `/api/v1/rounds/${rid}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  const reviews = await req(server, 'GET', `/api/v1/rounds/${rid}/reviews`);
  await req(server, 'POST', `/api/v1/reviews/${reviews.body.items[0].id}`, {
    review_status: 'resolved', reviewer_name: '王工',
  });
  await req(server, 'POST', `/api/v1/rounds/${rid}/close`);
  return { device, checklist, rid };
}

test('自检通过：健康的闭环数据无任何问题', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  await fullClosedFlow(server);

  const res = await req(server, 'GET', '/api/v1/self-check');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.passed, true);
  assert.strictEqual(res.body.total_issues, 0);
  assert.strictEqual(res.body.checks.length, 7);
  assert.ok(res.body.checks.every((c) => c.passed && c.issue_count === 0));
});

test('自检返回结构为 snake_case 且字段完整', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const res = await req(server, 'GET', '/api/v1/self-check');
  assert.ok('total_issues' in res.body);
  assert.ok('checked_at' in res.body);
  for (const c of res.body.checks) {
    assert.ok('name' in c);
    assert.ok('passed' in c);
    assert.ok('issue_count' in c);
    assert.ok('details' in c);
    // 检查名称均为 snake_case
    assert.match(c.name, /^[a-z0-9]+(_[a-z0-9]+)*$/);
  }
});

test('自检异常：存在 fault 但缺少复核记录', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seed(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const rid = round.body.id;
  await req(server, 'POST', `/api/v1/rounds/${rid}/start`);
  await req(server, 'POST', `/api/v1/rounds/${rid}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  // 直接删除自动生成的复核记录，制造不一致
  getDb().prepare('DELETE FROM reviews WHERE round_id = ?').run(rid);

  const res = await req(server, 'GET', '/api/v1/self-check');
  assert.strictEqual(res.body.passed, false);
  const check = res.body.checks.find((c) => c.name === 'fault_missing_review');
  assert.strictEqual(check.passed, false);
  assert.strictEqual(check.issue_count, 1);
  assert.strictEqual(check.details[0].item_name, '油位检查');
});

test('自检异常：已关闭轮次仍有待复核异常', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { rid } = await fullClosedFlow(server);
  // 强行把该轮次的复核改回 pending，制造"已关闭却有 pending"的不一致
  getDb().prepare("UPDATE reviews SET review_status = 'pending' WHERE round_id = ?").run(rid);

  const res = await req(server, 'GET', '/api/v1/self-check');
  const check = res.body.checks.find((c) => c.name === 'closed_round_pending_review');
  assert.strictEqual(check.passed, false);
  assert.strictEqual(check.issue_count, 1);
  assert.strictEqual(check.details[0].round_id, rid);
});

test('自检异常：轮次快照缺失', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seed(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  // 删除快照（关闭外键约束以注入脏数据）
  const db = getDb();
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('DELETE FROM checklist_snapshots WHERE id = ?').run(round.body.checklist_snapshot_id);
  db.exec('PRAGMA foreign_keys = ON');

  const res = await req(server, 'GET', '/api/v1/self-check');
  const check = res.body.checks.find((c) => c.name === 'round_snapshot_missing');
  assert.strictEqual(check.passed, false);
  assert.strictEqual(check.issue_count, 1);
});

test('自检异常：设备停用后仍生成新轮次', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seed(server);
  // 先停用设备
  await req(server, 'POST', `/api/v1/devices/${device.id}/disable`);
  // 正常接口会拒绝，这里直接向库里插入一条停用后创建的轮次，模拟绕过后的脏数据
  const db = getDb();
  const snap = db.prepare('SELECT id FROM checklist_snapshots LIMIT 1').get();
  const later = new Date(Date.now() + 1000).toISOString();
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare(`
    INSERT INTO rounds (device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, round_status, owner_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'scheduled', '张三', ?, ?)
  `).run(device.id, checklist.id, snap ? snap.id : 1, START, END, later, later);
  db.exec('PRAGMA foreign_keys = ON');

  const res = await req(server, 'GET', '/api/v1/self-check');
  const check = res.body.checks.find((c) => c.name === 'disabled_device_new_round');
  assert.strictEqual(check.passed, false);
  assert.ok(check.issue_count >= 1);
});

test('自检异常：清单快照 items 不是 JSON 数组', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seed(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  // 把快照 items_json 破坏成非数组
  getDb().prepare('UPDATE checklist_snapshots SET items_json = ? WHERE id = ?')
    .run('{"not":"array"}', round.body.checklist_snapshot_id);

  const res = await req(server, 'GET', '/api/v1/self-check');
  const check = res.body.checks.find((c) => c.name === 'snapshot_items_not_array');
  assert.strictEqual(check.passed, false);
  assert.strictEqual(check.issue_count, 1);
});

test('自检异常：已关闭轮次缺少审计事件', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { rid } = await fullClosedFlow(server);
  // 删除该轮次的 round_closed 审计事件
  getDb().prepare("DELETE FROM audit_events WHERE entity_type='round' AND entity_id=? AND event_type='round_closed'").run(rid);

  const res = await req(server, 'GET', '/api/v1/self-check');
  const check = res.body.checks.find((c) => c.name === 'audit_event_missing');
  assert.strictEqual(check.passed, false);
  assert.strictEqual(check.issue_count, 1);
  assert.strictEqual(check.details[0].round_id, rid);
});

test('自检异常：轮次状态与结果记录不匹配', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seed(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  // 未提交结果却强行置为 submitted
  getDb().prepare("UPDATE rounds SET round_status='submitted' WHERE id=?").run(round.body.id);

  const res = await req(server, 'GET', '/api/v1/self-check');
  const check = res.body.checks.find((c) => c.name === 'round_status_result_mismatch');
  assert.strictEqual(check.passed, false);
  assert.strictEqual(check.issue_count, 1);
});

test('README 关键流程可执行：创建设备->清单->轮次->提交故障->复核->关闭', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());

  // 1) 创建设备
  const device = await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-001', device_name: '空压机', area: 'A区', device_type: 'compressor', risk_level: 'high',
  });
  assert.strictEqual(device.status, 201);

  // 2) 创建清单
  const checklist = await req(server, 'POST', '/api/v1/checklists', {
    checklist_name: '空压机日检', device_type: 'compressor',
    items: ['油位检查', '温度检查', '异响检查'], cycle_days: 1,
  });
  assert.strictEqual(checklist.status, 201);

  // 3) 生成轮次
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.body.id, checklist_id: checklist.body.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  assert.strictEqual(round.status, 201);
  const rid = round.body.id;

  // 4) 开始 + 提交故障结果
  assert.strictEqual((await req(server, 'POST', `/api/v1/rounds/${rid}/start`)).status, 200);
  const submit = await req(server, 'POST', `/api/v1/rounds/${rid}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', note: '漏油', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 200);
  assert.strictEqual(submit.body.pending_reviews, 1);

  // 5) 复核异常
  const reviews = await req(server, 'GET', `/api/v1/rounds/${rid}/reviews`);
  const done = await req(server, 'POST', `/api/v1/reviews/${reviews.body.items[0].id}`, {
    review_status: 'resolved', reviewer_name: '王工', review_note: '已更换密封',
  });
  assert.strictEqual(done.status, 200);

  // 6) 关闭轮次
  const close = await req(server, 'POST', `/api/v1/rounds/${rid}/close`);
  assert.strictEqual(close.status, 200);
  assert.strictEqual(close.body.round_status, 'closed');

  // 收尾：自检应通过
  const check = await req(server, 'GET', '/api/v1/self-check');
  assert.strictEqual(check.body.passed, true);
});
