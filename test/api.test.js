process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db/connection');

getDb(); // 初始化内存库表结构
const app = createApp();

async function seedDevice(overrides = {}) {
  const res = await request(app)
    .post('/api/v1/devices')
    .send({
      device_code: 'PUMP-001',
      device_name: '一号水泵',
      area: '东区',
      device_type: 'pump',
      risk_level: 'high',
      maintenance_note: '每季度更换密封圈',
      ...overrides,
    });
  return res;
}

async function seedChecklist(overrides = {}) {
  const res = await request(app)
    .post('/api/v1/checklists')
    .send({
      checklist_name: '水泵巡检清单',
      device_type: 'pump',
      items: ['外观检查', { item_name: '振动检测', description: '振动值不超阈值' }, '温度检测'],
      cycle_days: 7,
      ...overrides,
    });
  return res;
}

async function seedRound(deviceId, checklistId, overrides = {}) {
  const res = await request(app).post('/api/v1/rounds').send({
    device_id: deviceId,
    checklist_id: checklistId,
    planned_start_at: '2026-08-01T00:00:00.000Z',
    owner_name: '张三',
    ...overrides,
  });
  return res;
}

test('创建设备成功并返回 snake_case 字段', async () => {
  const res = await seedDevice();
  assert.equal(res.status, 201);
  assert.equal(res.body.device_code, 'PUMP-001');
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.risk_level, 'high');
});

test('创建设备缺少必填字段返回固定错误格式', async () => {
  const res = await request(app).post('/api/v1/devices').send({ device_code: 'X-1' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error_code, 'validation_error');
  assert.equal(typeof res.body.message, 'string');
  assert.equal(typeof res.body.details, 'object');
  assert.ok(res.body.details.missing_fields.includes('device_name'));
});

test('设备编码重复返回 409', async () => {
  const res = await seedDevice({ device_name: '重复编码' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error_code, 'conflict');
});

test('创建清单并复制新版本', async () => {
  const created = await seedChecklist();
  assert.equal(created.status, 201);
  assert.equal(created.body.version, 1);
  assert.deepEqual(
    created.body.items.map((i) => i.item_name),
    ['外观检查', '振动检测', '温度检测']
  );

  const copied = await request(app)
    .post(`/api/v1/checklists/${created.body.id}/copy`)
    .send({ items: ['外观检查', '振动检测', '温度检测', '密封检测'] });
  assert.equal(copied.status, 201);
  assert.equal(copied.body.version, 2);
  assert.equal(copied.body.items.length, 4);
});

test('完整轮次闭环：快照隔离、异常复核、状态机约束', async () => {
  const device = (await seedDevice({ device_code: 'PUMP-002', device_name: '二号水泵' })).body;
  const checklistV1 = (await seedChecklist({ checklist_name: '闭环清单' })).body;

  // 生成轮次 -> 保存 v1 快照
  const round = (await seedRound(device.id, checklistV1.id)).body;
  assert.equal(round.round_status, 'scheduled');
  assert.equal(round.checklist_snapshot.version, 1);
  assert.equal(round.checklist_snapshot.items.length, 3);
  // planned_end_at 默认 = 开始 + cycle_days
  assert.equal(round.planned_end_at, '2026-08-08T00:00:00.000Z');

  // scheduled 不能直接关闭
  const badClose = await request(app).post(`/api/v1/rounds/${round.id}/close`);
  assert.equal(badClose.status, 409);
  assert.equal(badClose.body.error_code, 'invalid_transition');

  // 清单升级到 v2 新增项目，不影响旧轮次校验
  await request(app)
    .post(`/api/v1/checklists/${checklistV1.id}/copy`)
    .send({ items: ['外观检查', '振动检测', '温度检测', '新增项目'] });

  // scheduled 状态不能提交结果
  const earlySubmit = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({ results: [{ item_name: '外观检查', result_value: 'normal' }] });
  assert.equal(earlySubmit.status, 409);

  // 开始巡检
  const started = await request(app).post(`/api/v1/rounds/${round.id}/start`);
  assert.equal(started.body.round_status, 'in_progress');

  // v2 新增的 item_name 不属于旧快照，被拒绝（快照隔离）
  const badItem = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'normal' },
        { item_name: '温度检测', result_value: 'normal' },
        { item_name: '新增项目', result_value: 'normal' },
      ],
    });
  assert.equal(badItem.status, 400);
  assert.equal(badItem.body.error_code, 'validation_error');
  assert.equal(badItem.body.details.expected_count, 3);

  // 按 v1 快照的数量、顺序、名称一次性提交（含 fault），旧轮次不受 v2 影响
  const submitted = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'fault', note: '振动超标' },
        { item_name: '温度检测', result_value: 'attention' },
      ],
    });
  assert.equal(submitted.body.round_status, 'submitted');
  const faultResult = submitted.body.results.find((r) => r.result_value === 'fault');
  const attentionResult = submitted.body.results.find((r) => r.result_value === 'attention');
  assert.equal(faultResult.review.review_status, 'pending'); // 自动生成待复核

  // 存在未复核异常，禁止关闭
  const blocked = await request(app).post(`/api/v1/rounds/${round.id}/close`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error_code, 'unresolved_anomalies');
  assert.equal(blocked.body.details.blocking_reviews.length, 2);

  // fault 复核为 resolved；attention 仍未复核，关闭仍被拒绝
  const reviewed = await request(app)
    .post(`/api/v1/rounds/${round.id}/reviews`)
    .send({
      result_id: faultResult.id,
      review_status: 'resolved',
      reviewer_name: '李四',
      review_note: '已更换轴承',
    });
  assert.equal(reviewed.body.review_status, 'resolved');
  assert.equal(reviewed.body.reviewer_name, '李四');
  assert.ok(reviewed.body.reviewed_at);

  const stillBlocked = await request(app).post(`/api/v1/rounds/${round.id}/close`);
  assert.equal(stillBlocked.status, 409);
  assert.equal(stillBlocked.body.details.blocking_reviews.length, 1);
  assert.equal(stillBlocked.body.details.blocking_reviews[0].item_name, '温度检测');

  // attention 复核为 ignored 后，全部异常闭环
  await request(app)
    .post(`/api/v1/rounds/${round.id}/reviews`)
    .send({ result_id: attentionResult.id, review_status: 'ignored', reviewer_name: '王五' });

  // 终态（resolved）重复复核返回 409
  const dupReview = await request(app)
    .post(`/api/v1/rounds/${round.id}/reviews`)
    .send({ result_id: faultResult.id, review_status: 'ignored', reviewer_name: '王五' });
  assert.equal(dupReview.status, 409);

  const closed = await request(app)
    .post(`/api/v1/rounds/${round.id}/close`)
    .send({ operator_name: '赵班长' });
  assert.equal(closed.body.round_status, 'closed');
  assert.ok(closed.body.closed_at);

  // 设备最近轮次即该轮次
  const latest = await request(app).get(`/api/v1/devices/${device.id}/latest-round`);
  assert.equal(latest.body.id, round.id);
  assert.equal(latest.body.round_status, 'closed');
});

test('提交结果数量不一致（少传/多传）被拒绝', async () => {
  const device = (await seedDevice({ device_code: 'PUMP-003', device_name: '三号水泵' })).body;
  const checklist = (await seedChecklist({ checklist_name: '严格校验清单' })).body;
  const round = (await seedRound(device.id, checklist.id)).body;
  await request(app).post(`/api/v1/rounds/${round.id}/start`);

  // 少传
  const fewer = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'normal' },
      ],
    });
  assert.equal(fewer.status, 400);
  assert.equal(fewer.body.error_code, 'validation_error');
  assert.equal(fewer.body.details.expected_count, 3);
  assert.equal(fewer.body.details.received_count, 2);

  // 多传
  const more = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'normal' },
        { item_name: '温度检测', result_value: 'normal' },
        { item_name: '额外项目', result_value: 'normal' },
      ],
    });
  assert.equal(more.status, 400);
  assert.equal(more.body.details.expected_count, 3);
  assert.equal(more.body.details.received_count, 4);

  // 校验失败不产生任何结果，轮次仍为 in_progress
  const detail = await request(app).get(`/api/v1/rounds/${round.id}`);
  assert.equal(detail.body.round_status, 'in_progress');
  assert.equal(detail.body.results.length, 0);
});

test('提交结果顺序不一致或改名被拒绝', async () => {
  const device = (await seedDevice({ device_code: 'PUMP-004', device_name: '四号水泵' })).body;
  const checklist = (await seedChecklist({ checklist_name: '顺序校验清单' })).body;
  const round = (await seedRound(device.id, checklist.id)).body;
  await request(app).post(`/api/v1/rounds/${round.id}/start`);

  // 数量相同但顺序不一致
  const wrongOrder = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      results: [
        { item_name: '振动检测', result_value: 'normal' },
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '温度检测', result_value: 'normal' },
      ],
    });
  assert.equal(wrongOrder.status, 400);
  assert.equal(wrongOrder.body.details.index, 0);
  assert.equal(wrongOrder.body.details.expected_item, '外观检查');
  assert.equal(wrongOrder.body.details.received_item, '振动检测');

  // 数量相同但改名
  const renamed = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'normal' },
        { item_name: '壳体温度检测', result_value: 'normal' },
      ],
    });
  assert.equal(renamed.status, 400);
  assert.equal(renamed.body.details.index, 2);
  assert.equal(renamed.body.details.expected_item, '温度检测');

  // 按快照原顺序提交成功
  const ok = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'normal' },
        { item_name: '温度检测', result_value: 'skipped' },
      ],
    });
  assert.equal(ok.body.round_status, 'submitted');
});

test('planned_end_at 早于 planned_start_at 返回 400，等于则允许', async () => {
  const device = (await seedDevice({ device_code: 'PUMP-005', device_name: '五号水泵' })).body;
  const checklist = (await seedChecklist({ checklist_name: '时间校验清单' })).body;

  const bad = await seedRound(device.id, checklist.id, {
    planned_end_at: '2026-07-31T00:00:00.000Z',
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error_code, 'validation_error');
  assert.match(bad.body.message, /planned_end_at/);

  // 结束时间等于开始时间：合法
  const same = await seedRound(device.id, checklist.id, {
    planned_end_at: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(same.status, 201);
  assert.equal(same.body.planned_end_at, same.body.planned_start_at);

  // 非法日期字符串
  const invalid = await seedRound(device.id, checklist.id, {
    planned_start_at: 'not-a-date',
  });
  assert.equal(invalid.status, 400);
});

test('禁用清单不能生成轮次，也不能复制新版本', async () => {
  const device = (await seedDevice({ device_code: 'PUMP-006', device_name: '六号水泵' })).body;
  const checklist = (
    await seedChecklist({ checklist_name: '禁用清单', enabled: false })
  ).body;
  assert.equal(checklist.enabled, false);

  const genRes = await seedRound(device.id, checklist.id);
  assert.equal(genRes.status, 409);
  assert.equal(genRes.body.error_code, 'conflict');

  const copyRes = await request(app).post(`/api/v1/checklists/${checklist.id}/copy`).send({});
  assert.equal(copyRes.status, 409);
  assert.equal(copyRes.body.error_code, 'conflict');
});

test('未关闭轮次返回待复核异常数量与 overdue 标记（不改写数据库）', async () => {
  const device = (await seedDevice({ device_code: 'CRN-001', device_name: '行车一', area: '南区', device_type: 'crane', risk_level: 'critical' })).body;
  const checklist = (await seedChecklist({ checklist_name: '行车清单', device_type: 'crane', items: ['钢丝绳检查', '制动器检查'], cycle_days: 3 })).body;

  // 已过期的轮次（planned_end_at 在过去），含一个待复核 fault
  const overdueRound = (await seedRound(device.id, checklist.id, {
    planned_start_at: '2026-07-01T00:00:00.000Z',
    planned_end_at: '2026-07-04T00:00:00.000Z',
  })).body;
  await request(app).post(`/api/v1/rounds/${overdueRound.id}/start`);
  await request(app)
    .post(`/api/v1/rounds/${overdueRound.id}/results`)
    .send({
      results: [
        { item_name: '钢丝绳检查', result_value: 'fault', note: '断丝超标' },
        { item_name: '制动器检查', result_value: 'normal' },
      ],
    });

  // 未过期的轮次
  const futureRound = (await seedRound(device.id, checklist.id, {
    planned_start_at: '2026-08-01T00:00:00.000Z',
    planned_end_at: '2099-08-08T00:00:00.000Z',
  })).body;

  const open = await request(app).get('/api/v1/rounds/open?area=南区');
  const overdueRow = open.body.find((r) => r.id === overdueRound.id);
  const futureRow = open.body.find((r) => r.id === futureRound.id);
  assert.equal(overdueRow.overdue, true);
  assert.equal(overdueRow.pending_review_count, 1);
  assert.equal(futureRow.overdue, false);
  assert.equal(futureRow.pending_review_count, 0);

  // overdue 只是实时计算字段，数据库中的轮次状态不被改写
  const detail = await request(app).get(`/api/v1/rounds/${overdueRound.id}`);
  assert.equal(detail.body.round_status, 'submitted');
});

test('按区域查未关闭轮次、按风险等级查异常、区域汇总、审计查询', async () => {
  const devA = (await seedDevice({ device_code: 'VLV-001', device_name: '阀门一', area: '西区', device_type: 'valve', risk_level: 'medium' })).body;
  const clA = (await seedChecklist({ checklist_name: '阀门清单', device_type: 'valve', items: ['密封检查'], cycle_days: 30 })).body;

  const roundRes = await seedRound(devA.id, clA.id, { owner_name: '赵六' });
  assert.equal(roundRes.status, 201);
  const roundId = roundRes.body.id;

  // 未关闭轮次（scheduled 即未关闭）
  const open = await request(app).get('/api/v1/rounds/open?area=西区');
  assert.ok(open.body.some((r) => r.id === roundId));
  const openEast = await request(app).get('/api/v1/rounds/open?area=不存在区');
  assert.ok(!openEast.body.some((r) => r.id === roundId));

  // 制造一个 fault 异常
  await request(app).post(`/api/v1/rounds/${roundId}/start`);
  await request(app)
    .post(`/api/v1/rounds/${roundId}/results`)
    .send({ results: [{ item_name: '密封检查', result_value: 'fault' }] });

  const anomalies = await request(app).get('/api/v1/anomalies?risk_level=medium');
  assert.ok(anomalies.body.some((a) => a.round_id === roundId && a.result_value === 'fault'));
  const none = await request(app).get('/api/v1/anomalies?risk_level=critical');
  assert.ok(!none.body.some((a) => a.round_id === roundId));
  const badRisk = await request(app).get('/api/v1/anomalies?risk_level=unknown');
  assert.equal(badRisk.status, 400);

  const summary = await request(app).get('/api/v1/reports/area-risk-summary');
  const west = summary.body.find((s) => s.area === '西区');
  assert.ok(west);
  assert.equal(west.open_rounds >= 1, true);
  assert.equal(west.pending_faults >= 1, true);

  const audits = await request(app).get(`/api/v1/audit-events?entity_type=round&entity_id=${roundId}`);
  const types = audits.body.map((e) => e.event_type);
  assert.ok(types.includes('round.created'));
  assert.ok(types.includes('round.started'));
  assert.ok(types.includes('round.submitted'));
});

test('停用设备后不能生成轮次；未知路由返回固定错误格式', async () => {
  const dev = (await seedDevice({ device_code: 'GEN-001', device_name: '发电机', area: '北区', device_type: 'generator', risk_level: 'low' })).body;
  const cl = (await seedChecklist({ checklist_name: '发电机清单', device_type: 'generator', items: ['油位检查'] })).body;

  const disabled = await request(app).post(`/api/v1/devices/${dev.id}/disable`);
  assert.equal(disabled.body.enabled, false);

  const res = await seedRound(dev.id, cl.id, { owner_name: '孙七' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error_code, 'conflict');

  const notFoundRes = await request(app).get('/api/v1/unknown-path');
  assert.equal(notFoundRes.status, 404);
  assert.equal(notFoundRes.body.error_code, 'not_found');
  assert.deepEqual(notFoundRes.body.details, {});
});

test('confirmed 仅表示确认存在，不能作为关闭条件；可继续复核为 resolved 后关闭', async () => {
  const device = (await seedDevice({ device_code: 'PUMP-007', device_name: '七号水泵' })).body;
  const checklist = (await seedChecklist({ checklist_name: '确认闭环清单' })).body;
  const round = (await seedRound(device.id, checklist.id)).body;
  await request(app).post(`/api/v1/rounds/${round.id}/start`);

  const submitted = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'fault', note: '振动超标' },
        { item_name: '温度检测', result_value: 'normal' },
      ],
    });
  const faultResult = submitted.body.results.find((r) => r.result_value === 'fault');

  // confirmed 后仍不能关闭
  await request(app)
    .post(`/api/v1/rounds/${round.id}/reviews`)
    .send({ result_id: faultResult.id, review_status: 'confirmed', reviewer_name: '李四' });
  const blocked = await request(app).post(`/api/v1/rounds/${round.id}/close`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error_code, 'unresolved_anomalies');
  assert.equal(blocked.body.details.blocking_reviews[0].review_status, 'confirmed');

  // 重复 confirmed 无意义，返回 409
  const dupConfirmed = await request(app)
    .post(`/api/v1/rounds/${round.id}/reviews`)
    .send({ result_id: faultResult.id, review_status: 'confirmed', reviewer_name: '王五' });
  assert.equal(dupConfirmed.status, 409);

  // confirmed 可继续复核为 resolved，之后允许关闭
  const resolved = await request(app)
    .post(`/api/v1/rounds/${round.id}/reviews`)
    .send({ result_id: faultResult.id, review_status: 'resolved', reviewer_name: '李四', review_note: '已处理' });
  assert.equal(resolved.body.review_status, 'resolved');

  const closed = await request(app).post(`/api/v1/rounds/${round.id}/close`);
  assert.equal(closed.body.round_status, 'closed');
});

test('风险汇总：按 area + risk_level 统计五维口径', async () => {
  const devHigh = (await seedDevice({ device_code: 'BLR-001', device_name: '锅炉一', area: '统计区', device_type: 'boiler', risk_level: 'high' })).body;
  const devLow = (await seedDevice({ device_code: 'BLR-002', device_name: '锅炉二', area: '统计区', device_type: 'boiler', risk_level: 'low' })).body;
  const checklist = (await seedChecklist({ checklist_name: '锅炉清单', device_type: 'boiler', items: ['压力检查', '水位检查'] })).body;

  // high 组：一个已关闭轮次（全部 normal）
  const closedRound = (await seedRound(devHigh.id, checklist.id)).body;
  await request(app).post(`/api/v1/rounds/${closedRound.id}/start`);
  await request(app)
    .post(`/api/v1/rounds/${closedRound.id}/results`)
    .send({
      results: [
        { item_name: '压力检查', result_value: 'normal' },
        { item_name: '水位检查', result_value: 'normal' },
      ],
    });
  await request(app).post(`/api/v1/rounds/${closedRound.id}/close`);

  // high 组：一个逾期未关闭轮次，含 1 fault（待复核）+ 1 attention（待复核）
  const overdueRound = (await seedRound(devHigh.id, checklist.id, {
    planned_start_at: '2026-07-01T00:00:00.000Z',
    planned_end_at: '2026-07-02T00:00:00.000Z',
  })).body;
  await request(app).post(`/api/v1/rounds/${overdueRound.id}/start`);
  await request(app)
    .post(`/api/v1/rounds/${overdueRound.id}/results`)
    .send({
      results: [
        { item_name: '压力检查', result_value: 'fault' },
        { item_name: '水位检查', result_value: 'attention' },
      ],
    });

  // low 组：一个未逾期轮次（无异常）
  await seedRound(devLow.id, checklist.id, {
    planned_end_at: '2099-01-01T00:00:00.000Z',
  });

  const all = await request(app).get('/api/v1/reports/risk-summary?area=统计区');
  const high = all.body.find((r) => r.area === '统计区' && r.risk_level === 'high');
  const low = all.body.find((r) => r.area === '统计区' && r.risk_level === 'low');

  assert.equal(high.open_rounds, 1);        // overdueRound 未关闭
  assert.equal(high.closed_rounds, 1);      // closedRound 已关闭
  assert.equal(high.overdue_rounds, 1);     // overdueRound 已过期
  assert.equal(high.abnormal_results, 2);   // fault + attention
  assert.equal(high.pending_reviews, 2);    // 两个异常均待复核

  assert.equal(low.open_rounds, 1);
  assert.equal(low.closed_rounds, 0);
  assert.equal(low.overdue_rounds, 0);      // planned_end_at 在未来
  assert.equal(low.abnormal_results, 0);
  assert.equal(low.pending_reviews, 0);

  // risk_level 过滤
  const filtered = await request(app).get('/api/v1/reports/risk-summary?area=统计区&risk_level=low');
  assert.equal(filtered.body.length, 1);
  assert.equal(filtered.body[0].risk_level, 'low');

  const badRisk = await request(app).get('/api/v1/reports/risk-summary?risk_level=unknown');
  assert.equal(badRisk.status, 400);
});

test('审计事件：停用/复制/开始/提交/复核/关闭均记录操作者、动作、实体类型与说明', async () => {
  const device = (await seedDevice({ device_code: 'AUD-001', device_name: '审计泵', area: '审计区', device_type: 'pump' })).body;
  const checklist = (await seedChecklist({ checklist_name: '审计清单', items: ['外观检查', '振动检测', '温度检测'] })).body;

  await request(app).post(`/api/v1/devices/${device.id}/disable`).send({ operator_name: '管理员甲' });
  const copied = (await request(app)
    .post(`/api/v1/checklists/${checklist.id}/copy`)
    .send({ operator_name: '管理员乙' })).body;

  // 重新启用设备副本不可用，改用新设备生成轮次
  const device2 = (await seedDevice({ device_code: 'AUD-002', device_name: '审计泵二', area: '审计区', device_type: 'pump' })).body;
  const round = (await seedRound(device2.id, copied.id)).body;
  await request(app).post(`/api/v1/rounds/${round.id}/start`).send({ operator_name: '巡检员丙' });
  await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      submitter_name: '巡检员丙',
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'normal' },
        { item_name: '温度检测', result_value: 'normal' },
      ],
    });
  await request(app).post(`/api/v1/rounds/${round.id}/close`).send({ operator_name: '班长丁' });

  // 带异常的轮次验证复核审计
  const round2 = (await seedRound(device2.id, copied.id)).body;
  await request(app).post(`/api/v1/rounds/${round2.id}/start`).send({ operator_name: '巡检员丙' });
  const submitted2 = await request(app)
    .post(`/api/v1/rounds/${round2.id}/results`)
    .send({
      submitter_name: '巡检员丙',
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'fault' },
        { item_name: '温度检测', result_value: 'normal' },
      ],
    });
  const faultId = submitted2.body.results.find((r) => r.result_value === 'fault').id;
  await request(app)
    .post(`/api/v1/rounds/${round2.id}/reviews`)
    .send({ result_id: faultId, review_status: 'resolved', reviewer_name: '复核员戊' });
  await request(app).post(`/api/v1/rounds/${round2.id}/close`).send({ operator_name: '班长丁' });

  // 逐类校验审计字段
  const assertAudit = (events, eventType, actor, entityType) => {
    const e = events.find((x) => x.event_type === eventType);
    assert.ok(e, `缺少审计事件 ${eventType}`);
    assert.equal(e.actor, actor);
    assert.equal(e.entity_type, entityType);
    assert.ok(e.detail && typeof e.detail.description === 'string' && e.detail.description.length > 0);
  };

  const deviceAudits = (await request(app).get(`/api/v1/audit-events?entity_type=device&entity_id=${device.id}`)).body;
  assertAudit(deviceAudits, 'device.disabled', '管理员甲', 'device');

  const checklistAudits = (await request(app).get(`/api/v1/audit-events?entity_type=checklist&entity_id=${copied.id}`)).body;
  assertAudit(checklistAudits, 'checklist.copied', '管理员乙', 'checklist');

  const roundAudits = (await request(app).get(`/api/v1/audit-events?entity_type=round&entity_id=${round.id}`)).body;
  assertAudit(roundAudits, 'round.started', '巡检员丙', 'round');
  assertAudit(roundAudits, 'round.submitted', '巡检员丙', 'round');
  assertAudit(roundAudits, 'round.closed', '班长丁', 'round');

  const round2Audits = (await request(app).get(`/api/v1/audit-events?entity_type=round&entity_id=${round2.id}`)).body;
  assertAudit(round2Audits, 'review.submitted', '复核员戊', 'round');
});

test('README 关键流程可执行：创建设备→创建清单→生成轮次→提交故障结果→复核异常→关闭轮次', async () => {
  // 1. 创建设备
  const device = (
    await request(app).post('/api/v1/devices').send({
      device_code: 'README-001',
      device_name: '示例水泵',
      area: '示例区',
      device_type: 'demo_pump',
      risk_level: 'high',
      maintenance_note: 'README 示例设备',
    })
  ).body;
  assert.ok(device.id);

  // 2. 创建清单
  const checklist = (
    await request(app).post('/api/v1/checklists').send({
      checklist_name: 'README 示例清单',
      device_type: 'demo_pump',
      items: ['外观检查', '振动检测'],
      cycle_days: 7,
    })
  ).body;
  assert.ok(checklist.id);

  // 3. 生成轮次（保存清单快照）
  const round = (
    await request(app).post('/api/v1/rounds').send({
      device_id: device.id,
      checklist_id: checklist.id,
      planned_start_at: '2026-08-01T00:00:00.000Z',
      owner_name: '张三',
    })
  ).body;
  assert.equal(round.round_status, 'scheduled');
  assert.equal(round.checklist_snapshot.items.length, 2);

  // 开始巡检
  await request(app).post(`/api/v1/rounds/${round.id}/start`).send({ operator_name: '张三' });

  // 4. 提交故障结果（按快照顺序）
  const submitted = await request(app)
    .post(`/api/v1/rounds/${round.id}/results`)
    .send({
      submitter_name: '张三',
      results: [
        { item_name: '外观检查', result_value: 'normal' },
        { item_name: '振动检测', result_value: 'fault', note: '振动超标' },
      ],
    });
  assert.equal(submitted.body.round_status, 'submitted');
  const faultResult = submitted.body.results.find((r) => r.result_value === 'fault');
  assert.equal(faultResult.review.review_status, 'pending');

  // 未复核前禁止关闭
  const blocked = await request(app).post(`/api/v1/rounds/${round.id}/close`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error_code, 'unresolved_anomalies');

  // 5. 复核异常
  const review = await request(app)
    .post(`/api/v1/rounds/${round.id}/reviews`)
    .send({ result_id: faultResult.id, review_status: 'resolved', reviewer_name: '李四', review_note: '已更换轴承' });
  assert.equal(review.body.review_status, 'resolved');

  // 6. 关闭轮次
  const closed = await request(app).post(`/api/v1/rounds/${round.id}/close`).send({ operator_name: '王班长' });
  assert.equal(closed.body.round_status, 'closed');
});

test('数据自检：链路数据一致时全部检查通过', async () => {
  const res = await request(app).get('/api/v1/self-check');
  assert.equal(res.status, 200);
  assert.equal(res.body.passed, true);
  assert.equal(res.body.check_count, 7);
  const names = res.body.checks.map((c) => c.check_name);
  for (const expected of [
    'round_results_match',
    'fault_without_review',
    'closed_round_pending_reviews',
    'round_snapshot_missing',
    'rounds_on_disabled_device',
    'snapshot_items_not_json_array',
    'audit_events_missing',
  ]) {
    assert.ok(names.includes(expected), `缺少检查项 ${expected}`);
  }
  for (const check of res.body.checks) {
    assert.equal(check.passed, true, `${check.check_name} 不应有问题: ${JSON.stringify(check.issues)}`);
    assert.equal(check.issue_count, 0);
    assert.deepEqual(check.issues, []);
  }
});

test('自检与统计等新增接口响应字段保持 snake_case', async () => {
  const snakeKey = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
  const assertKeys = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => assertKeys(v, `${path}[${i}]`));
    } else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        assert.match(k, snakeKey, `字段 ${path}.${k} 不是 snake_case`);
        assertKeys(v, `${path}.${k}`);
      }
    }
  };

  const endpoints = [
    '/api/v1/self-check',
    '/api/v1/reports/risk-summary',
    '/api/v1/reports/area-risk-summary',
    '/api/v1/rounds/open',
    '/api/v1/anomalies',
    '/api/v1/audit-events',
  ];
  for (const url of endpoints) {
    const res = await request(app).get(url);
    assert.equal(res.status, 200, `${url} 应返回 200`);
    assertKeys(res.body, url);
  }
});

// 注意：本测试直接向数据库写入脏数据，必须作为最后一个用例运行
test('数据自检：能发现各类不一致数据', async () => {
  const db = getDb();

  // 造一个正常轮次作为脏数据载体
  const device = (await seedDevice({ device_code: 'DIRTY-001', device_name: '脏数据泵', area: '脏数据区', device_type: 'dirty', risk_level: 'low' })).body;
  const checklist = (await seedChecklist({ checklist_name: '脏数据清单', device_type: 'dirty', items: ['项目一', '项目二'] })).body;
  const round = (await seedRound(device.id, checklist.id)).body;
  const now = new Date().toISOString();

  // 1) scheduled 轮次直接塞入 fault 结果且无复核记录（触发 round_results_match + fault_without_review）
  db.prepare(
    `INSERT INTO results (round_id, item_name, result_value, note, submitted_at) VALUES (?, '项目一', 'fault', NULL, ?)`
  ).run(round.id, now);
  // 2) 破坏快照 items_json（触发 snapshot_items_not_json_array）
  db.prepare(`UPDATE checklist_snapshots SET items_json = 'not-a-json' WHERE id = ?`).run(round.checklist_snapshot_id);
  // 3) 删除该轮次的审计事件（触发 audit_events_missing）
  db.prepare(`DELETE FROM audit_events WHERE entity_type = 'round' AND entity_id = ?`).run(round.id);

  // 4) 已关闭轮次仍有待复核异常（触发 closed_round_pending_reviews + round_results_match）
  const round2 = (await seedRound(device.id, checklist.id)).body;
  await request(app).post(`/api/v1/rounds/${round2.id}/start`);
  await request(app)
    .post(`/api/v1/rounds/${round2.id}/results`)
    .send({ results: [{ item_name: '项目一', result_value: 'normal' }, { item_name: '项目二', result_value: 'normal' }] });
  await request(app).post(`/api/v1/rounds/${round2.id}/close`);
  const dirtyResultId = db.prepare(
    `INSERT INTO results (round_id, item_name, result_value, note, submitted_at) VALUES (?, '项目三', 'fault', NULL, ?)`
  ).run(round2.id, now).lastInsertRowid;
  db.prepare(`INSERT INTO reviews (round_id, result_id, review_status, created_at) VALUES (?, ?, 'pending', ?)`).run(round2.id, dirtyResultId, now);

  // 5) 轮次快照缺失（触发 round_snapshot_missing）
  db.pragma('foreign_keys = OFF');
  db.prepare(
    `INSERT INTO rounds (device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, round_status, owner_name, created_at, updated_at)
     VALUES (?, ?, 999999, ?, ?, 'scheduled', '脏数据员', ?, ?)`
  ).run(device.id, checklist.id, now, now, now, now);
  db.pragma('foreign_keys = ON');

  // 6) 设备停用后仍生成新轮次（触发 rounds_on_disabled_device）
  await request(app).post(`/api/v1/devices/${device.id}/disable`);
  const later = new Date(Date.now() + 5000).toISOString();
  db.prepare(
    `INSERT INTO rounds (device_id, checklist_id, checklist_snapshot_id, planned_start_at, planned_end_at, round_status, owner_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'scheduled', '脏数据员', ?, ?)`
  ).run(device.id, checklist.id, round.checklist_snapshot_id, now, now, later, later);

  const res = await request(app).get('/api/v1/self-check');
  assert.equal(res.status, 200);
  assert.equal(res.body.passed, false);
  const byName = new Map(res.body.checks.map((c) => [c.check_name, c]));

  assert.equal(byName.get('round_results_match').passed, false);
  // round2 已关闭但被塞入第 3 条结果，与快照 2 个项目不一致
  assert.ok(byName.get('round_results_match').issues.some((i) => i.entity_id === round2.id && i.expected_count === 2 && i.actual_count === 3));

  assert.equal(byName.get('fault_without_review').passed, false);
  assert.ok(byName.get('fault_without_review').issues.some((i) => i.round_id === round.id));

  assert.equal(byName.get('closed_round_pending_reviews').passed, false);
  assert.ok(byName.get('closed_round_pending_reviews').issues.some((i) => i.entity_id === round2.id));

  assert.equal(byName.get('round_snapshot_missing').passed, false);
  assert.ok(byName.get('round_snapshot_missing').issues.some((i) => i.checklist_snapshot_id === 999999));

  assert.equal(byName.get('rounds_on_disabled_device').passed, false);
  assert.ok(byName.get('rounds_on_disabled_device').issues.some((i) => i.device_code === 'DIRTY-001'));

  assert.equal(byName.get('snapshot_items_not_json_array').passed, false);
  assert.ok(byName.get('snapshot_items_not_json_array').issues.some((i) => i.entity_id === round.checklist_snapshot_id));

  assert.equal(byName.get('audit_events_missing').passed, false);
  assert.ok(byName.get('audit_events_missing').issues.some((i) => i.entity_id === round.id));
});
