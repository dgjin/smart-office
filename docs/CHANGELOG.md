# 智慧办公空间管理系统 - 更新日志

## [1.4.0] - 2026-03-03

### 新增
- 实现会议室门口显示屏 WebSocket 实时推送功能
  - 创建 RoomDisplay 单会议室显示组件 (components/RoomDisplay.tsx)
  - 扩展 RealtimeService 支持单会议室订阅 (services/realtimeService.ts)
    - 新增 RoomDisplayService 类
    - 支持按 roomId 过滤订阅
    - 自动重连和轮询降级机制
  - 创建独立入口页面
    - room-display.html - 显示屏专用 HTML
    - room-display-main.tsx - 显示屏入口脚本
  - 配置 Vite 多入口构建支持
  - 创建数据库迁移脚本 (scripts/migrate-room-display.sql)
    - 启用 REPLICA IDENTITY FULL
    - 创建优化视图和函数
    - 添加数据库变更触发器

### 技术特点
- 基于 Supabase Realtime 实现 WebSocket 实时推送
- 支持 RoomID -> Connection 映射
- 数据库 Insert/Update 自动触发推送
- 30秒轮询作为备用方案
- 显示屏适配大字体、高对比度设计

### 访问方式
```
开发环境: http://localhost:3000/room-display.html?roomId=xxx
生产环境: /room-display.html?roomId=xxx
```

---

## [1.3.0] - 2026-03-03

### 新增
- 创建 Supabase 迁移至 MySQL 详细方案文档
  - 包含完整的数据库 Schema 转换脚本
  - 提供 MySQL 服务层实现代码
  - 包含数据迁移脚本和测试方案
  - 提供风险评估和回滚策略

---

## [1.2.0] - 2026-03-03

### 新增
- 实现日期选择限制功能，防止选择过去日期
  - 添加服务器时间获取工具函数 (utils/dateUtils.ts)
  - 数据库添加服务器时间函数 (scripts/migrate-database.sql)
  - 会议室预订表单添加日期限制 (RoomBookingFormModal.tsx)
  - 工位预订表单添加日期限制 (DeskBookingFormModal.tsx)

### 技术细节
- 使用服务器时间判断，避免客户端时间不准确问题
- 日期选择器禁用早于当前日期的选项
- 提供视觉反馈（灰色显示、不可点击状态）
- 表单提交前进行日期校验

---

## [1.1.0] - 2026-02-25

### 新增
- 创建系统架构图 (docs/system-architecture.svg)
  - 展示系统整体架构
  - 包含数据流向和模块关系

---

## [1.0.0] - 2026-02-20

### 初始版本
- 智慧办公空间管理系统基础功能
  - 会议室预订管理
  - 工位预订管理
  - 用户管理和权限控制
  - 审批流程管理
  - 长期预订支持（按天/按周）
  - 实时数据同步

### 技术栈
- React 18 + TypeScript
- Vite 构建工具
- Tailwind CSS 样式框架
- Supabase 后端服务
- date-fns 日期处理
