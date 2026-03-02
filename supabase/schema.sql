-- ============================================
-- 智慧办公空间管理系统 - 完整数据库初始化脚本
-- ============================================
-- 说明: 此脚本包含完整的建表语句和初始数据
--       适用于新项目的首次部署
-- 执行方式: 在 Supabase SQL Editor 中完整执行
-- 警告: 此脚本会创建新表，不会删除已有数据
-- ============================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 启用密码加密扩展
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- 1. 创建数据表
-- ============================================

-- 1.1 用户表
CREATE TABLE IF NOT EXISTS smartoffice_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    role TEXT[] DEFAULT ARRAY['EMPLOYEE']::TEXT[],
    department TEXT,
    landline TEXT,
    mobile TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_users IS '系统用户表';
COMMENT ON COLUMN smartoffice_users.role IS '用户角色数组，如 SYSTEM_ADMIN, APPROVAL_ADMIN, EMPLOYEE';
COMMENT ON COLUMN smartoffice_users.password IS '用户密码（加密存储）';

-- 1.2 资源表
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

-- 1.3 预订表
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
    has_leader BOOLEAN DEFAULT FALSE,
    leader_details TEXT,
    is_video_conference BOOLEAN DEFAULT FALSE,
    needs_tea_service BOOLEAN DEFAULT FALSE,
    needs_name_card BOOLEAN DEFAULT FALSE,
    name_card_details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_bookings IS '资源预约表';
COMMENT ON COLUMN smartoffice_bookings.status IS '预约状态：PENDING 审批中，APPROVED 已通过，REJECTED 已驳回，COMPLETED 已完成，CANCELLED 已取消';
COMMENT ON COLUMN smartoffice_bookings.approval_history IS '审批历史记录，JSON 数组格式';
COMMENT ON COLUMN smartoffice_bookings.has_leader IS '是否有领导参会';
COMMENT ON COLUMN smartoffice_bookings.is_video_conference IS '是否需要视频会议';
COMMENT ON COLUMN smartoffice_bookings.needs_tea_service IS '是否需要茶水服务';
COMMENT ON COLUMN smartoffice_bookings.needs_name_card IS '是否需要桌牌';
COMMENT ON COLUMN smartoffice_bookings.name_card_details IS '桌牌详细要求';

-- 1.4 角色表
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

-- 1.5 部门表
CREATE TABLE IF NOT EXISTS smartoffice_departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES smartoffice_departments(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_departments IS '部门组织架构表';
COMMENT ON COLUMN smartoffice_departments.parent_id IS '上级部门 ID，为空表示顶级部门';

-- 1.6 工作流表
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

-- 1.7 审批审计表
CREATE TABLE IF NOT EXISTS smartoffice_approval_audit (
    id BIGSERIAL PRIMARY KEY,
    booking_id UUID NOT NULL REFERENCES smartoffice_bookings(id) ON DELETE CASCADE,
    node_index INTEGER NOT NULL,
    node_name TEXT,
    approver_id UUID REFERENCES smartoffice_users(id),
    approver_name TEXT,
    status TEXT NOT NULL CHECK (status IN ('APPROVED', 'REJECTED')),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE smartoffice_approval_audit IS '审批审计表，记录每一次审批决策';

-- ============================================
-- 2. 创建索引
-- ============================================
CREATE INDEX IF NOT EXISTS idx_smartoffice_users_email ON smartoffice_users(email);
CREATE INDEX IF NOT EXISTS idx_smartoffice_users_department ON smartoffice_users(department);
CREATE INDEX IF NOT EXISTS idx_smartoffice_resources_type ON smartoffice_resources(type);
CREATE INDEX IF NOT EXISTS idx_smartoffice_resources_status ON smartoffice_resources(status);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_user_id ON smartoffice_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_resource_id ON smartoffice_bookings(resource_id);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_status ON smartoffice_bookings(status);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_start_time ON smartoffice_bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_smartoffice_bookings_end_time ON smartoffice_bookings(end_time);
CREATE INDEX IF NOT EXISTS idx_smartoffice_departments_parent_id ON smartoffice_departments(parent_id);

-- ============================================
-- 3. 创建触发器（自动更新 updated_at）
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_smartoffice_users_updated_at ON smartoffice_users;
CREATE TRIGGER update_smartoffice_users_updated_at
    BEFORE UPDATE ON smartoffice_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_smartoffice_resources_updated_at ON smartoffice_resources;
CREATE TRIGGER update_smartoffice_resources_updated_at
    BEFORE UPDATE ON smartoffice_resources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_smartoffice_bookings_updated_at ON smartoffice_bookings;
CREATE TRIGGER update_smartoffice_bookings_updated_at
    BEFORE UPDATE ON smartoffice_bookings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_smartoffice_roles_updated_at ON smartoffice_roles;
CREATE TRIGGER update_smartoffice_roles_updated_at
    BEFORE UPDATE ON smartoffice_roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_smartoffice_departments_updated_at ON smartoffice_departments;
CREATE TRIGGER update_smartoffice_departments_updated_at
    BEFORE UPDATE ON smartoffice_departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_smartoffice_workflow_updated_at ON smartoffice_workflow;
CREATE TRIGGER update_smartoffice_workflow_updated_at
    BEFORE UPDATE ON smartoffice_workflow
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 4. 创建存储函数
-- ============================================

-- 4.1 密码哈希函数
CREATE OR REPLACE FUNCTION smartoffice_hash_password(p_password TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN crypt(p_password, gen_salt('bf'));
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION smartoffice_hash_password IS '对密码进行 bcrypt 哈希处理';

-- 4.2 密码验证函数
CREATE OR REPLACE FUNCTION smartoffice_verify_password(p_password TEXT, p_hash TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN crypt(p_password, p_hash) = p_hash;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION smartoffice_verify_password IS '验证密码是否正确';

-- 4.3 检查资源时间冲突
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

-- 4.4 获取用户待审批数量
CREATE OR REPLACE FUNCTION smartoffice_get_pending_approval_count(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
    v_user_roles TEXT[];
BEGIN
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

-- ============================================
-- 5. 启用 RLS（开发环境宽松策略）
-- ============================================
ALTER TABLE smartoffice_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE smartoffice_approval_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON smartoffice_users;
CREATE POLICY "Allow all" ON smartoffice_users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all" ON smartoffice_resources;
CREATE POLICY "Allow all" ON smartoffice_resources FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all" ON smartoffice_bookings;
CREATE POLICY "Allow all" ON smartoffice_bookings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all" ON smartoffice_roles;
CREATE POLICY "Allow all" ON smartoffice_roles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all" ON smartoffice_departments;
CREATE POLICY "Allow all" ON smartoffice_departments FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all" ON smartoffice_workflow;
CREATE POLICY "Allow all" ON smartoffice_workflow FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all" ON smartoffice_approval_audit;
CREATE POLICY "Allow all" ON smartoffice_approval_audit FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 6. 启用实时订阅
-- ============================================
ALTER TABLE smartoffice_bookings REPLICA IDENTITY FULL;
ALTER TABLE smartoffice_resources REPLICA IDENTITY FULL;

-- ============================================
-- 7. 插入初始数据
-- ============================================

-- 7.1 角色数据
INSERT INTO smartoffice_roles (id, name, description, color) VALUES
    ('SYSTEM_ADMIN', '系统管理员', '拥有全系统最高管理权限', 'indigo'),
    ('APPROVAL_ADMIN', '审批负责人', '负责各类资源申请的业务审核', 'amber'),
    ('MEETING_SERVICE', '会议服务', '负责会议室服务管理', 'blue'),
    ('EMPLOYEE', '正式员工', '可申请并使用公司公共资源', 'emerald')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    color = EXCLUDED.color;

-- 7.2 部门数据
INSERT INTO smartoffice_departments (id, name, parent_id) VALUES
    ('dpt-root', '集团总部', NULL),
    ('dpt-tech', '信息技术部', 'dpt-root'),
    ('dpt-tech-arch', '架构组', 'dpt-tech'),
    ('dpt-tech-dev', '研发组', 'dpt-tech'),
    ('dpt-tech-ops', '运维组', 'dpt-tech'),
    ('dpt-admin', '行政部', 'dpt-root'),
    ('dpt-admin-hr', '人力资源', 'dpt-admin'),
    ('dpt-admin-facility', '后勤管理', 'dpt-admin'),
    ('dpt-market', '市场部', 'dpt-root'),
    ('dpt-market-brand', '品牌策划', 'dpt-market'),
    ('dpt-sales', '销售部', 'dpt-root'),
    ('dpt-sales-north', '华北销售', 'dpt-sales'),
    ('dpt-sales-south', '华南销售', 'dpt-sales'),
    ('dpt-finance', '财务部', 'dpt-root'),
    ('dpt-product', '产品部', 'dpt-root')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    parent_id = EXCLUDED.parent_id;

-- 7.3 管理员用户
INSERT INTO smartoffice_users (id, name, email, password, role, department, landline, mobile)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '系统管理员',
    'admin@company.com',
    smartoffice_hash_password('admin123'),
    ARRAY['SYSTEM_ADMIN', 'APPROVAL_ADMIN']::TEXT[],
    '信息技术部',
    '010-88880001',
    '13800138001'
)
ON CONFLICT (email) DO UPDATE SET
    password = smartoffice_hash_password('admin123'),
    role = ARRAY['SYSTEM_ADMIN', 'APPROVAL_ADMIN']::TEXT[];

-- 7.4 审批人用户
INSERT INTO smartoffice_users (id, name, email, password, role, department, landline, mobile)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '审批专员',
    'approver@company.com',
    smartoffice_hash_password('approver123'),
    ARRAY['APPROVAL_ADMIN']::TEXT[],
    '行政部',
    '010-88880002',
    '13800138002'
)
ON CONFLICT (email) DO UPDATE SET
    password = smartoffice_hash_password('approver123'),
    role = ARRAY['APPROVAL_ADMIN']::TEXT[];

-- 7.5 会议服务用户
INSERT INTO smartoffice_users (id, name, email, password, role, department, landline, mobile)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '会议服务专员',
    'meeting@company.com',
    smartoffice_hash_password('meeting123'),
    ARRAY['MEETING_SERVICE']::TEXT[],
    '后勤管理',
    '010-88880003',
    '13800138003'
)
ON CONFLICT (email) DO UPDATE SET
    password = smartoffice_hash_password('meeting123'),
    role = ARRAY['MEETING_SERVICE']::TEXT[];

-- 7.6 测试员工用户
INSERT INTO smartoffice_users (id, name, email, password, role, department, landline, mobile)
VALUES 
    ('00000000-0000-0000-0000-000000000011', '张三', 'zhangsan@company.com', smartoffice_hash_password('user123'), ARRAY['EMPLOYEE']::TEXT[], '研发组', '010-88880011', '13800138011'),
    ('00000000-0000-0000-0000-000000000012', '李四', 'lisi@company.com', smartoffice_hash_password('user123'), ARRAY['EMPLOYEE']::TEXT[], '架构组', '010-88880012', '13800138012'),
    ('00000000-0000-0000-0000-000000000013', '王五', 'wangwu@company.com', smartoffice_hash_password('user123'), ARRAY['EMPLOYEE']::TEXT[], '运维组', '010-88880013', '13800138013'),
    ('00000000-0000-0000-0000-000000000021', '赵六', 'zhaoliu@company.com', smartoffice_hash_password('user123'), ARRAY['EMPLOYEE']::TEXT[], '市场部', '010-88880021', '13800138021'),
    ('00000000-0000-0000-0000-000000000022', '钱七', 'qianqi@company.com', smartoffice_hash_password('user123'), ARRAY['EMPLOYEE']::TEXT[], '销售部', '010-88880022', '13800138022'),
    ('00000000-0000-0000-0000-000000000023', '孙八', 'sunba@company.com', smartoffice_hash_password('user123'), ARRAY['EMPLOYEE']::TEXT[], '人力资源', '010-88880023', '13800138023'),
    ('00000000-0000-0000-0000-000000000024', '周九', 'zhoujiu@company.com', smartoffice_hash_password('user123'), ARRAY['EMPLOYEE']::TEXT[], '产品部', '010-88880024', '13800138024')
ON CONFLICT (email) DO UPDATE SET
    password = EXCLUDED.password;

-- 7.7 会议室资源
INSERT INTO smartoffice_resources (id, name, type, capacity, location, features, status) VALUES
    (gen_random_uuid(), '大会议室 A', 'ROOM', 50, '3楼东侧', ARRAY['投影仪', '视频会议', '白板', '音响系统', '无线投屏'], 'AVAILABLE'),
    (gen_random_uuid(), '大会议室 B', 'ROOM', 30, '3楼西侧', ARRAY['投影仪', '视频会议', '白板', '音响系统'], 'AVAILABLE'),
    (gen_random_uuid(), '多功能厅', 'ROOM', 100, '5楼中央', ARRAY['LED大屏', '专业音响', '舞台', '同声传译', '录音设备'], 'AVAILABLE'),
    (gen_random_uuid(), '中会议室 1', 'ROOM', 16, '3楼北侧', ARRAY['投影仪', '白板', '视频会议'], 'AVAILABLE'),
    (gen_random_uuid(), '中会议室 2', 'ROOM', 16, '3楼北侧', ARRAY['投影仪', '白板', '视频会议'], 'AVAILABLE'),
    (gen_random_uuid(), '中会议室 3', 'ROOM', 12, '4楼东侧', ARRAY['电视屏幕', '白板'], 'AVAILABLE'),
    (gen_random_uuid(), '中会议室 4', 'ROOM', 12, '4楼西侧', ARRAY['电视屏幕', '白板'], 'AVAILABLE'),
    (gen_random_uuid(), '洽谈室 1', 'ROOM', 6, '4楼南侧', ARRAY['电视屏幕'], 'AVAILABLE'),
    (gen_random_uuid(), '洽谈室 2', 'ROOM', 6, '4楼南侧', ARRAY['电视屏幕'], 'AVAILABLE'),
    (gen_random_uuid(), '洽谈室 3', 'ROOM', 4, '4楼南侧', ARRAY['电视屏幕'], 'AVAILABLE'),
    (gen_random_uuid(), 'VIP接待室', 'ROOM', 8, '6楼VIP区', ARRAY['豪华家具', '茶歇服务', '独立卫生间', '保密隔音'], 'AVAILABLE'),
    (gen_random_uuid(), '开放工位区 A', 'DESK', 20, '2楼开放区', ARRAY['电源插座', '网络接口', '储物柜'], 'AVAILABLE'),
    (gen_random_uuid(), '开放工位区 B', 'DESK', 20, '2楼开放区', ARRAY['电源插座', '网络接口', '储物柜'], 'AVAILABLE'),
    (gen_random_uuid(), '静音办公区', 'DESK', 10, '2楼北侧', ARRAY['独立隔间', '降噪耳机', '台灯'], 'AVAILABLE')
ON CONFLICT DO NOTHING;

-- 7.8 工作流配置
INSERT INTO smartoffice_workflow (id, name, approver_role, sort_order) VALUES
    ('wf-1', '部门初审', 'APPROVAL_ADMIN', 0),
    ('wf-2', '行政复审', 'APPROVAL_ADMIN', 1),
    ('wf-3', '最终核准', 'SYSTEM_ADMIN', 2)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    approver_role = EXCLUDED.approver_role,
    sort_order = EXCLUDED.sort_order;

-- ============================================
-- 8. 创建视图
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

COMMENT ON VIEW smartoffice_booking_details IS '预约详情视图，包含用户和资源信息';

-- ============================================
-- 9. 完成统计
-- ============================================
SELECT '============================================' as info;
SELECT '  智慧办公空间管理系统 - 数据库初始化完成' as info;
SELECT '============================================' as info;

SELECT 
    '数据汇总:' as category,
    NULL as count
UNION ALL
SELECT 
    '  角色',
    count(*)::text
FROM smartoffice_roles
UNION ALL
SELECT 
    '  部门',
    count(*)::text
FROM smartoffice_departments
UNION ALL
SELECT 
    '  用户',
    count(*)::text
FROM smartoffice_users
UNION ALL
SELECT 
    '  资源',
    count(*)::text
FROM smartoffice_resources
UNION ALL
SELECT 
    '  工作流节点',
    count(*)::text
FROM smartoffice_workflow;

SELECT '============================================' as info;
SELECT '  默认登录账号:' as info;
SELECT '    管理员: admin@company.com / admin123' as info;
SELECT '    审批人: approver@company.com / approver123' as info;
SELECT '    员工: zhangsan@company.com / user123' as info;
SELECT '============================================' as info;
