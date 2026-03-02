-- ============================================
-- 智慧办公空间管理系统 - 基础数据初始化脚本
-- ============================================
-- 说明: 此脚本插入系统运行所需的基础数据
--       包括角色、部门、用户、会议室资源和审批工作流
-- 执行方式: 在 Supabase SQL Editor 中执行
-- ============================================

-- 密码哈希函数（如果尚未创建）
CREATE OR REPLACE FUNCTION smartoffice_hash_password(p_password TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN crypt(p_password, gen_salt('bf'));
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 1. 初始化角色数据
-- ============================================
INSERT INTO smartoffice_roles (id, name, description, color) VALUES
    ('SYSTEM_ADMIN', '系统管理员', '拥有全系统最高管理权限，可管理用户、角色、部门、资源和审批流程', 'indigo'),
    ('APPROVAL_ADMIN', '审批负责人', '负责各类资源申请的业务审核，可查看和审批所有预订申请', 'amber'),
    ('MEETING_SERVICE', '会议服务', '负责会议室服务管理，可查看会议室状态和管理会议室资源', 'blue'),
    ('EMPLOYEE', '正式员工', '可申请并使用公司公共资源，管理个人预订', 'emerald')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    color = EXCLUDED.color;

-- ============================================
-- 2. 初始化部门数据
-- ============================================
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

-- ============================================
-- 3. 初始化用户数据
-- ============================================

-- 3.1 系统管理员
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
    name = EXCLUDED.name,
    password = EXCLUDED.password,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    landline = EXCLUDED.landline,
    mobile = EXCLUDED.mobile;

-- 3.2 审批负责人
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
    name = EXCLUDED.name,
    password = EXCLUDED.password,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    landline = EXCLUDED.landline,
    mobile = EXCLUDED.mobile;

-- 3.3 会议服务管理员
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
    name = EXCLUDED.name,
    password = EXCLUDED.password,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    landline = EXCLUDED.landline,
    mobile = EXCLUDED.mobile;

-- 3.4 普通员工 - 技术部
INSERT INTO smartoffice_users (id, name, email, password, role, department, landline, mobile)
VALUES 
    (
        '00000000-0000-0000-0000-000000000011',
        '张三',
        'zhangsan@company.com',
        smartoffice_hash_password('user123'),
        ARRAY['EMPLOYEE']::TEXT[],
        '研发组',
        '010-88880011',
        '13800138011'
    ),
    (
        '00000000-0000-0000-0000-000000000012',
        '李四',
        'lisi@company.com',
        smartoffice_hash_password('user123'),
        ARRAY['EMPLOYEE']::TEXT[],
        '架构组',
        '010-88880012',
        '13800138012'
    ),
    (
        '00000000-0000-0000-0000-000000000013',
        '王五',
        'wangwu@company.com',
        smartoffice_hash_password('user123'),
        ARRAY['EMPLOYEE']::TEXT[],
        '运维组',
        '010-88880013',
        '13800138013'
    )
ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    password = EXCLUDED.password,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    landline = EXCLUDED.landline,
    mobile = EXCLUDED.mobile;

-- 3.5 普通员工 - 其他部门
INSERT INTO smartoffice_users (id, name, email, password, role, department, landline, mobile)
VALUES 
    (
        '00000000-0000-0000-0000-000000000021',
        '赵六',
        'zhaoliu@company.com',
        smartoffice_hash_password('user123'),
        ARRAY['EMPLOYEE']::TEXT[],
        '市场部',
        '010-88880021',
        '13800138021'
    ),
    (
        '00000000-0000-0000-0000-000000000022',
        '钱七',
        'qianqi@company.com',
        smartoffice_hash_password('user123'),
        ARRAY['EMPLOYEE']::TEXT[],
        '销售部',
        '010-88880022',
        '13800138022'
    ),
    (
        '00000000-0000-0000-0000-000000000023',
        '孙八',
        'sunba@company.com',
        smartoffice_hash_password('user123'),
        ARRAY['EMPLOYEE']::TEXT[],
        '人力资源',
        '010-88880023',
        '13800138023'
    ),
    (
        '00000000-0000-0000-0000-000000000024',
        '周九',
        'zhoujiu@company.com',
        smartoffice_hash_password('user123'),
        ARRAY['EMPLOYEE']::TEXT[],
        '产品部',
        '010-88880024',
        '13800138024'
    )
ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    password = EXCLUDED.password,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    landline = EXCLUDED.landline,
    mobile = EXCLUDED.mobile;

-- ============================================
-- 4. 初始化会议室资源
-- ============================================

-- 4.1 大型会议室（20人以上）
INSERT INTO smartoffice_resources (id, name, type, capacity, location, features, status)
VALUES 
    (
        gen_random_uuid(),
        '大会议室 A',
        'ROOM',
        50,
        '3楼东侧',
        ARRAY['投影仪', '视频会议', '白板', '音响系统', '无线投屏']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '大会议室 B',
        'ROOM',
        30,
        '3楼西侧',
        ARRAY['投影仪', '视频会议', '白板', '音响系统']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '多功能厅',
        'ROOM',
        100,
        '5楼中央',
        ARRAY['LED大屏', '专业音响', '舞台', '同声传译', '录音设备']::TEXT[],
        'AVAILABLE'
    )
ON CONFLICT DO NOTHING;

-- 4.2 中型会议室（10-20人）
INSERT INTO smartoffice_resources (id, name, type, capacity, location, features, status)
VALUES 
    (
        gen_random_uuid(),
        '中会议室 1',
        'ROOM',
        16,
        '3楼北侧',
        ARRAY['投影仪', '白板', '视频会议']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '中会议室 2',
        'ROOM',
        16,
        '3楼北侧',
        ARRAY['投影仪', '白板', '视频会议']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '中会议室 3',
        'ROOM',
        12,
        '4楼东侧',
        ARRAY['电视屏幕', '白板']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '中会议室 4',
        'ROOM',
        12,
        '4楼西侧',
        ARRAY['电视屏幕', '白板']::TEXT[],
        'AVAILABLE'
    )
ON CONFLICT DO NOTHING;

-- 4.3 小型会议室/洽谈室（2-10人）
INSERT INTO smartoffice_resources (id, name, type, capacity, location, features, status)
VALUES 
    (
        gen_random_uuid(),
        '洽谈室 1',
        'ROOM',
        6,
        '4楼南侧',
        ARRAY['电视屏幕']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '洽谈室 2',
        'ROOM',
        6,
        '4楼南侧',
        ARRAY['电视屏幕']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '洽谈室 3',
        'ROOM',
        4,
        '4楼南侧',
        ARRAY['电视屏幕']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        'VIP接待室',
        'ROOM',
        8,
        '6楼VIP区',
        ARRAY['豪华家具', '茶歇服务', '独立卫生间', '保密隔音']::TEXT[],
        'AVAILABLE'
    )
ON CONFLICT DO NOTHING;

-- 4.4 工位资源
INSERT INTO smartoffice_resources (id, name, type, capacity, location, features, status)
VALUES 
    (
        gen_random_uuid(),
        '开放工位区 A',
        'DESK',
        20,
        '2楼开放区',
        ARRAY['电源插座', '网络接口', '储物柜']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '开放工位区 B',
        'DESK',
        20,
        '2楼开放区',
        ARRAY['电源插座', '网络接口', '储物柜']::TEXT[],
        'AVAILABLE'
    ),
    (
        gen_random_uuid(),
        '静音办公区',
        'DESK',
        10,
        '2楼北侧',
        ARRAY['独立隔间', '降噪耳机', '台灯']::TEXT[],
        'AVAILABLE'
    )
ON CONFLICT DO NOTHING;

-- ============================================
-- 5. 初始化审批工作流
-- ============================================
INSERT INTO smartoffice_workflow (id, name, approver_role, sort_order) VALUES
    ('wf-1', '部门初审', 'APPROVAL_ADMIN', 0),
    ('wf-2', '行政复审', 'APPROVAL_ADMIN', 1),
    ('wf-3', '最终核准', 'SYSTEM_ADMIN', 2)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    approver_role = EXCLUDED.approver_role,
    sort_order = EXCLUDED.sort_order;

-- ============================================
-- 初始化完成
-- ============================================
SELECT '角色数据' as category, count(*) as count FROM smartoffice_roles
UNION ALL
SELECT '部门数据', count(*) FROM smartoffice_departments
UNION ALL
SELECT '用户数据', count(*) FROM smartoffice_users
UNION ALL
SELECT '资源数据', count(*) FROM smartoffice_resources
UNION ALL
SELECT '工作流数据', count(*) FROM smartoffice_workflow;
