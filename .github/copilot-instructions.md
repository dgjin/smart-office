# SmartOffice 代码库说明

## 架构与边界

SmartOffice 是单一企业的中文办公空间管理系统，使用 React 19、TypeScript、Vite 6、独立 Node HTTP 服务和 MySQL 8。支持多部门、多园区、多楼栋，不建设多租户，不添加 `tenant_id`。

- MySQL 是业务数据、身份绑定、会话、用户偏好、ChatDock 对话与草案的唯一持久化存储。
- 浏览器不保存业务快照；Cookie 只含不透明会话令牌，数据库只保存令牌 SHA-256。
- `server/index.ts` 托管 API 和生产静态页面；开发时 Vite 在同一端口集成 API。
- `GET /api/workspace` 按当前会话用户裁剪读模型，业务 actor 只能来自 session，不能信任请求体或 query 中的 userId。
- DeepSeek 仅由服务端调用；ChatDock 草案必须由用户最终确认，不得自动提交预约。

## 核心写入与审批

- `server/db.ts` 的 `mutateDb` 负责事务、修订号和命名写锁；核心写入必须走领域命令，不恢复公共快照写入接口。
- 预约提交时冻结 `approvalWorkflow`、`workflowVersion`、`requesterDepartmentId` 和 `resourceCampus`。
- `utils/approval.ts` 统一处理当前节点角色、部门及子孙部门范围、园区范围、自审限制和有效期代理。
- 审批、组织管理、资源、代理等关键写入通过 `server/audit.ts` 在同事务写入 `audit_events`。
- `server/jobs.ts` 与 MySQL Job Worker 负责提醒、no-show、工单补建和 Outbox，支持租约恢复、重试及确定性去重。
- 数据库结构变更必须新增 `server/migrations/*.sql`，不能修改已应用迁移。

## 前端约定

- `App.tsx` 承载主要视图与组件；共享类型在 `types.ts`，纯业务规则放在 `utils/`。
- 预约时间以 ISO UTC 存储，在 UI 边界转换为本地时间。
- 保持固定且可收起的桌面侧栏、右侧独立滚动和移动端导航。
- 不重新引入预订表单内 AI 推荐，不实施 R3F/GLB。

## 常用命令

```bash
npm run dev
npm run typecheck
npm run test:unit
npm run build
npm run db:migrate
npm run db:status
npm run db:verify
```

项目接入 wb 工作台；在父仓库环境中运行 wb 时必须使用 `wb -C /Users/dgjin/dgjinapp/smart-office ...`。默认端口为 3001，不得占用其他系统的 3000 端口。

## 隔离测试

集成和浏览器测试只有同时满足以下条件才运行：

- `SMART_OFFICE_TEST_MYSQL=true`
- `MYSQL_DATABASE` 匹配 `^smart_office_test_[A-Za-z0-9_]+$`

```bash
MYSQL_DATABASE=smart_office_test_i1 npm run db:migrate
MYSQL_DATABASE=smart_office_test_i1 npm run db:seed
SMART_OFFICE_TEST_MYSQL=true MYSQL_DATABASE=smart_office_test_i1 npm run test:integration
SMART_OFFICE_TEST_MYSQL=true MYSQL_DATABASE=smart_office_test_i1 npm run test:e2e
```

集成测试必须串行；Playwright 使用系统 Chrome。测试会清理隔离库，严禁指向真实业务库。不得打印、提交或猜测 `.env` 中的密钥和数据库凭据。
