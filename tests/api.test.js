'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { freshServer, req } = require('./helpers');

/**
 * 端到端业务流程测试。每个测试用独立的内存库和临时 server。
 */

// 计划时间窗：过去 1 天到未来 1 天，保证 submitted_at 落在窗内
const START = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const END = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const NOW = new Date().toISOString();

async function seedDeviceAndChecklist(server, overrides = {}) {
  const device = await req(server, 'POST', '/api/v1/devices', {
    device_code: overrides.device_code || 'DEV-001',
    device_name: '空压机',
    area: 'A区',
    device_type: 'compressor',
    risk_level: 'high',
    ...overrides.device,
  });
  const checklist = await req(server, 'POST', '/api/v1/checklists', {
    checklist_name: overrides.checklist_name || '空压机日检',
    device_type: 'compressor',
    items: ['油位检查', '温度检查', '异响检查'],
    cycle_days: 1,
    ...overrides.checklist,
  });
  return { device: device.body, checklist: checklist.body };
}

test('创建设备并校验 snake_case 字段', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const res = await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-100',
    device_name: '水泵',
    area: 'B区',
    device_type: 'pump',
    risk_level: 'medium',
    maintenance_note: '季度保养',
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.device_code, 'DEV-100');
  assert.strictEqual(res.body.enabled, true);
  assert.ok('maintenance_note' in res.body);
  assert.ok('risk_level' in res.body);
});

test('重复设备编码返回 DUPLICATE', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-DUP', device_name: 'x', area: 'A', device_type: 'pump', risk_level: 'low',
  });
  const dup = await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-DUP', device_name: 'y', area: 'A', device_type: 'pump', risk_level: 'low',
  });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.error_code, 'DUPLICATE');
});

test('非法 risk_level 返回 VALIDATION_ERROR 且结构固定', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const res = await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-X', device_name: 'x', area: 'A', device_type: 'pump', risk_level: 'extreme',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error_code, 'VALIDATION_ERROR');
  assert.ok('message' in res.body);
  assert.ok('details' in res.body);
});

test('停用设备后不能生成轮次（DEVICE_DISABLED）', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const dis = await req(server, 'POST', `/api/v1/devices/${device.id}/disable`);
  assert.strictEqual(dis.status, 200);
  assert.strictEqual(dis.body.enabled, false);

  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  assert.strictEqual(round.status, 409);
  assert.strictEqual(round.body.error_code, 'DEVICE_DISABLED');
});

test('设备类型与清单类型不一致返回 DEVICE_TYPE_MISMATCH', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const device = await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-T', device_name: 'x', area: 'A', device_type: 'pump', risk_level: 'low',
  });
  const checklist = await req(server, 'POST', '/api/v1/checklists', {
    checklist_name: '压缩机检', device_type: 'compressor', items: ['a'], cycle_days: 1,
  });
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.body.id, checklist_id: checklist.body.id, owner_name: '李四',
    planned_start_at: START, planned_end_at: END,
  });
  assert.strictEqual(round.status, 409);
  assert.strictEqual(round.body.error_code, 'DEVICE_TYPE_MISMATCH');
});

test('复制清单版本递增 version 并可覆盖 items', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { checklist } = await seedDeviceAndChecklist(server);
  assert.strictEqual(checklist.version, 1);
  const v2 = await req(server, 'POST', `/api/v1/checklists/${checklist.id}/versions`, {
    items: ['油位检查', '温度检查', '异响检查', '新增项'],
  });
  assert.strictEqual(v2.status, 201);
  assert.strictEqual(v2.body.version, 2);
  assert.strictEqual(v2.body.items.length, 4);
});

test('快照隔离：清单出新版本不影响旧轮次校验', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  // 用 v1 生成轮次
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const roundId = round.body.id;
  // 清单出 v2（改变 items），但对旧轮次无影响
  await req(server, 'POST', `/api/v1/checklists/${checklist.id}/versions`, {
    items: ['完全不同的项'],
  });
  // 详情里的快照仍是 v1 的三项
  const detail = await req(server, 'GET', `/api/v1/rounds/${roundId}`);
  assert.strictEqual(detail.body.checklist_snapshot.version, 1);
  assert.deepStrictEqual(
    detail.body.checklist_snapshot.items.sort(),
    ['异响检查', '温度检查', '油位检查'].sort(),
  );

  // 开始并按快照三项提交，应成功
  await req(server, 'POST', `/api/v1/rounds/${roundId}/start`);
  const submit = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 200);
});

test('状态机：scheduled 不能直接 close', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const close = await req(server, 'POST', `/api/v1/rounds/${round.body.id}/close`);
  assert.strictEqual(close.status, 409);
  assert.strictEqual(close.body.error_code, 'INVALID_STATE_TRANSITION');
});

test('提交结果检查项与快照不一致返回 SNAPSHOT_MISMATCH', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  await req(server, 'POST', `/api/v1/rounds/${round.body.id}/start`);
  const submit = await req(server, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
    results: [
      { item_name: '不存在的项', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 422);
  assert.strictEqual(submit.body.error_code, 'SNAPSHOT_MISMATCH');
});

test('提交时间超出计划窗返回 VALIDATION_ERROR', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  await req(server, 'POST', `/api/v1/rounds/${round.body.id}/start`);
  const future = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
  const submit = await req(server, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'normal', submitted_at: future },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 400);
  assert.strictEqual(submit.body.error_code, 'VALIDATION_ERROR');
});

test('完整闭环：fault 自动生成待复核，未复核不能关闭', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const roundId = round.body.id;
  await req(server, 'POST', `/api/v1/rounds/${roundId}/start`);
  const submit = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', note: '漏油', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'attention', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 200);
  assert.strictEqual(submit.body.pending_reviews, 2);

  // 有未复核 fault，关闭被拒
  const close1 = await req(server, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.strictEqual(close1.status, 409);
  assert.strictEqual(close1.body.error_code, 'ROUND_HAS_UNREVIEWED_FAULT');

  // 取复核列表，逐条提交结论
  const reviews = await req(server, 'GET', `/api/v1/rounds/${roundId}/reviews`);
  const faultReview = reviews.body.items.find((r) => r.result_id);
  for (const rv of reviews.body.items) {
    const done = await req(server, 'POST', `/api/v1/reviews/${rv.id}`, {
      review_status: 'resolved', reviewer_name: '王工', review_note: '已处理',
    });
    assert.strictEqual(done.status, 200);
    assert.strictEqual(done.body.review_status, 'resolved');
  }
  assert.ok(faultReview);

  // 全部复核后可关闭
  const close2 = await req(server, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.strictEqual(close2.status, 200);
  assert.strictEqual(close2.body.round_status, 'closed');
});

test('重复提交复核返回 STATE_CONFLICT', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const roundId = round.body.id;
  await req(server, 'POST', `/api/v1/rounds/${roundId}/start`);
  await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  const reviews = await req(server, 'GET', `/api/v1/rounds/${roundId}/reviews`);
  const rid = reviews.body.items[0].id;
  await req(server, 'POST', `/api/v1/reviews/${rid}`, { review_status: 'confirmed', reviewer_name: 'A' });
  const again = await req(server, 'POST', `/api/v1/reviews/${rid}`, { review_status: 'ignored', reviewer_name: 'B' });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.body.error_code, 'STATE_CONFLICT');
});

test('confirmed 不能作为关闭条件：confirmed 后仍不能关闭轮次', async (t) => {
  // 需求：confirmed 只表示"问题确认存在"，不满足闭环；只有 ignored/resolved 才能关闭。
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const roundId = round.body.id;
  await req(server, 'POST', `/api/v1/rounds/${roundId}/start`);
  await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  const reviews = await req(server, 'GET', `/api/v1/rounds/${roundId}/reviews`);
  await req(server, 'POST', `/api/v1/reviews/${reviews.body.items[0].id}`, {
    review_status: 'confirmed', reviewer_name: 'A',
  });
  const close = await req(server, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.strictEqual(close.status, 409);
  assert.strictEqual(close.body.error_code, 'ROUND_HAS_UNREVIEWED_FAULT');
});

test('查询设备最近轮次', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const res = await req(server, 'GET', `/api/v1/devices/${device.id}/rounds`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.rounds.length, 1);
  assert.strictEqual(res.body.device.device_code, 'DEV-001');
});

test('按区域查未关闭轮次', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const res = await req(server, 'GET', '/api/v1/rounds/open?area=A区');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.items.length, 1);
  assert.strictEqual(res.body.items[0].area, 'A区');
  assert.ok('pending_reviews' in res.body.items[0]);
  assert.ok('overdue' in res.body.items[0]);
});

test('按风险等级查异常 + 区域风险汇总', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  await req(server, 'POST', `/api/v1/rounds/${round.body.id}/start`);
  await req(server, 'POST', `/api/v1/rounds/${round.body.id}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  const anomalies = await req(server, 'GET', '/api/v1/reports/anomalies?risk_level=high');
  assert.strictEqual(anomalies.status, 200);
  assert.strictEqual(anomalies.body.items.length, 1);
  assert.strictEqual(anomalies.body.items[0].risk_level, 'high');

  const summary = await req(server, 'GET', '/api/v1/reports/risk-summary');
  assert.strictEqual(summary.status, 200);
  const bucket = summary.body.items.find((b) => b.area === 'A区' && b.risk_level === 'high');
  assert.ok(bucket);
  assert.strictEqual(bucket.open_round_count, 1);
  assert.strictEqual(bucket.anomaly_item_count, 1);
  assert.strictEqual(bucket.pending_review_count, 1);
  assert.strictEqual(bucket.overdue_round_count, 0);
  assert.strictEqual(bucket.closed_round_count, 0);
});

test('审计事件查询记录关键动作', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device } = await seedDeviceAndChecklist(server);
  const res = await req(server, 'GET', `/api/v1/audit-events?entity_type=device&entity_id=${device.id}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.items.length >= 1);
  assert.strictEqual(res.body.items[0].event_type, 'device_created');
  assert.ok(res.body.items[0].detail.description);
});

test('未知路由返回 NOT_FOUND', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const res = await req(server, 'GET', '/api/v1/unknown');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error_code, 'NOT_FOUND');
});

// ---- 提交结果与快照边界收紧后的补充覆盖 ----

// 便捷：生成并开始一个轮次，返回 roundId
async function startedRound(server) {
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  await req(server, 'POST', `/api/v1/rounds/${round.body.id}/start`);
  return { roundId: round.body.id, device, checklist };
}

test('时间非法：planned_end_at 早于 planned_start_at 返回 VALIDATION_ERROR', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: END, planned_end_at: START, // 故意颠倒
  });
  assert.strictEqual(round.status, 400);
  assert.strictEqual(round.body.error_code, 'VALIDATION_ERROR');
});

test('停用设备不能生成新轮次返回 DEVICE_DISABLED', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  await req(server, 'POST', `/api/v1/devices/${device.id}/disable`);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  assert.strictEqual(round.status, 409);
  assert.strictEqual(round.body.error_code, 'DEVICE_DISABLED');
});

test('禁用清单不能复制版本返回 CHECKLIST_DISABLED', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const checklist = await req(server, 'POST', '/api/v1/checklists', {
    checklist_name: '禁用清单', device_type: 'pump', items: ['a', 'b'], cycle_days: 1, enabled: false,
  });
  const copy = await req(server, 'POST', `/api/v1/checklists/${checklist.body.id}/versions`, {});
  assert.strictEqual(copy.status, 409);
  assert.strictEqual(copy.body.error_code, 'CHECKLIST_DISABLED');
});

test('禁用清单不能生成轮次返回 CHECKLIST_DISABLED', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const device = await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-CD', device_name: 'x', area: 'A区', device_type: 'pump', risk_level: 'low',
  });
  const checklist = await req(server, 'POST', '/api/v1/checklists', {
    checklist_name: '禁用泵检', device_type: 'pump', items: ['a', 'b'], cycle_days: 1, enabled: false,
  });
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.body.id, checklist_id: checklist.body.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  assert.strictEqual(round.status, 409);
  assert.strictEqual(round.body.error_code, 'CHECKLIST_DISABLED');
});

test('结果项数量不一致（少传）返回 SNAPSHOT_MISMATCH', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId } = await startedRound(server);
  const submit = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
    ], // 少传一项
  });
  assert.strictEqual(submit.status, 422);
  assert.strictEqual(submit.body.error_code, 'SNAPSHOT_MISMATCH');
  assert.strictEqual(submit.body.details.expected_count, 3);
  assert.strictEqual(submit.body.details.received_count, 2);
});

test('结果项数量不一致（多传）返回 SNAPSHOT_MISMATCH', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId } = await startedRound(server);
  const submit = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '多余项', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 422);
  assert.strictEqual(submit.body.error_code, 'SNAPSHOT_MISMATCH');
});

test('结果项顺序不一致返回 SNAPSHOT_MISMATCH', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId } = await startedRound(server);
  const submit = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW }, // 顺序调换
      { item_name: '油位检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 422);
  assert.strictEqual(submit.body.error_code, 'SNAPSHOT_MISMATCH');
  assert.strictEqual(submit.body.details.index, 0);
  assert.strictEqual(submit.body.details.expected_item_name, '油位检查');
  assert.strictEqual(submit.body.details.received_item_name, '温度检查');
});

test('结果项改名返回 SNAPSHOT_MISMATCH', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId } = await startedRound(server);
  const submit = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '温度检测', result_value: 'normal', submitted_at: NOW }, // 改名
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 422);
  assert.strictEqual(submit.body.error_code, 'SNAPSHOT_MISMATCH');
});

test('顺序与名称完全一致时提交成功', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId } = await startedRound(server);
  const submit = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(submit.status, 200);
  assert.strictEqual(submit.body.round.round_status, 'submitted');
});

test('旧轮次不受新清单版本影响：改版后仍按旧快照顺序校验', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const roundId = round.body.id;
  // 清单出新版本，改变项数量与顺序
  await req(server, 'POST', `/api/v1/checklists/${checklist.id}/versions`, {
    items: ['异响检查', '油位检查'],
  });
  await req(server, 'POST', `/api/v1/rounds/${roundId}/start`);
  // 用新版本的顺序提交应失败（旧快照仍是三项固定顺序）
  const wrong = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '油位检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(wrong.status, 422);
  assert.strictEqual(wrong.body.error_code, 'SNAPSHOT_MISMATCH');
  // 用旧快照的顺序提交应成功
  const ok = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  assert.strictEqual(ok.status, 200);
});

test('overdue 计算：超过 planned_end_at 且未关闭返回 overdue=true，且不改写数据库状态', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  // 计划窗完全在过去 => 已逾期
  const pastStart = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: pastStart, planned_end_at: pastEnd,
  });
  const roundId = round.body.id;

  // 按区域查未关闭轮次：overdue=true，且带 pending_reviews
  const open = await req(server, 'GET', '/api/v1/rounds/open?area=A区');
  assert.strictEqual(open.status, 200);
  const item = open.body.items.find((r) => r.id === roundId);
  assert.ok(item);
  assert.strictEqual(item.overdue, true);
  assert.strictEqual(item.pending_reviews, 0);

  // 数据库状态未被改写，仍是 scheduled
  const detail = await req(server, 'GET', `/api/v1/rounds/${roundId}`);
  assert.strictEqual(detail.body.round.round_status, 'scheduled');
  assert.strictEqual(detail.body.round.overdue, true);
});

test('未逾期轮次 overdue=false', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END, // 结束时间在未来
  });
  const open = await req(server, 'GET', '/api/v1/rounds/open?area=A区');
  const item = open.body.items.find((r) => r.id === round.body.id);
  assert.strictEqual(item.overdue, false);
});

// ---- 异常复核闭环扩展 / 风险统计口径 / 审计写入 补充覆盖 ----

// 便捷：生成 -> 开始 -> 提交带 fault+attention 的结果，返回 roundId 与复核列表
async function submittedWithAnomalies(server) {
  const { device, checklist } = await seedDeviceAndChecklist(server);
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const roundId = round.body.id;
  await req(server, 'POST', `/api/v1/rounds/${roundId}/start`);
  const submit = await req(server, 'POST', `/api/v1/rounds/${roundId}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', note: '漏油', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'attention', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  return { roundId, device, submit };
}

test('提交结果只要存在 fault 就自动生成待复核异常记录', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId, submit } = await submittedWithAnomalies(server);
  // fault + attention 各生成一条，共 2 条 pending
  assert.strictEqual(submit.body.pending_reviews, 2);
  const reviews = await req(server, 'GET', `/api/v1/rounds/${roundId}/reviews`);
  assert.strictEqual(reviews.body.items.length, 2);
  assert.ok(reviews.body.items.every((r) => r.review_status === 'pending'));
});

test('异常未复核不能关闭轮次', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId } = await submittedWithAnomalies(server);
  const close = await req(server, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.strictEqual(close.status, 409);
  assert.strictEqual(close.body.error_code, 'ROUND_HAS_UNREVIEWED_FAULT');
});

test('部分复核（仍有 pending 或 confirmed）不能关闭', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId } = await submittedWithAnomalies(server);
  const reviews = await req(server, 'GET', `/api/v1/rounds/${roundId}/reviews`);
  // 一条 resolved，一条 confirmed —— confirmed 不满足闭环
  await req(server, 'POST', `/api/v1/reviews/${reviews.body.items[0].id}`, {
    review_status: 'resolved', reviewer_name: '王工',
  });
  await req(server, 'POST', `/api/v1/reviews/${reviews.body.items[1].id}`, {
    review_status: 'confirmed', reviewer_name: '王工',
  });
  const close = await req(server, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.strictEqual(close.status, 409);
  assert.strictEqual(close.body.error_code, 'ROUND_HAS_UNREVIEWED_FAULT');
});

test('全部 ignored/resolved 后关闭成功', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { roundId } = await submittedWithAnomalies(server);
  const reviews = await req(server, 'GET', `/api/v1/rounds/${roundId}/reviews`);
  await req(server, 'POST', `/api/v1/reviews/${reviews.body.items[0].id}`, {
    review_status: 'resolved', reviewer_name: '王工',
  });
  await req(server, 'POST', `/api/v1/reviews/${reviews.body.items[1].id}`, {
    review_status: 'ignored', reviewer_name: '王工',
  });
  const close = await req(server, 'POST', `/api/v1/rounds/${roundId}/close`);
  assert.strictEqual(close.status, 200);
  assert.strictEqual(close.body.round_status, 'closed');
});

test('风险汇总口径：未关闭/异常项/待复核/逾期/已关闭 计数正确', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server); // A区 high

  // 轮次1：逾期且未关闭（计划窗在过去）
  const pastStart = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: pastStart, planned_end_at: pastEnd,
  });

  // 轮次2：未来窗，提交 fault 后全部 resolved 并关闭
  const r2 = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  await req(server, 'POST', `/api/v1/rounds/${r2.body.id}/start`);
  await req(server, 'POST', `/api/v1/rounds/${r2.body.id}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });
  const rv2 = await req(server, 'GET', `/api/v1/rounds/${r2.body.id}/reviews`);
  await req(server, 'POST', `/api/v1/reviews/${rv2.body.items[0].id}`, {
    review_status: 'resolved', reviewer_name: '王工',
  });
  await req(server, 'POST', `/api/v1/rounds/${r2.body.id}/close`);

  // 轮次3：未来窗，提交 attention（待复核），保持未关闭
  const r3 = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  await req(server, 'POST', `/api/v1/rounds/${r3.body.id}/start`);
  await req(server, 'POST', `/api/v1/rounds/${r3.body.id}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'attention', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  });

  const summary = await req(server, 'GET', '/api/v1/reports/risk-summary');
  const b = summary.body.items.find((x) => x.area === 'A区' && x.risk_level === 'high');
  assert.ok(b);
  // 轮次1(open,overdue,submitted-no…scheduled) + 轮次3(open) = 2 未关闭；轮次1 逾期 =1
  assert.strictEqual(b.open_round_count, 2);
  assert.strictEqual(b.overdue_round_count, 1);
  assert.strictEqual(b.closed_round_count, 1);
  // 异常检查项：轮次2 fault(1) + 轮次3 attention(1) = 2；其中待复核只有轮次3 =1
  assert.strictEqual(b.anomaly_item_count, 2);
  assert.strictEqual(b.pending_review_count, 1);
});

test('六类关键动作均写入审计事件（含 actor/动作/实体类型/说明）', async (t) => {
  const server = await freshServer();
  t.after(() => server.close());
  const { device, checklist } = await seedDeviceAndChecklist(server);

  // 1) 清单复制
  await req(server, 'POST', `/api/v1/checklists/${checklist.id}/versions`, {}, { 'X-Actor': 'copier' });
  // 2) 设备停用（用另一台设备，避免影响后续轮次）
  const dev2 = await req(server, 'POST', '/api/v1/devices', {
    device_code: 'DEV-AUD', device_name: 'x', area: 'A区', device_type: 'compressor', risk_level: 'low',
  });
  await req(server, 'POST', `/api/v1/devices/${dev2.body.id}/disable`, undefined, { 'X-Actor': 'disabler' });
  // 3) 轮次开始 4) 结果提交 5) 复核提交 6) 轮次关闭
  const round = await req(server, 'POST', '/api/v1/rounds', {
    device_id: device.id, checklist_id: checklist.id, owner_name: '张三',
    planned_start_at: START, planned_end_at: END,
  });
  const rid = round.body.id;
  await req(server, 'POST', `/api/v1/rounds/${rid}/start`, undefined, { 'X-Actor': 'starter' });
  await req(server, 'POST', `/api/v1/rounds/${rid}/results`, {
    results: [
      { item_name: '油位检查', result_value: 'fault', submitted_at: NOW },
      { item_name: '温度检查', result_value: 'normal', submitted_at: NOW },
      { item_name: '异响检查', result_value: 'normal', submitted_at: NOW },
    ],
  }, { 'X-Actor': 'submitter' });
  const reviews = await req(server, 'GET', `/api/v1/rounds/${rid}/reviews`);
  await req(server, 'POST', `/api/v1/reviews/${reviews.body.items[0].id}`, {
    review_status: 'resolved', reviewer_name: '王工',
  }, { 'X-Actor': 'reviewer' });
  await req(server, 'POST', `/api/v1/rounds/${rid}/close`, undefined, { 'X-Actor': 'closer' });

  // 逐一断言审计事件类型、实体类型、actor 与说明存在
  const expect = [
    { event_type: 'checklist_version_copied', entity_type: 'checklist', actor: 'copier' },
    { event_type: 'device_disabled', entity_type: 'device', actor: 'disabler' },
    { event_type: 'round_started', entity_type: 'round', actor: 'starter' },
    { event_type: 'results_submitted', entity_type: 'round', actor: 'submitter' },
    { event_type: 'review_submitted', entity_type: 'review', actor: 'reviewer' },
    { event_type: 'round_closed', entity_type: 'round', actor: 'closer' },
  ];
  for (const e of expect) {
    const res = await req(server, 'GET', `/api/v1/audit-events?event_type=${e.event_type}`);
    assert.strictEqual(res.status, 200, e.event_type);
    assert.ok(res.body.items.length >= 1, `缺少审计事件 ${e.event_type}`);
    const ev = res.body.items[0];
    assert.strictEqual(ev.entity_type, e.entity_type, e.event_type);
    assert.strictEqual(ev.actor, e.actor, e.event_type);
    assert.ok(ev.detail && ev.detail.description, `审计事件 ${e.event_type} 缺少说明`);
  }
});
