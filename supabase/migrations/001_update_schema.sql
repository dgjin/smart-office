-- 数据库更新脚本
-- 智慧办公空间管理系统
-- 版本：2026-02-24

-- ==================== 更新用户表 ====================
-- 添加密码字段，用于支持密码登录
ALTER TABLE smartoffice_users ADD COLUMN IF NOT EXISTS password TEXT;

COMMENT ON COLUMN smartoffice_users.password IS '用户密码（加密存储）';

-- ==================== 更新预约表 ====================
-- 添加桌牌需求字段
ALTER TABLE smartoffice_bookings ADD COLUMN IF NOT EXISTS needs_name_card BOOLEAN DEFAULT FALSE;
ALTER TABLE smartoffice_bookings ADD COLUMN IF NOT EXISTS name_card_details TEXT;

COMMENT ON COLUMN smartoffice_bookings.needs_name_card IS '是否需要桌牌';
COMMENT ON COLUMN smartoffice_bookings.name_card_details IS '桌牌详细要求';

-- ==================== 创建密码加密函数 ====================
-- 创建密码哈希函数（使用 pgcrypto 扩展）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION smartoffice_hash_password(p_password TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN crypt(p_password, gen_salt('bf'));
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION smartoffice_hash_password IS '对密码进行哈希处理';

-- 创建密码验证函数
CREATE OR REPLACE FUNCTION smartoffice_verify_password(p_password TEXT, p_hash TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN crypt(p_password, p_hash) = p_hash;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION smartoffice_verify_password IS '验证密码是否正确';

-- ==================== 更新预约详情视图 ====================
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

-- ==================== 插入默认管理员用户 ====================
-- 插入默认管理员用户（密码：123456）
INSERT INTO smartoffice_users (id, name, email, password, role, department)
VALUES (
    uuid_generate_v4(),
    '系统管理员',
    'admin@company.com',
    smartoffice_hash_password('123456'),
    ARRAY['SYSTEM_ADMIN', 'APPROVAL_ADMIN']::TEXT[],
    '信息技术部'
)
ON CONFLICT (email) DO UPDATE
SET 
    password = EXCLUDED.password,
    role = EXCLUDED.role;

-- 插入默认员工用户（密码：123456）
INSERT INTO smartoffice_users (id, name, email, password, role, department)
VALUES (
    uuid_generate_v4(),
    '测试员工',
    'user@company.com',
    smartoffice_hash_password('123456'),
    ARRAY['EMPLOYEE']::TEXT[],
    '行政部'
)
ON CONFLICT (email) DO UPDATE
SET 
    password = EXCLUDED.password,
    role = EXCLUDED.role;

-- ==================== 更新触发器 ====================
-- 确保更新时间触发器包含新字段
-- 触发器已在初始化脚本中创建，这里不需要重新创建

-- ==================== 更新完成 ====================
SELECT '数据库更新完成' AS status;
