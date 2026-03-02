# 智慧办公空间管理系统 - 数据初始化脚本

本文档说明如何使用数据初始化脚本来设置系统数据。

---

## 📋 脚本清单

| 脚本 | 用途 | 执行方式 |
|------|------|----------|
| `setup-database.sql` | 完整数据库初始化（建表+数据） | Supabase SQL Editor |
| `init-data.sql` | 插入基础数据（角色、部门、用户、资源） | Supabase SQL Editor |
| `reset-data.sql` | 清空业务数据，保留基础配置 | Supabase SQL Editor |
| `seed-sample-data.js` | 生成示例预订数据 | Node.js |
| `hash-password.js` | 密码哈希生成工具 | Node.js |
| `check_password.cjs` | 密码诊断工具 | Node.js |

---

## 🚀 快速开始

### 方式一：完整初始化（推荐新部署）

适用于**全新部署**，包含完整的建表语句和初始数据：

1. 打开 Supabase Dashboard
2. 进入 **SQL Editor**
3. 新建查询，复制 `setup-database.sql` 内容
4. 点击 **Run** 执行

执行完成后，系统包含：
- ✅ 完整的表结构
- ✅ 4 个系统角色
- ✅ 14 个部门
- ✅ 3 个管理员账号 + 7 个测试员工
- ✅ 14 个会议室/工位资源
- ✅ 3 级审批工作流

### 方式二：仅初始化基础数据

适用于**已有表结构**，只需要插入基础数据：

1. 打开 Supabase Dashboard
2. 进入 **SQL Editor**
3. 新建查询，复制 `init-data.sql` 内容
4. 点击 **Run** 执行

### 方式三：生成示例预订数据

适用于**开发和测试环境**，生成随机的预订记录：

1. 确保已安装依赖：
   ```bash
   npm install @supabase/supabase-js
   ```

2. 设置环境变量：
   ```bash
   export VITE_SUPABASE_URL=https://your-project.supabase.co
   export VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. 执行脚本：
   ```bash
   node scripts/seed-sample-data.js
   ```

脚本会生成约 50 条预订记录，包含：
- 不同状态的预订（待审批、已批准、已完成、已拒绝等）
- 不同时间段的预订（过去、现在、未来）
- 随机的附加服务（视频会议、茶水、桌牌等）

---

## 🔑 默认账号

初始化完成后，可以使用以下账号登录：

| 角色 | 邮箱 | 密码 | 说明 |
|------|------|------|------|
| 系统管理员 | `admin@company.com` | `admin123` | 全权限 |
| 审批负责人 | `approver@company.com` | `approver123` | 审批权限 |
| 会议服务 | `meeting@company.com` | `meeting123` | 会议室管理 |
| 普通员工 | `zhangsan@company.com` | `user123` | 基础权限 |
| 普通员工 | `lisi@company.com` | `user123` | 基础权限 |
| 普通员工 | `wangwu@company.com` | `user123` | 基础权限 |

---

## 📝 脚本详细说明

### setup-database.sql

**用途**: 完整的数据库初始化

**包含内容**:
1. 创建所有数据表
2. 创建索引和触发器
3. 创建存储函数（密码哈希、冲突检测等）
4. 启用 RLS 和实时订阅
5. 插入基础数据

**适用场景**:
- 新项目首次部署
- 重新创建数据库

**注意事项**:
- 使用 `IF NOT EXISTS` 避免重复创建
- 角色和用户数据使用 `ON CONFLICT UPDATE` 实现幂等性

---

### init-data.sql

**用途**: 插入基础业务数据

**包含内容**:
1. 4 个系统角色
2. 14 个部门（树形结构）
3. 3 个管理员 + 7 个测试员工
4. 14 个会议室/工位
5. 3 级审批工作流

**适用场景**:
- 已有表结构，需要填充基础数据
- 重置基础数据

---

### reset-data.sql

**用途**: 清空业务数据，保留基础配置

**清除内容**:
- 预订记录
- 审批审计记录
- 资源数据
- 非默认用户

**保留内容**:
- 表结构
- 角色定义
- 默认用户（重置密码）
- 部门和工作流配置

**适用场景**:
- 开发和测试环境的数据清理
- 演示前的数据重置

**警告**: 此操作不可恢复，请谨慎执行！

---

### seed-sample-data.js

**用途**: 生成示例预订数据

**配置项**:
```javascript
const CONFIG = {
  bookingCount: 50,      // 生成预订数量
  dateRange: 14,         // 日期范围（前后14天）
  timeSlots: [...],      // 时间段配置
  purposes: [...],       // 会议用途
  statusWeights: {...},  // 状态分布权重
};
```

**特点**:
- 自动检测冲突，避免重复预订
- 根据时间自动设置合理状态（过去已完成，未来随机）
- 生成随机的附加服务
- 批量插入，自动限流

**环境变量**:
- `VITE_SUPABASE_URL`: Supabase 项目 URL
- `VITE_SUPABASE_ANON_KEY`: Supabase 匿名密钥

---

### hash-password.js

**用途**: 生成密码哈希

**使用方法**:
```bash
node scripts/hash-password.js your-password
```

**输出**:
- SHA-256 哈希
- Base64 编码
- 带盐的 SHA-256

**适用场景**:
- 手动更新用户密码
- 验证密码格式

---

### check_password.cjs

**用途**: 密码诊断工具

**使用方法**:
```bash
# 测试密码加密
node scripts/check_password.cjs "your-password"

# 对比数据库中的密码
node scripts/check_password.cjs "your-password" "db-password-hash"
```

**功能**:
- 显示各种加密方式的结果
- 自动识别数据库密码格式
- 帮助排查密码问题

---

## 🔄 典型工作流程

### 新环境部署

```bash
# 1. 执行完整初始化
# 在 Supabase SQL Editor 中执行 setup-database.sql

# 2. 生成示例数据（可选）
node scripts/seed-sample-data.js
```

### 开发环境重置

```bash
# 1. 清空业务数据
# 在 Supabase SQL Editor 中执行 reset-data.sql

# 2. 重新生成示例数据
node scripts/seed-sample-data.js
```

### 生产环境更新

```bash
# 仅执行 init-data.sql 中的 INSERT 语句
# 注意：避免执行 TRUNCATE 或 DELETE
```

---

## ⚠️ 注意事项

1. **环境隔离**: 不同环境使用不同的 Supabase 项目
2. **数据备份**: 重置前建议导出重要数据
3. **密码安全**: 生产环境务必修改默认密码
4. **权限控制**: 生产环境使用严格的 RLS 策略
5. **示例数据**: 仅在开发和测试环境使用示例数据脚本

---

## 📚 相关文档

- [Supabase 文档](https://supabase.com/docs)
- [PostgreSQL 文档](https://www.postgresql.org/docs/)
- [项目文档](../docs/)
