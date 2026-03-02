import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('请在环境变量中设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function run() {
  const bookingId = process.env.TEST_BOOKING_ID;
  const approverId = process.env.TEST_APPROVER_ID || '2';
  const approverName = process.env.TEST_APPROVER_NAME || 'approver@company.com';
  const expectedNodeIndex = Number(process.env.TEST_NODE_INDEX || '0');

  if (!bookingId) {
    console.error('请设置 TEST_BOOKING_ID 环境变量');
    process.exit(1);
  }

  try {
    const { data, error } = await supabase.rpc('smartoffice_approve_booking', {
      p_booking_id: bookingId,
      p_approver_id: approverId,
      p_approver_name: approverName,
      p_expected_node_index: expectedNodeIndex,
      p_decision: 'APPROVED',
      p_comment: '测试通过',
    });

    if (error) {
      console.error('RPC 调用失败:', error);
      process.exit(1);
    }

    console.log('RPC 返回:', data);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

run();
