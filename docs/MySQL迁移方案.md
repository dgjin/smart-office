# SmartOffice 系统 Supabase 迁移至 MySQL 详细方案

**版本**: 1.0.0  
**创建日期**: 2026-03-03  
**作者**: SmartOffice 开发团队

---

## 目录

1. [概述](#1-概述)
2. [迁移范围与影响分析](#2-迁移范围与影响分析)
3. [数据库 Schema 转换](#3-数据库-schema-转换)
4. [后端服务改造](#4-后端服务改造)
5. [实时功能替代方案](#5-实时功能替代方案)
6. [迁移实施步骤](#6-迁移实施步骤)
7. [数据迁移脚本](#7-数据迁移脚本)
8. [测试方案](#8-测试方案)
9. [风险评估与回滚策略](#9-风险评估与回滚策略)
10. [附录](#10-附录)

---

## 1. 概述

### 1.1 迁移背景

当前 SmartOffice 系统使用 Supabase (PostgreSQL) 作为后端数据库。为满足本地部署需求，需要将数据库迁移至 MySQL。

### 1.2 迁移目标

- 完整迁移所有数据表结构和数据
- 保持应用程序功能完全兼容
- 替换 Supabase 特有功能（Realtime、RLS、RPC）
- 确保性能和安全性不降低

### 1.3 技术栈变更

| 组件 | 当前 (Supabase) | 目标 (MySQL) |
|------|----------------|--------------|
| 数据库 | PostgreSQL 15 | MySQL 8.0+ |
| 实时推送 | Supabase Realtime | WebSocket + 轮询 |
| 认证 | 自定义 + bcrypt | 自定义 + bcrypt |
| 数据访问 | @supabase/supabase-js | mysql2 + 自定义封装 |
| 连接池 | Supabase 管理 | mysql2 连接池 |

---

## 2. 迁移范围与影响分析

### 2.1 数据库表清单

| 表名 | 记录数预估 | 迁移优先级 | 复杂度 |
|------|-----------|-----------|--------|
| smartoffice_users | < 1000 | P0 | 低 |
| smartoffice_resources | < 100 | P0 | 低 |
| smartoffice_bookings | < 10000 | P0 | 高 |
| smartoffice_roles | < 10 | P0 | 低 |
| smartoffice_departments | < 50 | P0 | 低 |
| smartoffice_workflow | < 10 | P0 | 低 |
| smartoffice_approval_audit | < 50000 | P1 | 中 |
| smartoffice_system_config | 1 | P0 | 低 |

### 2.2 Supabase 特性替换矩阵

| Supabase 特性 | 用途 | MySQL 替代方案 |
|--------------|------|---------------|
| Realtime | 数据变更实时推送 | WebSocket Server + 轮询 |
| RLS | 行级安全 | 应用层权限控制 |
| RPC | 存储过程调用 | MySQL 存储过程 / 应用层实现 |
| pgcrypto | 密码加密 | bcryptjs (Node.js) |
| uuid-ossp | UUID 生成 | MySQL UUID() / 应用层生成 |
| JSONB | JSON 数据存储 | MySQL JSON 类型 |
| ARRAY | 数组类型 | 关联表 / JSON 数组 |
| TIMESTAMP WITH TIME ZONE | 带时区时间戳 | TIMESTAMP + 应用层处理 |

### 2.3 受影响文件清单

```
services/
├── supabaseService.ts          # 主要改造文件
├── realtimeService.ts          # 需要重构
└── mysqlService.ts             # 新增

utils/
├── dateUtils.ts                # 需适配 MySQL
└── dbUtils.ts                  # 新增

scripts/
├── setup-database.sql          # 重写为 MySQL 版本
├── init-data.sql               # 重写为 MySQL 版本
├── migrate-database.sql        # 重写为 MySQL 版本
└── migrate-supabase-to-mysql.js # 新增数据迁移脚本

config/
└── database.ts                 # 新增数据库配置
```

---

## 3. 数据库 Schema 转换

### 3.1 数据类型映射

| PostgreSQL 类型 | MySQL 类型 | 说明 |
|----------------|-----------|------|
| UUID | CHAR(36) | 使用标准 UUID 格式 |
| TEXT | VARCHAR(500) / TEXT | 根据长度选择 |
| TEXT[] | JSON | 数组转为 JSON 数组 |
| INTEGER | INT | 直接映射 |
| BIGSERIAL | BIGINT AUTO_INCREMENT | 自增主键 |
| BOOLEAN | TINYINT(1) | 0/1 表示 |
| TIMESTAMP WITH TIME ZONE | TIMESTAMP | 应用层处理时区 |
| JSONB | JSON | MySQL 5.7+ 支持 |
| DATE | DATE | 直接映射 |
| TIME | TIME | 直接映射 |

### 3.2 建表脚本 (MySQL)

```sql
-- ============================================
-- SmartOffice MySQL 数据库初始化脚本
-- ============================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS smartoffice 
    CHARACTER SET utf8mb4 
    COLLATE utf8mb4_unicode_ci;

USE smartoffice;

-- ============================================
-- 1. 用户表
-- ============================================
CREATE TABLE IF NOT EXISTS smartoffice_users (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255),
    role JSON DEFAULT '["EMPLOYEE"]',
    department VARCHAR(100),
    landline VARCHAR(20),
    mobile VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_department (department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. 资源表
-- ============================================
CREATE TABLE IF NOT EXISTS smartoffice_resources (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type ENUM('ROOM', 'DESK') NOT NULL,
    capacity INT DEFAULT 1,
    location VARCHAR(200) NOT NULL,
    features JSON DEFAULT '[]',
    status ENUM('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'PENDING') DEFAULT 'AVAILABLE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. 预订表
-- ============================================
CREATE TABLE IF NOT EXISTS smartoffice_bookings (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    resource_id CHAR(36) NOT NULL,
    type ENUM('ROOM', 'DESK') NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status ENUM('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED') DEFAULT 'PENDING',
    purpose TEXT NOT NULL,
    participants INT DEFAULT 1,
    current_node_index INT DEFAULT 0,
    approval_history JSON DEFAULT '[]',
    has_leader TINYINT(1) DEFAULT 0,
    leader_details TEXT,
    is_video_conference TINYINT(1) DEFAULT 0,
    needs_tea_service TINYINT(1) DEFAULT 0,
    needs_name_card TINYINT(1) DEFAULT 0,
    name_card_details TEXT,
    -- 长期预订字段
    is_long_term TINYINT(1) DEFAULT 0,
    long_term_group_id VARCHAR(255),
    long_term_start_date DATE,
    long_term_end_date DATE,
    daily_start_time TIME,
    daily_end_time TIME,
    long_term_type VARCHAR(20) DEFAULT 'daily',
    selected_week_days JSON,
    week_count INT,
    is_master TINYINT(1) DEFAULT 0,
    master_id CHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_resource_id (resource_id),
    INDEX idx_status (status),
    INDEX idx_start_time (start_time),
    INDEX idx_end_time (end_time),
    INDEX idx_long_term_group (long_term_group_id),
    INDEX idx_long_term_dates (long_term_start_date, long_term_end_date),
    FOREIGN KEY (user_id) REFERENCES smartoffice_users(id) ON DELETE CASCADE,
    FOREIGN KEY (resource_id) REFERENCES smartoffice_resources(id) ON DELETE CASCADE,
    FOREIGN KEY (master_id) REFERENCES smartoffice_bookings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. 角色表
-- ============================================
CREATE TABLE IF NOT EXISTS smartoffice_roles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT 'indigo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. 部门表
-- ============================================
CREATE TABLE IF NOT EXISTS smartoffice_departments (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    parent_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_parent_id (parent_id),
    FOREIGN KEY (parent_id) REFERENCES smartoffice_departments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 6. 工作流表
-- ============================================
CREATE TABLE IF NOT EXISTS smartoffice_workflow (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    approver_role VARCHAR(50) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 7. 审批审计表
-- ============================================
CREATE TABLE IF NOT EXISTS smartoffice_approval_audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_id CHAR(36) NOT NULL,
    node_index INT NOT NULL,
    node_name VARCHAR(100),
    approver_id CHAR(36),
    approver_name VARCHAR(100),
    status ENUM('APPROVED', 'REJECTED') NOT NULL,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES smartoffice_bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (approver_id) REFERENCES smartoffice_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 8. 系统配置表
-- ============================================
CREATE TABLE IF NOT EXISTS smartoffice_system_config (
    id CHAR(36) PRIMARY KEY,
    max_booking_days INT DEFAULT 20,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by CHAR(36),
    FOREIGN KEY (updated_by) REFERENCES smartoffice_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 9. 创建视图
-- ============================================
CREATE OR REPLACE VIEW smartoffice_booking_details AS
SELECT 
    b.*,
    u.name as user_name,
    u.email as user_email,
    u.department as user_department,
    r.name as resource_name,
    r.location as resource_location,
    r.capacity as resource_capacity,
    r.type as resource_type
FROM smartoffice_bookings b
JOIN smartoffice_users u ON b.user_id = u.id
JOIN smartoffice_resources r ON b.resource_id = r.id;

-- ============================================
-- 10. 创建存储过程
-- ============================================

DELIMITER //

-- 密码哈希函数 (使用应用层 bcrypt，此处为占位)
CREATE PROCEDURE IF NOT EXISTS smartoffice_hash_password(
    IN p_password VARCHAR(255),
    OUT p_hash VARCHAR(255)
)
BEGIN
    SET p_hash = p_password; -- 实际哈希在应用层完成
END //

-- 检查预订时间冲突
CREATE PROCEDURE IF NOT EXISTS smartoffice_check_booking_conflict(
    IN p_resource_id CHAR(36),
    IN p_start_time TIMESTAMP,
    IN p_end_time TIMESTAMP,
    IN p_exclude_booking_id CHAR(36)
)
BEGIN
    SELECT COUNT(*) as conflict_count
    FROM smartoffice_bookings
    WHERE resource_id = p_resource_id
        AND status IN ('PENDING', 'APPROVED')
        AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
        AND (start_time < p_end_time AND end_time > p_start_time);
END //

-- 获取用户待审批数量
CREATE PROCEDURE IF NOT EXISTS smartoffice_get_pending_approval_count(
    IN p_user_id CHAR(36)
)
BEGIN
    SELECT COUNT(*) as pending_count
    FROM smartoffice_bookings b
    WHERE b.status = 'PENDING'
        AND EXISTS (
            SELECT 1 FROM smartoffice_workflow w
            WHERE w.sort_order = b.current_node_index
                AND w.approver_role IN (
                    SELECT JSON_UNQUOTE(JSON_EXTRACT(role, '$[*]')) 
                    FROM smartoffice_users 
                    WHERE id = p_user_id
                )
        );
END //

-- 获取服务器时间
CREATE PROCEDURE IF NOT EXISTS get_server_time()
BEGIN
    SELECT NOW() as server_time;
END //

-- 获取服务器日期
CREATE PROCEDURE IF NOT EXISTS get_server_date()
BEGIN
    SELECT CURDATE() as server_date;
END //

DELIMITER ;
```

### 3.3 索引优化建议

```sql
-- 常用查询索引
CREATE INDEX idx_bookings_time_range ON smartoffice_bookings(start_time, end_time);
CREATE INDEX idx_bookings_user_status ON smartoffice_bookings(user_id, status);
CREATE INDEX idx_bookings_resource_status ON smartoffice_bookings(resource_id, status);
CREATE INDEX idx_audit_booking ON smartoffice_approval_audit(booking_id, created_at);
```

---

## 4. 后端服务改造

### 4.1 新增 MySQL 服务层

**文件**: `services/mysqlService.ts`

```typescript
import mysql from 'mysql2/promise';
import { User, Resource, Booking, RoleDefinition, Department, ApprovalNode } from '../types';

// MySQL 连接配置
const dbConfig = {
  host: import.meta.env.VITE_MYSQL_HOST || 'localhost',
  port: parseInt(import.meta.env.VITE_MYSQL_PORT || '3306'),
  user: import.meta.env.VITE_MYSQL_USER || 'root',
  password: import.meta.env.VITE_MYSQL_PASSWORD || '',
  database: import.meta.env.VITE_MYSQL_DATABASE || 'smartoffice',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

// 创建连接池
const pool = mysql.createPool(dbConfig);

// 数据库表名
const TABLES = {
  USERS: 'smartoffice_users',
  RESOURCES: 'smartoffice_resources',
  BOOKINGS: 'smartoffice_bookings',
  ROLES: 'smartoffice_roles',
  DEPARTMENTS: 'smartoffice_departments',
  WORKFLOW: 'smartoffice_workflow',
  AUDIT: 'smartoffice_approval_audit',
} as const;

// 测试连接
export async function testConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('MySQL 连接成功');
    return true;
  } catch (error) {
    console.error('MySQL 连接失败:', error);
    return false;
  }
}

// 执行查询
async function query<T>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

// 执行插入/更新/删除
async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const [result] = await pool.execute(sql, params);
  return result as mysql.ResultSetHeader;
}

// ==================== 用户相关操作 ====================

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.USERS} WHERE email = ?`,
    [email]
  );
  return rows.length > 0 ? transformUserFromDB(rows[0]) : null;
}

export async function loginWithEmailAndPassword(email: string, password: string): Promise<User | null> {
  const user = await getUserByEmail(email);
  if (!user) return null;
  
  // 密码验证在应用层使用 bcrypt
  const bcrypt = await import('bcryptjs');
  const dbPassword = user.password || '';
  
  // 支持 bcrypt 和 SHA-256 格式
  let isValid = false;
  if (dbPassword.startsWith('$2')) {
    isValid = await bcrypt.compare(password, dbPassword);
  } else if (dbPassword.length === 64) {
    const hashedPassword = await hashPasswordSHA256(password);
    isValid = dbPassword === hashedPassword;
  } else {
    isValid = dbPassword === password;
  }
  
  return isValid ? user : null;
}

async function hashPasswordSHA256(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getUsers(): Promise<User[]> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.USERS} ORDER BY created_at DESC`
  );
  return rows.map(transformUserFromDB);
}

export async function createUser(user: Omit<User, 'id'>): Promise<User> {
  const id = crypto.randomUUID();
  const dbUser = transformUserToDB(user);
  
  await execute(
    `INSERT INTO ${TABLES.USERS} (id, name, email, password, role, department, landline, mobile) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, dbUser.name, dbUser.email, dbUser.password, 
     JSON.stringify(dbUser.role), dbUser.department, dbUser.landline, dbUser.mobile]
  );
  
  return { ...user, id } as User;
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User> {
  const dbUpdates = transformUserToDB(updates);
  const fields: string[] = [];
  const values: any[] = [];
  
  if (dbUpdates.name) { fields.push('name = ?'); values.push(dbUpdates.name); }
  if (dbUpdates.email) { fields.push('email = ?'); values.push(dbUpdates.email); }
  if (dbUpdates.password) { fields.push('password = ?'); values.push(dbUpdates.password); }
  if (dbUpdates.role) { fields.push('role = ?'); values.push(JSON.stringify(dbUpdates.role)); }
  if (dbUpdates.department) { fields.push('department = ?'); values.push(dbUpdates.department); }
  if (dbUpdates.landline) { fields.push('landline = ?'); values.push(dbUpdates.landline); }
  if (dbUpdates.mobile) { fields.push('mobile = ?'); values.push(dbUpdates.mobile); }
  
  values.push(id);
  
  await execute(
    `UPDATE ${TABLES.USERS} SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  
  const updated = await query<any>(`SELECT * FROM ${TABLES.USERS} WHERE id = ?`, [id]);
  return transformUserFromDB(updated[0]);
}

export async function deleteUser(id: string): Promise<void> {
  await execute(`DELETE FROM ${TABLES.USERS} WHERE id = ?`, [id]);
}

// ==================== 资源相关操作 ====================

export async function getResources(): Promise<Resource[]> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.RESOURCES} ORDER BY created_at DESC`
  );
  return rows.map(transformResourceFromDB);
}

export async function createResource(resource: Omit<Resource, 'id'>): Promise<Resource> {
  const id = crypto.randomUUID();
  const dbResource = transformResourceToDB(resource);
  
  await execute(
    `INSERT INTO ${TABLES.RESOURCES} (id, name, type, capacity, location, features, status) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, dbResource.name, dbResource.type, dbResource.capacity, 
     dbResource.location, JSON.stringify(dbResource.features), dbResource.status]
  );
  
  return { ...resource, id } as Resource;
}

export async function updateResource(id: string, updates: Partial<Resource>): Promise<Resource> {
  const dbUpdates = transformResourceToDB(updates);
  const fields: string[] = [];
  const values: any[] = [];
  
  if (dbUpdates.name) { fields.push('name = ?'); values.push(dbUpdates.name); }
  if (dbUpdates.type) { fields.push('type = ?'); values.push(dbUpdates.type); }
  if (dbUpdates.capacity) { fields.push('capacity = ?'); values.push(dbUpdates.capacity); }
  if (dbUpdates.location) { fields.push('location = ?'); values.push(dbUpdates.location); }
  if (dbUpdates.features) { fields.push('features = ?'); values.push(JSON.stringify(dbUpdates.features)); }
  if (dbUpdates.status) { fields.push('status = ?'); values.push(dbUpdates.status); }
  
  values.push(id);
  
  await execute(
    `UPDATE ${TABLES.RESOURCES} SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  
  const updated = await query<any>(`SELECT * FROM ${TABLES.RESOURCES} WHERE id = ?`, [id]);
  return transformResourceFromDB(updated[0]);
}

export async function deleteResource(id: string): Promise<void> {
  await execute(`DELETE FROM ${TABLES.RESOURCES} WHERE id = ?`, [id]);
}

// ==================== 预订相关操作 ====================

export async function getBookings(): Promise<Booking[]> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.BOOKINGS} ORDER BY created_at DESC`
  );
  return rows.map(transformBookingFromDB);
}

export async function getBookingsByUserId(userId: string): Promise<Booking[]> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.BOOKINGS} WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(transformBookingFromDB);
}

export async function getBookingsByResourceId(resourceId: string): Promise<Booking[]> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.BOOKINGS} WHERE resource_id = ? ORDER BY start_time ASC`,
    [resourceId]
  );
  return rows.map(transformBookingFromDB);
}

export async function createBooking(booking: Omit<Booking, 'id'>): Promise<Booking> {
  const id = crypto.randomUUID();
  const dbBooking = transformBookingToDB(booking);
  
  await execute(
    `INSERT INTO ${TABLES.BOOKINGS} (
      id, user_id, resource_id, type, start_time, end_time, status, purpose, participants,
      current_node_index, approval_history, has_leader, leader_details, is_video_conference,
      needs_tea_service, needs_name_card, name_card_details, is_long_term, long_term_group_id,
      long_term_start_date, long_term_end_date, daily_start_time, daily_end_time,
      long_term_type, selected_week_days, week_count, is_master, master_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, dbBooking.user_id, dbBooking.resource_id, dbBooking.type, 
      dbBooking.start_time, dbBooking.end_time, dbBooking.status, 
      dbBooking.purpose, dbBooking.participants, dbBooking.current_node_index,
      JSON.stringify(dbBooking.approval_history), dbBooking.has_leader ? 1 : 0,
      dbBooking.leader_details, dbBooking.is_video_conference ? 1 : 0,
      dbBooking.needs_tea_service ? 1 : 0, dbBooking.needs_name_card ? 1 : 0,
      dbBooking.name_card_details, dbBooking.is_long_term ? 1 : 0,
      dbBooking.long_term_group_id, dbBooking.long_term_start_date,
      dbBooking.long_term_end_date, dbBooking.daily_start_time,
      dbBooking.daily_end_time, dbBooking.long_term_type,
      JSON.stringify(dbBooking.selected_week_days), dbBooking.week_count,
      dbBooking.is_master ? 1 : 0, dbBooking.master_id
    ]
  );
  
  return { ...booking, id } as Booking;
}

export async function updateBooking(id: string, updates: Partial<Booking>): Promise<Booking> {
  const dbUpdates = transformBookingToDB(updates);
  const fields: string[] = [];
  const values: any[] = [];
  
  // 构建动态更新字段
  Object.entries(dbUpdates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      if (key === 'approval_history' || key === 'selected_week_days') {
        values.push(JSON.stringify(value));
      } else if (typeof value === 'boolean') {
        values.push(value ? 1 : 0);
      } else {
        values.push(value);
      }
    }
  });
  
  values.push(id);
  
  await execute(
    `UPDATE ${TABLES.BOOKINGS} SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  
  const updated = await query<any>(`SELECT * FROM ${TABLES.BOOKINGS} WHERE id = ?`, [id]);
  return transformBookingFromDB(updated[0]);
}

export async function deleteBooking(id: string): Promise<void> {
  await execute(`DELETE FROM ${TABLES.BOOKINGS} WHERE id = ?`, [id]);
}

// ==================== 角色相关操作 ====================

export async function getRoles(): Promise<RoleDefinition[]> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.ROLES} ORDER BY created_at ASC`
  );
  return rows.map(transformRoleFromDB);
}

export async function createRole(role: Omit<RoleDefinition, 'id'>): Promise<RoleDefinition> {
  const id = `role_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  await execute(
    `INSERT INTO ${TABLES.ROLES} (id, name, description, color) VALUES (?, ?, ?, ?)`,
    [id, role.name, role.description || '', role.color || 'indigo']
  );
  
  return { ...role, id };
}

export async function updateRole(id: string, updates: Partial<RoleDefinition>): Promise<RoleDefinition> {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.name) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.color) { fields.push('color = ?'); values.push(updates.color); }
  
  values.push(id);
  
  await execute(
    `UPDATE ${TABLES.ROLES} SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  
  const updated = await query<any>(`SELECT * FROM ${TABLES.ROLES} WHERE id = ?`, [id]);
  return transformRoleFromDB(updated[0]);
}

export async function deleteRole(id: string): Promise<void> {
  await execute(`DELETE FROM ${TABLES.ROLES} WHERE id = ?`, [id]);
}

// ==================== 部门相关操作 ====================

export async function getDepartments(): Promise<Department[]> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.DEPARTMENTS} ORDER BY created_at ASC`
  );
  return rows.map(transformDepartmentFromDB);
}

export async function createDepartment(department: Omit<Department, 'id'>): Promise<Department> {
  const id = `dept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  await execute(
    `INSERT INTO ${TABLES.DEPARTMENTS} (id, name, parent_id) VALUES (?, ?, ?)`,
    [id, department.name, department.parentId || null]
  );
  
  return { ...department, id };
}

export async function updateDepartment(id: string, updates: Partial<Department>): Promise<Department> {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.name) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.parentId !== undefined) { fields.push('parent_id = ?'); values.push(updates.parentId); }
  
  values.push(id);
  
  await execute(
    `UPDATE ${TABLES.DEPARTMENTS} SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
  
  const updated = await query<any>(`SELECT * FROM ${TABLES.DEPARTMENTS} WHERE id = ?`, [id]);
  return transformDepartmentFromDB(updated[0]);
}

export async function deleteDepartment(id: string): Promise<void> {
  await execute(`DELETE FROM ${TABLES.DEPARTMENTS} WHERE id = ?`, [id]);
}

// ==================== 工作流相关操作 ====================

export async function getWorkflow(): Promise<ApprovalNode[]> {
  const rows = await query<any>(
    `SELECT * FROM ${TABLES.WORKFLOW} ORDER BY sort_order ASC`
  );
  return rows.map(transformWorkflowFromDB);
}

export async function updateWorkflow(nodes: ApprovalNode[]): Promise<void> {
  // 使用事务批量更新
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      await connection.execute(
        `INSERT INTO ${TABLES.WORKFLOW} (id, name, approver_role, sort_order) 
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = ?, approver_role = ?, sort_order = ?`,
        [node.id, node.name, node.approverRole, i, node.name, node.approverRole, i]
      );
    }
    
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ==================== 审批相关操作 ====================

export async function approveBooking(
  bookingId: string,
  approverId: string,
  approverName: string,
  expectedNodeIndex: number,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string
): Promise<Booking> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // 1. 读取当前 booking
    const [bookings] = await connection.execute(
      `SELECT * FROM ${TABLES.BOOKINGS} WHERE id = ?`,
      [bookingId]
    );
    const dbBooking = (bookings as any[])[0];
    
    if (!dbBooking) {
      throw new Error('BOOKING_NOT_FOUND');
    }
    
    const currentNodeIndex = dbBooking.current_node_index || 0;
    if (currentNodeIndex !== expectedNodeIndex) {
      throw new Error('CONFLICT: booking already processed');
    }
    
    // 2. 获取工作流
    const [workflows] = await connection.execute(
      `SELECT * FROM ${TABLES.WORKFLOW} ORDER BY sort_order ASC`
    );
    const workflow = workflows as any[];
    const isLast = expectedNodeIndex === (workflow.length - 1);
    
    // 3. 构建审批记录
    const approvalRecord = {
      nodeName: workflow[expectedNodeIndex]?.name || '未知',
      approverName: approverName || '未知',
      status: decision,
      comment: comment || '',
      timestamp: new Date().toISOString(),
    };
    
    const currentHistory = JSON.parse(dbBooking.approval_history || '[]');
    const newApprovalHistory = [...currentHistory, approvalRecord];
    
    const newCurrentNodeIndex = (decision === 'APPROVED' && !isLast) ? currentNodeIndex + 1 : currentNodeIndex;
    const newStatus = decision === 'REJECTED' ? 'REJECTED' : (decision === 'APPROVED' && isLast ? 'APPROVED' : 'PENDING');
    
    // 4. 原子更新 booking
    const [updateResult] = await connection.execute(
      `UPDATE ${TABLES.BOOKINGS} 
       SET current_node_index = ?, status = ?, approval_history = ?
       WHERE id = ? AND current_node_index = ?`,
      [newCurrentNodeIndex, newStatus, JSON.stringify(newApprovalHistory), bookingId, currentNodeIndex]
    );
    
    if ((updateResult as mysql.ResultSetHeader).affectedRows === 0) {
      throw new Error('CONFLICT: booking updated by other actor');
    }
    
    // 5. 如果是长期预订主记录，批量更新从记录
    if (dbBooking.is_long_term && dbBooking.is_master) {
      await connection.execute(
        `UPDATE ${TABLES.BOOKINGS} 
         SET status = ?, approval_history = ?
         WHERE master_id = ?`,
        [newStatus, JSON.stringify(newApprovalHistory), bookingId]
      );
    }
    
    // 6. 写入审计表
    await connection.execute(
      `INSERT INTO ${TABLES.AUDIT} (booking_id, node_index, node_name, approver_id, approver_name, status, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, expectedNodeIndex, workflow[expectedNodeIndex]?.name || null, 
       approverId, approverName, decision, comment || null]
    );
    
    await connection.commit();
    
    // 7. 返回更新后的 booking
    const [updated] = await connection.execute(
      `SELECT * FROM ${TABLES.BOOKINGS} WHERE id = ?`,
      [bookingId]
    );
    
    return transformBookingFromDB((updated as any[])[0]);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ==================== 批量操作 ====================

export async function batchImportUsers(users: Omit<User, 'id'>[]): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    for (const user of users) {
      const id = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO ${TABLES.USERS} (id, name, email, role, department, landline, mobile) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, user.name, user.email, JSON.stringify(user.role), 
         user.department, user.landline, user.mobile]
      );
    }
    
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function batchImportResources(resources: Omit<Resource, 'id'>[]): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    for (const resource of resources) {
      const id = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO ${TABLES.RESOURCES} (id, name, type, capacity, location, features, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, resource.name, resource.type, resource.capacity, 
         resource.location, JSON.stringify(resource.features), resource.status]
      );
    }
    
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function batchImportDepartments(departments: Omit<Department, 'id'>[]): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    for (const dept of departments) {
      const id = `dept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await connection.execute(
        `INSERT INTO ${TABLES.DEPARTMENTS} (id, name, parent_id) VALUES (?, ?, ?)`,
        [id, dept.name, dept.parentId || null]
      );
    }
    
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ==================== 导出/导入所有数据 ====================

export async function exportAllData() {
  const [users, resources, bookings, roles, departments, workflow] = await Promise.all([
    getUsers(),
    getResources(),
    getBookings(),
    getRoles(),
    getDepartments(),
    getWorkflow(),
  ]);
  
  return { users, resources, bookings, roles, departments, workflow };
}

export async function restoreAllData(data: {
  users: User[];
  resources: Resource[];
  bookings: Booking[];
  roles: RoleDefinition[];
  departments: Department[];
  workflow: ApprovalNode[];
}): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // 清空所有表（保持外键约束顺序）
    await connection.execute(`DELETE FROM ${TABLES.AUDIT}`);
    await connection.execute(`DELETE FROM ${TABLES.BOOKINGS}`);
    await connection.execute(`DELETE FROM ${TABLES.RESOURCES}`);
    await connection.execute(`DELETE FROM ${TABLES.USERS}`);
    await connection.execute(`DELETE FROM ${TABLES.DEPARTMENTS}`);
    await connection.execute(`DELETE FROM ${TABLES.ROLES}`);
    
    // 插入数据
    if (data.roles.length > 0) {
      for (const role of data.roles) {
        await connection.execute(
          `INSERT INTO ${TABLES.ROLES} (id, name, description, color) VALUES (?, ?, ?, ?)`,
          [role.id, role.name, role.description, role.color]
        );
      }
    }
    
    if (data.departments.length > 0) {
      for (const dept of data.departments) {
        await connection.execute(
          `INSERT INTO ${TABLES.DEPARTMENTS} (id, name, parent_id) VALUES (?, ?, ?)`,
          [dept.id, dept.name, dept.parentId || null]
        );
      }
    }
    
    if (data.users.length > 0) {
      for (const user of data.users) {
        const dbUser = transformUserToDB(user);
        await connection.execute(
          `INSERT INTO ${TABLES.USERS} (id, name, email, password, role, department, landline, mobile) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [user.id, dbUser.name, dbUser.email, dbUser.password, 
           JSON.stringify(dbUser.role), dbUser.department, dbUser.landline, dbUser.mobile]
        );
      }
    }
    
    if (data.resources.length > 0) {
      for (const resource of data.resources) {
        const dbResource = transformResourceToDB(resource);
        await connection.execute(
          `INSERT INTO ${TABLES.RESOURCES} (id, name, type, capacity, location, features, status) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [resource.id, dbResource.name, dbResource.type, dbResource.capacity, 
           dbResource.location, JSON.stringify(dbResource.features), dbResource.status]
        );
      }
    }
    
    if (data.bookings.length > 0) {
      for (const booking of data.bookings) {
        const dbBooking = transformBookingToDB(booking);
        await connection.execute(
          `INSERT INTO ${TABLES.BOOKINGS} (id, user_id, resource_id, type, start_time, end_time, status, purpose, participants)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [booking.id, dbBooking.user_id, dbBooking.resource_id, dbBooking.type, 
           dbBooking.start_time, dbBooking.end_time, dbBooking.status, 
           dbBooking.purpose, dbBooking.participants]
        );
      }
    }
    
    // 更新工作流
    if (data.workflow.length > 0) {
      await updateWorkflow(data.workflow);
    }
    
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ==================== 数据转换函数 ====================

function transformUserFromDB(dbUser: any): User {
  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    password: dbUser.password,
    role: typeof dbUser.role === 'string' ? JSON.parse(dbUser.role) : dbUser.role,
    department: dbUser.department,
    landline: dbUser.landline,
    mobile: dbUser.mobile,
  };
}

function transformUserToDB(user: Partial<User>): any {
  return {
    ...(user.name && { name: user.name }),
    ...(user.email && { email: user.email }),
    ...(user.password && { password: user.password }),
    ...(user.role && { role: user.role }),
    ...(user.department && { department: user.department }),
    ...(user.landline && { landline: user.landline }),
    ...(user.mobile && { mobile: user.mobile }),
  };
}

function transformResourceFromDB(dbResource: any): Resource {
  return {
    id: dbResource.id,
    name: dbResource.name,
    type: dbResource.type,
    capacity: dbResource.capacity,
    location: dbResource.location,
    features: typeof dbResource.features === 'string' ? JSON.parse(dbResource.features) : dbResource.features || [],
    status: dbResource.status,
  };
}

function transformResourceToDB(resource: Partial<Resource>): any {
  return {
    ...(resource.name && { name: resource.name }),
    ...(resource.type && { type: resource.type }),
    ...(resource.capacity && { capacity: resource.capacity }),
    ...(resource.location && { location: resource.location }),
    ...(resource.features && { features: resource.features }),
    ...(resource.status && { status: resource.status }),
  };
}

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
    approvalHistory: typeof dbBooking.approval_history === 'string' 
      ? JSON.parse(dbBooking.approval_history) 
      : dbBooking.approval_history || [],
    hasLeader: dbBooking.has_leader === 1,
    leaderDetails: dbBooking.leader_details,
    isVideoConference: dbBooking.is_video_conference === 1,
    needsTeaService: dbBooking.needs_tea_service === 1,
    needsNameCard: dbBooking.needs_name_card === 1,
    nameCardDetails: dbBooking.name_card_details,
    isLongTerm: dbBooking.is_long_term === 1,
    longTermGroupId: dbBooking.long_term_group_id,
    longTermStartDate: dbBooking.long_term_start_date,
    longTermEndDate: dbBooking.long_term_end_date,
    dailyStartTime: dbBooking.daily_start_time,
    dailyEndTime: dbBooking.daily_end_time,
    longTermType: dbBooking.long_term_type,
    selectedWeekDays: typeof dbBooking.selected_week_days === 'string'
      ? JSON.parse(dbBooking.selected_week_days)
      : dbBooking.selected_week_days,
    weekCount: dbBooking.week_count,
    isMaster: dbBooking.is_master === 1,
    masterId: dbBooking.master_id,
  };
}

function transformBookingToDB(booking: Partial<Booking>): any {
  return {
    ...(booking.userId && { user_id: booking.userId }),
    ...(booking.resourceId && { resource_id: booking.resourceId }),
    ...(booking.type && { type: booking.type }),
    ...(booking.startTime && { start_time: booking.startTime }),
    ...(booking.endTime && { end_time: booking.endTime }),
    ...(booking.status && { status: booking.status }),
    ...(booking.purpose && { purpose: booking.purpose }),
    ...(booking.participants && { participants: booking.participants }),
    ...(booking.currentNodeIndex !== undefined && { current_node_index: booking.currentNodeIndex }),
    ...(booking.approvalHistory && { approval_history: booking.approvalHistory }),
    ...(booking.hasLeader !== undefined && { has_leader: booking.hasLeader }),
    ...(booking.leaderDetails && { leader_details: booking.leaderDetails }),
    ...(booking.isVideoConference !== undefined && { is_video_conference: booking.isVideoConference }),
    ...(booking.needsTeaService !== undefined && { needs_tea_service: booking.needsTeaService }),
    ...(booking.needsNameCard !== undefined && { needs_name_card: booking.needsNameCard }),
    ...(booking.nameCardDetails && { name_card_details: booking.nameCardDetails }),
    ...(booking.isLongTerm !== undefined && { is_long_term: booking.isLongTerm }),
    ...(booking.longTermGroupId && { long_term_group_id: booking.longTermGroupId }),
    ...(booking.longTermStartDate && { long_term_start_date: booking.longTermStartDate }),
    ...(booking.longTermEndDate && { long_term_end_date: booking.longTermEndDate }),
    ...(booking.dailyStartTime && { daily_start_time: booking.dailyStartTime }),
    ...(booking.dailyEndTime && { daily_end_time: booking.dailyEndTime }),
    ...(booking.longTermType && { long_term_type: booking.longTermType }),
    ...(booking.selectedWeekDays && { selected_week_days: booking.selectedWeekDays }),
    ...(booking.weekCount && { week_count: booking.weekCount }),
    ...(booking.isMaster !== undefined && { is_master: booking.isMaster }),
    ...(booking.masterId && { master_id: booking.masterId }),
  };
}

function transformRoleFromDB(dbRole: any): RoleDefinition {
  return {
    id: dbRole.id,
    name: dbRole.name,
    description: dbRole.description,
    color: dbRole.color,
  };
}

function transformDepartmentFromDB(dbDepartment: any): Department {
  return {
    id: dbDepartment.id,
    name: dbDepartment.name,
    parentId: dbDepartment.parent_id,
  };
}

function transformWorkflowFromDB(dbWorkflow: any): ApprovalNode {
  return {
    id: dbWorkflow.id,
    name: dbWorkflow.name,
    approverRole: dbWorkflow.approver_role,
  };
}

export { pool };
```

### 4.2 数据库配置

**文件**: `config/database.ts`

```typescript
// 数据库配置
export const dbConfig = {
  mysql: {
    host: import.meta.env.VITE_MYSQL_HOST || 'localhost',
    port: parseInt(import.meta.env.VITE_MYSQL_PORT || '3306'),
    user: import.meta.env.VITE_MYSQL_USER || 'root',
    password: import.meta.env.VITE_MYSQL_PASSWORD || '',
    database: import.meta.env.VITE_MYSQL_DATABASE || 'smartoffice',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  },
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  }
};

// 数据库类型
export type DatabaseType = 'mysql' | 'supabase';

// 当前使用的数据库
export const currentDatabase: DatabaseType = 
  (import.meta.env.VITE_DATABASE_TYPE as DatabaseType) || 'supabase';
```

### 4.3 统一数据服务层

**文件**: `services/databaseService.ts`

```typescript
import { currentDatabase } from '../config/database';
import * as mysqlService from './mysqlService';
import * as supabaseService from './supabaseService';

// 根据配置导出对应的服务
export const dbService = currentDatabase === 'mysql' ? mysqlService : supabaseService;

// 重新导出所有函数
export const {
  testConnection,
  getUserByEmail,
  loginWithEmailAndPassword,
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getResources,
  createResource,
  updateResource,
  deleteResource,
  getBookings,
  getBookingsByUserId,
  getBookingsByResourceId,
  createBooking,
  updateBooking,
  deleteBooking,
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getWorkflow,
  updateWorkflow,
  approveBooking,
  batchImportUsers,
  batchImportResources,
  batchImportDepartments,
  exportAllData,
  restoreAllData,
} = dbService;
```

---

## 5. 实时功能替代方案

### 5.1 方案对比

| 方案 | 优点 | 缺点 | 推荐场景 |
|------|------|------|---------|
| WebSocket Server | 真正的实时推送 | 需要额外服务器 | 高实时性需求 |
| 长轮询 | 兼容性好 | 服务器压力大 | 中等实时性 |
| 短轮询 (30s) | 实现简单 | 延迟较高 | 当前方案兼容 |
| MySQL Binlog | 数据库级实时 | 复杂度高 | 大规模部署 |

### 5.2 推荐方案：WebSocket + 轮询降级

**架构图**:

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│   前端应用       │ ◄────────────────► │  WebSocket Server │
│  (Display Page) │                    │   (Node.js)       │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │           轮询 (降级)                 │
         │◄─────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   MySQL DB      │
│  (触发器/事件)   │
└─────────────────┘
```

**实现要点**:

1. **WebSocket Server** (Node.js + ws)
   - 维护 RoomID -> Connection 映射
   - 监听 MySQL 变更（通过应用层事件或轮询）
   - 推送 JSON 数据到对应客户端

2. **前端适配**
   - 优先使用 WebSocket
   - WebSocket 失败时自动降级为轮询

3. **MySQL 触发器** (可选)
   - 在关键表上创建触发器
   - 将变更写入事件表

### 5.3 实时服务改造

**文件**: `services/realtimeService.ts` (改造后)

```typescript
import { Booking, Resource } from '../types';
import { dbService } from './databaseService';

interface RealtimeConfig {
  onBookingsChange?: (bookings: Booking[], delta: BookingDelta) => void;
  onResourcesChange?: (resources: Resource[], delta: ResourceDelta) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onError?: (error: Error) => void;
}

interface BookingDelta {
  added: Booking[];
  updated: Booking[];
  deleted: string[];
}

interface ResourceDelta {
  added: Resource[];
  updated: Resource[];
  deleted: string[];
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

class RealtimeService {
  private config: RealtimeConfig;
  private ws: WebSocket | null = null;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pollingInterval: any = null;
  private lastBookings: Map<string, Booking> = new Map();
  private lastResources: Map<string, Resource> = new Map();

  constructor(config: RealtimeConfig) {
    this.config = config;
  }

  public async connect(): Promise<void> {
    if (this.connectionStatus === 'connected' || this.connectionStatus === 'connecting') {
      return;
    }

    this.setConnectionStatus('connecting');

    try {
      // 加载初始数据
      await this.fetchAndNotifyBookings();
      await this.fetchAndNotifyResources();

      // 尝试 WebSocket 连接
      await this.connectWebSocket();
      
      // WebSocket 失败时启动轮询
      if (this.connectionStatus !== 'connected') {
        this.startPolling();
      }
    } catch (error) {
      console.error('实时连接失败:', error);
      this.startPolling();
    }
  }

  private async connectWebSocket(): Promise<void> {
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        this.setConnectionStatus('connected');
        this.reconnectAttempts = 0;
        this.stopPolling();
      };
      
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.handleWebSocketMessage(data);
      };
      
      this.ws.onclose = () => {
        this.scheduleReconnect();
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket 错误:', error);
        this.handleError(new Error('WebSocket 连接失败'));
      };
    } catch (error) {
      console.error('WebSocket 连接失败:', error);
    }
  }

  private handleWebSocketMessage(data: any): void {
    switch (data.type) {
      case 'bookings':
        this.fetchAndNotifyBookings();
        break;
      case 'resources':
        this.fetchAndNotifyResources();
        break;
    }
  }

  private startPolling(): void {
    if (this.pollingInterval) return;
    
    console.log('启动轮询，每30秒刷新一次数据...');
    this.pollingInterval = setInterval(async () => {
      try {
        await this.fetchAndNotifyBookings();
        await this.fetchAndNotifyResources();
      } catch (error) {
        console.error('轮询数据刷新失败:', error);
      }
    }, 30000);
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async fetchAndNotifyBookings(): Promise<void> {
    const bookings = await dbService.getBookings();
    const delta = this.calculateBookingDelta(bookings);
    
    this.lastBookings.clear();
    bookings.forEach(b => this.lastBookings.set(b.id, b));
    
    if (this.config.onBookingsChange) {
      this.config.onBookingsChange(bookings, delta);
    }
  }

  private async fetchAndNotifyResources(): Promise<void> {
    const resources = await dbService.getResources();
    const delta = this.calculateResourceDelta(resources);
    
    this.lastResources.clear();
    resources.forEach(r => this.lastResources.set(r.id, r));
    
    if (this.config.onResourcesChange) {
      this.config.onResourcesChange(resources, delta);
    }
  }

  private calculateBookingDelta(current: Booking[]): BookingDelta {
    const added: Booking[] = [];
    const updated: Booking[] = [];
    const deleted: string[] = [];

    current.forEach(booking => {
      const last = this.lastBookings.get(booking.id);
      if (!last) {
        added.push(booking);
      } else if (JSON.stringify(last) !== JSON.stringify(booking)) {
        updated.push(booking);
      }
    });

    this.lastBookings.forEach((_, id) => {
      if (!current.find(b => b.id === id)) {
        deleted.push(id);
      }
    });

    return { added, updated, deleted };
  }

  private calculateResourceDelta(current: Resource[]): ResourceDelta {
    const added: Resource[] = [];
    const updated: Resource[] = [];
    const deleted: string[] = [];

    current.forEach(resource => {
      const last = this.lastResources.get(resource.id);
      if (!last) {
        added.push(resource);
      } else if (JSON.stringify(last) !== JSON.stringify(resource)) {
        updated.push(resource);
      }
    });

    this.lastResources.forEach((_, id) => {
      if (!current.find(r => r.id === id)) {
        deleted.push(id);
      }
    });

    return { added, updated, deleted };
  }

  private scheduleReconnect(): void {
    if (this.connectionStatus === 'reconnecting') return;

    this.setConnectionStatus('reconnecting');

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setConnectionStatus('disconnected');
      this.startPolling(); // 降级到轮询
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connectWebSocket();
    }, delay);
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    if (this.config.onConnectionChange) {
      this.config.onConnectionChange(status);
    }
  }

  private handleError(error: Error): void {
    if (this.config.onError) {
      this.config.onError(error);
    }
  }

  public disconnect(): void {
    this.stopPolling();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionStatus('disconnected');
  }
}

export { RealtimeService };
```

---

## 6. 迁移实施步骤

### 6.1 准备阶段 (1-2天)

1. **环境准备**
   - [ ] 安装 MySQL 8.0+
   - [ ] 创建数据库和用户
   - [ ] 配置远程访问权限
   - [ ] 安装 Node.js mysql2 依赖

2. **代码准备**
   - [ ] 创建 MySQL 服务层
   - [ ] 创建统一数据服务层
   - [ ] 添加环境变量配置

### 6.2 数据库迁移 (1天)

1. **Schema 迁移**
   ```bash
   # 执行 MySQL 建表脚本
   mysql -u root -p smartoffice < scripts/setup-database-mysql.sql
   ```

2. **数据迁移**
   ```bash
   # 运行数据迁移脚本
   node scripts/migrate-supabase-to-mysql.js
   ```

3. **验证数据完整性**
   - 对比记录数
   - 抽样检查数据
   - 验证外键关系

### 6.3 应用改造 (2-3天)

1. **服务层改造**
   - [ ] 实现 mysqlService.ts
   - [ ] 实现 databaseService.ts 统一接口
   - [ ] 改造 realtimeService.ts

2. **配置改造**
   - [ ] 更新 .env 配置
   - [ ] 添加数据库类型切换开关

3. **组件适配**
   - [ ] 更新所有导入语句
   - [ ] 测试核心功能

### 6.4 测试阶段 (2-3天)

1. **功能测试**
   - [ ] 用户管理
   - [ ] 资源管理
   - [ ] 预订流程
   - [ ] 审批流程
   - [ ] 实时数据更新

2. **性能测试**
   - [ ] 并发预订测试
   - [ ] 大数据量查询测试
   - [ ] 实时推送延迟测试

3. **兼容性测试**
   - [ ] 不同浏览器
   - [ ] 移动端适配

### 6.5 上线部署 (1天)

1. **生产环境部署**
   - [ ] 部署 MySQL
   - [ ] 迁移生产数据
   - [ ] 部署新版本应用
   - [ ] 配置监控告警

2. **验证与监控**
   - [ ] 验证核心业务流程
   - [ ] 监控错误日志
   - [ ] 观察性能指标

---

## 7. 数据迁移脚本

### 7.1 数据导出脚本

**文件**: `scripts/export-supabase-data.js`

```javascript
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const TABLES = [
  'smartoffice_users',
  'smartoffice_resources',
  'smartoffice_bookings',
  'smartoffice_roles',
  'smartoffice_departments',
  'smartoffice_workflow',
  'smartoffice_approval_audit',
];

async function exportData() {
  const exportData = {};
  
  for (const table of TABLES) {
    console.log(`导出表: ${table}`);
    const { data, error } = await supabase.from(table).select('*');
    
    if (error) {
      console.error(`导出 ${table} 失败:`, error);
      continue;
    }
    
    exportData[table] = data;
    console.log(`  导出 ${data.length} 条记录`);
  }
  
  const outputPath = path.join(__dirname, '../data/supabase-export.json');
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`数据已导出到: ${outputPath}`);
}

exportData().catch(console.error);
```

### 7.2 数据导入脚本

**文件**: `scripts/import-to-mysql.js`

```javascript
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'smartoffice',
};

const TABLE_MAPPING = {
  'smartoffice_users': 'smartoffice_users',
  'smartoffice_resources': 'smartoffice_resources',
  'smartoffice_bookings': 'smartoffice_bookings',
  'smartoffice_roles': 'smartoffice_roles',
  'smartoffice_departments': 'smartoffice_departments',
  'smartoffice_workflow': 'smartoffice_workflow',
  'smartoffice_approval_audit': 'smartoffice_approval_audit',
};

function transformRecord(table, record) {
  const transformed = { ...record };
  
  // 处理数组类型
  if (record.role && Array.isArray(record.role)) {
    transformed.role = JSON.stringify(record.role);
  }
  if (record.features && Array.isArray(record.features)) {
    transformed.features = JSON.stringify(record.features);
  }
  if (record.approval_history && Array.isArray(record.approval_history)) {
    transformed.approval_history = JSON.stringify(record.approval_history);
  }
  if (record.selected_week_days && Array.isArray(record.selected_week_days)) {
    transformed.selected_week_days = JSON.stringify(record.selected_week_days);
  }
  
  // 处理布尔值
  const booleanFields = [
    'has_leader', 'is_video_conference', 'needs_tea_service', 
    'needs_name_card', 'is_long_term', 'is_master'
  ];
  booleanFields.forEach(field => {
    if (field in transformed) {
      transformed[field] = transformed[field] ? 1 : 0;
    }
  });
  
  // 处理字段名映射
  const fieldMappings = {
    'userId': 'user_id',
    'resourceId': 'resource_id',
    'startTime': 'start_time',
    'endTime': 'end_time',
    'createdAt': 'created_at',
    'updatedAt': 'updated_at',
    'currentNodeIndex': 'current_node_index',
    'approvalHistory': 'approval_history',
    'leaderDetails': 'leader_details',
    'isVideoConference': 'is_video_conference',
    'needsTeaService': 'needs_tea_service',
    'needsNameCard': 'needs_name_card',
    'nameCardDetails': 'name_card_details',
    'isLongTerm': 'is_long_term',
    'longTermGroupId': 'long_term_group_id',
    'longTermStartDate': 'long_term_start_date',
    'longTermEndDate': 'long_term_end_date',
    'dailyStartTime': 'daily_start_time',
    'dailyEndTime': 'daily_end_time',
    'longTermType': 'long_term_type',
    'selectedWeekDays': 'selected_week_days',
    'weekCount': 'week_count',
    'isMaster': 'is_master',
    'masterId': 'master_id',
    'parentId': 'parent_id',
    'approverRole': 'approver_role',
    'sortOrder': 'sort_order',
  };
  
  Object.entries(fieldMappings).forEach(([oldKey, newKey]) => {
    if (oldKey in transformed) {
      transformed[newKey] = transformed[oldKey];
      delete transformed[oldKey];
    }
  });
  
  return transformed;
}

async function importData() {
  const pool = mysql.createPool(dbConfig);
  const exportPath = path.join(__dirname, '../data/supabase-export.json');
  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // 按顺序导入（考虑外键约束）
    const importOrder = [
      'smartoffice_roles',
      'smartoffice_departments',
      'smartoffice_users',
      'smartoffice_resources',
      'smartoffice_workflow',
      'smartoffice_bookings',
      'smartoffice_approval_audit',
    ];
    
    for (const table of importOrder) {
      const records = exportData[table];
      if (!records || records.length === 0) continue;
      
      console.log(`导入表: ${table} (${records.length} 条记录)`);
      
      for (const record of records) {
        const transformed = transformRecord(table, record);
        const fields = Object.keys(transformed);
        const values = Object.values(transformed);
        const placeholders = fields.map(() => '?').join(', ');
        
        await connection.execute(
          `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders})`,
          values
        );
      }
    }
    
    await connection.commit();
    console.log('数据导入完成');
  } catch (error) {
    await connection.rollback();
    console.error('数据导入失败:', error);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

importData().catch(console.error);
```

---

## 8. 测试方案

### 8.1 单元测试

```typescript
// tests/mysqlService.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as mysqlService from '../services/mysqlService';

describe('MySQL Service Tests', () => {
  beforeAll(async () => {
    await mysqlService.testConnection();
  });

  it('should create and retrieve a user', async () => {
    const user = await mysqlService.createUser({
      name: 'Test User',
      email: 'test@example.com',
      role: ['EMPLOYEE'],
      department: 'Test Dept',
    });
    
    expect(user.id).toBeDefined();
    expect(user.name).toBe('Test User');
    
    const retrieved = await mysqlService.getUserByEmail('test@example.com');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe('Test User');
  });

  it('should handle booking CRUD operations', async () => {
    // 测试预订创建、查询、更新、删除
  });

  it('should handle concurrent booking approval', async () => {
    // 测试并发审批的原子性
  });
});
```

### 8.2 集成测试

| 测试场景 | 测试步骤 | 预期结果 |
|---------|---------|---------|
| 完整预订流程 | 1. 创建预订 2. 审批通过 3. 验证状态 | 状态流转正确 |
| 时间冲突检测 | 1. 创建重叠预订 | 返回冲突提示 |
| 长期预订创建 | 1. 创建按周预订 | 生成多条记录 |
| 实时数据更新 | 1. 修改数据 2. 观察前端 | 30秒内更新 |
| 大数据量查询 | 1. 导入10000条预订 | 查询<500ms |

### 8.3 性能基准

| 指标 | 目标值 | 测试方法 |
|------|--------|---------|
| 单表查询 | < 50ms | SELECT * FROM table LIMIT 100 |
| 关联查询 | < 100ms | 4表JOIN查询 |
| 数据插入 | < 20ms | 单条INSERT |
| 并发写入 | > 100 TPS | 100并发插入 |
| 实时推送延迟 | < 5s | WebSocket消息延迟 |

---

## 9. 风险评估与回滚策略

### 9.1 风险识别

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 数据丢失 | 低 | 高 | 完整备份、分批迁移 |
| 性能下降 | 中 | 中 | 索引优化、连接池 |
| 功能不兼容 | 中 | 高 | 全面测试、灰度发布 |
| 实时功能失效 | 低 | 中 | 轮询降级方案 |
| 外键约束冲突 | 中 | 中 | 按依赖顺序导入 |

### 9.2 回滚策略

1. **数据库回滚**
   - 保留 Supabase 实例运行
   - 保留完整数据备份
   - 快速切换 DNS/配置

2. **应用回滚**
   - 使用蓝绿部署
   - 保留上一版本镜像
   - 配置开关控制

3. **数据同步回滚**
   ```bash
   # 如需回滚，可将 MySQL 数据导回 Supabase
   node scripts/migrate-mysql-to-supabase.js
   ```

### 9.3 应急预案

| 场景 | 应急措施 |
|------|---------|
| 数据迁移失败 | 停止迁移，分析日志，修复后重试 |
| 应用启动失败 | 回滚到 Supabase 版本 |
| 性能严重下降 | 启用读写分离，优化慢查询 |
| 数据不一致 | 暂停服务，对比修复，重新同步 |

---

## 10. 附录

### 10.1 环境变量配置

```bash
# .env 文件

# 数据库类型: mysql | supabase
VITE_DATABASE_TYPE=mysql

# MySQL 配置
VITE_MYSQL_HOST=localhost
VITE_MYSQL_PORT=3306
VITE_MYSQL_USER=smartoffice
VITE_MYSQL_PASSWORD=your_password
VITE_MYSQL_DATABASE=smartoffice

# Supabase 配置（保留用于回滚）
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# WebSocket 配置
VITE_WS_URL=ws://localhost:8080
VITE_ENABLE_POLLING=true
```

### 10.2 依赖安装

```bash
# 安装 MySQL 依赖
npm install mysql2 bcryptjs

# 安装类型定义
npm install -D @types/mysql2 @types/bcryptjs
```

### 10.3 MySQL 安装命令

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install mysql-server-8.0
sudo mysql_secure_installation

# macOS
brew install mysql@8.0
brew services start mysql

# Docker
docker run -d \
  --name smartoffice-mysql \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -e MYSQL_DATABASE=smartoffice \
  -p 3306:3306 \
  mysql:8.0
```

### 10.4 变更日志

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0.0 | 2026-03-03 | 初始版本，完整迁移方案 |

---

**文档结束**
