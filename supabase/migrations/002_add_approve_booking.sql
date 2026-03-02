-- Migration: 002_add_approve_booking.sql
-- 添加审批审计表与原子审批函数（smartoffice_approve_booking）

BEGIN;

-- 审计表
CREATE TABLE IF NOT EXISTS smartoffice_approval_audit (
    id BIGSERIAL PRIMARY KEY,
    booking_id TEXT NOT NULL,
    node_index INTEGER NOT NULL,
    node_name TEXT,
    approver_id TEXT,
    approver_name TEXT,
    status TEXT NOT NULL CHECK (status IN ('APPROVED', 'REJECTED')),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 原子审批函数：验证 current_node_index，更新 booking，并插入审计记录（在事务内执行）
CREATE OR REPLACE FUNCTION smartoffice_approve_booking(
  p_booking_id TEXT,
  p_approver_id TEXT,
  p_approver_name TEXT,
  p_expected_node_index INTEGER,
  p_decision TEXT,
  p_comment TEXT DEFAULT NULL
)
RETURNS TABLE(
  id TEXT,
  user_id TEXT,
  resource_id TEXT,
  type TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  status TEXT,
  purpose TEXT,
  participants INTEGER,
  created_at TIMESTAMPTZ,
  current_node_index INTEGER,
  approval_history JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking RECORD;
  v_workflow_count INTEGER;
  v_is_last BOOLEAN;
  v_node_name TEXT;
  v_new_history JSONB;
BEGIN
  SELECT * INTO v_booking FROM smartoffice_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF COALESCE(v_booking.current_node_index,0) <> p_expected_node_index THEN
    RAISE EXCEPTION 'CONFLICT: booking already processed';
  END IF;

  SELECT count(*) INTO v_workflow_count FROM smartoffice_workflow;
  v_is_last := (p_expected_node_index = v_workflow_count - 1);

  SELECT name INTO v_node_name FROM smartoffice_workflow WHERE sort_order = p_expected_node_index LIMIT 1;

  -- 构造新的 approval_history
  v_new_history := COALESCE(v_booking.approval_history, '[]'::jsonb) || jsonb_build_object(
    'nodeName', v_node_name,
    'approverName', p_approver_name,
    'status', p_decision,
    'comment', p_comment,
    'timestamp', now()::text
  );

  -- 更新 booking
  UPDATE smartoffice_bookings SET
    current_node_index = CASE WHEN p_decision = 'APPROVED' AND NOT v_is_last THEN v_booking.current_node_index + 1 ELSE v_booking.current_node_index END,
    status = CASE WHEN p_decision = 'REJECTED' THEN 'REJECTED' WHEN p_decision = 'APPROVED' AND v_is_last THEN 'APPROVED' ELSE 'PENDING' END,
    approval_history = v_new_history
  WHERE id = p_booking_id;

  -- 写审计表
  INSERT INTO smartoffice_approval_audit(booking_id, node_index, node_name, approver_id, approver_name, status, comment)
    VALUES (p_booking_id, p_expected_node_index, v_node_name, p_approver_id, p_approver_name, p_decision, p_comment);

  -- 返回更新后的 booking
  RETURN QUERY SELECT id, user_id, resource_id, type, start_time, end_time, status, purpose, participants, created_at, current_node_index, approval_history FROM smartoffice_bookings WHERE id = p_booking_id;
END;
$$;

COMMIT;
