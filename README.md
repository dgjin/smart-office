# SmartOffice 智慧办公空间管理系统

React 19 + Vite + Node.js + MySQL 8 的单一企业办公空间管理系统，支持多部门、多园区、多楼栋、会议室预约、审批、长期预订、服务工单和 DeepSeek 对话助手。

## 持久化与身份边界

- MySQL 是业务数据、身份绑定、登录事务、会话、用户偏好以及 ChatDock 对话与草案的唯一持久化存储。
- 浏览器不保存业务快照、对话或草案；Cookie 仅包含不透明随机会话令牌，MySQL 仅保存令牌 SHA-256 哈希。
- OIDC 使用 Authorization Code Flow + PKCE S256。外部身份通过 `issuer + subject` 绑定已有内部用户，不按邮箱自动绑定或创建用户。
- 预约、审批、通知和工单由服务端按当前会话用户执行事务；`GET /api/workspace` 按当前用户裁剪数据，旧 `/api/db` 公共快照读写接口已关闭。
- 组织、角色、部门、资源、流程和批量导入使用独立管理命令；schemaVersion 7 受控 JSON 备份包含服务工单、流程版本、代理审批、设备、集成投递和门禁授权事实，兼容 v2—v6 恢复；旧版本恢复会清空新版本外部回调与授权事实，避免遗留权限。
- 预约提交时冻结完整审批流程、流程版本、申请部门和资源园区；节点支持部门及子孙部门、园区范围，代理审批受有效期和自审限制约束，关键写入同事务记录独立 `audit_events`。
- MySQL Job Worker 负责提醒、no-show、工单补建和 Outbox 投递，支持租约恢复、重试和确定性事件去重；浏览器全部关闭后任务仍由 Node 执行。
- ChatDock 按会话用户隔离对话，使用版本号防止旧窗口覆盖；恢复草案不会自动执行，仍须用户在预约表单或操作卡片中最终确认。
- 请求安全、结构化日志、Prometheus 指标、MySQL 原生备份恢复、CI 工作流和隔离演练已实现；本地验证通过不等于已完成企业正式投产，仍需实际 CI、灰度发布和企业运维签字。

## 环境准备

要求 Node.js 22.23+ 或 Node.js 24、MySQL 8。

```bash
npm install
cp .env.example .env
```

在 `.env` 中配置 DeepSeek、MySQL 和 OIDC。`.env` 已被 Git 排除，不要提交或打印其中的密钥。生产环境必须满足：

- `NODE_ENV=production`
- `SMART_OFFICE_DEV_AUTH=false`
- `OIDC_ISSUER` 和 `OIDC_REDIRECT_URI` 使用 HTTPS。
- `OIDC_TOKEN_ENCRYPTION_KEY` 为 32 字节密钥的 base64url 或 64 位十六进制编码。
- `OIDC_REDIRECT_URI` 与身份提供方登记的回调完全一致，路径为 `/api/auth/callback`。

开发身份仅在不生产环境、显式设置 `SMART_OFFICE_DEV_AUTH=true` 且请求来自 loopback Host/地址时可用。

## 数据库迁移与受控初始化

```bash
npm run db:migrate
npm run db:status
npm run db:seed
npm run db:verify
```

`db:seed` 只允许写入空业务数据库。迁移按文件名顺序执行，记录 SHA-256 校验和；已执行迁移的内容发生变化时会拒绝继续。不要手工修改已应用迁移，应新增迁移文件。

## 绑定企业身份

数据库已有用户但尚无任何身份绑定时，可为已有系统管理员执行一次引导：

```bash
npm run auth:bootstrap -- --userId <已有管理员ID> --issuer <OIDC issuer> --subject <OIDC subject>
```

后续身份绑定由已授权的管理流程执行；当前 CLI 用法：

```bash
npm run auth:bind -- --userId <内部用户ID> --issuer <OIDC issuer> --subject <OIDC subject>
```

两个命令都只绑定已有内部用户，不会自动创建用户。

## 运行

开发模式由 Vite 提供页面并在 Node 中间件中运行同一套 API：

```bash
npm run dev
```

独立 Node 模式同时托管 API 和 `dist`，不依赖 Vite Preview：

```bash
npm run build
NODE_ENV=production npm start
```

默认监听 `127.0.0.1:3001`，可通过 `SMART_OFFICE_HOST`、`SMART_OFFICE_PORT` 调整。健康检查为 `GET /healthz`。

生产反向代理应终止 HTTPS，转发到 `127.0.0.1:3001`，保留原始 `Host`，并限制管理面和数据库网络访问。不要暴露 MySQL，不要将开发身份用于共享环境。服务收到 SIGINT/SIGTERM 后会停止接收连接并关闭 MySQL 连接池。

## 校验与隔离测试

```bash
npm run typecheck
npm run test:unit
npm audit
```

集成和浏览器测试默认跳过，只有同时满足以下条件才执行：

- `SMART_OFFICE_TEST_MYSQL=true`
- `MYSQL_DATABASE` 以 `smart_office_test_` 开头

测试会清空并重建该测试数据库，严禁指向业务库。示例：

```bash
MYSQL_DATABASE=smart_office_test_i1 npm run db:migrate
MYSQL_DATABASE=smart_office_test_i1 npm run db:seed
SMART_OFFICE_TEST_MYSQL=true MYSQL_DATABASE=smart_office_test_i1 npm run test:integration
SMART_OFFICE_TEST_MYSQL=true MYSQL_DATABASE=smart_office_test_i1 npm run test:e2e
```

浏览器测试使用系统 Google Chrome（Playwright `channel: 'chrome'`），运行前需安装 Chrome。集成测试使用真实 Node、隔离 MySQL 和本地 Fake OIDC Provider；浏览器测试使用独立 BrowserContext，不读取或写入真实业务库。`production.spec.ts` 另外以 `NODE_ENV=production` 验证 CSP、安全响应头、会话鉴权、权限化读模型和偏好写入。

### 容量测试工具

`test:capacity` 在独立 loopback 临时端口启动 Node，强制要求 `SMART_OFFICE_TEST_MYSQL=true` 和 `smart_office_test_` 数据库前缀，并关闭 OA、日历、门禁和外部消息适配器，不使用业务 3001。工具不会清空数据库，但会写入唯一未来时段的预约并立即取消清理，因此仍只能使用专用隔离库：

```bash
SMART_OFFICE_TEST_MYSQL=true MYSQL_DATABASE=smart_office_test_capacity \
npm run test:capacity -- \
  --config scripts/perf/exploratory.example.json \
  --output .wb/reports/capacity-exploratory-<唯一标识>.json
```

查询阶段混合真实工作区和管理员近 7 天报表请求；设备阶段调用真实门口屏快照接口；提交阶段记录每次预约及取消清理。输出文件不可覆盖，包含原始延迟、HTTP 状态、P50/P95/P99、吞吐、错误率、Prometheus 快照、进程 CPU/RSS 时间序列、代码 revision 和服务日志尾部，不保存 Cookie、设备令牌或数据库凭据。设备令牌仅通过 `SMART_OFFICE_CAPACITY_DEVICE_TOKENS_JSON` 环境变量以 JSON 数组传入，数量必须覆盖全部 ACTIVE 门口屏，且 `deviceQuery.concurrency` 不得小于设备数。`EXPLORATORY` 始终输出 `NOT_EVALUATED`；`FORMAL` 必须提供已确认的 `expected.employees/meetingRooms/bookableMeetingRooms/doorDevices/accessControllers` 和 `modelEvidence`，有门口屏时必须配置 `deviceQuery`，并达到各阶段并发、持续时间、P95/P99 与错误率配置后才输出 PASS。会议室总量与可预约量分别核对，PENDING 房间不计入可预约量。外部门禁控制器数量只能作为确认输入保存，不能由当前门口屏清单推定。

## 请求安全与可观测性

- 所有响应包含 CSP、`nosniff`、禁止嵌入、同源 opener/resource policy；生产环境额外发送 HSTS。JSON 请求体默认上限 1 MB，Node 限制请求头、请求耗时和连接复用。
- 登录、OIDC 回调和开发认证按客户端 IP 与路由限流，默认每 5 分钟 30 次，超限返回 429 和 `Retry-After`。只有反向代理会覆盖外部传入的 `X-Forwarded-For` 时才设置 `SMART_OFFICE_TRUST_PROXY=true`。
- `/livez` 仅检查进程存活；`/healthz` 检查数据库 readiness；`/metrics` 输出 Prometheus 文本。指标可从 loopback 读取，远程读取必须配置 `SMART_OFFICE_METRICS_TOKEN` 并使用 Bearer Token。
- stdout/stderr 使用 JSON 结构化日志，通过 `X-Request-ID` 关联请求；日志不记录 query、Cookie、Token、密码或 OIDC code。由日志系统设置 retention、访问控制和告警，不要把日志公开暴露。
- 最低告警项：`smart_office_database_up == 0`、5xx 响应持续增长、`auth.failed`/`jobs.tick_failed`/`api.failed` 异常激增、认证 429 突增，以及 readiness 连续失败。告警应路由到企业值班渠道并明确响应人。

## MySQL 原生备份、恢复与演练

备份使用 `mysqldump --single-transaction`，恢复使用 `mysql`。凭据只写入临时 `0600 defaults-extra-file`，不会放进进程参数或日志；SQL 文件同时生成 SHA-256 校验文件。

```bash
npm run db:backup -- --output /受控备份目录/smart-office.sql
sha256sum -c /受控备份目录/smart-office.sql.sha256
SMART_OFFICE_RESTORE_CONFIRM="$MYSQL_DATABASE" npm run db:restore -- --input /受控备份目录/smart-office.sql
```

恢复是覆盖性操作，`SMART_OFFICE_RESTORE_CONFIRM` 必须与目标数据库名完全一致。执行前停止应用写入、确认目标库和校验和，并由数据库负责人审批；不要把生产备份恢复到共享测试实例。

隔离恢复演练只允许 `smart_office_test_` 前缀源库，会创建唯一临时库、比较核心表行数、验证当前必需迁移，并仅清理自己创建的临时库：

```bash
SMART_OFFICE_TEST_MYSQL=true MYSQL_DATABASE=smart_office_test_drill npm run db:drill
```

生产前由企业确定 RPO/RTO、加密、异地副本、保留期和恢复责任人。建议至少每日全量备份、每周隔离恢复演练，并定期验证备份可读性；备份目录不得位于 Web 静态目录，调度账号仅授予所需权限。

## CI 与投产门槛

`.github/workflows/ci.yml` 在 MySQL 8 服务上依次执行依赖审计、类型检查、单测、构建、迁移、seed、集成测试、浏览器测试和原生恢复演练。CI 使用独立测试凭据和 `smart_office_test_ci`，不得改指业务库。工作流已建立，但只有在远程仓库实际运行成功后才可记为 CI 通过。

发布采用“先备份、再迁移、后应用”的顺序：

1. 冻结发布窗口，确认备份、校验和及可用回滚版本；检查迁移状态和新增迁移兼容性。
2. 先向一个试点部门或少量用户灰度，观察 readiness、5xx、认证、审批、Job Worker 和核心预约链路，再逐步扩大范围。
3. 应用回滚只回滚 Node 进程和 `dist`；数据库迁移没有自动 down migration。隔离实测表明旧提交虽能读取既有业务事实，但其新写入未填充 007—010 的治理字段，不能作为无损持续写入方案；未经专项兼容写入验证，回滚窗口必须停止旧应用业务写入。若新版本已写入不兼容数据，不得直接回滚旧应用，应按预案停止写入并由数据库负责人执行恢复。
4. 出现数据库 readiness 持续失败、核心写入错误、审批越权或数据不一致时立即停止扩量；保留请求 ID、审计记录和指标作为处置证据。

正式全企业投产必须同时满足：远程 CI 全绿、无未接受的高危依赖漏洞、OIDC/HTTPS/代理配置核验、试点验收通过、监控告警到达值班人、备份调度与隔离恢复成功、回滚演练通过、业务与运维负责人签字。

截至 2026-11-21，本地证据为：完整 wb 校验通过；127 项单元测试、71 项隔离 MySQL 集成测试和 22 项真实 Chrome 测试通过；全新隔离库完成 001—013 全量迁移、受控 seed、重复迁移和 `db:verify`；两套隔离库的原生备份恢复演练均确认八张核心表行数一致并清理临时库；`npm audit --audit-level=high` 报告 0 个已知漏洞。这些结果覆盖 P9-01、P9-02 的本地工程验证及 P9-04 的依赖审计和数据库恢复部分，不替代上述企业生产门槛。

MRP9 及后续阶段仍有以下明确门禁：

- P9-03 正式性能容量验收尚未执行。容量工具已在 3 用户、2 间可订会议室、0 块门口屏的全新隔离库完成短时探索性冒烟：374 次工作区/近 7 天报表查询和 12 次预约提交均返回预期状态，12 条预约全部取消成功，保存 31 个进程资源采样点且运行错误为 0；原始 JSON 为 `.wb/reports/mrp9-capacity-tool-smoke-20261121-2156.json`，结论为 `NOT_EVALUATED`，不能外推为全员、28 间资源或正式阈值通过。只读核查 2026-11-10 台账发现：`01 房间台账`有 29 间会议室，其中 28 间“在用”，漏摘的 1408 为 14F 小型空置会议室；`06 会议室台账`摘录了 28 间在用资源，与需求的 28 间口径一致，但表内“差异(应为0)”仍为 1，且 10 间在用会议室缺座位数，不能视为已签字容量台账。
- 同一台账的办公类人员合计为 364 人（高管 13、中层 66、开放办公区 285），另有 1411、1412 两间会议室各关联 1 条人员记录，使全表人数公式显示 366；真实员工口径须由责任方确认。需求初稿明确 16 层现有 5 块门口小屏，但未给出其他门禁设备数量；全员工同时在线的具体并发模型、提交和跨 7 天查询秒数也仍为待确认值。未形成这些正式输入前，不执行冒充验收结论的峰值测试；后续仍须保存 P95/P99、吞吐、错误率及资源曲线原始报告。
- P9-04 已完成提交 `1e13583` 旧代码在 001—013 隔离库上的生产构建、基础冒烟和业务对账：当前候选创建的同一预约完成两级审批、工单、QR 签到、使用确认、提前结束、日历/门禁 Outbox 和授权回收；旧应用可读取 COMPLETED 预约与 DONE 工单，且旧应用另一笔写入前后，目标预约及其工单、签到、使用事实、Outbox、集成投递、门禁授权和审计摘要一致。原始结果见 `.wb/reports/mrp9-rollback-smoke-20261121.md` 和 `.wb/reports/mrp9-business-rollback-20261121.md`。但旧应用新写入的 `rule_version`、`workflow_version`、`approval_rule_set_version`、`approval_rule_id`、`approval_submitted_at`、`schedule_version` 关系列均为 NULL，payload 也缺 `meetingType`、`ruleVersion`、`scheduleVersion`，因此完整业务兼容回滚未通过，不得允许旧应用直接承接新预约写入。企业安全测试、实际发布候选切换及生产签字仍未完成。
- P9-04 的跨版本备份恢复路径已在另一隔离库通过：001—006 旧应用完成预约、两级审批和工单后生成原生备份；升级 007—013 并写入候选数据，再恢复备份后，迁移记录回到 001—006、候选新增预约被移除、备份前预约与工单摘要一致，旧应用可再次完成预约、两级审批和工单生成。原始结果见 `.wb/reports/mrp9-cross-version-restore-20261121.md`。本地可证明的完整读写回滚方案是停止写入并恢复兼容备份，而不是旧代码直接承接新库写入；真实生产备份恢复和责任方签字仍未完成。
- P9-05 远程 CI 尚未对当前发布候选代码实际运行成功；旧 run `44860079503` 的 SHA `6b228511…` 不属于当前候选，不能复用为本次验收证据。只有新不可变提交对应的远程运行全绿后才关闭此门槛。
- P9-06 发布候选评审尚未完成。`.wb/reports/mrp9-release-candidate-review-20261121.json` 仅是 HEAD `1e13583` 加未提交改动时的历史评审输入，其中文件计数、数据库迁移状态等快照已过时；当前候选须基于新不可变提交重新评审。所有问题仍需接受人、获批规避方案、期限及业务/测试/运维/安全/数据库签字，不虚构评审结论。
- 本地业务库已在备份后应用 001—013，并正式导入 28 间需求会议室：18 间按源座位数开放，10 间使用分类下限技术占位且保持 PENDING；原 5 个资源和 16 条预约导入前后保持一致。该结果不等于生产迁移、10 间容量核定或现场签字完成。历史问题数据仍待授权清理，外部平台联调、现场施工与设备验收、业务 UAT、培训、灰度和正式投产均须后续真实证据。

## 报表、ICS 与可选外部集成

- 运营报表按预约与统计范围的时段交集计数，跨范围和跨日使用时长会裁剪到每日 08:00–20:00 的开放区间；提前结束以 `endedEarlyAt` 计算，部分日期只按实际开放分钟数提供容量。
- 平均审批时长只统计已完成最终审批的申请，审批中或已驳回申请的部分节点记录不会误算为最终审批。CSV 与页面共用同一份报表结果。
- ICS 使用 UTC 时间、稳定 UID、CRLF、UTF-8 75 octet 折行以及文本/参数转义；已核准预约导出 `CONFIRMED`，取消预约导出 `CANCELLED`，其他状态不直接导出。
- ICS 文件下载继续保留。企业微信、紧急短信、可选邮件、OA 回调、企业日历和门禁适配器已实现 Outbox、幂等重试、死信、对账与安全重放边界，全部默认关闭；目前仅通过隔离 Fake 端点验证，未声明已与真实企业平台联调。启用前仍须完成企业选择、凭据管理、权限评审和现场验收。
