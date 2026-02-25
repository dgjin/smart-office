import { createClient } from '@supabase/supabase-js';

// Supabase 配置
const SUPABASE_URL = 'https://ggqyitnxjcbulitacogg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdncXlpdG54amNidWxpdGFjb2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NDM1NTAsImV4cCI6MjA4NjUxOTU1MH0.GDVFAwfjsheB9jujnAhIKNPXGOmsOKizLiutGJPKKYI';

// 创建 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 添加今天的预订数据
async function addTodayBookings() {
  try {
    console.log('开始添加今天的预订数据...');
    
    // 获取所有资源
    const { data: resources, error: resourcesError } = await supabase.from('smartoffice_resources').select('id, name');
    if (resourcesError) {
      console.error('获取资源失败:', resourcesError);
      return;
    }
    
    console.log('获取到资源:', resources);
    
    if (resources.length === 0) {
      console.error('没有可用资源');
      return;
    }
    
    // 准备今天的预订数据
    const today = new Date();
    const bookingsToAdd = [
      {
        user_id: '86a3ad5f-4157-4d73-a685-ac3d320330c5',
        resource_id: resources[0].id,
        type: 'ROOM',
        start_time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0).toISOString(),
        end_time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0).toISOString(),
        status: 'APPROVED',
        purpose: '团队早会',
        participants: 8,
        current_node_index: 0,
        approval_history: [],
        has_leader: false,
        leader_details: null,
        is_video_conference: false,
        needs_tea_service: false,
        needs_name_card: false,
        name_card_details: null
      },
      {
        user_id: '86a3ad5f-4157-4d73-a685-ac3d320330c5',
        resource_id: resources[1].id,
        type: 'ROOM',
        start_time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0, 0).toISOString(),
        end_time: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 15, 30, 0).toISOString(),
        status: 'APPROVED',
        purpose: '客户会议',
        participants: 12,
        current_node_index: 0,
        approval_history: [],
        has_leader: true,
        leader_details: '张总',
        is_video_conference: true,
        needs_tea_service: true,
        needs_name_card: true,
        name_card_details: '客户公司名称'
      }
    ];
    
    console.log('准备添加的预订数据:', bookingsToAdd);
    
    // 批量添加预订
    for (const booking of bookingsToAdd) {
      const { data, error } = await supabase.from('smartoffice_bookings').insert(booking);
      if (error) {
        console.error('添加预订失败:', error);
      } else {
        console.log('添加预订成功:', data);
      }
    }
    
    console.log('添加今天的预订数据完成');
    
  } catch (error: any) {
    console.error('添加预订数据异常:', error?.message || error);
  }
}

// 运行测试
addTodayBookings();
