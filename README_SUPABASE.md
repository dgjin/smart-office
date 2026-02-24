# SmartOffice 移动端 + Supabase 集成完成

## ✅ 已完成的功能

### 1. 移动端重构
- 全新的移动端 UI 设计
- 底部导航栏（首页、资源、我的申请、审批、个人中心）
- 触摸优化和手势支持
- 适配刘海屏/灵动岛
- 离线模式支持

### 2. Supabase 集成
- 完整的 CRUD 操作封装
- 实时数据订阅（Real-time）
- 离线缓存和自动恢复
- 网络状态监测

### 3. 数据库表结构
- `users` - 用户表
- `resources` - 资源表（会议室/工位）
- `bookings` - 预约表
- `roles` - 角色表
- `departments` - 部门表
- `workflow` - 审批流程表

## 📁 新增/修改的文件

```
smart-office/
├── services/
│   └── supabaseService.ts      # Supabase 服务层
├── supabase/
│   └── schema.sql              # 数据库表结构
├── .env.example                # 环境变量模板
├── SUPABASE_SETUP.md           # Supabase 配置指南
├── AppMobile.tsx               # 移动端主应用（已更新）
└── index.tsx                   # 入口文件（已更新）
```

## 🚀 快速开始

### 1. 配置 Supabase

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入你的 Supabase 配置
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 2. 创建数据库表

1. 登录 [Supabase Dashboard](https://app.supabase.com)
2. 进入 SQL Editor
3. 复制 `supabase/schema.sql` 的内容
4. 执行 SQL 语句

### 3. 启用实时订阅

在 Database > Replication 中启用：
- `bookings` 表
- `resources` 表

### 4. 运行应用

```bash
npm run dev
```

## 📱 移动端特性

### 页面结构
1. **首页 (Dashboard)**
   - 用户信息展示
   - 快捷操作（预订会议室/申请工位）
   - 统计数据卡片
   - 最近预约预览

2. **资源列表 (Resources)**
   - 会议室和工位卡片展示
   - 搜索功能
   - 一键预约

3. **我的申请 (Bookings)**
   - 可折叠的预约卡片
   - 状态标签
   - 撤销申请

4. **审批中心 (Approval Center)**
   - 待审批列表
   - 一键通过/驳回
   - 审批历史

5. **个人中心 (Profile)**
   - 用户信息
   - 系统管理入口（管理员）
   - 主题切换

### 交互优化
- 触摸反馈动画
- 下拉刷新预留
- Toast 通知
- 加载状态
- 离线提示

## 🔌 Supabase 功能

### 实时同步
- 预约数据实时更新
- 资源状态实时同步
- 多用户协作支持

### 离线支持
- 自动检测网络状态
- 本地数据缓存
- 离线模式提示
- 网络恢复后自动同步

### 数据操作
```typescript
// 获取数据
const users = await getUsers();
const resources = await getResources();
const bookings = await getBookings();

// 创建数据
const newBooking = await createBooking(bookingData);

// 更新数据
const updated = await updateBooking(id, updates);

// 删除数据
await deleteBooking(id);

// 实时订阅
subscribeToBookings((bookings) => {
  setBookings(bookings);
});
```

## 🔧 开发说明

### 环境变量
| 变量名 | 说明 | 必需 |
|--------|------|------|
| VITE_SUPABASE_URL | Supabase 项目 URL | ✅ |
| VITE_SUPABASE_ANON_KEY | Supabase Anon Key | ✅ |
| VITE_GEMINI_API_KEY | Gemini API Key | ❌ |

### 数据流
1. 应用启动时从 Supabase 加载数据
2. 建立实时订阅监听数据变化
3. 用户操作通过 Supabase API 执行
4. 离线时自动切换到本地缓存

## 📝 注意事项

1. **Supabase 免费版限制**
   - 数据库大小：500MB
   - API 调用：无限（但有速率限制）
   - 实时连接：200 个并发

2. **安全性**
   - 生产环境建议启用 RLS
   - 配置适当的访问策略
   - 不要将 `.env` 提交到 Git

3. **性能优化**
   - 使用索引加速查询
   - 合理分页加载数据
   - 图片等资源使用 CDN

## 🐛 故障排除

### 连接失败
```
检查 .env 文件配置
确认 Supabase 项目状态
检查网络连接
```

### 数据不更新
```
检查实时订阅是否启用
确认表是否启用 REPLICA IDENTITY FULL
查看浏览器控制台错误信息
```

### 权限错误
```
检查 RLS 策略配置
确认使用的 anon key 正确
验证表权限设置
```

## 📚 相关链接

- [Supabase 文档](https://supabase.com/docs)
- [Supabase JS 客户端](https://supabase.com/docs/reference/javascript)
- [Vite 环境变量](https://vitejs.dev/guide/env-and-mode.html)
