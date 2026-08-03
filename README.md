# node-rounds-ledger

设备巡检轮次后端服务（纯后端 API）。将分散在聊天记录中的设备巡检安排沉淀为可查询、可追踪的台账，围绕异常复核形成闭环，并提供数据自检能力排查链路不一致。

## 技术栈与运行

- Node.js + Express（路由 / 中间件分层）
- SQLite（better-sqlite3，WAL 模式，外键约束）
- node:test + supertest（测试）

```bash
npm install
npm start        # 监听 18102 端口
npm test         # 运行测试（内存 SQLite，独立环境）
```

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| 端口（`PORT`） | `18102` | 服务监听端口 |
| SQLite 文件（`DB_PATH`） | `./data/ledger.db` | 数据库文件位置，测试用 `:memory:` |

接口统一前缀 `/api/v1`，字段统一 snake_case。

## 目录结构

```
src/
  server.js                # 入口：初始化 DB，监听 18102
  app.js                   # Express 应用装配
  db/         connection.js / schema.js      # SQLite 连接与 7 张表 DDL
  domain/     constants / roundStateMachine / snapshot / reviewPolicy
  repositories/  数据访问层（device/checklist/snapshot/round/result/review/audit）
  services/      业务服务层（device/checklist/round/review/report/audit/selfCheck）
  routes/        路由层（devices/checklists/rounds/reports/audit/selfCheck）
  middleware/    errorHandler（统一错误格式）/ notFound
test/api.test.js           # 端到端测试（19 个用例）
```

## 数据模型（首轮 schema，7 张表）

- **devices**：`id`、`device_code`(唯一)、`device_name`、`area`、`device_type`、`risk_level`(low/medium/high/critical)、`enabled`、`maintenance_note`、`created_at`、`updated_at`
- **checklists**：`id`、`checklist_name`、`device_type`、`items`(JSON 数组)、`cycle_days`、`version`、`enabled`、`created_at`、`updated_at`，`(checklist_name, version)` 唯一
- **checklist_snapshots**：`id`、`checklist_id`、`checklist_name`、`device_type`、`version`、`cycle_days`、`items_json`、`created_at`
- **rounds**：`id`、`device_id`、`checklist_id`、`checklist_snapshot_id`、`planned_start_at`、`planned_end_at`、`round_status`、`owner_name`、`created_at`、`updated_at`、`closed_at`
- **results**：`id`、`round_id`、`item_name`、`result_value`、`note`、`submitted_at`，`(round_id, item_name)` 唯一
- **reviews**：`id`、`round_id`、`result_id`(唯一)、`review_status`、`reviewer_name`、`review_note`、`reviewed_at`、`created_at`
- **audit_events**：`id`、`event_type`、`entity_type`、`entity_id`、`actor`、`detail`(JSON)、`created_at`

## 统一错误结构

所有错误响应固定为：

```json
{ "error_code": "validation_error", "message": "缺少必填字段: device_name", "details": { "missing_fields": ["device_name"] } }
```

| error_code | HTTP | 场景 |
| --- | --- | --- |
| `validation_error` | 400 | 参数缺失 / 枚举非法 / 结果项与快照不一致 / 时间非法 |
| `not_found` | 404 | 资源或路由不存在 |
| `conflict` | 409 | 编码/版本重复、设备停用、禁用清单、重复复核 |
| `invalid_transition` | 409 | 状态机非法流转 |
| `unresolved_anomalies` | 409 | 存在 pending/confirmed 异常，禁止关闭 |
| `internal_error` | 500 | 未捕获异常 |

## 核心业务规则

1. **枚举约束**
   - `result_value` ∈ `normal | attention | fault | skipped`
   - 复核结论 `review_status` ∈ `confirmed | ignored | resolved`（生成时为内部状态 `pending`）
   - `round_status` ∈ `scheduled | in_progress | submitted | closed`
2. **状态流转**：`scheduled → in_progress → submitted → closed`；不允许 `scheduled` 直接到 `closed`，不允许跨级或回退，违规返回 409 `invalid_transition`。
3. **清单快照**：生成轮次时将清单的 `version` 与 `items` JSON 数组写入 `checklist_snapshots`；清单后续复制新版本不影响旧轮次。
4. **结果严格匹配快照**：提交结果时，`results` 数组的**数量、顺序、`item_name`** 必须与轮次快照完全一致，不能多传、少传、乱序或改名，违反返回 400 `validation_error`（details 含 `expected_count`/`received_count` 或 `index`/`expected_item`/`received_item`）。
5. **计划时间**：`planned_end_at` 不能早于 `planned_start_at`（允许相等）；缺省为 `planned_start_at + cycle_days` 天。
6. **异常复核闭环**：提交结果时，只要存在 `fault`（以及 `attention`）结果，系统自动生成 `pending` 待复核记录；`ignored`/`resolved` 为终态不可再改，`confirmed` 仅表示问题确认存在，允许继续复核为 `ignored`/`resolved`。
7. **关闭拦截**：只有所有异常都被 `ignored` 或 `resolved` 后轮次才允许进入 `closed`；存在 `pending` 或 `confirmed` 异常时返回 409 `unresolved_anomalies`，details 含 `blocking_reviews` 明细。
8. **轮次推进**：`in_progress` 状态下一次性提交全部结果，校验通过即进入 `submitted`。
9. **设备/清单约束**：停用（`enabled=false`）设备不能生成轮次；禁用清单不能生成轮次，也不能复制新版本；设备 `device_type` 必须与清单 `device_type` 一致。
10. **逾期字段**：`GET /rounds/open` 返回每轮 `pending_review_count`（待复核异常数量）与 `overdue`（当前时间超过 `planned_end_at` 且轮次未关闭时为 `true`）；`overdue` 为实时计算字段，不改写数据库状态。

## API 一览（统一前缀 `/api/v1`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/devices` | 创建设备 |
| POST | `/devices/:id/disable` | 停用设备（body 可传 `operator_name`） |
| GET | `/devices/:id/latest-round` | 查询设备最近轮次 |
| POST | `/checklists` | 创建清单 |
| POST | `/checklists/:id/copy` | 复制清单新版本（默认 version+1，可覆盖 items/cycle_days） |
| POST | `/rounds` | 生成计划轮次（自动保存清单快照） |
| POST | `/rounds/:id/start` | 开始巡检（body 可传 `operator_name`） |
| POST | `/rounds/:id/results` | 提交执行结果（自动生成待复核异常，可传 `submitter_name`） |
| POST | `/rounds/:id/reviews` | 提交异常复核 |
| POST | `/rounds/:id/close` | 关闭轮次（body 可传 `operator_name`） |
| GET | `/rounds/:id` | 查询轮次详情与清单快照 |
| GET | `/rounds/open?area=东区` | 按区域查未关闭轮次（area 可空），含 `pending_review_count` 与 `overdue` |
| GET | `/anomalies?risk_level=high` | 按风险等级查异常（可空=全部） |
| GET | `/reports/area-risk-summary` | 区域风险汇总（设备数、风险分布、未关闭轮次、待复核异常） |
| GET | `/reports/risk-summary?area=&risk_level=` | 风险汇总：按 area + risk_level 统计 `open_rounds` / `abnormal_results` / `pending_reviews` / `overdue_rounds` / `closed_rounds` |
| GET | `/audit-events?entity_type=&entity_id=&event_type=&from=&to=&limit=` | 审计事件查询 |
| GET | `/self-check` | 数据自检：巡检链路一致性检查 |

## 数据自检接口

`GET /api/v1/self-check` 返回统一 JSON：顶层 `passed` / `check_count`，`checks` 数组中每项包含 `check_name`（检查名称）、`passed`（通过状态）、`issue_count`（问题数量）、`issues`（明细，含 `entity_type` / `entity_id` / `message` 及上下文）。

| check_name | 检查内容 |
| --- | --- |
| `round_results_match` | 轮次状态与结果记录匹配：scheduled 不应有结果；submitted/closed 结果数等于快照项目数 |
| `fault_without_review` | 存在 fault 但缺少复核记录 |
| `closed_round_pending_reviews` | 已关闭轮次仍有待复核异常 |
| `round_snapshot_missing` | 轮次引用的清单快照缺失 |
| `rounds_on_disabled_device` | 设备停用后仍生成新轮次 |
| `snapshot_items_not_json_array` | 清单快照中的 items 不是合法 JSON 数组 |
| `audit_events_missing` | 审计事件缺失（按轮次状态推导必须存在的审计事件） |

响应示例：

```json
{
  "passed": false,
  "check_count": 7,
  "checks": [
    {
      "check_name": "fault_without_review",
      "passed": false,
      "issue_count": 1,
      "issues": [
        { "entity_type": "result", "entity_id": 12, "message": "fault 结果缺少复核记录", "round_id": 5, "item_name": "振动检测" }
      ]
    }
  ]
}
```

## 审计事件

设备停用、清单复制、轮次开始、结果提交、异常复核、轮次关闭都会写入审计事件，字段包含 `actor`（操作者）、`event_type`（动作）、`entity_type` / `entity_id`（实体）与 `detail.description`（说明）。操作者来源：停用/开始/关闭接口的 `operator_name`，结果提交的 `submitter_name`，复核的 `reviewer_name`，清单复制的 `operator_name`。通过 `GET /api/v1/audit-events` 查询，支持 `entity_type` / `entity_id` / `event_type` / `from` / `to` / `limit` 过滤。

| event_type | entity_type | 触发动作 |
| --- | --- | --- |
| `device.created` / `device.disabled` | device | 创建 / 停用设备 |
| `checklist.created` / `checklist.copied` | checklist | 创建 / 复制清单 |
| `round.created` / `round.started` / `round.submitted` / `round.closed` | round | 生成 / 开始 / 提交结果 / 关闭轮次 |
| `review.submitted` | round | 提交异常复核 |

## 完整操作流程

从创建设备到关闭轮次的端到端示例（与测试用例「README 关键流程可执行」一致）：

```bash
BASE=http://localhost:18102/api/v1

# 1. 创建设备
curl -X POST $BASE/devices -H 'Content-Type: application/json' -d '{
  "device_code":"PUMP-001","device_name":"一号水泵","area":"东区",
  "device_type":"pump","risk_level":"high","maintenance_note":"每季度更换密封圈"
}'

# 2. 创建清单
curl -X POST $BASE/checklists -H 'Content-Type: application/json' -d '{
  "checklist_name":"水泵巡检清单","device_type":"pump",
  "items":["外观检查",{"item_name":"振动检测","description":"振动值不超阈值"}],
  "cycle_days":7
}'

# 3. 生成轮次（保存清单 v1 快照）
curl -X POST $BASE/rounds -H 'Content-Type: application/json' -d '{
  "device_id":1,"checklist_id":1,"planned_start_at":"2026-08-01T00:00:00Z","owner_name":"张三"
}'

# 开始巡检
curl -X POST $BASE/rounds/1/start -H 'Content-Type: application/json' -d '{"operator_name":"张三"}'

# 4. 提交故障结果（数量/顺序/名称与快照一致；fault 自动生成待复核记录）
curl -X POST $BASE/rounds/1/results -H 'Content-Type: application/json' -d '{
  "submitter_name":"张三",
  "results":[{"item_name":"外观检查","result_value":"normal"},
             {"item_name":"振动检测","result_value":"fault","note":"振动超标"}]
}'

# 未复核前关闭会被拦截：409 unresolved_anomalies
curl -X POST $BASE/rounds/1/close

# 5. 复核异常（confirmed 仅确认存在，不能作为关闭条件；ignored/resolved 为闭环终态）
curl -X POST $BASE/rounds/1/reviews -H 'Content-Type: application/json' -d '{
  "result_id":2,"review_status":"resolved","reviewer_name":"李四","review_note":"已更换轴承"
}'

# 6. 关闭轮次
curl -X POST $BASE/rounds/1/close -H 'Content-Type: application/json' -d '{"operator_name":"王班长"}'

# 排查与统计
curl "$BASE/rounds/open?area=东区"                 # 未关闭轮次（含 pending_review_count / overdue）
curl "$BASE/anomalies?risk_level=high"             # 按风险等级查异常
curl "$BASE/reports/risk-summary"                  # 按 area + risk_level 五维汇总
curl "$BASE/audit-events?entity_type=round&entity_id=1"  # 审计事件
curl "$BASE/self-check"                            # 数据自检
```
