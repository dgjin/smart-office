-- Supabase 数据库表结构
-- 智慧办公空间管理系统
-- 所有表名使用 smartoffice 前缀（全小写，无需引号）

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== 用户表 ====================
CREATE TABLE IF NOT EXISTS smartoffice_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT[] DEFAULT ARRAY['EMPLOYEE']::TEXT[],
    department TEXT,
    landline TEXT,
    mobile TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_users IS '系统用户表';
COMMENT ON COLUMN smartoffice_users.role IS '用户角色数组，如 SYSTEM_ADMIN, APPROVAL_ADMIN, EMPLOYEE';

-- ==================== 资源表 ====================
CREATE TABLE IF NOT EXISTS smartoffice_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ROOM', 'DESK')),
    capacity INTEGER DEFAULT 1,
    location TEXT NOT NULL,
    features TEXT[] DEFAULT ARRAY[]::TEXT[],
    status TEXT DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'PENDING')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_resources IS '办公资源表（会议室、工位）';
COMMENT ON COLUMN smartoffice_resources.type IS '资源类型：ROOM 会议室，DESK 工位';
COMMENT ON COLUMN smartoffice_resources.status IS '资源状态：AVAILABLE 可用，OCCUPIED 占用，MAINTENANCE 维护中，PENDING 待审批';

-- ==================== 预约表 ====================
CREATE TABLE IF NOT EXISTS smartoffice_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES smartoffice_users(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES smartoffice_resources(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('ROOM', 'DESK')),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')),
    purpose TEXT NOT NULL,
    participants INTEGER DEFAULT 1,
    current_node_index INTEGER DEFAULT 0,
    approval_history JSONB DEFAULT '[]'::JSONB,
    -- 特殊需求字段
    has_leader BOOLEAN DEFAULT FALSE,
    leader_details TEXT,
    is_video_conference BOOLEAN DEFAULT FALSE,
    needs_tea_service BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_bookings IS '资源预约表';
COMMENT ON COLUMN smartoffice_bookings.status IS '预约状态：PENDING 审批中，APPROVED 已通过，REJECTED 已驳回，COMPLETED 已完成，CANCELLED 已取消';
COMMENT ON COLUMN smartoffice_bookings.approval_history IS '审批历史记录，JSON 数组格式';
COMMENT ON COLUMN smartoffice_bookings.has_leader IS '是否有领导参会';
COMMENT ON COLUMN smartoffice_bookings.is_video_conference IS '是否需要视频会议';
COMMENT ON COLUMN smartoffice_bookings.needs_tea_service IS '是否需要茶水服务';

-- ==================== 角色表 ====================
CREATE TABLE IF NOT EXISTS smartoffice_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT 'indigo',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_roles IS '角色定义表';
COMMENT ON COLUMN smartoffice_roles.color IS '角色标识颜色，用于 UI 显示';

-- ==================== 部门表 ====================
CREATE TABLE IF NOT EXISTS smartoffice_departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES smartoffice_departments(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_departments IS '部门组织架构表';
COMMENT ON COLUMN smartoffice_departments.parent_id IS '上级部门 ID，为空表示顶级部门';

-- ==================== 工作流表 ====================
CREATE TABLE IF NOT EXISTS smartoffice_workflow (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    approver_role TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_workflow IS '审批流程配置表';
COMMENT ON COLUMN smartoffice_workflow.approver_role IS '该节点的审批人角色 ID';
COMMENT ON COLUMN smartoffice_workflow.sort_order IS '节点排序顺序';

-- ==================== 创建索引 ====================
-- 用户表索引
CREATE INDEX IF NOT EXISTS idx_smartoffice_users_email ON smartoffice_users(email);
CREATE INDEX IF NOT EXISTS idx_smartoffice_users_department ON smartoffice_users(department);

-- 资源表索引
CREATE INDEX IF NOT EXISTS idx_smartoffice_resources_type ON smartoffice_resources(type);
CREATE INDEX IF NOT EXISTS idx_smartoffice_resources_status ON smartoffice_resources(status);

-- 预约表索引
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_user_id ON smartoffice_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_resource_id ON smartoffice_bookings(resource_id);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_status ON smartoffice_bookings(status);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_start_time ON smartoffice_bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_end_time ON smartoffice_bookings(end_time);

-- 部门表索引
CREATE INDEX IF NOT EXISTS idx_smartoffice_departments_parent_id ON smartoffice_departments(parent_id);

-- ==================== 创建更新时间触发器 ====================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为用户表创建触发器
CREATE TRIGGER update_smartoffice_users_updated_at
    BEFORE UPDATE ON smartoffice_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 为资源表创建触发器
CREATE TRIGGER update_smartoffice_resources_updated_at
    BEFORE UPDATE ON smartoffice_resources
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 为预约表创建触发器
CREATE TRIGGER update_smartoffice_bookings_updated_at
    BEFORE UPDATE ON smartoffice_bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 为角色表创建触发器
CREATE TRIGGER update_smartoffice_roles_updated_at
    BEFORE UPDATE ON smartoffice_roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 为部门表创建触发器
CREATE TRIGGER update_smartoffice_departments_updated_at
    BEFORE UPDATE ON smartoffice_departments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 为工作流表创建触发器
CREATE TRIGGER update_smartoffice_workflow_updated_at
    BEFORE UPDATE ON smartoffice_workflow
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==================== 启用 Row Level Security (RLS) ====================
-- 启用 RLS
ALTER TABLE smartoffice_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_workflow ENABLE ROW LEVEL SECURITY;

-- 创建允许所有操作的策略（开发环境使用）
CREATE POLICY "Allow all operations on users" ON smartoffice_users
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on resources" ON smartoffice_resources
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on bookings" ON smartoffice_bookings
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on roles" ON smartoffice_roles
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on departments" ON smartoffice_departments
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on workflow" ON smartoffice_workflow
  FOR ALL USING (true) WITH CHECK (true);

-- ==================== 启用实时订阅 ====================
-- 预约表实时订阅
ALTER TABLE smartoffice_bookings REPLICA IDENTITY FULL;

-- 资源表实时订阅
ALTER TABLE smartoffice_resources REPLICA IDENTITY FULL;

-- ==================== 插入默认数据 ====================

-- 默认角色
INSERT INTO smartoffice_roles (id, name, description, color) VALUES
    ('SYSTEM_ADMIN', '系统管理员', '拥有全系统最高管理权限', 'indigo'),
    ('APPROVAL_ADMIN', '审批负责人', '负责各类资源申请的业务审核', 'amber'),
    ('EMPLOYEE', '正式员工', '可申请并使用公司公共资源', 'emerald')
ON CONFLICT (id) DO NOTHING;

-- 默认部门
INSERT INTO smartoffice_departments (id, name, parent_id) VALUES
    ('dpt-root', '集团总部', NULL),
    ('dpt1', '信息技术部', 'dpt-root'),
    ('dpt1-1', '架构组', 'dpt1'),
    ('dpt1-2', '运维组', 'dpt1'),
    ('dpt2', '行政部', 'dpt-root'),
    ('dpt3', '市场部', 'dpt-root'),
    ('dpt4', '销售部', 'dpt-root')
ON CONFLICT (id) DO NOTHING;

-- 默认工作流
INSERT INTO smartoffice_workflow (id, name, approver_role, sort_order) VALUES
    ('n1', '行政预审', 'APPROVAL_ADMIN', 0),
    ('n2', '最终核准', 'SYSTEM_ADMIN', 1)
ON CONFLICT (id) DO NOTHING;

-- ==================== 创建视图 ====================

-- 预约详情视图（包含用户和资源信息）
CREATE OR REPLACE VIEW smartoffice_booking_details AS
SELECT 
    b.*,
    u.name as user_name,
    u.email as user_email,
    u.department as user_department,
    r.name as resource_name,
    r.location as resource_location,
    r.type as resource_type
FROM smartoffice_bookings b
JOIN smartoffice_users u ON b.user_id = u.id
JOIN smartoffice_resources r ON b.resource_id = r.id;

COMMENT ON VIEW smartoffice_booking_details IS '预约详情视图，包含用户和资源信息';

-- ==================== 创建存储过程 ====================

-- 检查资源时间冲突
CREATE OR REPLACE FUNCTION smartoffice_check_booking_conflict(
    p_resource_id UUID,
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE,
    p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM smartoffice_bookings
    WHERE resource_id = p_resource_id
        AND status IN ('PENDING', 'APPROVED')
        AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
        AND (start_time < p_end_time AND end_time > p_start_time);
    
    RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION smartoffice_check_booking_conflict IS '检查指定时间段内资源是否已被预约';

-- 获取用户待审批数量
CREATE OR REPLACE FUNCTION smartoffice_get_pending_approval_count(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
    v_user_roles TEXT[];
BEGIN
    -- 获取用户角色
    SELECT role INTO v_user_roles FROM smartoffice_users WHERE id = p_user_id;
    
    SELECT COUNT(*) INTO v_count
    FROM smartoffice_bookings b
    WHERE b.status = 'PENDING'
        AND EXISTS (
            SELECT 1 FROM smartoffice_workflow w
            WHERE w.sort_order = b.current_node_index
                AND w.approver_role = ANY(v_user_roles)
        );
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION smartoffice_get_pending_approval_count IS '获取指定用户的待审批预约数量';
