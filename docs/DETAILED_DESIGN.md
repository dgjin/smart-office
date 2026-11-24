# SmartOffice 详细设计文档

- 文档版本：v1.0
- 基线日期：2026-11-23
- 适用实现：单企业、React 19 + Node.js + MySQL 8 唯一持久化版本
- 配套文档：`docs/SYSTEM_ARCHITECTURE.md`、`docs/USER_MANUAL.md`

## 1. 设计范围与原则

本文描述当前代码中的模块职责、核心数据、业务规则、接口、状态机、助手动作和验证边界，不把规划能力写成已实现能力。

核心约束：

1. 服务端按当前会话重新获取用户并鉴权，前端菜单隐藏不是权限边界。
2. MySQL 保存全部业务事实、身份、会话、偏好、通知、审计、任务、集成事实和 ChatDock 会话。
3. 新建、修改和续期预约只能通过正式表单最终提交；助手只能生成白名单草案。
4. 取消、审批、签到和完成工单可以由助手生成操作卡片，但确认后仍由服务端重新鉴权、重检状态并事务执行。
5. 涉密授权、组织同步应用、集成补偿/重放、设备撤销/重启和备份恢复只提供正式页面及操作指导，不开放助手直接执行。
6. 已应用数据库迁移不可修改，结构变化只能新增迁移。

## 2. 角色与视图设计

### 2.1 固定系统视图

`helpCatalog.ts` 定义唯一 `SystemView` 集合：

- 基础：`DASHBOARD`、`RESOURCES`、`BOOKINGS`、`HQ_3D`。
- 流程与会务：`APPROVAL_CENTER`、`WORK_ORDERS`、`EXCEPTIONS`。
- 管理：`USERS`、`ROLES`、`DEPARTMENTS`、`REPORTS`、`WORKFLOW_CONFIG`、`DEVICES`、`DATA_CENTER`。
- 保密：`CONFIDENTIALITY`。

前端 `App.tsx` 和服务端 `server/tools.ts` 分别根据当前用户角色、审批职责、有效代理和实际工单职责计算可见视图。助手 `NAVIGATE` 只允许上述固定值，并在前后端重复校验。成员新增和编辑会规范化角色数组并去重，保存完整多角色集合，不能只保留当前操作涉及的单个角色。

### 2.2 数据可见性

`server/confidentiality.ts` 的 `getActorDbView` 是助手和部分读接口的权限化读模型：

- 普通预约详情向申请人、参会人、授权审批人、相关会务角色和系统管理员开放。
- 无权读取的预约保留占用事实，但清除用途、人员、联系人、审批、服务、签到和其他敏感字段；涉密不可见读模型的 `userId`、`attendeeIds` 和 `overlapParticipantIds` 均为空，不能泄露申请人或参会人 ID。
- 普通预约仍保留去重后的 `overlapParticipantIds` 投影，用于参会冲突提示，不因此开放完整预约详情。
- 涉密预约还需 confidential access grant、申请人/参会人身份、保密角色或有效审批范围；系统管理员身份本身不自动获得涉密读取或直接写操作权限。
- `GET /api/workspace` 等轮询读取不记录 `CONFIDENTIAL_READ`；用户主动展开详情时，前端调用 `POST /api/bookings/:id/confidential-read`，服务端重检涉密读取权限并以 `source=BOOKING_DETAIL` 审计。
- 工单按申请人、系统管理员、负责角色及涉密读取权限过滤。

## 3. 表现层详细设计

### 3.1 主应用协调

`App.tsx` 负责：

- 加载 `/api/workspace` 权限化数据及用户偏好。
- 管理当前固定视图、移动端导航、通知、主题和侧栏状态。
- 管理新建、修改、长期续期的正式预约表单及 prefill。
- 分发助手固定动作，不执行模型给出的 URL、脚本或任意请求。
- 挂载 `HelpDrawer` 和 `ChatDock`，在二者之间传递智能帮助问题。
- 工作区每 10 秒轮询；`operationRequestRef` 防止同一身份请求重入，`operationOwnerRef` 隔离身份切换前后的响应，`document.hidden` 或浏览器离线时跳过本轮。
- `ChatDock`、`HelpDrawer` 和 `OperationsReports` 使用 `React.lazy` 按需加载，不改变其权限检查或业务步骤。

资源管理采用逐项会话锁：默认全部锁定，只有当前会话明确解锁的资源可以编辑或删除；重新加载或身份变化后重新锁定。锁只是防误操作措施，服务端仍执行真实权限和关联约束检查。

### 3.2 品牌主题与偏好

- 主应用根节点通过 `data-theme` 选择 CSS 变量和局部覆盖；`coamc`“东方蓝”使用白色品牌侧栏、`#00427f` 选中导航、`#003366` 深蓝标题及冷灰工作区，原五套主题保留并可随时互换。东方蓝品牌区加载 `/images/china-orient-logo-horizontal.png` 的蓝色横式组合标志，其他五套主题加载 `/images/china-orient-logo-horizontal-reverse.png` 的透明反白稿并继承当前侧栏主题色；展开态显示完整图片，折叠态通过对应透明图片仅显示左侧图形标，图片替代文本为“中国东方”，不增加远程品牌资源。
- 桌面入口位于侧栏底部“界面风格”，移动端位于“更多 → 界面主题”；二者遍历同一 `THEMES` 配置并更新同一状态，移动端六主题使用三列布局。
- `tailwind.config.js` 的 safelist 包含 `coamc` 动态色阶，生产构建会生成主题色按钮等状态类；品牌样式仅使用现有同源 Noto Sans SC，不增加远程图片、字体或脚本依赖。
- `server/preferences.ts` 只接受白名单主题，`GET/PUT /api/preferences` 继续将主题和侧栏状态写入既有 MySQL 用户偏好表，无需新增迁移。品牌覆盖不改变登录页、独立门口屏、业务规则或权限边界。
- 主应用向总部楼层 3D 和空间资源库内嵌剖切的 iframe 传递白名单 `theme` 参数：`coamc` 启用白色面板、东方蓝交互态和深海蓝模型背景，其余五套主题统一使用 `classic` 保留原 3D 配色；所有主题均显示同源中国东方横式标志。Three.js 房间类别色、空间状态色、资源映射和交互不随品牌主题改变。主应用 3D 容器的负边距随桌面、平板和手机断点匹配实际内容内边距，375px 视口下 iframe 保持 375px，不裁切模型边缘标签。
- 助手的 `NAVIGATE.hq3d` 由 App 通过 `URLSearchParams` 转成 `buildingId/floorNo/roomUid/navigationId`。完整 3D 页面启动时优先按稳定 UID 定位并选中房间，否则按楼栋和可选楼层定位；`navigationId` 使重复定位也刷新 iframe。无效参数回退默认视图，`embed=spatial` 剖切不读取这些定位参数，普通手动导航清除旧定位。

### 3.3 帮助抽屉

`components/HelpDrawer.tsx` 与 `helpCatalog.ts` 共同实现：

- 唯一帮助入口固定在主内容顶部栏，桌面和移动端均可打开；智办助手保留独立浮动入口。
- 按当前角色和可见视图过滤主题。
- 支持“全部、会议与空间、流程与会务、系统管理”分类。
- `searchHelpTopics` 对标题、关键词、摘要和步骤评分并排序。
- 指南详情包含摘要、步骤、注意事项和固定“打开功能”动作。
- “针对此指南提问”和智能帮助输入复用原 ChatDock，不建立第二套模型或会话存储。
- 打开后聚焦搜索框，Tab/Shift+Tab 约束焦点，Escape 关闭并返回触发按钮。
- 桌面为右侧抽屉，移动端全宽；主要触控目标至少 44px，并支持 reduced-motion。

### 3.4 运营看板

`OperationsReports.tsx` 默认显示“管理看板”，可切换到“明细与对账”。两个视图使用同一次 `/api/reports` 返回的 `OperationsReport`：

- `OperationsDashboard.tsx` 呈现核心指标、计划/实际趋势、空间使用、部门投入、会务状态和管理关注事项。
- 图表使用内联 SVG，直接标注数值，提供标题、说明、空状态和可展开数据表。
- 趋势图例合计直接使用 `report.overall.scheduledHours/actualHours`，避免逐日四舍五入造成总计偏差。
- 筛选、CSV/XLSX 导出和原明细对账保持不变。
- 导出请求必须携带当前页面 `report.revision`；缺失或非法时返回 `400 REPORT_REVISION_REQUIRED`，与服务端当前快照不一致时返回 `409 REPORT_SNAPSHOT_CHANGED`。前端收到快照变化后重新加载报表，提示用户基于最新快照重新导出。

### 3.5 助手输入与运行优化

- ChatDock 发送快捷键同时检查 `!event.nativeEvent.isComposing` 和 `event.keyCode !== 229`，中文 IME 组合输入期间按 Enter 不误发送。
- 打开 ChatDock 后聚焦输入框，Tab/Shift+Tab 约束焦点，Escape 关闭，关闭后焦点返回触发元素；关闭与发送按钮至少 44×44px，移动端输入框至少 44px 高并使用 16px 字号。
- `public/hq3d.html` 在 `document.hidden` 时取消当前 RAF，页面恢复可见后继续请求下一帧，减少隐藏页面的无效渲染。

## 4. HTTP 接口设计

### 4.1 通用约定

- API 由 `server/api.ts` 固定注册；非 `/api/` 请求由开发 Vite 或生产静态托管处理。
- 除认证、设备和明确公开的探活接口外，请求需要有效会话。
- 写接口使用 JSON，默认请求体上限 1 MB。
- 错误使用稳定业务错误码和适当 HTTP 状态；前端不得把网络失败显示成业务成功。
- 服务端错误协议保持不变，前端通过 `utils/userErrors.ts` 统一格式化用户提示：优先使用页面专用或公共中文映射，其次保留不含错误码的中文 `detail/message`，未知错误码、数字状态码和英文网络错误使用中文兜底。主请求在内部 `Error.code` 保留原始错误码，供页面专用映射使用；原始码只进入 API、日志、审计和技术联调，不直接展示给普通用户。
- 写操作在服务端重检 actor、资源状态、排期版本、审批范围或负责角色。
- 涉密字段在响应生成前裁剪，不能依赖前端隐藏。
- 生产样式由 `styles.css` 的 Tailwind/PostCSS 指令在构建期生成，`index.html` 使用同源 `/vendor/fonts/fonts.css`；`server/http.ts` 的 CSP 以 `default-src 'self'` 为基础，主应用脚本、字体和连接均同源，不配置 Tailwind CDN 或 Google Fonts 运行时依赖。

### 4.2 核心路由分组

| 分组 | 主要接口 | 设计职责 |
|---|---|---|
| 工作区 | `GET /api/workspace`、`GET /api/dashboard`、`GET /api/exceptions` | 权限化工作区、角色驾驶舱、异常聚合 |
| 预约 | `POST /api/bookings`、`POST /api/bookings/batch`、`POST /api/bookings/:id/confidential-read` 及预约动态路由 | 新建、批量/长期、修改、审批、取消、签到、续期、ICS、主动涉密详情读取审计等固定领域动作 |
| 报表 | `GET /api/reports`、`GET /api/reports/export` | 同一权限化报表快照及 CSV/XLSX 导出 |
| 助手 | `GET/PUT /api/agent/conversation`、`GET /api/agent/status`、`POST /api/agent/chat`、`POST /api/agent/action` | 会话恢复、SSE 对话、固定确认动作 |
| 通知待办 | `GET/PATCH /api/notifications`、`GET /api/todos` | 按用户路由的通知和待办 |
| 资源与规则 | `POST /api/resources`、`GET/PUT /api/rules`、资源动态路由、台账预检/导入 | 资源维护、规则配置和受控导入 |
| 审批配置 | `PUT /api/workflow`、`PUT /api/approval-rule-set` | 流程节点发布、完整动态规则集草稿发布、乐观并发和审计 |
| 组织权限 | 用户、角色、部门、审批代理、组织同步 preview/apply | 组织维护、职责和差异应用 |
| 会务 | 服务目录、区域、班次及工单动态路由 | 目录版本、工单处理、巡查和成本 |
| 保密 | 保密白名单及授权动态路由 | 白名单和变更授权管理 |
| 总部 3D | `GET /api/hq3d/snapshot`、`GET /api/hq3d/layout/export`、`POST /api/hq3d/layout/parse`、`POST /api/hq3d/layout/preflight`、`POST /api/hq3d/layout/import`、房间资料/维护/面积等动态路由 | 独立细粒度 3D 数据读写及管理员 JSON/Excel/图片整栋或单层布局导入 |
| 设备 | `GET/POST /api/devices`、设备动态路由；`GET /api/device/snapshot`、`POST /api/device/heartbeat` | 管理面与设备令牌面分离 |
| 数据中心 | 集成查询、对账、补偿、重放、审计和受控备份恢复 | 高影响运维操作 |
| 个性化 | `GET/PUT /api/preferences` | 主题和侧栏偏好 |

具体动态路径以 `server/api.ts` 为准，新增接口必须同步本表、用户手册、帮助目录和权限测试。

## 5. 核心数据与状态设计

### 5.1 主要状态枚举

| 对象 | 状态 | 说明 |
|---|---|---|
| 资源 `ResourceStatus` | `AVAILABLE/OCCUPIED/MAINTENANCE/PENDING` | PENDING 或维护资源不可作为正常可订资源 |
| 预约 `BookingStatus` | `PENDING/APPROVED/REJECTED/COMPLETED/CANCELLED` | 持久业务状态 |
| 预约展示状态 | `PENDING/UPCOMING/IN_PROGRESS/NO_SHOW/RELEASED/ENDED_EARLY/COMPLETED/CANCELLED/REJECTED` | 由持久状态、当前时间和使用事实派生，不另建冲突事实 |
| 工单 `WorkOrderStatus` | `TODO/PENDING_INFO/IN_PROGRESS/DONE/CANCELLED/EXCEPTION` | 记录状态历史、处理人、成本和快照 |
| 使用申诉 | `PENDING/RESTORED/REJECTED` | 仅处理 no-show、确认未使用或人工异常释放争议；主动取消不可申诉 |
| 门禁授权 | `PENDING/AUTHORIZED/REVOKED` | 与预约和排期版本关联 |
| 定时任务/Outbox | 待执行、执行中、完成、失败等持久状态 | 通过租约、重试和幂等键推进 |

### 5.2 快照和版本

- `Booking.scheduleVersion` 在改期时递增，异步提醒、正常完成、no-show、工单和集成事件按版本失效或重建。
- 预约提交冻结 `ruleSettingsSnapshot`、审批规则/流程版本、申请部门、资源公司和服务目录快照。
- 系统管理员在“流程配置”维护完整 `ApprovalRuleSetVersion` 本地草稿，新增、编辑、删除和默认流程调整均不直接写库；重置恢复当前发布版本，工作区版本变化时重新载入草稿。
- `PUT /api/approval-rule-set` 仅允许 `SYSTEM_ADMIN`，以 `baseVersion` 拒绝过期草稿，复用统一规则集规范化校验后追加版本并写入 `APPROVAL_RULE_SET_PUBLISH` 审计。空条件、未知条件、重复规则标识/优先级、无效流程引用及无变化发布均被拒绝，历史版本不可变。
- `ChatDock` 的 `chatdock_conversations` 以 `user_id` 为主键，保存 `revision` 和 `payload JSON`。
- 会话 PUT 在事务中读取当前行并 `FOR UPDATE`，客户端 revision 不一致时返回 `409 CONVERSATION_CONFLICT`。
- 核心办公快照也有独立版本/CAS；`GET /api/reports` 返回的 `report.revision` 标识页面数据快照，CSV/XLSX 导出必须回传同一版本；3D 房间资料采用单行细粒度写入，避免整库快照重写。

## 6. 资源与总部 3D 设计

### 6.1 资源维护

资源包含类型、容量、设备、楼栋楼层、会议室分类、开放时间、专属属性和可订状态。创建、修改、缩容、维护和删除均由服务端校验：

- 容量、参与人数和设备需求在预约时再次检查。
- 删除前检查有效预约和门口屏设备依赖，存在关联时拒绝普通删除。
- 资源锁定只影响当前管理会话，不改变资源业务状态。
- 资源“所属公司”和流程节点“资源公司范围”对外统一使用公司口径，持久字段仍为 `campus/campuses`；新申请冻结提交时的资源公司，在途申请不改写历史快照。
- 批量台账先 preflight，再按明确差异导入，不用未核验数据覆盖真实资源。CSV 模板表头显示“公司(可选)”，仍按原列位置解析公司值，兼容旧模板同列数据。

### 6.2 3D 映射与同步

- `public/hq3d.html` 使用 Three.js 0.160，自托管依赖和字体。
- 礼堂/报告厅由 `public/hq3d-auditorium.js` 的 `planAuditoriumLayout(width, depth)` 计算局部坐标。主席台宽度取房间宽度的 78%，深度按 16% 并设边界；扣除台前通道和后侧余量后，以 0.86m 列距、1.05m 排距及两侧座位区计算行列，中央过道随宽度取 0.8–1.25m。座位区块在剩余深度内居中，最多 320 座。
- 渲染层只在 `meeting` 类别且名称包含“礼堂”或“报告厅”时进入专用分支，保留原 UID、类别、点击、状态和资源映射。主席台、讲台、主席桌椅、投屏和观众椅仍写入楼层共享盒子/柱体数组，由既有 InstancedMesh 合批；视觉座位数不回写资源容量或预约规则。
- 独立 3D 页在宽度不超过 900px 时，以底部功能抽屉顶边作为取景区域下界，单层模型完整呈现在抽屉上方；楼栋、楼层、房间选择和缩放交互保持不变。
- 主楼 20 层和南配楼 4 层来自持久布局；每间房使用显式稳定 UID。
- 布局重复初始化执行 UPSERT，移除空间差异停用，不删除历史资料和维护记录。
- `server/hq3dLayoutImport.ts` 使用 `smart-office.hq3d-layout` / `schemaVersion: 1` 文件封装，`scope.kind` 为 `BUILDING` 或 `FLOOR`。整栋文件必须完整声明当前楼层集合；单层文件只含目标楼层且不能修改楼栋元数据。文件和数据库继续使用稳定 UID 与 `nx/nz/nw/nd/frac` 归一化几何，导入不新增、删除或重排楼层。
- `server/hq3dLayoutFiles.ts` 统一接收严格 base64 JSON envelope，按真实扩展名分派 JSON、XLSX、PNG/JPG/JPEG；JSON、Excel、图片分别限制 2、4、8 MiB，`POST /api/hq3d/layout/parse` 请求体上限 12 MiB。解析只返回规范化 `Hq3dLayoutDocument`、来源类型和识别提示，不直接执行写库。
- `server/hq3dLayoutExcel.ts` 通过既有 ExcelJS 导出/读取版本化 XLSX。系统工作簿固定包含“布局信息”“楼层”“房间”“填写说明”，独立楼层表可表达空楼层，房间表覆盖 UID、业务文本、多行标签和全部几何；表名、表头、公式和不受支持对象均受校验，最终仍调用 `parseHq3dLayoutDocument`。`parseHq3dLayoutExcelUpload` 自动区分系统模板与原生楼层图，原生文件按当前 `BUILDING/FLOOR` scope 先导出只读基线，再生成同一标准布局文档。
- 原生楼层图按“楼栋 + 中文楼层 + 可选版本”匹配工作表，整栋必须覆盖当前全部楼层，单层只处理目标楼层；版本优先级为“新”高于“全”高于无后缀高于“部分”高于“旧”，同级重复拒绝。封皮、前三行标题、未选版本和打印区域外内容不进入布局，无打印区域时按有效房间单元格及合并范围推导边界。
- 原生识别只处理合并区域 master cell，横向按实际列宽并扣除 5px 间隙、纵向按行高换算归一化几何，`frac` 按识别面积归一化。既有房间先按房号、再按名称和中心距离匹配，名称变化时允许同类别且矩形重叠不少于 50% 的最近房间沿用 UID；未匹配项使用确定性 UID 并追加序号。识别结果仍须人工核对，且仅支持附件所示单元格绘制结构，不宣称兼容任意 Excel。
- `server/hq3dLayoutOcr.ts` 只接受真实 PNG/JPEG 文件头，图片不超过 8 MiB、2400 万像素且单边不超过 10000 像素，只允许 `FLOOR` 范围。Tesseract.js 使用本地 `chi_sim` 语言包、稀疏文本模式和自适应阈值以改善黄色等高亮背景文字识别，模块级队列一次执行一个 OCR 任务，worker 在 finally 中终止，不依赖运行时 CDN。
- OCR 行先按置信度和有效 bbox 过滤，再以独立房号为锚点合并同列相邻的部门、人员和括号续行。房号优先、明确名称辅助匹配现有房间；房号匹配项把多行识别文字变化写入候选并进入预检，同时保留原 UID、类别、维护备注和几何，仅识别到房号或纯空格、换行、括号等格式差异时不修改原资料。未识别现有房间全部保留。只有带房号的新标注才生成 `meeting` 候选，UID 冲突追加序号，几何按文字位置估算；识别文字和坐标仍须人工核对，没有有效房间标注时拒绝，图片路径不会因漏识别产生批量 retire。
- 三种来源统一复用只读预检：计算新增、修改、恢复、停用、不变和元数据变化，同时返回当前范围 SHA-256 baseline。正式导入在事务内以 `FOR UPDATE` 重读目标范围、重算 baseline 和差异；客户端 baseline 过期时返回 409，任何错误均整批回滚。目标范围外的 UID 不允许移入；整栋只允许同栋既有楼层间移动。
- JSON/Excel 是完整精确快照，省略的未映射房间按报告逐条软停用，恢复沿用原 UID；已绑定资源的房间省略时预检和正式导入均拒绝。profile、维护、楼层面积、资源映射、disposition 与历史不随布局更新删除，新房间不自动创建预约资源。每次成功导入仅写一条 `HQ3D_LAYOUT_IMPORT` 审计。
- 导出、统一解析、预检和导入接口均要求系统管理员；预检和导入 JSON 请求体上限 2 MiB。快照通过 `capabilities.canManageLayout` 控制完整 3D 页入口，内嵌空间剖切不显示该能力，服务端权限校验不依赖前端隐藏。
- 空间资源库与 3D 通过 `resourceId—roomUid` 显式一对一映射共享状态，不按名称模糊匹配。
- 空间导航以 `/hq3d.html?embed=spatial` 嵌入整栋剖切；同源 `postMessage` 只传递约定消息并检查 origin/source。
- 当前 14 条已确认映射之外的空间仍需管理员维护或 UAT 核定，不能自动变成可预约资源。

## 7. 预约领域设计

### 7.1 提交流程

`validateBookingBatch` 对单批预约逐项执行：

1. 限制单批只能使用一个资源。
2. 读取申请人姓名、座机和手机并生成联系人快照；缺项直接拒绝。
3. 校验用途、会议类型和涉密选择的一致性。
4. 校验资源存在、类型、时间范围、容量、人数、设备和可订状态。
5. 拒绝过去开始时间并检查资源自然日开放时段。
6. 校验礼堂布置、专属资源领导条件、申请时间窗和申请理由。
7. 规范化会务需求，并按当前目录冻结服务快照。
8. 检查资源冲突、申请人时间冲突，生成参会人冲突提醒。
9. 按自然日拆分并核算申请部门日净额度。
10. 冻结规则版本和规则快照，再进入审批及持久化流程。

批量中的前一项会参与后一项冲突和额度计算，避免同一批次内部双订或超额。提前结束的完成预约按 `actualEndTime` 重算部门日额度，正常完成及其他计划内预约仍使用计划 `endTime`。

### 7.2 新建、修改与续期

- 新建和周期/长期预约使用正式表单提交，服务端完成完整规则校验。
- 修改只接受当前用户有权管理的有效预约；改期后增加排期版本，并重建关联任务。
- 助手修改草案只包含用户明确提供的变更字段，冲突检测排除当前预约。
- 长期续期要求本人、原长期系列已核准首条且不存在待审或活跃续期。
- 助手续期只打开正式续期表单，成功打开不等于续期已提交或已核准。
- 涉密预约不通过助手修改草案进入普通编辑链路。

### 7.3 审批与取消

- 审批流程、规则版本和节点范围在申请时冻结。
- 动态规则按优先级从高到低命中第一条，同一规则内已配置条件必须同时满足；普通预约未命中特殊规则时自动核准，`defaultWorkflowVersion` 只用于规则集版本追踪，不会隐式令全部普通预约进入审批。
- 节点支持角色、部门及子孙部门、公司和有效代理范围；自审按规则阻断。
- 长期系列按系列规则处理，不能把单条状态误当整个系列审批完成。
- 审批、批量审批和驳回记录历史与审计。
- 取消和异常释放联动剩余时段、部门额度、未完成服务和门禁授权，旧排期版本任务失效。

## 8. 涉密控制设计

- `meetingType=CONFIDENTIAL` 与 `confidentialityChoice=CONFIDENTIAL` 必须一致。
- 申请人和全部参会人必须在涉密白名单内，否则拒绝提交。
- 重建访问授权时保留申请人、参会人和保密管理员权限，并记录授权人和时间。
- 无权限用户只看到资源占用，不看到真实用途、人员、会务、签到和审批信息；人员 ID 及涉密人员冲突投影也从不可见读模型移除。
- 通知、报表和助手回答中的涉密用途统一显示为“涉密会议”。
- 涉密直接写操作通过 `assertConfidentialOperation` 复用 `canReadConfidentialBooking` 的专用读取授权；系统管理员角色本身不是放行条件。具体涉密工单/巡查的责任人履约是唯一最小权限例外，只开放服务执行必需信息，不因此获得完整预约读取或其他涉密写操作权限。
- 参会变更授权可针对 `PENDING` 或 `APPROVED` 涉密预约签发；`ATTENDEE_CHANGE` 为一次授权，匹配变更成功后写入 `usedAt` 并重新进入审批。`DECLASSIFY` 仍要求两名不同授权人，申请人自授权被阻断。
- 白名单和变更授权只能在正式保密管理页面操作，助手只提供指南和导航。

## 9. 会务服务与工单设计

- 服务需求按类型去重，字段值、备注长度和必填条件在提交时校验。
- `freezeServiceRequirements` 冻结目录项 ID、版本、名称、字段模板、负责角色、SLA、重服务和可取消属性。
- 后续目录变更不悄然改写历史预约；修改草案跨刷新恢复时也保留历史目录快照。
- 工单由核准预约、服务目录和排期版本驱动；状态变化保留处理记录。资源派单依次按显式资源、公司、楼栋匹配责任区，最终兜底 `area-default`；该区只包含未进入自定义责任区的会议室。
- 服务角色包括系统管理员、审批管理员、服务协调、前台以及实际自定义工单负责角色。
- 工单完成可经助手卡片确认，但 `/api/agent/action` 仍检查负责角色和当前状态；涉密工单责任人只能完成该具体工单，不能借此读取完整预约。
- 服务成本、备料数量和状态进入正式运营报表。涉密工单与巡查按具体责任范围开放，工作区继续通过脱敏预约隐藏主题、人员、联系人和非履约必需字段；申请人补录、无关会务角色及其他涉密写操作仍按原专用授权校验。

## 10. 签到、使用事实与异常设计

- 申请人和参会人的签到及使用确认窗口均为 `startTime - 15min <= now < endTime`；仅 `APPROVED` 预约可确认使用，计划结束后不能补做。
- 使用确认选择 `UNUSED` 时必须填写说明，并调用 `assertCancellationAuthorized` 复用取消授权，不能借确认未使用绕过取消权限。
- 签到事件支持签到和撤销，按人员保留当前有效事件。
- 实际使用事实独立保存实际开始、结束、时长和来源，预约冗余字段用于展示但以对账事实为准。
- `completeBookingNormally` 只处理已签到、仍为 `APPROVED` 且已到计划结束的预约，将状态设为 `COMPLETED`，清除提前结束标记，并把 `actualEndTime` 和 `accessRevokedAt` 设为计划 `endTime`；SYSTEM 使用事实与提前结束、no-show 分开记录。
- 提前结束按实际操作时间记录实际结束并计算与计划结束的差异；no-show 按当前排期版本自动释放。
- 签到、使用确认、人工释放、使用申诉创建/处理和提前结束等涉密直接写路径均执行涉密操作守卫；工单与巡查使用具体责任范围的最小履约权限，不扩展为完整预约读取权。
- 取消、驳回、未签到释放、确认未使用、提前结束和正常使用在报表中分别归类。
- 只有本人 `CANCELLED` 且 `releaseType` 为 `NO_SHOW`、`MANUAL_EXCEPTION` 或 `UNUSED_CONFIRMED` 的预约可以申诉，主动取消的 `CANCELLED` 释放类型不可申诉；人工异常释放和申诉处理只能由授权角色在正式流程执行，并保留原因、通知和审计。
- 恢复前重检结束时间、资源状态、资源与申请人冲突、部门额度和涉密白名单，递增 `scheduleVersion` 并重建访问授权。原冻结审批流程为空才恢复 `APPROVED` 并重建工单、使用事实及预约任务；流程非空则恢复 `PENDING`、回到首节点、清空旧审批历史并只重建审批任务，核准前不提前创建新工单、提醒或 no-show。

## 11. 报表与导出设计

`buildOperationsReport` 的流程：

1. 校验统计开始和结束时间。
2. 按 actor 过滤可读预约，再取与统计范围相交的预约。
3. 关联当前排期版本的工单、签到事件和独立使用事实。
4. 计算计划分钟、实际分钟、签到、提前结束、no-show、服务和差异说明。
5. 生成整体、资源、部门、楼栋楼层、资源类型、会议室类型、时段、服务和使用维度。
6. 在同一 `OperationsReport` 中返回汇总、图表数据、预约明细和备料统计。

关键口径：

- 跨范围时长裁剪到统计边界，容量按每日开放区间计算。
- 平均审批时长只统计已完成最终审批的申请。
- 计划/实际趋势按会议本地开始日期归集，总计使用整体汇总值。
- `get_usage_stats` 是助手简化聚合，不替代正式报表。
- 正常完成在使用维度归类为“正常使用”，对账一致时显示“一致”；提前结束、未签到释放、确认未使用、已取消和待确认使用分别归类。
- 对账还区分“未到使用结算”“待结算”“事实异常”“使用事实缺口”“签到事实缺口”“提前结束”“无需使用事实”“待确认实际使用”“未签到释放”等状态，不用单一完成状态覆盖使用事实差异。
- CSV/XLSX 导出必须带页面 `report.revision`，缺失或非法返回 `400 REPORT_REVISION_REQUIRED`，快照变化返回 `409 REPORT_SNAPSHOT_CHANGED`；导出文件对 `= + - @` 等公式前缀进行电子表格注入防护。

## 12. 智能助手详细设计

### 12.1 工具循环

- DeepSeek `deepseek-chat`，最多 6 轮工具调用、20 条历史消息、单条输入 4000 字符。
- `/api/agent/chat` 使用 SSE，15 秒 heartbeat；`/api/agent/status` 返回模型和流式能力状态。
- DeepSeek 默认超时为 60 秒，可由调用选项或环境配置调整；`withLlmRequest` 组合内部 `AbortController`、外部 signal 和定时器。流式请求 abort 时执行 `reader.cancel()`，`server/agent.ts` 监听 `req.aborted` 和 `res.close`，把客户端断开传播到 Agent 和上游调用。
- 具体资源、时间、人员、预约、审批、工单和统计必须先调用工具，不依赖模型记忆作答。
- 总部 3D 的楼栋、楼层、房间、部门、使用人、面积、维护、映射和处置查询必须调用 `query_hq3d_spaces`。工具仅在实际执行时动态导入 `server/hq3d.ts` 并读取 `getHq3dSnapshot()`；以 `profiles` 覆盖后的当前房间资料为准，无过滤只返回楼栋/楼层概览，房间结果默认 12 间、上限 20 间，最近维护摘要最多 3 条。
- 新预约要求明确用途和正整数人数，不自动编造参会人，不用“会议/开会”替代真实用途。
- 未匹配或同名歧义参会人明确报错，不静默丢弃。

### 12.2 当前工具清单

| 类别 | 工具 |
|---|---|
| 帮助与导航 | `search_help`、`navigate_system` |
| 资源查询 | `list_resources`、`find_available_resources`、`get_resource_calendar` |
| 总部3D查询 | `query_hq3d_spaces` |
| 个人查询 | `list_my_bookings`、`get_my_todos` |
| 流程查询 | `get_pending_approvals` |
| 会务查询 | `get_work_orders` |
| 简化统计 | `get_usage_stats` |
| 表单草案 | `propose_booking`、`propose_edit_booking`、`propose_renew_booking` |
| 确认动作 | `propose_cancel`、`propose_approval`、`propose_check_in`、`propose_complete_work_order` |

工具集按角色、审批节点/代理和实际工单职责裁剪，模型不能通过提示词取得额外工具。

### 12.3 固定动作

| 动作 | 前端行为 | 是否直接写业务 |
|---|---|---|
| `PROPOSE_BOOKING` | 打开新建正式表单并预填 | 否 |
| `PROPOSE_EDIT_BOOKING` | 打开修改正式表单并保留历史服务快照 | 否 |
| `PROPOSE_RENEW_BOOKING` | 打开长期续期正式表单 | 否 |
| `PROPOSE_CANCEL` | 用户确认后调用固定动作 API | 是，服务端重检 |
| `PROPOSE_APPROVAL` | 用户确认后执行审批/驳回 | 是，服务端重检 |
| `PROPOSE_CHECK_IN` | 用户确认后执行签到 | 是，服务端重检 |
| `PROPOSE_WORK_ORDER` | 用户确认后完成工单 | 是，服务端重检 |
| `OPEN_HELP` | 打开指定且当前角色可见的指南 | 否 |
| `NAVIGATE` | 打开固定且当前角色可见的视图；可选 `hq3d` 仅携带楼栋、楼层和房间 UID，由 App 构造同源地址并定位完整总部3D | 否 |
| `REFRESH` | 重新加载工作区和运营报表 | 否 |

### 12.4 会话持久化与清洗

`server/chatConversations.ts` 对 turns、handled、input 和 actions 进行白名单清洗：

- 只接受固定动作类型和固定 `SystemView`。
- 草案只保留允许的预约、服务和人员字段。
- 服务目录快照只保留目录版本、名称、字段模板、负责角色、SLA、重服务和可取消属性。
- 保留取消原因、帮助主题 ID 等明确字段，不持久化任意对象。
- `NAVIGATE.hq3d` 只允许在 `HQ_3D` 视图中携带非空 `buildingId`、可选 1—200 的整数 `floorNo` 和可选非空 `roomUid`；URL 和其他额外字段会被剔除，非法目标拒绝保存。
- 刷新或服务重启只恢复对话、草案和定位卡片，不自动提交或执行动作。

## 13. 异步任务、集成与审计

- Node 启动 Job Worker，`reconcileJobs` 补齐提醒、审批升级/关闭、会前提醒、签到提醒、`BOOKING_COMPLETION`、no-show、服务 SLA 和巡查任务。
- 正常完成任务 key 为 `completion:<bookingId>:v<scheduleVersion>`，只处理已到计划结束、仍为 `APPROVED` 且已签到的预约；事务状态重检、确定性通知 ID 和版本检查共同保证幂等，旧排期版本任务安全失效。
- 任务和 Outbox 使用 `FOR UPDATE SKIP LOCKED`、worker 租约、过期恢复和指数退避。
- 执行前重查当前预约状态、审批节点和排期版本，避免旧任务修改新排期。
- 通知和外部事件使用确定性 key 去重，失败进入可观测的重试或死信状态。
- 核心事务不直接依赖远端平台可用性；OA、消息、日历和门禁通过 Outbox/回调解耦。
- 补偿、重放、组织同步 apply 和回调处理有独立权限、幂等与审计边界。
- 外部适配器默认关闭，Fake 端点测试不代表真实企业平台联调完成。

## 14. 事务、并发与失败处理

- 预约、审批、取消、签到、服务和集成事实在同一领域事务中维护聚合、投影、任务、通知、Outbox 和审计。
- 冲突、额度、状态和权限在提交时重检，不能仅依赖打开表单时的查询结果。
- 会话和核心快照使用版本控制；过期客户端收到冲突，不覆盖新版本。
- 前端刷新失败后保留可见错误，不能把部分成功显示为全部刷新成功。
- 普通 `mutateDb` 比较变更前后集合、预约和通知内容，仅写实际变化行或集合；`replaceBookings` 仍先删除再全量重建预约投影，不能将其误当作增量路径。
- 通知列表直接查询 `notifications` 关系表并按当前用户或 `sys` 路由过滤；定向通知使用原 `is_read`，广播通过 `notification_read_states(notification_id,user_id)` 计算当前用户已读状态。标记已读保留 `GET_LOCK('smart_office_write', 10)` 和事务，定向通知只更新本人行，广播使用幂等 `INSERT IGNORE`，但不读取或推进核心快照 revision，也不写重复 Outbox。迁移 `017_notification_read_path.sql` 增加 `(user_id, timestamp, id)` 索引；`018_notification_read_states.sql` 建立广播按用户已读表，并被列为必需迁移。
- native restore 在启动 `mysql` 前验证非空 SQL、`${inputPath}.sha256`、侧车内原始文件名与实际 SHA-256；恢复命令还要求 `SMART_OFFICE_RESTORE_CONFIRM === DATABASE_NAME`，显式确认覆盖目标库。
- 数据库没有自动 down migration；应用回滚与数据库恢复分开处理，旧应用不得直接承接不兼容新库写入。

## 15. 测试设计与同步门禁

- Node 单测覆盖预约规则、助手工具、角色裁剪、状态机和报表口径。
- 隔离 MySQL 集成测试覆盖真实 Node、事务、OIDC Fake、外部 Fake 和恢复。
- Chrome E2E 覆盖帮助角色过滤、智能帮助、焦点恢复、修改草案跨刷新、历史会务快照、动态规则桌面新增/编辑/发布/删除及移动端草稿重置，以及“只打开正式表单不落库”。
- 浏览器和集成写测试必须显式启用 `SMART_OFFICE_TEST_MYSQL=true`，且数据库名以 `smart_office_test_` 开头。
- 每次功能变化同步架构、详细设计、用户手册、`helpCatalog.ts`、帮助抽屉、助手工具/提示词/动作及对应测试。
- 本地工程证据不替代正式 P9-03、企业安全、真实 OA/日历/门禁联调、生产恢复及责任方签认、UAT、培训、灰度和稳定观察。
- 真机、真实中文 IME、读屏、企业浏览器和低端设备能耗需要外部现场验收，本地 Chrome、移动视口模拟和自动化测试不能替代。
