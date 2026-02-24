# Supabase 配置指南

本文档说明如何将智慧办公空间管理系统连接到 Supabase 后端数据库。

## 📋 前置要求

1. 一个 Supabase 账户（免费版即可）
2. 已创建的 Supabase 项目

## 🚀 快速开始

### 1. 创建 Supabase 项目

1. 访问 [Supabase Dashboard](https://app.supabase.com)
2. 点击 "New Project"
3. 填写项目名称和密码
4. 选择最近的区域（如 Singapore）
5. 等待项目创建完成

### 2. 获取连接信息

在项目设置中找到以下信息：

- **Project URL**: `https://<project-ref>.supabase.co`
- **Anon Key**: 在 Settings > API > Project API keys 中找到 `anon` key

### 3. 配置环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. 创建数据库表

在 Supabase SQL Editor 中执行 `supabase/schema.sql` 文件中的所有 SQL 语句：

1. 打开 Supabase Dashboard
2. 进入 SQL Editor
3. 点击 "New query"
4. 复制 `supabase/schema.sql` 的内容
5. 点击 "Run"

### 5. 启用实时订阅

在 Database > Replication 中启用以下表的实时订阅：

- `bookings`
- `resources`

### 6. 配置 Row Level Security (RLS)

为了安全起见，建议启用 RLS 并配置适当的策略。以下是基本策略：

```sql
-- 用户表策略
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on users" ON users
  FOR ALL USING (true) WITH CHECK (true);

-- 资源表策略
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on resources" ON resources
  FOR ALL USING (true) WITH CHECK (true);

-- 预约表策略
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on bookings" ON bookings
  FOR ALL USING (true) WITH CHECK (true);

-- 角色表策略
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on roles" ON roles
  FOR ALL USING (true) WITH CHECK (true);

-- 部门表策略
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on departments" ON departments
  FOR ALL USING (true) WITH CHECK (true);

-- 工作流表策略
ALTER TABLE workflow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on workflow" ON workflow
  FOR ALL USING (true) WITH CHECK (true);
```

## 📊 数据库表结构

### users（用户表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | TEXT | 用户姓名 |
| email | TEXT | 邮箱（唯一） |
| role | TEXT[] | 角色数组 |
| department | TEXT | 所属部门 |
| landline | TEXT | 座机号码 |
| mobile | TEXT | 手机号码 |

### resources（资源表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | TEXT | 资源名称 |
| type | TEXT | ROOM/DESK |
| capacity | INTEGER | 容量 |
| location | TEXT | 位置 |
| features | TEXT[] | 特性列表 |
| status | TEXT | 状态 |

### bookings（预约表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| user_id | UUID | 用户ID（外键） |
| resource_id | UUID | 资源ID（外键） |
| type | TEXT | ROOM/DESK |
| start_time | TIMESTAMPTZ | 开始时间 |
| end_time | TIMESTAMPTZ | 结束时间 |
| status | TEXT | 预约状态 |
| purpose | TEXT | 用途 |
| participants | INTEGER | 参与人数 |
| has_leader | BOOLEAN | 是否有领导 |
| is_video_conference | BOOLEAN | 视频会议 |
| needs_tea_service | BOOLEAN | 茶水服务 |

## 🔧 离线支持

应用已实现离线缓存功能：

1. 当网络不可用时，自动切换到本地缓存数据
2. 所有操作会保存在本地，等待网络恢复后同步
3. 实时订阅会在网络恢复后自动重新连接

## 📝 注意事项

1. **免费套餐限制**：Supabase 免费版有数据库大小和 API 调用次数限制
2. **实时订阅**：免费版同时连接数有限制
3. **数据备份**：建议定期导出数据备份
4. **安全性**：生产环境请配置更严格的 RLS 策略

## 🐛 故障排除

### 连接失败
- 检查环境变量是否正确配置
- 确认 Supabase 项目是否正常运行
- 检查网络连接

### 数据不更新
- 检查实时订阅是否启用
- 确认表是否启用了 REPLICA IDENTITY FULL

### 权限错误
- 检查 RLS 策略是否正确配置
- 确认使用的 anon key 是否正确

## 📚 相关文档

- [Supabase 官方文档](https://supabase.com/docs)
- [Supabase JavaScript 客户端](https://supabase.com/docs/reference/javascript)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
