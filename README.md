# SmartOffice 智慧办公空间管理系统

React 19 + Vite + Node.js + MySQL 8 的单一企业办公空间管理系统，支持多部门、多园区、多楼栋、会议室预约、审批、长期预订、服务工单和 DeepSeek 对话助手。

## 持久化与身份边界

- MySQL 是业务数据、身份绑定、登录事务、会话、用户偏好以及 ChatDock 对话与草案的唯一持久化存储。
- 浏览器不保存业务快照、对话或草案；Cookie 仅包含不透明随机会话令牌，MySQL 仅保存令牌 SHA-256 哈希。
- OIDC 使用 Authorization Code Flow + PKCE S256。外部身份通过 `issuer + subject` 绑定已有内部用户，不按邮箱自动绑定或创建用户。
- 预约、审批、通知和工单由服务端按当前会话用户执行事务；`GET /api/workspace` 按当前用户裁剪数据，旧 `/api/db` 公共快照读写接口已关闭。
- 组织、角色、部门、资源、流程和批量导入使用独立管理命令；schemaVersion 2 受控 JSON 备份包含服务工单、流程版本和代理审批，恢复会严格替换备份覆盖的业务集合。
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
3. 应用回滚只回滚 Node 进程和 `dist`；数据库迁移没有自动 down migration。若新版本已写入不兼容数据，不得直接回滚旧应用，应按预案停止写入并由数据库负责人执行恢复。
4. 出现数据库 readiness 持续失败、核心写入错误、审批越权或数据不一致时立即停止扩量；保留请求 ID、审计记录和指标作为处置证据。

正式全企业投产必须同时满足：远程 CI 全绿、无未接受的高危依赖漏洞、OIDC/HTTPS/代理配置核验、试点验收通过、监控告警到达值班人、备份调度与隔离恢复成功、回滚演练通过、业务与运维负责人签字。当前本地证据为完整 wb 校验通过、19 项集成测试通过、6 项浏览器测试通过，以及 006 迁移和八张核心表行数一致的原生恢复演练；这些证据不替代上述企业生产门槛。

## 报表、ICS 与可选外部集成

- 运营报表按预约与统计范围的时段交集计数，跨范围和跨日使用时长会裁剪到每日 08:00–20:00 的开放区间；提前结束以 `endedEarlyAt` 计算，部分日期只按实际开放分钟数提供容量。
- 平均审批时长只统计已完成最终审批的申请，审批中或已驳回申请的部分节点记录不会误算为最终审批。CSV 与页面共用同一份报表结果。
- ICS 使用 UTC 时间、稳定 UID、CRLF、UTF-8 75 octet 折行以及文本/参数转义；已核准预约导出 `CONFIRMED`，取消预约导出 `CANCELLED`，其他状态不直接导出。
- 当前交付的是 ICS 文件下载，不是企业日历双向同步。外部邮件、企业微信和企业日历适配器均属于后续可选集成，默认关闭且未声明已接入；启用前需单独完成企业选择、凭据管理、权限评审、失败重试和验收。
