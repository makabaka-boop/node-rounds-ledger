# node-rounds-ledger

设备巡检轮次台账服务，面向运维团队管理设备档案、巡检清单、计划轮次、结果提交、异常复核、风险汇总和审计追踪。纯后端实现，重点在 Node.js 分层架构、SQLite 持久化、轮次状态机与清单快照隔离。

- 运行时：Node.js（>= 20），仅使用内置模块 `node:http` 与 `node:sqlite`，**无任何第三方依赖**。
- 监听端口：**18102**
- API 前缀：所有接口以 **`/api/v1`** 开头
- 字段风格：统一 **snake_case**
- 错误响应固定格式：`{"error_code":"...","message":"...","details":{...}}`

## 快速开始

```bash
# 启动服务（默认监听 18102，数据库文件为 data/ledger.db）
npm start

# 运行测试（内置 node:test，使用内存库，互不干扰）
npm test
```

可选环境变量：`PORT`（端口）、`DB_PATH`（SQLite 文件路径）。

## 目录结构（分层）

```
src/
├── config.js                 # 端口 / 数据库路径 / API 前缀
├── server.js                 # 服务入口（init + listen）
├── app.js                    # 组装路由，创建 http.Server
├── db.js                     # SQLite 连接与建表（node:sqlite）
├── domain/                   # 领域层：枚举、状态机、快照、复核策略、校验、错误
│   ├── enums.js              #   结果项/复核结论/轮次状态/风险等级 + 状态迁移表
│   ├── roundStateMachine.js  #   轮次状态机（含 scheduled 不可直接 closed）
│   ├── snapshot.js           #   清单快照构建与解析
│   ├── reviewPolicy.js       #   异常判定与关闭前置（须全部 ignored/resolved）
│   ├── validators.js         #   通用输入校验
│   └── errors.js             #   AppError 与统一错误码 -> HTTP 状态映射
├── repositories/             # 数据访问层（集中所有 SQL）
│   ├── deviceRepository.js
│   ├── checklistRepository.js
│   ├── snapshotRepository.js
│   ├── roundRepository.js
│   ├── resultRepository.js
│   ├── reviewRepository.js
│   ├── auditRepository.js
│   └── selfCheckRepository.js
├── services/                 # 服务层（业务规则）
│   ├── deviceService.js
│   ├── checklistService.js
│   ├── roundService.js
│   ├── reviewService.js
│   ├── reportService.js
│   ├── auditService.js
│   └── selfCheckService.js
├── routes/                   # 路由层（HTTP -> service）
│   ├── deviceRoutes.js
│   ├── checklistRoutes.js
│   ├── roundRoutes.js
│   ├── reviewRoutes.js
│   ├── reportRoutes.js
│   └── selfCheckRoutes.js
└── middleware/               # 中间件与基础设施
    ├── router.js             #   极简正则路由器
    ├── bodyParser.js         #   JSON 请求体解析
    └── http.js               #   统一 JSON 响应 / 错误中间件
tests/                        # node:test 端到端测试
├── helpers.js
├── api.test.js
└── selfCheck.test.js
data/                         # SQLite 数据文件目录（运行时生成，SQLite 文件默认 data/ledger.db）
```

## 数据模型

SQLite 保存七类实体：

| 表 | 关键字段 |
| --- | --- |
| `devices` 设备台账 | `device_code`、`device_name`、`area`、`device_type`、`risk_level`、`enabled`、`maintenance_note` |
| `checklists` 巡检清单 | `checklist_name`、`device_type`、`items`(JSON)、`cycle_days`、`version`、`enabled` |
| `checklist_snapshots` 清单快照 | `checklist_id`、`checklist_name`、`device_type`、`version`、`cycle_days`、`items_json` |
| `rounds` 计划轮次 | `device_id`、`checklist_id`、`checklist_snapshot_id`、`planned_start_at`、`planned_end_at`、`round_status`、`owner_name` |
| `results` 执行结果 | `round_id`、`item_name`、`result_value`、`note`、`submitted_at` |
| `reviews` 异常复核 | `round_id`、`result_id`、`review_status`、`reviewer_name`、`review_note`、`reviewed_at` |
| `audit_events` 审计事件 | `actor`、`event_type`、`entity_type`、`entity_id`、`detail` |

## 核心业务规则

1. **结果项枚举**：`result_value` 只能是 `normal`、`attention`、`fault`、`skipped`。
2. **复核结论枚举**：提交复核时 `review_status` 只能是 `confirmed`、`ignored`、`resolved`（系统内部初始态为 `pending`）。
3. **轮次状态机**：状态只允许 `scheduled` → `in_progress` → `submitted` → `closed`，逐级推进；**`scheduled` 不能直接到 `closed`**。非法迁移返回 `INVALID_STATE_TRANSITION`。
4. **设备/清单校验**：生成轮次时设备与清单都必须启用，且 `device_type` 必须一致；停用设备不能生成轮次（`DEVICE_DISABLED`）。
5. **清单快照隔离**：生成轮次时固化"当时的清单版本 + `items` 数组"为快照（`checklist_snapshots`）。之后清单出新版本或修改 items，**不影响旧轮次的校验**。提交结果时以首轮固化的快照为唯一基准做**严格边界校验**：
   - **数量一致**：结果项数量必须等于快照检查项数量，不能多传、不能少传；
   - **顺序一致**：`results[i].item_name` 必须与 `snapshot.items[i]` 逐位相等，不能重排；
   - **名称一致**：不能改名（逐位精确匹配）。
   任一不满足返回 `SNAPSHOT_MISMATCH`，`details` 给出 `expected_count`/`received_count` 或 `index`/`expected_item_name`/`received_item_name` 以便定位。
6. **时间窗校验**：`planned_end_at` 不能早于（也不能等于）`planned_start_at`；每条结果的 `submitted_at` 必须落在轮次计划时间窗内（含边界）。校验失败整体不落库，轮次保持 `in_progress`。
7. **异常复核闭环**：提交结果时只要存在异常检查项（`attention` / `fault`），系统自动为每一项生成 `pending` 待复核记录。
8. **关闭前置**：**只有当轮次下所有异常都被 `ignored` 或 `resolved` 后才允许进入 `closed`**（否则返回 `ROUND_HAS_UNREVIEWED_FAULT`）。`pending`（未复核）与 `confirmed`（仅确认问题存在）都不满足闭环，均阻止关闭 —— 即 **`confirmed` 不能作为关闭条件**。`details.blocking_reviews` 列出阻塞项及其当前状态。
9. **审计留痕**：以下六类关键动作都必须写入 `audit_events`，记录操作者 `actor`、动作 `event_type`、实体类型 `entity_type`、实体 `entity_id` 与说明 `detail.description`：设备停用（`device_disabled`）、清单复制（`checklist_version_copied`）、轮次开始（`round_started`）、结果提交（`results_submitted`）、异常复核（`review_submitted`）、轮次关闭（`round_closed`）。操作者通过请求头 `X-Actor` 传入，默认 `system`。（创建设备/清单也会留痕。）
10. **禁用约束**：停用设备不能生成新轮次（`DEVICE_DISABLED`）；禁用清单既不能复制版本、也不能生成轮次（`CHECKLIST_DISABLED`）。复制在同名清单最大 `version` 基础上加 1。
11. **未关闭轮次查询（`/rounds/open`）**：额外返回 `pending_reviews`（待复核异常数量）与 `overdue`。当前时间超过 `planned_end_at` 且轮次未关闭时 `overdue: true`，该字段为**实时计算**，不写库、不改写轮次状态。
12. **区域风险汇总（`/reports/risk-summary`）**：按 `area` + `risk_level` 分组统计 `open_round_count`（未关闭轮次）、`anomaly_item_count`（异常检查项数）、`pending_review_count`（待复核异常数）、`overdue_round_count`（逾期轮次数）、`closed_round_count`（已关闭轮次数）。逾期为实时计算。

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/v1/devices` | 创建设备 |
| POST | `/api/v1/devices/:id/disable` | 停用设备 |
| GET | `/api/v1/devices` | 设备列表 |
| GET | `/api/v1/devices/:id` | 设备详情 |
| GET | `/api/v1/devices/:id/rounds` | 查询设备最近轮次（`?limit=`） |
| POST | `/api/v1/checklists` | 创建清单 |
| POST | `/api/v1/checklists/:id/versions` | 复制清单版本 |
| GET | `/api/v1/checklists` | 清单列表 |
| GET | `/api/v1/checklists/:id` | 清单详情 |
| POST | `/api/v1/rounds` | 生成计划轮次（固化快照） |
| GET | `/api/v1/rounds/open` | 按区域查未关闭轮次（`?area=`），额外返回 `pending_reviews` 与实时计算的 `overdue` |
| POST | `/api/v1/rounds/:id/start` | 开始巡检 |
| POST | `/api/v1/rounds/:id/results` | 提交结果（自动生成待复核异常） |
| POST | `/api/v1/rounds/:id/close` | 关闭轮次 |
| GET | `/api/v1/rounds/:id` | 查询轮次详情与清单快照 |
| GET | `/api/v1/rounds/:id/reviews` | 查询某轮次复核列表 |
| POST | `/api/v1/reviews/:id` | 提交异常复核 |
| GET | `/api/v1/reports/anomalies` | 按风险等级查异常（`?risk_level=`） |
| GET | `/api/v1/reports/risk-summary` | 区域风险汇总（未关闭/异常项/待复核/逾期/已关闭 计数） |
| GET | `/api/v1/audit-events` | 审计事件查询（`?entity_type=&entity_id=&event_type=&limit=`） |
| GET | `/api/v1/self-check` | 数据自检（巡检链路一致性诊断） |
| GET | `/health` | 健康检查 |

> 可选请求头 `X-Actor` 用于标记操作人，写入审计的 `actor` 字段，默认 `system`。

## 错误码

| error_code | HTTP | 含义 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 入参校验失败（字段缺失、类型/枚举/时间窗不合法等） |
| `NOT_FOUND` | 404 | 资源或路由不存在 |
| `DUPLICATE` | 409 | 唯一性冲突（如设备编码、同名清单） |
| `INVALID_STATE_TRANSITION` | 409 | 轮次状态机非法迁移 |
| `STATE_CONFLICT` | 409 | 状态冲突（如设备已停用、复核已提交） |
| `DEVICE_DISABLED` | 409 | 设备已停用，不能生成轮次 |
| `CHECKLIST_DISABLED` | 409 | 清单已禁用，不能生成轮次 |
| `DEVICE_TYPE_MISMATCH` | 409 | 设备类型与清单类型不一致 |
| `ROUND_HAS_UNREVIEWED_FAULT` | 409 | 存在未闭环异常（非 ignored/resolved），不能关闭轮次 |
| `SNAPSHOT_MISMATCH` | 422 | 提交结果与清单快照不一致 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

## 端到端 curl 演练

以下命令基于服务已在 18102 端口启动。时间字段请按需替换为落在计划窗内的时间。

```bash
# 1) 创建设备
curl -s -X POST http://127.0.0.1:18102/api/v1/devices \
  -H 'Content-Type: application/json' \
  -d '{"device_code":"DEV-001","device_name":"空压机","area":"A区","device_type":"compressor","risk_level":"high"}'

# 2) 创建清单（items 为字符串数组）
curl -s -X POST http://127.0.0.1:18102/api/v1/checklists \
  -H 'Content-Type: application/json' \
  -d '{"checklist_name":"空压机日检","device_type":"compressor","items":["油位检查","温度检查","异响检查"],"cycle_days":1}'

# 3) 生成计划轮次（固化清单快照）—— 假设设备 id=1、清单 id=1
curl -s -X POST http://127.0.0.1:18102/api/v1/rounds \
  -H 'Content-Type: application/json' \
  -d '{"device_id":1,"checklist_id":1,"owner_name":"张三","planned_start_at":"2026-08-01T00:00:00Z","planned_end_at":"2026-08-31T00:00:00Z"}'

# 4) 开始巡检 —— 假设轮次 id=1
curl -s -X POST http://127.0.0.1:18102/api/v1/rounds/1/start

# 5) 提交结果（fault 会自动生成待复核异常）
curl -s -X POST http://127.0.0.1:18102/api/v1/rounds/1/results \
  -H 'Content-Type: application/json' \
  -d '{"results":[
        {"item_name":"油位检查","result_value":"fault","note":"漏油","submitted_at":"2026-08-03T09:00:00Z"},
        {"item_name":"温度检查","result_value":"normal","submitted_at":"2026-08-03T09:01:00Z"},
        {"item_name":"异响检查","result_value":"normal","submitted_at":"2026-08-03T09:02:00Z"}
      ]}'

# 6) 查看轮次详情与快照
curl -s http://127.0.0.1:18102/api/v1/rounds/1

# 7) 查看待复核列表
curl -s http://127.0.0.1:18102/api/v1/rounds/1/reviews

# 8) 提交异常复核 —— 假设复核 id=1
curl -s -X POST http://127.0.0.1:18102/api/v1/reviews/1 \
  -H 'Content-Type: application/json' \
  -d '{"review_status":"resolved","reviewer_name":"王工","review_note":"已更换密封"}'

# 9) 关闭轮次（须所有异常已 ignored/resolved 才成功）
curl -s -X POST http://127.0.0.1:18102/api/v1/rounds/1/close

# 10) 报表与审计
curl -s "http://127.0.0.1:18102/api/v1/reports/anomalies?risk_level=high"
curl -s http://127.0.0.1:18102/api/v1/reports/risk-summary
curl -s "http://127.0.0.1:18102/api/v1/rounds/open?area=A区"
curl -s "http://127.0.0.1:18102/api/v1/audit-events?entity_type=round&entity_id=1"

# 11) 数据自检
curl -s http://127.0.0.1:18102/api/v1/self-check
```

## 数据自检（`GET /api/v1/self-check`）

用于交付前发现巡检链路里的不一致。返回统一 JSON，`checks` 数组逐项列出**检查名称、通过状态、问题数量与明细**：

```json
{
  "passed": true,
  "total_issues": 0,
  "checked_at": "2026-08-03T09:00:00.000Z",
  "checks": [
    { "name": "round_status_result_mismatch", "description": "...", "passed": true, "issue_count": 0, "details": [] }
  ]
}
```

覆盖的 7 项检查：

| name | 含义 |
| --- | --- |
| `round_status_result_mismatch` | 轮次状态与结果记录不匹配（已提交/关闭却无结果，或计划中却已有结果） |
| `fault_missing_review` | 存在 fault 但缺少复核记录 |
| `closed_round_pending_review` | 已关闭轮次仍有待复核（pending）异常 |
| `round_snapshot_missing` | 轮次快照缺失 |
| `disabled_device_new_round` | 设备停用后仍生成新轮次 |
| `snapshot_items_not_array` | 清单快照中的 `items` 不是 JSON 数组 |
| `audit_event_missing` | 关键动作缺少审计事件（已关闭轮次缺 `round_closed` 审计） |

任一检查发现问题时，顶层 `passed` 为 `false`，`total_issues` 汇总所有问题数量。

## 测试

`npm test` 运行 `tests/api.test.js` 与 `tests/selfCheck.test.js`，覆盖：snake_case 字段、错误响应结构、唯一性冲突、状态机（含 scheduled 不可直接 closed）、设备停用与类型校验、清单复制与快照隔离、快照数量/顺序/名称严格校验、时间窗校验、异常复核闭环（未复核/confirmed 不能关闭、全部 ignored/resolved 后关闭）、区域风险汇总口径、审计写入、逾期字段、数据自检通过与各类异常、README 关键流程可执行，以及新增接口保持 snake_case。所有用例使用内存 SQLite，互不干扰。
