# node-rounds-ledger

设备巡检轮次台账后端服务。面向运维小组，将分散在聊天记录里的设备巡检安排沉淀为可查询、可追踪的后端服务，并围绕异常复核形成闭环。

- 运行时：Node.js (>=18) + Express
- 持久化：SQLite（`better-sqlite3`）
- 默认端口：`18102`
- SQLite 文件位置：默认 `./data/ledger.db`（可通过环境变量 `DB_PATH` 覆盖）
- API 前缀：`/api/v1`
- 字段风格：`snake_case`
- 错误响应固定结构：
  ```json
  { "error_code": "...", "message": "...", "details": {} }
  ```

## 目录结构

```
src/
  app.js                     # Express 应用装配
  server.js                  # 启动入口（监听 18102）
  container.js               # 仓储/服务依赖装配
  config/                    # 配置（端口、DB 路径、API 前缀）
  constants/                 # 枚举常量
  db/                        # SQLite 连接与 schema
  errors/                    # 业务错误类
  middleware/                # 错误中间件
  repositories/              # 数据访问层
  routes/                    # 路由层
  services/                  # 服务层（业务逻辑、自检、报表）
  stateMachine/              # 轮次状态机
  utils/                     # 校验、异步包装等
test/                        # 基于 node:test + supertest 的测试
```

## 快速开始

```bash
npm install
npm start
```

健康检查：

```bash
curl http://127.0.0.1:18102/health
```

运行测试：

```bash
npm test
```

## 数据模型（首轮 schema）

### devices（设备台账）

| 字段 | 说明 |
| --- | --- |
| device_code | 设备编码，唯一 |
| device_name | 设备名称 |
| area | 所属区域 |
| device_type | 设备类型（用于匹配巡检清单） |
| risk_level | 风险等级：`low` / `medium` / `high` / `critical` |
| enabled | 是否启用 |
| maintenance_note | 维护备注 |
| created_at / updated_at | 创建/更新时间 |

### checklists（巡检清单，按版本存储）

| 字段 | 说明 |
| --- | --- |
| checklist_name | 清单名称 |
| device_type | 适用设备类型 |
| items_json | 巡检项 JSON 数组 |
| cycle_days | 周期天数 |
| version | 版本号，同一 `checklist_name + device_type` 自增 |
| enabled | 是否启用 |
| source_checklist_id | 复制版本时的来源清单 |

### checklist_snapshots（清单快照）

| 字段 | 说明 |
| --- | --- |
| checklist_id | 来源清单 ID |
| checklist_name / device_type / version / cycle_days | 生成时的清单属性 |
| items_json | 冻结的巡检项 JSON 数组 |
| snapshot_at | 快照时间 |

### rounds（计划轮次）

| 字段 | 说明 |
| --- | --- |
| device_id | 设备 ID |
| checklist_id | 清单 ID |
| checklist_snapshot_id | 生成时冻结的清单快照 ID |
| planned_start_at / planned_end_at | 计划起止时间（ISO 8601） |
| round_status | `scheduled` / `in_progress` / `submitted` / `closed` |
| owner_name | 负责人 |
| started_at / submitted_at / closed_at | 各阶段时间戳 |

### round_results（执行结果）

| 字段 | 说明 |
| --- | --- |
| round_id | 所属轮次 |
| item_name | 巡检项名称（必须来自快照） |
| result_value | `normal` / `attention` / `fault` / `skipped` |
| note | 备注 |
| submitted_at | 提交时间 |

### anomaly_reviews（异常复核）

| 字段 | 说明 |
| --- | --- |
| round_id | 所属轮次 |
| result_id | 关联结果项 |
| review_status | `pending` / `confirmed` / `ignored` / `resolved` |
| reviewer_name | 复核人 |
| review_note | 复核意见 |
| reviewed_at | 复核时间 |

### audit_events（审计事件）

| 字段 | 说明 |
| --- | --- |
| event_type | 事件类型 |
| entity_type / entity_id | 关联实体类型与 ID |
| operator_name | 操作者 |
| payload_json | 动作、实体类型、说明等 JSON |
| created_at | 记录时间 |

## 清单快照

生成轮次时，系统会将当时的清单版本、`items` JSON 数组原样冻结到 `checklist_snapshots`，并在轮次上记录 `checklist_snapshot_id`。提交结果时，服务端按快照里的 `items` 严格校验：

- 结果项**数量**必须与快照一致；
- 结果项**顺序**必须与快照一致；
- 结果项**名称**必须与快照一致；
- 不能多传、少传、改名或调换顺序。

后续清单复制新版本、修改 items 都不会影响已生成轮次的校验。

## 轮次状态机与异常复核闭环

```
scheduled -> in_progress -> submitted -> closed
```

- 不允许 `scheduled` 直接到 `closed`；`closed` 为终态。
- 提交结果后，只要存在 `fault`（以及 `attention`）结果项，系统自动生成 `pending` 状态的待复核异常记录。
- 关闭轮次时，所有异常复核必须为 `ignored` 或 `resolved`。`pending` 与 `confirmed` 都会阻止关闭；`confirmed` 仅表示确认问题存在，不能作为关闭条件。

## 逾期字段

按区域查询未关闭轮次时，每条记录额外返回：

- `pending_review_count`：该轮次下待复核异常数量；
- `overdue`：当前时间超过 `planned_end_at` 且轮次未关闭时为 `true`。

该字段为运行时计算，不写回数据库，不改变轮次状态。

## API 列表

### 设备

- `POST /api/v1/devices`：创建设备
- `GET /api/v1/devices`：查询设备（支持 `area`、`device_type`、`enabled` 过滤）
- `GET /api/v1/devices/:id`：设备详情
- `POST /api/v1/devices/:id/disable`：停用设备

### 巡检清单

- `POST /api/v1/checklists`：创建清单（自动版本为 1）
- `GET /api/v1/checklists`：清单列表（支持 `device_type`、`enabled`）
- `GET /api/v1/checklists/:id`：清单详情
- `POST /api/v1/checklists/:id/copy-version`：复制清单生成新版本（可覆盖 `items`、`cycle_days`、`checklist_name`、`device_type`）；源清单被禁用时不允许复制
- `POST /api/v1/checklists/:id/disable`：禁用清单（禁用后不能复制新版本，也不能用于生成新轮次）

### 轮次

- `POST /api/v1/rounds/generate`：生成计划轮次（自动匹配该设备类型最新启用清单，创建快照；停用设备与禁用清单会被拒绝；`planned_end_at` 不能早于 `planned_start_at`）
- `GET /api/v1/rounds/:id`：轮次详情（含设备、清单、清单快照、结果、异常复核）
- `POST /api/v1/rounds/:id/start`：开始巡检
- `POST /api/v1/rounds/:id/submit-results`：提交结果（数量、顺序、名称必须与快照一致；自动生成待复核异常）
- `POST /api/v1/rounds/:id/close`：关闭轮次（存在 `pending` 或 `confirmed` 异常复核时拒绝）
- `GET /api/v1/rounds/device/:device_id/latest`：查询设备最近轮次
- `GET /api/v1/rounds/area/:area/unclosed`：按区域查询未关闭轮次（含 `pending_review_count` 与 `overdue`）

### 异常复核

- `POST /api/v1/anomaly-reviews/:id/review`：提交复核结论（`confirmed` / `ignored` / `resolved`）
- `GET /api/v1/anomaly-reviews/:id`：复核详情
- `GET /api/v1/anomaly-reviews/round/:round_id`：按轮次查询复核记录

### 区域汇总、风险统计、审计与自检

- `GET /api/v1/reports/area-risk-summary`：区域风险汇总（按区域聚合设备数量与异常概览）
- `GET /api/v1/reports/risk-summary`：风险汇总，按 `area` 与 `risk_level` 分组统计 `device_count`、`unclosed_round_count`、`anomaly_result_count`、`pending_review_count`、`overdue_round_count`、`closed_round_count`；支持可选参数 `area`、`risk_level`
- `GET /api/v1/reports/anomalies/by-risk/:risk_level`：按风险等级查询异常
- `GET /api/v1/reports/audit-events`：审计事件查询（支持 `event_type`、`entity_type`、`entity_id`、`limit`、`offset`）
- `GET /api/v1/reports/self-check`：数据自检，返回统一 JSON：
  ```json
  {
    "generated_at": "...",
    "overall_passed": true,
    "total_issues": 0,
    "checks": [
      { "check_name": "...", "passed": true, "issue_count": 0, "details": [] }
    ]
  }
  ```
  检查项包括：轮次状态与结果记录匹配、存在 fault 但缺少复核记录、已关闭轮次仍有待复核异常、轮次快照缺失、设备停用后仍生成新轮次、清单快照 items 不是 JSON 数组、关键审计事件缺失、已关闭轮次缺少 `closed_at`。

## 审计事件写入

以下操作会写入审计事件，每条记录都包含操作者（`operator_name`）、动作（`payload.action`）、实体类型（`entity_type` 与 `payload.entity_type`）和说明（`payload.description`）：

- 设备停用（`device.disabled` / `disable_device`）
- 清单复制新版本（`checklist.version_copied` / `copy_checklist_version`）
- 轮次开始（`round.started` / `start_round`）
- 结果提交（`round.submitted` / `submit_round_results`，含 fault/attention 数量与自动生成待复核数量）
- 异常复核（`anomaly.reviewed` / `review_anomaly`）
- 轮次关闭（`round.closed` / `close_round`）

## 完整操作流程

以下流程可直接执行（使用 `jq` 提取返回 ID）：

```bash
BASE=http://127.0.0.1:18102/api/v1

# 1. 创建设备
DEVICE_ID=$(curl -s -X POST $BASE/devices \
  -H 'Content-Type: application/json' \
  -d '{"device_code":"PUMP-01","device_name":"主泵A","area":"A区","device_type":"pump","risk_level":"high"}' \
  | jq .id)

# 2. 创建清单
CHECKLIST_ID=$(curl -s -X POST $BASE/checklists \
  -H 'Content-Type: application/json' \
  -d '{"checklist_name":"泵类巡检清单","device_type":"pump","cycle_days":7,"items":[{"item_name":"检查油位"},{"item_name":"听异响"}]}' \
  | jq .id)

# 3. 生成计划轮次
ROUND_ID=$(curl -s -X POST $BASE/rounds/generate \
  -H 'Content-Type: application/json' \
  -d "{\"device_id\":$DEVICE_ID,\"planned_start_at\":\"2026-08-01T08:00:00.000Z\",\"planned_end_at\":\"2026-08-01T18:00:00.000Z\",\"owner_name\":\"张三\"}" \
  | jq .id)

# 4. 开始巡检
curl -s -X POST $BASE/rounds/$ROUND_ID/start \
  -H 'Content-Type: application/json' \
  -d '{"operator_name":"张三"}'

# 5. 提交故障结果（fault 自动生成待复核异常）
SUBMIT=$(curl -s -X POST $BASE/rounds/$ROUND_ID/submit-results \
  -H 'Content-Type: application/json' \
  -d '{"operator_name":"张三","results":[{"item_name":"检查油位","result_value":"normal"},{"item_name":"听异响","result_value":"fault","note":"发现异常声响"}]}')
REVIEW_ID=$(echo $SUBMIT | jq '.anomaly_reviews[0].id')

# 未复核时关闭轮次会被拒绝（409 CONFLICT）
curl -s -X POST $BASE/rounds/$ROUND_ID/close \
  -H 'Content-Type: application/json' \
  -d '{"operator_name":"李工"}'

# 6. 复核异常（resolved/ignored 才允许关闭轮次；confirmed 不行）
curl -s -X POST $BASE/anomaly-reviews/$REVIEW_ID/review \
  -H 'Content-Type: application/json' \
  -d '{"review_status":"resolved","reviewer_name":"李工","review_note":"已安排维修"}'

# 7. 关闭轮次
curl -s -X POST $BASE/rounds/$ROUND_ID/close \
  -H 'Content-Type: application/json' \
  -d '{"operator_name":"李工"}'

# 8. 查看轮次详情与自检结果
curl -s $BASE/rounds/$ROUND_ID | jq .
curl -s $BASE/reports/self-check | jq .
```

## 设计要点

1. **分层清晰**：路由仅做协议适配，业务逻辑在 service 层，SQL 全部收敛在 repository 层。
2. **快照隔离**：生成轮次时冻结清单 items，提交结果时严格按快照校验数量、顺序、名称。
3. **状态机显式化**：`src/stateMachine/roundStateMachine.js` 集中维护允许的状态迁移。
4. **异常复核闭环**：fault 自动生成待复核记录；必须全部为 `ignored`/`resolved` 才能关闭轮次。
5. **逾期与风险统计**：逾期为计算字段，不污染状态；风险汇总按区域+风险等级聚合。
6. **数据自检**：`/reports/self-check` 检查轮次、结果、复核、快照、审计等链路一致性。
7. **审计可追溯**：关键写操作记录操作者、动作、实体类型与说明。
8. **错误统一**：所有错误经错误中间件输出固定结构，未知路由与非法 JSON 也有一致响应。
