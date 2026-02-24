# Mobile 组件目录结构

## 目录规划

```
components/mobile/
├── common/           # 通用组件
│   ├── index.ts
│   ├── MobileAdminPage.tsx    # 管理页面通用布局
│   ├── StatusBadge.tsx        # 状态标签
│   ├── RoleTag.tsx            # 角色标签
│   ├── BottomNav.tsx          # 底部导航
│   └── MobileStatCard.tsx     # 统计卡片
├── views/            # 页面视图组件
│   ├── index.ts
│   ├── LoginView.tsx          # 登录页面
│   ├── DashboardView.tsx      # 首页仪表板
│   ├── ResourcesView.tsx      # 资源列表
│   ├── BookingsView.tsx       # 预约管理
│   ├── ApprovalView.tsx       # 审批中心
│   └── ProfileView.tsx        # 个人中心
├── management/       # 管理功能模块
│   ├── index.ts
│   ├── UserManagement.tsx     # 成员管理
│   ├── RoleManagement.tsx     # 角色管理
│   ├── DepartmentManagement.tsx # 部门管理
│   └── WorkflowManagement.tsx   # 流程配置
└── modals/           # 弹窗组件
    ├── index.ts
    ├── BookingModal.tsx       # 预约弹窗
    ├── QRScannerModal.tsx     # 扫码弹窗
    └── ConflictModal.tsx      # 冲突提示
```

## 拆分建议

### 第一阶段：提取通用组件
1. MobileAdminPage - 管理页面通用布局
2. StatusBadge - 状态标签
3. RoleTag - 角色标签
4. BottomNav - 底部导航

### 第二阶段：提取管理模块
1. UserManagement - 成员管理（已完成示例）
2. RoleManagement - 角色管理
3. DepartmentManagement - 部门管理
4. WorkflowManagement - 流程配置

### 第三阶段：提取视图组件
1. LoginView - 登录页面
2. DashboardView - 首页仪表板
3. ResourcesView - 资源列表
4. BookingsView - 预约管理
5. ApprovalView - 审批中心
6. ProfileView - 个人中心

### 第四阶段：提取弹窗组件
1. BookingModal - 预约表单弹窗
2. QRScannerModal - 扫码签到弹窗
3. ConflictModal - 预约冲突弹窗

## 使用方式

```tsx
// 在 AppMobile.tsx 中导入
import { UserManagement } from './components/mobile/management';
import { MobileAdminPage, StatusBadge } from './components/mobile/common';
```
