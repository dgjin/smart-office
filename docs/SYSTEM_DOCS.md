# 智慧办公空间管理系统 (SmartOffice) - 系统文档

## 1. 系统概述

智慧办公空间管理系统（SmartOffice）是一款面向现代化企业的物理资源管理平台。系统集成了会议室预订、工位申请、多级审批流程自定义、组织架构管理、基于角色的权限控制以及会议室实时监控大屏。

### 1.1 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   React 18  │  │  TypeScript │  │     Tailwind CSS    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │    Vite     │  │ Lucide Icons│  │   Responsive Design │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      服务层                                  │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │  Supabase Client│  │      Realtime Service           │  │
│  │                 │  │  - 实时数据推送                  │  │
│  │  - 数据库操作    │  │  - 断线重连机制                  │  │
│  │  - 用户认证      │  │  - 轮询备选方案                  │  │
│  │  - 数据订阅      │  │  - 增量更新计算                  │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │Recommendation   │  │      Gemini Service             │  │
│  │    Service      │  │  - AI 智能推荐                   │  │
│  │  - 多维度评分    │  │  - 自然语言处理                  │  │
│  │  - 权重配置      │  │  - 推荐理由生成                  │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      数据层                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Supabase (PostgreSQL)                   │   │
│  │  - 用户表 (smartoffice_users)                        │   │
│  │  - 资源表 (smartoffice_resources)                    │   │
│  │  - 预订表 (smartoffice_bookings)                     │   │
│  │  - 角色表 (smartoffice_roles)                        │   │
│  │  - 部门表 (smartoffice_departments)                  │   │
│  │  - 工作流表 (smartoffice_workflow)                   │   │
│  │  - 审计表 (smartoffice_approval_audit)               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 18.x |
| 开发语言 | TypeScript | 5.x |
| 构建工具 | Vite | 5.x |
| UI 框架 | Tailwind CSS | 3.x |
| 图标库 | Lucide React | 最新 |
| 后端服务 | Supabase | 最新 |
| AI 服务 | Google Gemini | 3 Flash |

---

## 2. 用户角色与权限

### 2.1 角色定义

系统采用基于角色的访问控制（RBAC），支持以下四种角色：

| 角色 | 说明 | 权限范围 |
|------|------|----------|
| **系统管理员** (SYSTEM_ADMIN) | 拥有全系统最高管理权限 | 全部权限 |
| **审批负责人** (APPROVAL_ADMIN) | 负责各类资源申请的业务审核 | 审批中心、预订管理、个人中心 |
| **会议服务** (MEETING_SERVICE) | 负责会议室服务管理 | 会议室管理、预订查看、个人中心 |
| **普通员工** (EMPLOYEE) | 基本使用权限 | 资源查看、预订、个人中心 |

### 2.2 权限列表

```typescript
const PERMISSIONS = {
  // 基础视图权限
  VIEW_DASHBOARD: '查看仪表盘',
  VIEW_RESOURCES: '查看资源',
  VIEW_MEETING_SERVICE: '查看会议服务',
  VIEW_APPROVAL_CENTER: '查看审批中心',
  VIEW_PROFILE: '查看个人中心',

  // 管理权限
  VIEW_BOOKINGS: '查看预订',
  EDIT_PROFILE: '编辑个人资料',
  MANAGE_USERS: '用户管理',
  MANAGE_ROLES: '角色管理',
  MANAGE_DEPARTMENTS: '部门管理',
  MANAGE_RESOURCES: '资源管理',
  CONFIG_WORKFLOW: '工作流配置',
  ACCESS_DATA_CENTER: '数据中心',
  CONFIGURE_RECOMMENDATION: '推荐配置',

  // 高级权限
  VIEW_ALL_BOOKINGS: '查看所有预订',
  APPROVE_BOOKINGS: '审批预订',
  VIEW_ALL_USERS: '查看所有用户',
  EDIT_ALL_USERS: '编辑所有用户',
};
```

### 2.3 权限检查

```typescript
// 使用 usePermissions Hook
const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();

// 检查单个权限
if (hasPermission(PERMISSIONS.MANAGE_RESOURCES)) {
  // 显示资源管理按钮
}

// 检查多个权限（满足其一）
if (hasAnyPermission([PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_RESOURCES])) {
  // 显示管理菜单
}
```

---

## 3. 功能模块详解

### 3.1 用户认证与登录

#### 3.1.1 登录方式
- **企业邮箱登录**: 邮箱 + 密码
- **手机号登录**: 手机号 + 密码
- **密码加密**: SHA-256 哈希存储

#### 3.1.2 会话管理
```typescript
// 登录状态存储
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Token 自动刷新
- Supabase 自动处理 token 刷新
- 会话持久化到 localStorage
```

### 3.2 组织架构管理

#### 3.2.1 部门管理
- 树形结构展示
- 无限层级支持
- 父子关系维护

#### 3.2.2 批量导入
```typescript
// CSV 格式示例
name,parent_name
技术部,
前端组,技术部
后端组,技术部
```

### 3.3 资源管理

#### 3.3.1 资源类型
```typescript
type ResourceType = 'ROOM' | 'DESK';
type ResourceStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'PENDING';
```

#### 3.3.2 资源属性
| 属性 | 类型 | 说明 |
|------|------|------|
| id | string | UUID |
| name | string | 资源名称 |
| type | ResourceType | ROOM/DESK |
| capacity | number | 容量 |
| location | string | 位置 |
| features | string[] | 设施列表 |
| status | ResourceStatus | 状态 |

### 3.4 预订系统

#### 3.4.1 预订状态
```typescript
type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';
```

#### 3.4.2 预订申请
- 选择资源类型和具体资源
- 选择日期和时间段
- 填写参会人数和用途
- 选择附加服务

#### 3.4.3 周期性预约
```typescript
interface RecurringConfig {
  frequency: 'daily' | 'weekly' | 'monthly';
  count: number; // 1-10
  interval: number; // 间隔
}
```

### 3.5 审批中心

#### 3.5.1 审批流程
1. 用户提交预约
2. 系统创建工作流实例
3. 按节点顺序流转审批
4. 最终状态确定

#### 3.5.2 审批操作
```typescript
// 审批通过/拒绝
await approveBooking(
  bookingId: string,
  approverId: string,
  approverName: string,
  expectedNodeIndex: number,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string
);
```

### 3.6 AI 推荐系统

#### 3.6.1 推荐算法
```typescript
interface RecommendationConfig {
  capacityWeight: number;      // 容量权重 0.3
  featureWeight: number;       // 设施权重 0.25
  historyWeight: number;       // 历史权重 0.25
  availabilityWeight: number;  // 可用性权重 0.2
}
```

#### 3.6.2 评分计算
```typescript
// 综合评分 = 容量分×0.3 + 设施分×0.25 + 历史分×0.25 + 可用性分×0.2
const weightedScore = 
  (capacityScore * config.capacityWeight) +
  (featureScore * config.featureWeight) +
  (historyScore * config.historyWeight) +
  (availabilityScore * config.availabilityWeight);
```

#### 3.6.3 Gemini 智能推荐
```typescript
const recommendation = await getSmartRecommendation(
  purpose: string,      // 会议用途
  participants: number, // 参会人数
  availableResources: Resource[]
);
```

---

## 4. 实时监控大屏

### 4.1 访问方式

监控大屏可通过以下方式访问：
- 独立入口: `/monitor.html`
- 组件嵌入: `<MeetingRoomMonitor />`

### 4.2 技术实现

#### 4.2.1 实时数据推送
```typescript
// 创建实时服务
const realtimeService = createRealtimeService({
  onBookingsChange: (bookings, delta) => {
    // 处理预订数据变更
  },
  onResourcesChange: (resources, delta) => {
    // 处理资源数据变更
  },
  onConnectionChange: (status) => {
    // 处理连接状态变更
  },
});

// 建立连接
await realtimeService.connect();
```

#### 4.2.2 断线重连机制
- 最大重连次数: 5 次
- 重连延迟: 指数退避 (1s, 2s, 4s, 8s, 16s)
- 最大延迟: 30 秒

#### 4.2.3 轮询备选
- 间隔: 30 秒
- 当实时推送不可用时自动启用

### 4.3 时间格视图

#### 4.3.1 视图结构
- 横轴: 7:00-21:00 时间段
- 纵轴: 各会议室
- 单元格: 每小时一个单元格

#### 4.3.2 预订匹配算法
```typescript
// 精确的时间重叠检测
const matchHour = start.getTime() < hourEnd.getTime() && 
                  end.getTime() > hourStart.getTime();
```

### 4.4 状态颜色

| 状态 | 颜色 | 说明 |
|------|------|------|
| 进行中(已批准) | bg-green-600 | 会议正在进行 |
| 即将开始(已批准) | bg-green-400 | 会议将在近期开始 |
| 进行中(待审批) | bg-yellow-600 | 待审批的进行中会议 |
| 即将开始(待审批) | bg-yellow-400 | 待审批的即将开始会议 |
| 已结束 | bg-slate-500 | 会议已结束 |
| 空闲 | bg-slate-700 | 无预订 |

---

## 5. 数据转换

### 5.1 数据库字段映射

数据库使用 snake_case，应用使用 camelCase：

```typescript
// 预订数据转换
function transformBookingFromDB(dbBooking: any): Booking {
  return {
    id: dbBooking.id,
    userId: dbBooking.user_id,
    resourceId: dbBooking.resource_id,
    type: dbBooking.type,
    startTime: dbBooking.start_time,
    endTime: dbBooking.end_time,
    status: dbBooking.status,
    purpose: dbBooking.purpose,
    participants: dbBooking.participants,
    createdAt: dbBooking.created_at,
    currentNodeIndex: dbBooking.current_node_index || 0,
    approvalHistory: dbBooking.approval_history || [],
    hasLeader: dbBooking.has_leader,
    leaderDetails: dbBooking.leader_details,
    isVideoConference: dbBooking.is_video_conference,
    needsTeaService: dbBooking.needs_tea_service,
    needsNameCard: dbBooking.needs_name_card,
    nameCardDetails: dbBooking.name_card_details,
  };
}
```

### 5.2 时区处理

- 统一使用本地时区显示
- 日期比较使用 `getLocalDateStr()` 函数
- 时间比较使用完整时间戳

```typescript
// 获取本地日期字符串
const getLocalDateStr = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
```

---

## 6. 部署配置

### 6.1 环境变量

```env
# Supabase 配置
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Gemini API（可选）
VITE_GEMINI_API_KEY=your-gemini-api-key
```

### 6.2 构建配置

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

### 6.3 生产部署

```bash
# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

---

## 7. 常见问题

### Q1: 监控大屏不显示数据
- 检查 Supabase 连接是否正常
- 查看浏览器控制台日志
- 确认环境变量配置正确

### Q2: 实时推送不工作
- 确认已在 Supabase 控制台启用 Realtime
- 检查数据库表的 Replication 设置
- 查看网络连接状态

### Q3: 时间显示不正确
- 检查时区设置
- 确保使用本地时间而非 UTC
- 验证 `getLocalDateStr()` 函数实现

### Q4: AI 推荐不工作
- 检查 Gemini API Key 是否配置
- 确认网络可以访问 Google API
- 查看浏览器控制台错误信息

### Q5: 审批流程卡住
- 检查工作流配置是否正确
- 确认审批节点有对应的角色用户
- 查看审批历史记录

---

## 8. 开发规范

### 8.1 代码风格
- 使用 TypeScript 严格模式
- 组件使用函数式组件 + Hooks
- 类型定义集中放在 `types.ts`

### 8.2 命名规范
- 组件: PascalCase (e.g., `MeetingRoomMonitor`)
- 函数: camelCase (e.g., `getBookingsForDate`)
- 常量: UPPER_SNAKE_CASE (e.g., `PERMISSIONS`)
- 类型: PascalCase (e.g., `BookingStatus`)

### 8.3 文件组织
```
src/
├── components/       # React 组件
├── services/         # 服务层
├── hooks/            # 自定义 Hooks
├── types.ts          # 类型定义
├── permissions.ts    # 权限配置
└── constants.tsx     # 常量定义
```

---

*最后更新: 2025年3月*
