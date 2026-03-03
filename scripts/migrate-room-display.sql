-- ============================================
-- 会议室门口显示屏功能数据库迁移脚本
-- 创建日期: 2026-03-03
-- 版本: 1.4.0
-- ============================================

-- ============================================
-- 1. 确保 bookings 表已启用 REPLICA IDENTITY FULL
-- ============================================
-- 这是 Supabase Realtime 正常工作的必要条件
-- 它确保数据库变更时包含完整的行数据

ALTER TABLE smartoffice_bookings REPLICA IDENTITY FULL;

-- 验证设置
SELECT 
    relname,
    relreplident
FROM pg_class
WHERE relname = 'smartoffice_bookings';

-- ============================================
-- 2. 创建会议室显示优化视图
-- ============================================
-- 此视图优化了会议室显示屏的数据查询

CREATE OR REPLACE VIEW smartoffice_room_display_view AS
SELECT 
    b.id as booking_id,
    b.resource_id as room_id,
    b.purpose,
    b.start_time,
    b.end_time,
    b.status,
    b.participants,
    b.has_leader,
    b.is_video_conference,
    b.needs_tea_service,
    b.needs_name_card,
    b.name_card_details,
    b.leader_details,
    u.name as user_name,
    u.department as user_department,
    r.name as room_name,
    r.location as room_location,
    r.capacity as room_capacity,
    r.features as room_features,
    r.status as room_status,
    CASE 
        WHEN b.status = 'APPROVED' AND NOW() BETWEEN b.start_time AND b.end_time THEN 'IN_PROGRESS'
        WHEN b.status = 'APPROVED' AND b.start_time > NOW() THEN 'UPCOMING'
        WHEN b.status = 'PENDING' THEN 'PENDING'
        ELSE 'OTHER'
    END as booking_state,
    EXTRACT(EPOCH FROM (b.end_time - NOW())) / 60 as remaining_minutes
FROM smartoffice_bookings b
JOIN smartoffice_users u ON b.user_id = u.id
JOIN smartoffice_resources r ON b.resource_id = r.id
WHERE b.status IN ('APPROVED', 'PENDING')
    AND b.start_time::date = CURRENT_DATE;

COMMENT ON VIEW smartoffice_room_display_view IS '会议室显示屏优化视图，包含当前和今日预订信息';

-- ============================================
-- 3. 创建获取会议室当前状态函数
-- ============================================

CREATE OR REPLACE FUNCTION get_room_current_status(p_room_id UUID)
RETURNS TABLE (
    room_id UUID,
    room_name TEXT,
    room_location TEXT,
    room_capacity INTEGER,
    room_features TEXT[],
    current_status TEXT,
    current_booking JSONB,
    next_booking JSONB,
    today_bookings_count INTEGER
) AS $$
DECLARE
    v_current_booking JSONB;
    v_next_booking JSONB;
    v_today_count INTEGER;
BEGIN
    -- 获取当前进行中的会议
    SELECT to_jsonb(b.*) INTO v_current_booking
    FROM smartoffice_bookings b
    WHERE b.resource_id = p_room_id
        AND b.status = 'APPROVED'
        AND NOW() BETWEEN b.start_time AND b.end_time
    LIMIT 1;

    -- 获取下一个会议
    SELECT to_jsonb(b.*) INTO v_next_booking
    FROM smartoffice_bookings b
    WHERE b.resource_id = p_room_id
        AND b.status IN ('APPROVED', 'PENDING')
        AND b.start_time > NOW()
    ORDER BY b.start_time ASC
    LIMIT 1;

    -- 获取今日预订总数
    SELECT COUNT(*) INTO v_today_count
    FROM smartoffice_bookings b
    WHERE b.resource_id = p_room_id
        AND b.status IN ('APPROVED', 'PENDING')
        AND b.start_time::date = CURRENT_DATE;

    RETURN QUERY
    SELECT 
        r.id,
        r.name,
        r.location,
        r.capacity,
        r.features,
        CASE 
            WHEN v_current_booking IS NOT NULL THEN 'OCCUPIED'
            WHEN v_next_booking IS NOT NULL AND 
                 (v_next_booking->>'start_time')::timestamp - NOW() < INTERVAL '15 minutes' 
            THEN 'ABOUT_TO_START'
            ELSE 'AVAILABLE'
        END,
        v_current_booking,
        v_next_booking,
        v_today_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_room_current_status IS '获取会议室当前状态，用于显示屏实时展示';

-- ============================================
-- 4. 创建会议室今日预订列表函数
-- ============================================

CREATE OR REPLACE FUNCTION get_room_today_bookings(p_room_id UUID)
RETURNS TABLE (
    booking_id UUID,
    purpose TEXT,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    status TEXT,
    user_name TEXT,
    user_department TEXT,
    participants INTEGER,
    is_current BOOLEAN,
    is_next BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        b.purpose,
        b.start_time,
        b.end_time,
        b.status,
        u.name,
        u.department,
        b.participants,
        (b.status = 'APPROVED' AND NOW() BETWEEN b.start_time AND b.end_time) as is_current,
        (b.status IN ('APPROVED', 'PENDING') 
         AND b.start_time > NOW()
         AND NOT EXISTS (
             SELECT 1 FROM smartoffice_bookings b2
             WHERE b2.resource_id = p_room_id
                 AND b2.status IN ('APPROVED', 'PENDING')
                 AND b2.start_time > NOW()
                 AND b2.start_time < b.start_time
         )) as is_next
    FROM smartoffice_bookings b
    JOIN smartoffice_users u ON b.user_id = u.id
    WHERE b.resource_id = p_room_id
        AND b.status IN ('APPROVED', 'PENDING')
        AND b.start_time::date = CURRENT_DATE
    ORDER BY b.start_time ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_room_today_bookings IS '获取会议室今日所有预订列表';

-- ============================================
-- 5. 创建触发器函数：预订变更时发送通知
-- ============================================

CREATE OR REPLACE FUNCTION notify_booking_change()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
BEGIN
    -- 构建通知 payload
    v_payload := jsonb_build_object(
        'type', 'booking_change',
        'room_id', COALESCE(NEW.resource_id, OLD.resource_id),
        'event', TG_OP,
        'timestamp', NOW()
    );

    -- 根据操作类型添加数据
    IF TG_OP = 'DELETE' THEN
        v_payload := v_payload || jsonb_build_object('old_data', row_to_json(OLD));
    ELSIF TG_OP = 'INSERT' THEN
        v_payload := v_payload || jsonb_build_object('new_data', row_to_json(NEW));
    ELSE -- UPDATE
        v_payload := v_payload || jsonb_build_object(
            'old_data', row_to_json(OLD),
            'new_data', row_to_json(NEW)
        );
    END IF;

    -- 发送通知
    PERFORM pg_notify('booking_changes', v_payload::text);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
DROP TRIGGER IF EXISTS trg_notify_booking_change ON smartoffice_bookings;
CREATE TRIGGER trg_notify_booking_change
    AFTER INSERT OR UPDATE OR DELETE ON smartoffice_bookings
    FOR EACH ROW
    EXECUTE FUNCTION notify_booking_change();

COMMENT ON FUNCTION notify_booking_change IS '当预订数据变更时发送 PostgreSQL 通知';

-- ============================================
-- 6. 创建资源表触发器（设备信息变更通知）
-- ============================================

CREATE OR REPLACE FUNCTION notify_resource_change()
RETURNS TRIGGER AS $$
DECLARE
    v_payload JSONB;
BEGIN
    v_payload := jsonb_build_object(
        'type', 'resource_change',
        'room_id', COALESCE(NEW.id, OLD.id),
        'event', TG_OP,
        'timestamp', NOW()
    );

    IF TG_OP = 'DELETE' THEN
        v_payload := v_payload || jsonb_build_object('old_data', row_to_json(OLD));
    ELSIF TG_OP = 'INSERT' THEN
        v_payload := v_payload || jsonb_build_object('new_data', row_to_json(NEW));
    ELSE
        v_payload := v_payload || jsonb_build_object(
            'old_data', row_to_json(OLD),
            'new_data', row_to_json(NEW)
        );
    END IF;

    PERFORM pg_notify('resource_changes', v_payload::text);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_resource_change ON smartoffice_resources;
CREATE TRIGGER trg_notify_resource_change
    AFTER INSERT OR UPDATE OR DELETE ON smartoffice_resources
    FOR EACH ROW
    EXECUTE FUNCTION notify_resource_change();

-- ============================================
-- 7. 验证配置
-- ============================================

-- 检查 Realtime 是否启用
SELECT 
    c.relname as table_name,
    CASE c.relreplident 
        WHEN 'd' THEN 'default'
        WHEN 'n' THEN 'nothing'
        WHEN 'f' THEN 'full'
        WHEN 'i' THEN 'index'
    END as replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
    AND c.relname IN ('smartoffice_bookings', 'smartoffice_resources')
ORDER BY c.relname;

-- 检查触发器
SELECT 
    tgname as trigger_name,
    relname as table_name,
    proname as function_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE tgname LIKE 'trg_notify_%'
ORDER BY relname, tgname;

-- ============================================
-- 8. 测试数据（可选）
-- ============================================

-- 为测试创建示例会议室（如果不存在）
INSERT INTO smartoffice_resources (id, name, type, capacity, location, features, status)
SELECT 
    'test-display-room-001',
    '测试会议室-显示屏',
    'ROOM',
    10,
    '1楼测试区',
    ARRAY['投影仪', '白板', '视频会议'],
    'AVAILABLE'
WHERE NOT EXISTS (
    SELECT 1 FROM smartoffice_resources WHERE id = 'test-display-room-001'
);

-- 创建今日测试预订
INSERT INTO smartoffice_bookings (
    id, user_id, resource_id, type, start_time, end_time, 
    status, purpose, participants
)
SELECT 
    'test-booking-display-001',
    '00000000-0000-0000-0000-000000000011',
    'test-display-room-001',
    'ROOM',
    NOW() + INTERVAL '1 hour',
    NOW() + INTERVAL '2 hour',
    'APPROVED',
    '显示屏测试会议',
    5
WHERE NOT EXISTS (
    SELECT 1 FROM smartoffice_bookings WHERE id = 'test-booking-display-001'
);

-- ============================================
-- 完成
-- ============================================
SELECT '会议室门口显示屏功能数据库迁移完成' as status;
