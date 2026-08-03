# node-rounds-ledger

设备巡检轮次台账服务，面向运维团队管理设备档案、巡检清单、计划轮次、结果提交、异常复核、风险汇总、审计追踪和数据自检。

## 技术栈

- **运行时**: Node.js
- **Web 框架**: Express
- **数据库**: SQLite (better-sqlite3)，数据库文件默认位于 `data/rounds-ledger.db`
- **测试**: Jest + Supertest
- **服务端口**: 18102

## 快速开始

```bash
npm install
npm start          # 启动服务，监听 18102 端口
npm run dev        # 开发模式（文件变更自动重启）
npm test           # 运行全部测试（93 个用例）
```

服务启动后：
- 健康检查: http://localhost:18102/health
- API 基础路径: http://localhost:18102/api/v1

## 数据模型（Schema）

SQLite 数据库包含 7 张表，首次启动自动创建。

### devices（设备台账）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 设备 ID (UUID) |
| device_code | TEXT UNIQUE | 设备编码 |
| device_name | TEXT | 设备名称 |
| area | TEXT | 所属区域 |
| device_type | TEXT | 设备类型 |
| risk_level | TEXT | 风险等级: low / medium / high / critical |
| enabled | INTEGER | 是否启用 (1/0) |
| maintenance_note | TEXT | 维护备注 |
| created_at / updated_at | TEXT | 创建/更新时间 |

### checklists（巡检清单）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 清单 ID |
| checklist_name | TEXT | 清单名称 |
| device_type | TEXT | 适用设备类型 |
| items | TEXT (JSON) | 巡检项数组 |
| cycle_days | INTEGER | 巡检周期（天） |
| version | INTEGER | 版本号 |
| enabled | INTEGER | 是否启用 |

### checklist_snapshots（清单快照）
生成轮次时自动创建，保存当时的清单版本和 items JSON 数组，后续清单版本升级不影响已生成轮次的校验。

### rounds（计划轮次）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 轮次 ID |
| device_id | TEXT FK | 设备 ID |
| checklist_id | TEXT FK | 清单 ID |
| checklist_snapshot_id | TEXT FK | 清单快照 ID |
| planned_start_at | TEXT | 计划开始时间 |
| planned_end_at | TEXT | 计划结束时间 |
| round_status | TEXT | 轮次状态 |
| owner_name | TEXT | 负责人 |
| started_at / submitted_at / closed_at | TEXT | 实际开始/提交/关闭时间 |

### round_results（执行结果）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 结果 ID |
| round_id | TEXT FK | 轮次 ID |
| item_name | TEXT | 巡检项名称 |
| result_value | TEXT | normal / attention / fault / skipped |
| note | TEXT | 备注 |

### exception_reviews（异常复核）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 复核 ID |
| round_id | TEXT FK | 轮次 ID |
| result_id | TEXT FK | 结果 ID |
| review_status | TEXT | pending / confirmed / ignored / resolved |
| reviewer_name | TEXT | 复核人 |
| review_note | TEXT | 复核意见 |
| reviewed_at | TEXT | 复核时间 |

### audit_events（审计事件）
记录所有关键操作，包含 event_type、entity_type、entity_id、operator_name、event_data（含 description 说明）。

## 统一错误响应

所有错误返回固定结构：

```json
{
  "error_code": "VALIDATION_ERROR",
  "message": "错误描述",
  "details": {}
}
```

| error_code | HTTP 状态 | 说明 |
|------------|-----------|------|
| VALIDATION_ERROR | 400 | 参数校验失败 |
| NOT_FOUND | 404 | 资源不存在 |
| CONFLICT | 409 | 数据冲突（重复等） |
| INVALID_STATE_TRANSITION | 409 | 非法状态转换 |
| BUSINESS_RULE_VIOLATION | 422 | 业务规则冲突 |
| INVALID_JSON | 400 | 请求体 JSON 格式错误 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |

## 轮次状态机

```
scheduled → in_progress → submitted → closed
                          ↓
                     in_progress（可重新提交）
```

- 不允许从 `scheduled` 直接到 `closed`
- 存在 `pending` 或 `confirmed` 状态异常时不能关闭
- 所有异常必须为 `ignored` 或 `resolved` 才能关闭

## 清单快照机制

生成轮次时系统自动将当前清单的 items（JSON 数组）和版本号保存到 checklist_snapshots 表。提交结果时：
- 结果项**数量、顺序、名称**必须与快照完全一致
- 不能多传、少传或改名
- 清单后续创建新版本不影响旧轮次的校验依据

## 异常复核闭环

- 提交结果时，`fault` 和 `attention` 自动生成 `pending` 复核记录
- `confirmed`：确认问题存在，但**不能**作为关闭条件
- `ignored`：忽略（如误报），可关闭
- `resolved`：已解决，可关闭
- 关闭轮次时返回阻塞项详情，包括 pending_count、confirmed_count 和 blocking_items 列表

## 逾期字段（overdue）

按区域查询未关闭轮次时，响应中动态计算 `overdue` 字段：
- 当前时间超过 `planned_end_at` 且轮次未关闭时为 `true`
- 该字段仅在查询时计算，不修改数据库状态
- 同时返回 `pending_review_count`（待复核异常数量）

## API 接口

所有路径以 `/api/v1` 开头，字段统一使用 `snake_case`。

### 设备管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /devices | 创建设备 |
| GET | /devices | 查询设备列表（支持 area、device_type、risk_level、enabled 过滤） |
| GET | /devices/:id | 查询设备详情 |
| PATCH | /devices/:id | 更新设备 |
| POST | /devices/:id/deactivate | 停用设备 |

### 巡检清单管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /checklists | 创建清单 |
| GET | /checklists | 查询清单列表 |
| GET | /checklists/:id | 查询清单详情 |
| PATCH | /checklists/:id | 更新清单（启用/停用） |
| POST | /checklists/:id/copy-version | 复制清单版本（版本号自动递增，停用清单不可复制） |
| GET | /checklists/snapshots/:snapshotId | 查询清单快照 |

### 轮次管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /rounds/generate | 生成计划轮次（自动创建快照） |
| GET | /rounds | 查询轮次列表 |
| GET | /rounds/:id | 查询轮次详情（含快照、设备、结果、复核） |
| POST | /rounds/:id/start | 开始巡检 |
| POST | /rounds/:id/submit | 提交巡检结果 |
| POST | /rounds/:id/close | 关闭轮次 |
| GET | /rounds/:id/reviews | 查询轮次的复核记录 |

### 异常复核

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /exception-reviews/:id/review | 提交复核结论 |

### 查询与统计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /queries/devices/:deviceId/recent-rounds | 设备最近轮次 |
| GET | /queries/rounds/:roundId/details | 轮次完整详情 |
| GET | /queries/areas/:area/open-rounds | 按区域查未关闭轮次（含 overdue、pending_review_count） |
| GET | /queries/exceptions/by-risk/:riskLevel | 按风险等级查异常 |
| GET | /queries/areas/risk-summary | 区域风险汇总（按区域） |
| GET | /queries/risk-summary | 按区域+风险等级双维度风险汇总 |

### 审计事件

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /audit-events | 查询审计事件（支持 event_type、entity_type、entity_id、operator_name、时间范围过滤） |

审计事件类型：`device.created`、`device.updated`、`device.deactivated`、`checklist.created`、`checklist.updated`、`checklist.version_copied`、`round.generated`、`round.started`、`round.results_submitted`、`round.closed`、`exception.reviewed`。

### 数据自检

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health-check | 执行全量数据一致性自检 |

自检接口返回统一 JSON，按 `checks` 数组列出每项检查的名称、通过状态、问题数量和明细：

```json
{
  "overall_status": "passed",
  "total_checks": 7,
  "total_issues": 0,
  "checked_at": "2026-08-03T10:00:00.000Z",
  "checks": [
    {
      "check_name": "round_status_result_consistency",
      "check_label": "轮次状态与结果记录一致性",
      "passed": true,
      "issue_count": 0,
      "details": []
    }
  ]
}
```

7 项自检内容：

| check_name | 检查内容 |
|------------|----------|
| round_status_result_consistency | 轮次状态与结果记录是否匹配（scheduled/in_progress 不应有结果，submitted/closed 必须有结果） |
| fault_missing_review | fault/attention 结果是否缺少复核记录 |
| closed_round_pending_reviews | 已关闭轮次是否仍存在 pending/confirmed 复核 |
| missing_snapshot | 轮次引用的清单快照是否存在 |
| rounds_for_disabled_devices | 停用设备是否仍关联轮次 |
| snapshot_items_valid_json | 清单快照 items 是否为合法 JSON 数组且非空 |
| missing_audit_events | 关键操作（轮次生成/关闭、异常复核、设备停用）是否缺少审计事件 |

当 `overall_status` 为 `failed` 时，`total_issues` 大于 0，每个失败检查的 `details` 数组包含具体问题条目。

## 完整操作流程

以下是从创建设备到关闭轮次的完整链路示例（使用 curl）：

### 1. 创建设备

```bash
curl -X POST http://localhost:18102/api/v1/devices \
  -H "Content-Type: application/json" \
  -H "X-Operator: admin" \
  -d '{
    "device_code": "PUMP-001",
    "device_name": "1号离心泵",
    "area": "生产一区",
    "device_type": "pump",
    "risk_level": "high",
    "maintenance_note": "每月检查密封件"
  }'
```

### 2. 创建巡检清单

```bash
curl -X POST http://localhost:18102/api/v1/checklists \
  -H "Content-Type: application/json" \
  -d '{
    "checklist_name": "离心泵周巡检",
    "device_type": "pump",
    "items": ["检查油位", "检查温度", "检查密封", "听运行声音"],
    "cycle_days": 7
  }'
```

### 3. 生成计划轮次

```bash
curl -X POST http://localhost:18102/api/v1/rounds/generate \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "<设备ID>",
    "checklist_id": "<清单ID>",
    "planned_start_at": "2026-08-03T08:00:00.000Z",
    "planned_end_at": "2026-08-10T08:00:00.000Z",
    "owner_name": "张三"
  }'
```

响应中包含 `checklist_snapshot_id`，此时清单快照已冻结。

### 4. 开始巡检

```bash
curl -X POST http://localhost:18102/api/v1/rounds/<轮次ID>/start
```

### 5. 提交巡检结果（含故障）

结果项的数量、顺序、名称必须与快照完全一致：

```bash
curl -X POST http://localhost:18102/api/v1/rounds/<轮次ID>/submit \
  -H "Content-Type: application/json" \
  -d '{
    "results": [
      {"item_name": "检查油位", "result_value": "normal", "note": "油位正常"},
      {"item_name": "检查温度", "result_value": "attention", "note": "温度略高"},
      {"item_name": "检查密封", "result_value": "fault", "note": "发现泄漏"},
      {"item_name": "听运行声音", "result_value": "normal"}
    ]
  }'
```

提交后系统自动为 `attention` 和 `fault` 创建待复核异常记录。

### 6. 尝试关闭轮次（预期失败）

```bash
curl -X POST http://localhost:18102/api/v1/rounds/<轮次ID>/close
```

返回 422 错误，提示存在未闭环异常，details 中包含阻塞项列表。

### 7. 复核异常

先查询轮次详情获取 review_id：

```bash
curl http://localhost:18102/api/v1/rounds/<轮次ID>
```

对 fault 异常提交 resolved 结论：

```bash
curl -X POST http://localhost:18102/api/v1/exception-reviews/<复核ID>/review \
  -H "Content-Type: application/json" \
  -d '{
    "review_status": "resolved",
    "reviewer_name": "李工程师",
    "review_note": "已更换密封件，泄漏消除"
  }'
```

对 attention 异常可以 ignored 或 resolved：

```bash
curl -X POST http://localhost:18102/api/v1/exception-reviews/<复核ID>/review \
  -H "Content-Type: application/json" \
  -d '{
    "review_status": "ignored",
    "reviewer_name": "王主管",
    "review_note": "环境温度导致，误报"
  }'
```

### 8. 关闭轮次（成功）

所有异常均为 ignored 或 resolved 后：

```bash
curl -X POST http://localhost:18102/api/v1/rounds/<轮次ID>/close
```

### 9. 查询审计事件

```bash
curl "http://localhost:18102/api/v1/audit-events?entity_type=round&entity_id=<轮次ID>"
```

### 10. 运行数据自检

```bash
curl http://localhost:18102/api/v1/health-check
```

## 业务规则汇总

1. **清单快照不可变**：生成轮次时冻结 items 和版本，后续清单变更不影响旧轮次
2. **设备类型匹配**：设备类型必须与清单适用类型一致
3. **停用设备/清单限制**：停用设备不能生成轮次；停用清单不能生成轮次或复制版本
4. **计划时间校验**：`planned_end_at` 不能早于 `planned_start_at`
5. **结果严格匹配快照**：数量、顺序、名称完全一致
6. **状态机约束**：scheduled → in_progress → submitted → closed，禁止跳步
7. **异常自动生成**：fault/attention 自动创建 pending 复核
8. **关闭前闭环检查**：所有异常必须为 ignored 或 resolved，confirmed 不能关闭
9. **逾期动态计算**：查询时计算 overdue，不修改数据库
10. **审计完整记录**：关键操作记录操作者、动作、实体和说明
11. **数据自检**：7 项一致性检查，发现巡检链路中的数据不一致

## 测试

项目包含 93 个测试用例，覆盖设备、清单、轮次、异常复核、查询统计、审计事件、数据自检和错误处理。

```bash
npm test
```

## 项目结构

```
src/
├── server.js                  # 服务入口
├── app.js                     # Express 应用组装
├── constants/                 # 枚举常量
├── db/                        # SQLite 连接和 schema
├── daos/                      # 数据访问层
├── errors/                    # 错误类型
├── middleware/                # 错误中间件
├── routes/                    # 路由层
├── services/                  # 业务逻辑层（含 health-check.service.js）
└── state-machine/             # 轮次状态机
tests/                         # Jest 测试
```
