-- ============================================
-- 长期预订功能数据库迁移脚本
-- ============================================

-- 为 smartoffice_bookings 表添加长期预订相关字段
ALTER TABLE smartoffice_bookings
ADD COLUMN IF NOT EXISTS is_long_term BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS long_term_group_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS long_term_start_date DATE,
ADD COLUMN IF NOT EXISTS long_term_end_date DATE,
ADD COLUMN IF NOT EXISTS daily_start_time TIME,
ADD COLUMN IF NOT EXISTS daily_end_time TIME,
ADD COLUMN IF NOT EXISTS needs_name_card BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS name_card_details TEXT,
ADD COLUMN IF NOT EXISTS long_term_type VARCHAR(20) DEFAULT 'daily',
ADD COLUMN IF NOT EXISTS selected_week_days INTEGER[],
ADD COLUMN IF NOT EXISTS week_count INTEGER,
ADD COLUMN IF NOT EXISTS is_master BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS master_id UUID REFERENCES smartoffice_bookings(id);

-- 添加索引以优化长期预订查询
CREATE INDEX IF NOT EXISTS idx_bookings_long_term_group 
ON smartoffice_bookings(long_term_group_id) 
WHERE is_long_term = TRUE;

CREATE INDEX IF NOT EXISTS idx_bookings_long_term_dates 
ON smartoffice_bookings(long_term_start_date, long_term_end_date) 
WHERE is_long_term = TRUE;

-- 添加系统配置表
CREATE TABLE IF NOT EXISTS smartoffice_system_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    max_booking_days INTEGER DEFAULT 20,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES smartoffice_users(id)
);

-- 插入默认配置
INSERT INTO smartoffice_system_config (id, max_booking_days, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 20, NOW())
ON CONFLICT (id) DO NOTHING;

-- 添加注释
COMMENT ON COLUMN smartoffice_bookings.is_long_term IS '是否为长期预订';
COMMENT ON COLUMN smartoffice_bookings.long_term_group_id IS '长期预订组ID，用于关联同一批长期预订';
COMMENT ON COLUMN smartoffice_bookings.long_term_start_date IS '长期预订开始日期';
COMMENT ON COLUMN smartoffice_bookings.long_term_end_date IS '长期预订结束日期';
COMMENT ON COLUMN smartoffice_bookings.daily_start_time IS '每天开始时间';
COMMENT ON COLUMN smartoffice_bookings.daily_end_time IS '每天结束时间';
COMMENT ON COLUMN smartoffice_bookings.needs_name_card IS '是否需要桌牌';
COMMENT ON COLUMN smartoffice_bookings.name_card_details IS '桌牌详情';
COMMENT ON COLUMN smartoffice_bookings.long_term_type IS '长期预订类型：daily(连续日期) / weekly(按周重复)';
COMMENT ON COLUMN smartoffice_bookings.selected_week_days IS '按周预订时选择的星期几 (0=周日, 1=周一, ..., 6=周六)';
COMMENT ON COLUMN smartoffice_bookings.week_count IS '按周预订时的周数';
COMMENT ON COLUMN smartoffice_bookings.is_master IS '是否为长期预订的主记录（用于整合审批）';
COMMENT ON COLUMN smartoffice_bookings.master_id IS '主记录ID（从记录使用，关联到主记录）';

-- ============================================
-- 回滚脚本（如需撤销修改）
-- ============================================
/*
-- 删除添加的字段
ALTER TABLE smartoffice_bookings
DROP COLUMN IF EXISTS is_long_term,
DROP COLUMN IF EXISTS long_term_group_id,
DROP COLUMN IF EXISTS long_term_start_date,
DROP COLUMN IF EXISTS long_term_end_date,
DROP COLUMN IF EXISTS daily_start_time,
DROP COLUMN IF EXISTS daily_end_time,
DROP COLUMN IF EXISTS needs_name_card,
DROP COLUMN IF EXISTS name_card_details,
DROP COLUMN IF EXISTS long_term_type,
DROP COLUMN IF EXISTS selected_week_days,
DROP COLUMN IF EXISTS week_count,
DROP COLUMN IF EXISTS is_master,
DROP COLUMN IF EXISTS master_id;

-- 删除索引
DROP INDEX IF EXISTS idx_bookings_long_term_group;
DROP INDEX IF EXISTS idx_bookings_long_term_dates;

-- 删除系统配置表
DROP TABLE IF EXISTS smartoffice_system_config;
*/
