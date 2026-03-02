# Supabase 配置指南

本文档详细说明如何将智慧办公空间管理系统连接到 Supabase 后端数据库。

## 📋 前置要求

1. 一个 Supabase 账户（[免费注册](https://supabase.com)）
2. 已创建的 Supabase 项目
3. Node.js 18+ 环境

---

## 🚀 快速开始

### 1. 创建 Supabase 项目

1. 访问 [Supabase Dashboard](https://app.supabase.com)
2. 点击 "New Project"
3. 填写项目名称和密码
4. 选择最近的区域（推荐 Singapore 或 Tokyo）
5. 等待项目创建完成（约 1-2 分钟）

### 2. 获取连接信息

在项目设置中找到以下信息：

1. 进入 **Project Settings** > **API**
2. 复制以下信息：
   - **Project URL**: `https://<project-ref>.supabase.co`
   - **Anon Key**: `anon` public 密钥

### 3. 配置环境变量

复制项目中的环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_GEMINI_API_KEY=your-gemini-api-key-here  # 可选
```

> ⚠️ **安全提示**: 不要将 `.env` 文件提交到代码仓库，它已在 `.gitignore` 中配置。

### 4. 创建数据库表

#### 4.1 打开 SQL Editor

1. 在 Supabase Dashboard 中，点击左侧 **SQL Editor**
2. 点击 **New query**
3. 复制执行 `supabase/schema.sql` 中的 SQL 语句

#### 4.2 核心表结构

```sql
-- 用户表
CREATE TABLE smartoffice_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  role TEXT[] DEFAULT '{}',
  department TEXT,
  landline TEXT,
  mobile TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 资源表
CREATE TABLE smartoffice_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ROOM', 'DESK')),
  capacity INTEGER,
  location TEXT,
  features TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'PENDING')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 预订表
CREATE TABLE smartoffice_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES smartoffice_users(id),
  resource_id UUID REFERENCES smartoffice_resources(id),
  type TEXT NOT NULL CHECK (type IN ('ROOM', 'DESK')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')),
  purpose TEXT,
  participants INTEGER,
  current_node_index INTEGER DEFAULT 0,
  approval_history JSONB DEFAULT '[]',
  has_leader BOOLEAN DEFAULT FALSE,
  leader_details TEXT,
  is_video_conference BOOLEAN DEFAULT FALSE,
  needs_tea_service BOOLEAN DEFAULT FALSE,
  needs_name_card BOOLEAN DEFAULT FALSE,
  name_card_details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 角色表
CREATE TABLE smartoffice_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT 'indigo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 部门表
CREATE TABLE smartoffice_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES smartoffice_departments(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 工作流表
CREATE TABLE smartoffice_workflow (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 审批审计表
CREATE TABLE smartoffice_approval_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES smartoffice_bookings(id),
  node_index INTEGER,
  node_name TEXT,
  approver_id UUID REFERENCES smartoffice_users(id),
  approver_name TEXT,
  status TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5. 启用实时订阅

#### 5.1 启用 Database Realtime

1. 进入 **Database** > **Replication**
2. 找到 **Source** 配置
3. 确保 `supabase_realtime` 已启用

#### 5.2 为表启用 Realtime

执行以下 SQL：

```sql
-- 为预订表启用实时订阅
alter publication supabase_realtime add table smartoffice_bookings;

-- 为资源表启用实时订阅
alter publication supabase_realtime add table smartoffice_resources;

-- 设置表的复制身份（用于获取完整行数据）
alter table smartoffice_bookings replica identity full;
alter table smartoffice_resources replica identity full;
```

### 6. 配置 Row Level Security (RLS)

#### 6.1 启用 RLS

```sql
-- 为用户表启用 RLS
ALTER TABLE smartoffice_users ENABLE ROW LEVEL SECURITY;

-- 为资源表启用 RLS
ALTER TABLE smartoffice_resources ENABLE ROW LEVEL SECURITY;

-- 为预订表启用 RLS
ALTER TABLE smartoffice_bookings ENABLE ROW LEVEL SECURITY;

-- 为角色表启用 RLS
ALTER TABLE smartoffice_roles ENABLE ROW LEVEL SECURITY;

-- 为部门表启用 RLS
ALTER TABLE smartoffice_departments ENABLE ROW LEVEL SECURITY;

-- 为工作流表启用 RLS
ALTER TABLE smartoffice_workflow ENABLE ROW LEVEL SECURITY;

-- 为审计表启用 RLS
ALTER TABLE smartoffice_approval_audit ENABLE ROW LEVEL SECURITY;
```

#### 6.2 配置策略（开发环境）

开发环境可以使用宽松策略：

```sql
-- 允许所有操作（开发环境）
CREATE POLICY "Allow all" ON smartoffice_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON smartoffice_resources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON smartoffice_bookings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON smartoffice_roles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON smartoffice_departments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON smartoffice_workflow FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON smartoffice_approval_audit FOR ALL USING (true) WITH CHECK (true);
```

#### 6.3 生产环境策略建议

生产环境应该配置更严格的策略：

```sql
-- 用户只能看到自己的信息
CREATE POLICY "Users can view own data" ON smartoffice_users
  FOR SELECT USING (auth.uid() = id);

-- 用户可以创建预订
CREATE POLICY "Users can create bookings" ON smartoffice_bookings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 用户可以查看自己的预订
CREATE POLICY "Users can view own bookings" ON smartoffice_bookings
  FOR SELECT USING (auth.uid() = user_id);

-- 审批人可以查看待审批的预订
CREATE POLICY "Approvers can view pending bookings" ON smartoffice_bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM smartoffice_users
      WHERE id = auth.uid()
      AND role @> ARRAY['APPROVAL_ADMIN']
    )
  );
```

### 7. 创建存储过程（可选）

#### 7.1 密码验证函数

如果使用 bcrypt 密码，创建验证函数：

```sql
CREATE OR REPLACE FUNCTION smartoffice_verify_password(p_password TEXT, p_hash TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN p_hash = crypt(p_password, p_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 📊 数据库表详解

### smartoffice_users（用户表）

| 字段 | 类型 | 说明 | 可空 |
|------|------|------|------|
| id | UUID | 主键 | 否 |
| name | TEXT | 用户姓名 | 否 |
| email | TEXT | 邮箱（唯一） | 否 |
| password | TEXT | 密码哈希 | 是 |
| role | TEXT[] | 角色数组 | 是 |
| department | TEXT | 所属部门 | 是 |
| landline | TEXT | 座机号码 | 是 |
| mobile | TEXT | 手机号码 | 是 |
| created_at | TIMESTAMPTZ | 创建时间 | 否 |
| updated_at | TIMESTAMPTZ | 更新时间 | 否 |

### smartoffice_resources（资源表）

| 字段 | 类型 | 说明 | 可空 |
|------|------|------|------|
| id | UUID | 主键 | 否 |
| name | TEXT | 资源名称 | 否 |
| type | TEXT | ROOM/DESK | 否 |
| capacity | INTEGER | 容量 | 是 |
| location | TEXT | 位置 | 是 |
| features | TEXT[] | 设施列表 | 是 |
| status | TEXT | 状态 | 否 |
| created_at | TIMESTAMPTZ | 创建时间 | 否 |
| updated_at | TIMESTAMPTZ | 更新时间 | 否 |

### smartoffice_bookings（预订表）

| 字段 | 类型 | 说明 | 可空 |
|------|------|------|------|
| id | UUID | 主键 | 否 |
| user_id | UUID | 用户ID（外键） | 否 |
| resource_id | UUID | 资源ID（外键） | 否 |
| type | TEXT | ROOM/DESK | 否 |
| start_time | TIMESTAMPTZ | 开始时间 | 否 |
| end_time | TIMESTAMPTZ | 结束时间 | 否 |
| status | TEXT | 预约状态 | 否 |
| purpose | TEXT | 用途 | 是 |
| participants | INTEGER | 参与人数 | 是 |
| current_node_index | INTEGER | 当前审批节点 | 否 |
| approval_history | JSONB | 审批历史 | 是 |
| has_leader | BOOLEAN | 是否有领导 | 是 |
| leader_details | TEXT | 领导详情 | 是 |
| is_video_conference | BOOLEAN | 视频会议 | 是 |
| needs_tea_service | BOOLEAN | 茶水服务 | 是 |
| needs_name_card | BOOLEAN | 桌牌服务 | 是 |
| name_card_details | TEXT | 桌牌详情 | 是 |
| created_at | TIMESTAMPTZ | 创建时间 | 否 |
| updated_at | TIMESTAMPTZ | 更新时间 | 否 |

---

## 🔧 离线支持

应用已实现离线缓存功能：

1. **数据缓存**: 使用 LocalStorage 缓存关键数据
2. **离线读取**: 网络不可用时，自动切换到本地缓存
3. **操作队列**: 离线操作保存在本地，网络恢复后同步
4. **自动重连**: 实时订阅在网络恢复后自动重新连接

---

## 📝 注意事项

### 免费套餐限制
- 数据库大小: 500MB
- API 调用: 无限（但有速率限制）
- 实时连接: 200 并发

### 性能优化建议
1. 为常用查询字段添加索引
2. 使用分页查询大数据集
3. 合理使用 Realtime 订阅，避免过多并发连接

### 数据备份
建议定期导出数据备份：

```bash
# 使用 Supabase CLI 导出
supabase db dump -f backup.sql
```

---

## 🐛 故障排除

### 连接失败

**症状**: 应用无法连接到 Supabase

**排查步骤**:
1. 检查环境变量是否正确配置
2. 确认 Supabase 项目是否正常运行
3. 检查网络连接
4. 查看浏览器控制台错误信息

### 数据不更新

**症状**: 实时数据不推送

**排查步骤**:
1. 检查实时订阅是否启用
2. 确认表是否启用了 REPLICA IDENTITY FULL
3. 查看 Supabase Realtime 日志
4. 检查网络 WebSocket 连接

### 权限错误

**症状**: 操作返回 403 或 401 错误

**排查步骤**:
1. 检查 RLS 策略是否正确配置
2. 确认使用的 anon key 是否正确
3. 检查用户是否有相应权限

### CORS 错误

**症状**: 跨域请求被拒绝

**解决方案**:
1. 在 Supabase 项目设置中配置允许的来源
2. 确保环境变量中的 URL 正确

---

## 📚 相关文档

- [Supabase 官方文档](https://supabase.com/docs)
- [Supabase JavaScript 客户端](https://supabase.com/docs/reference/javascript)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Realtime 订阅](https://supabase.com/docs/guides/realtime)

---

*最后更新: 2025年3月*
