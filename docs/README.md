# 智慧办公空间管理系统 (SmartOffice)

<div align="center">

![SmartOffice Logo](https://img.shields.io/badge/SmartOffice-智慧办公-blue?style=for-the-badge)

**数字化办公资源管理平台 | 智能预约 | 多级审批 | 实时监控**

</div>

## 📋 项目简介

智慧办公空间管理系统（SmartOffice）是一款面向现代化企业的综合办公资源管理平台。系统集成了会议室预订、工位申请、多级审批流程、组织架构管理、基于角色的权限控制以及会议室实时监控大屏等功能。

### ✨ 核心特性

- 🏢 **空间资源管理** - 会议室、工位等资源的数字化管理
- 📅 **智能预约系统** - 支持单次和周期性重复预约
- ✅ **多级审批流程** - 可自定义的审批工作流
- 🤖 **AI 智能推荐** - 基于 Gemini 模型的会议室推荐
- 📊 **实时监控大屏** - 会议室使用情况的实时可视化
- 🔔 **实时数据推送** - Supabase Realtime 实时同步
- 📱 **响应式设计** - 支持桌面和移动端访问

## 🚀 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn
- Supabase 账号
- Gemini API Key（可选，用于 AI 推荐）

### 安装步骤

1. **克隆项目并安装依赖**
   ```bash
   npm install
   ```

2. **配置环境变量**
   ```bash
   cp .env.example .env
   ```
   编辑 `.env` 文件，填写以下配置：
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_GEMINI_API_KEY=your_gemini_api_key
   ```

3. **初始化数据库**
   - 在 Supabase SQL Editor 中执行 `supabase/schema.sql`
   - 启用 Realtime 订阅（bookings 和 resources 表）

4. **启动开发服务器**
   ```bash
   npm run dev
   ```

5. **访问监控大屏**（可选）
   ```bash
   # 监控大屏独立入口
   http://localhost:5173/monitor.html
   ```

## 📚 文档目录

| 文档 | 说明 |
|------|------|
| [REQUIREMENTS.md](./REQUIREMENTS.md) | 功能需求说明书 |
| [SYSTEM_DOCS.md](./SYSTEM_DOCS.md) | 系统架构与技术文档 |
| [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) | Supabase 配置指南 |

## 🏗️ 技术栈

- **前端**: React 18 + TypeScript + Vite
- **UI 框架**: Tailwind CSS + Lucide Icons
- **后端**: Supabase (PostgreSQL + Realtime)
- **AI 服务**: Google Gemini API
- **构建工具**: Vite

## 🔐 默认角色

| 角色 | 权限范围 |
|------|----------|
| SYSTEM_ADMIN | 全部权限 |
| APPROVAL_ADMIN | 审批中心、预订管理、个人中心 |
| MEETING_SERVICE | 会议室管理、预订查看、个人中心 |
| EMPLOYEE | 资源查看、预订、个人中心 |

## 📄 许可证

MIT License

---

*最后更新: 2025年3月*
