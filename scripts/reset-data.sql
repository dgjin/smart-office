-- ============================================
-- 智慧办公空间管理系统 - 数据重置脚本
-- ============================================
-- 说明: 此脚本清空所有业务数据，但保留表结构和基础配置
--       用于开发和测试环境的数据清理
-- 警告: 此操作不可恢复，请谨慎执行！
-- ============================================

-- 开始事务
BEGIN;

-- ============================================
-- 1. 清空业务数据（保留基础配置）
-- ============================================

-- 1.1 清空审批审计记录
TRUNCATE TABLE smartoffice_approval_audit RESTART IDENTITY CASCADE;

-- 1.2 清空预订记录
TRUNCATE TABLE smartoffice_bookings RESTART IDENTITY CASCADE;

-- 1.3 清空资源数据
TRUNCATE TABLE smartoffice_resources RESTART IDENTITY CASCADE;

-- 1.4 清空用户数据（保留默认管理员）
-- 删除非默认用户
DELETE FROM smartoffice_users 
WHERE email NOT IN (
    'admin@company.com',
    'approver@company.com', 
    'meeting@company.com'
);

-- 重置默认用户的密码
UPDATE smartoffice_users 
SET password = smartoffice_hash_password(
    CASE email
        WHEN 'admin@company.com' THEN 'admin123'
        WHEN 'approver@company.com' THEN 'approver123'
        WHEN 'meeting@company.com' THEN 'meeting123'
    END
);

-- ============================================
-- 2. 重置基础配置（可选）
-- ============================================

-- 2.1 重置部门数据
TRUNCATE TABLE smartoffice_departments RESTART IDENTITY CASCADE;

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
    ('dpt-product', '产品部', 'dpt-root');

-- 2.2 重置工作流配置
TRUNCATE TABLE smartoffice_workflow RESTART IDENTITY CASCADE;

INSERT INTO smartoffice_workflow (id, name, approver_role, sort_order) VALUES
    ('wf-1', '部门初审', 'APPROVAL_ADMIN', 0),
    ('wf-2', '行政复审', 'APPROVAL_ADMIN', 1),
    ('wf-3', '最终核准', 'SYSTEM_ADMIN', 2);

-- ============================================
-- 3. 验证重置结果
-- ============================================

-- 显示当前数据状态
SELECT '============================================' as info;
SELECT '  数据重置完成' as info;
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
    '  用户（仅默认）',
    count(*)::text
FROM smartoffice_users
UNION ALL
SELECT 
    '  资源',
    count(*)::text
FROM smartoffice_resources
UNION ALL
SELECT 
    '  预订',
    count(*)::text
FROM smartoffice_bookings
UNION ALL
SELECT 
    '  工作流节点',
    count(*)::text
FROM smartoffice_workflow
UNION ALL
SELECT 
    '  审计记录',
    count(*)::text
FROM smartoffice_approval_audit;

SELECT '============================================' as info;

-- 提交事务
COMMIT;
