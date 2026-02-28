<div align="center">
<img width="1200" height="475" alt="SmartOffice Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 智慧办公空间管理系统 (SmartOffice)

## 项目简介

SmartOffice 是一款面向现代化企业的智慧办公空间管理平台，提供会议室预订、工位申请、审批流程、资源管理等核心功能，并配备实时监控大屏。

## 功能特性

### 👥 用户与权限
- 多渠道登录（邮箱/手机）
- 基于角色的权限控制（RBAC）
- 强制首次登录修改密码

### 🏢 组织架构
- 部门树形结构管理
- CSV 批量导入
- 自动层级识别

### 📅 资源预订
- 会议室、工位等资源管理
- 在线预订申请
- 多级审批工作流
- 预订状态跟踪

### 📊 审批中心
- 待审批事项集中处理
- 批量审批操作
- 审批历史记录

### 📈 监控大屏（新增）
- 实时数据推送
- 时间格视图展示
- 状态颜色区分
- 周视图概览

## 技术栈

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite
- **UI 框架**: Tailwind CSS
- **后端服务**: Supabase (PostgreSQL + Realtime)
- **图标库**: Lucide React

## 快速开始

### 前置要求

- Node.js 18+
- npm 或 yarn

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
# 复制 .env.example 为 .env 并填写配置
cp .env.example .env

# 3. 启动开发服务器
npm run dev
```

### 环境变量

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_GEMINI_API_KEY=your-gemini-api-key
```

## 项目结构

```
smart-office/
├── src/
│   ├── components/       # React 组件
│   │   ├── mobile/      # 移动端组件
│   │   └── ...
│   ├── services/        # 服务层
│   │   ├── supabaseService.ts
│   │   └── realtimeService.ts
│   ├── hooks/           # 自定义 Hooks
│   ├── types/           # TypeScript 类型
│   ├── constants/       # 常量定义
│   └── permissions.ts    # 权限配置
├── docs/                # 文档
├── monitor.html         # 监控大屏入口
└── vite.config.ts       # Vite 配置
```

## 角色与权限

| 角色 | 说明 |
|------|------|
| 系统管理员 | 全部管理权限 |
| 审批负责人 | 审批管理权限 |
| 会议服务 | 会议室管理权限 |
| 普通员工 | 基本使用权限 |

## 监控大屏

访问 `/monitor.html` 查看会议室实时监控大屏：

- 🟢 **进行中** - 会议正在进行
- 🟢 **即将开始** - 会议即将开始
- ⚫ **已结束** - 会议已结束（半透明）
- 🟡 **待审批** - 等待审批
- ⬛ **空闲** - 无预订

## 文档

- [系统文档](./docs/SYSTEM_DOCS.md) - 详细功能说明
- [部署指南](./docs/DEPLOYMENT.md) - 部署配置
- [Supabase 配置](./docs/SUPABASE_SETUP.md) - 数据库设置

## License

MIT
