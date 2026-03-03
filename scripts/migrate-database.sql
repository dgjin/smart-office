-- ============================================
-- 智慧办公空间管理系统 - 数据库更新脚本
-- ============================================
-- 说明: 此脚本用于更新现有数据库结构
--       包含日期选择器过去日期限制功能所需的数据库函数
-- 执行方式: 在 Supabase SQL Editor 中执行
-- ============================================

-- ============================================
-- 1. 创建获取服务器时间的 RPC 函数
-- ============================================

-- 获取服务器当前时间
CREATE OR REPLACE FUNCTION get_server_time()
RETURNS TIMESTAMP WITH TIME ZONE AS $$
BEGIN
    RETURN NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_server_time() IS '获取数据库服务器当前时间，用于客户端时间同步';

-- 获取服务器当前日期
CREATE OR REPLACE FUNCTION get_server_date()
RETURNS DATE AS $$
BEGIN
    RETURN CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_server_date() IS '获取数据库服务器当前日期';

-- 检查指定日期是否早于服务器当前日期
CREATE OR REPLACE FUNCTION is_date_before_today(p_date DATE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN p_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION is_date_before_today(DATE) IS '检查指定日期是否早于今天';

-- 检查指定日期时间是否已经过去
CREATE OR REPLACE FUNCTION is_datetime_in_past(p_datetime TIMESTAMP WITH TIME ZONE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN p_datetime < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION is_datetime_in_past(TIMESTAMP WITH TIME ZONE) IS '检查指定日期时间是否已经过去';

-- ============================================
-- 2. 授予执行权限
-- ============================================
GRANT EXECUTE ON FUNCTION get_server_time() TO anon;
GRANT EXECUTE ON FUNCTION get_server_time() TO authenticated;
GRANT EXECUTE ON FUNCTION get_server_time() TO service_role;

GRANT EXECUTE ON FUNCTION get_server_date() TO anon;
GRANT EXECUTE ON FUNCTION get_server_date() TO authenticated;
GRANT EXECUTE ON FUNCTION get_server_date() TO service_role;

GRANT EXECUTE ON FUNCTION is_date_before_today(DATE) TO anon;
GRANT EXECUTE ON FUNCTION is_date_before_today(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION is_date_before_today(DATE) TO service_role;

GRANT EXECUTE ON FUNCTION is_datetime_in_past(TIMESTAMP WITH TIME ZONE) TO anon;
GRANT EXECUTE ON FUNCTION is_datetime_in_past(TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION is_datetime_in_past(TIMESTAMP WITH TIME ZONE) TO service_role;

-- ============================================
-- 3. 验证函数创建成功
-- ============================================
SELECT '============================================' as info;
SELECT '  数据库更新完成 - 日期限制功能' as info;
SELECT '============================================' as info;

SELECT 
    '创建的函数:' as category,
    NULL as details
UNION ALL
SELECT 
    '  - get_server_time()',
    '获取服务器当前时间'
UNION ALL
SELECT 
    '  - get_server_date()',
    '获取服务器当前日期'
UNION ALL
SELECT 
    '  - is_date_before_today(DATE)',
    '检查日期是否早于今天'
UNION ALL
SELECT 
    '  - is_datetime_in_past(TIMESTAMP)',
    '检查日期时间是否已经过去';

SELECT '============================================' as info;
