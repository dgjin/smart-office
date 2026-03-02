#!/usr/bin/env node
/**
 * 智慧办公空间管理系统 - 示例数据生成脚本
 * 
 * 此脚本生成示例预订数据，用于开发和测试环境
 * 运行方式: node scripts/seed-sample-data.js
 * 
 * 环境变量:
 *   VITE_SUPABASE_URL - Supabase 项目 URL
 *   VITE_SUPABASE_ANON_KEY - Supabase 匿名密钥
 */

const { createClient } = require('@supabase/supabase-js');

// 配置
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ 错误: 请设置环境变量 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY');
  console.error('示例:');
  console.error('  export VITE_SUPABASE_URL=https://your-project.supabase.co');
  console.error('  export VITE_SUPABASE_ANON_KEY=your-anon-key');
  process.exit(1);
}

// 创建 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 示例数据配置
const CONFIG = {
  // 生成的预订数量
  bookingCount: 50,
  // 日期范围（前后天数）
  dateRange: 14,
  // 时间段配置
  timeSlots: [
    { start: 9, end: 10 },   // 09:00-10:00
    { start: 10, end: 11 },  // 10:00-11:00
    { start: 11, end: 12 },  // 11:00-12:00
    { start: 14, end: 15 },  // 14:00-15:00
    { start: 15, end: 16 },  // 15:00-16:00
    { start: 16, end: 17 },  // 16:00-17:00
    { start: 14, end: 16 },  // 14:00-16:00 (2小时)
    { start: 9, end: 12 },   // 09:00-12:00 (3小时)
  ],
  // 会议用途
  purposes: [
    '周例会',
    '项目评审',
    '需求讨论',
    '技术分享',
    '客户会议',
    '团队建设',
    '产品规划',
    '代码评审',
    '培训会议',
    '季度总结',
    '头脑风暴',
    '部门协调',
    '战略规划',
    '新员工面试',
    '供应商谈判',
  ],
  // 预订状态分布
  statusWeights: {
    'APPROVED': 60,   // 60% 已批准
    'PENDING': 20,    // 20% 待审批
    'REJECTED': 5,    // 5% 已拒绝
    'CANCELLED': 5,   // 5% 已取消
    'COMPLETED': 10,  // 10% 已完成
  },
};

/**
 * 获取随机元素
 */
function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * 获取加权随机状态
 */
function randomStatus() {
  const weights = Object.entries(CONFIG.statusWeights);
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let random = Math.random() * total;
  
  for (const [status, weight] of weights) {
    random -= weight;
    if (random <= 0) return status;
  }
  return 'PENDING';
}

/**
 * 生成随机日期时间
 */
function randomDateTime(daysOffset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * 生成审批历史
 */
function generateApprovalHistory(status) {
  const history = [];
  
  if (status === 'PENDING') {
    return history;
  }
  
  if (status === 'APPROVED' || status === 'COMPLETED') {
    history.push({
      nodeName: '部门初审',
      approverName: '审批专员',
      status: 'APPROVED',
      comment: '符合要求，同意',
      timestamp: new Date(Date.now() - Math.random() * 86400000 * 2).toISOString(),
    });
    history.push({
      nodeName: '行政复审',
      approverName: '系统管理员',
      status: 'APPROVED',
      comment: '审核通过',
      timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    });
  }
  
  if (status === 'REJECTED') {
    history.push({
      nodeName: '部门初审',
      approverName: '审批专员',
      status: 'REJECTED',
      comment: '时间冲突，请选择其他时段',
      timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
    });
  }
  
  return history;
}

/**
 * 获取基础数据
 */
async function getBaseData() {
  console.log('📊 正在获取基础数据...');
  
  // 获取用户
  const { data: users, error: userError } = await supabase
    .from('smartoffice_users')
    .select('id, name, department');
  
  if (userError) throw new Error(`获取用户失败: ${userError.message}`);
  
  // 获取资源
  const { data: resources, error: resourceError } = await supabase
    .from('smartoffice_resources')
    .select('id, name, type, capacity');
  
  if (resourceError) throw new Error(`获取资源失败: ${resourceError.message}`);
  
  // 获取会议室
  const rooms = resources.filter(r => r.type === 'ROOM');
  const desks = resources.filter(r => r.type === 'DESK');
  
  console.log(`   ✓ 用户: ${users.length} 人`);
  console.log(`   ✓ 会议室: ${rooms.length} 间`);
  console.log(`   ✓ 工位: ${desks.length} 个`);
  
  return { users, rooms, desks };
}

/**
 * 生成预订数据
 */
function generateBookings(users, rooms, count) {
  const bookings = [];
  const usedSlots = new Set(); // 用于简单冲突检测
  
  let attempts = 0;
  const maxAttempts = count * 10;
  
  while (bookings.length < count && attempts < maxAttempts) {
    attempts++;
    
    const user = randomElement(users);
    const room = randomElement(rooms);
    const timeSlot = randomElement(CONFIG.timeSlots);
    
    // 随机日期（前后14天）
    const daysOffset = Math.floor(Math.random() * CONFIG.dateRange * 2) - CONFIG.dateRange;
    const date = randomDateTime(daysOffset);
    
    // 构建时间
    const startTime = new Date(date);
    startTime.setHours(timeSlot.start, 0, 0, 0);
    
    const endTime = new Date(date);
    endTime.setHours(timeSlot.end, 0, 0, 0);
    
    // 简单冲突检测键
    const slotKey = `${room.id}_${startTime.toISOString()}`;
    if (usedSlots.has(slotKey)) continue;
    
    // 根据时间决定状态（过去的已完成，未来的随机）
    let status;
    const now = new Date();
    if (endTime < now) {
      status = Math.random() > 0.3 ? 'COMPLETED' : 'CANCELLED';
    } else if (startTime < now && endTime > now) {
      status = 'APPROVED'; // 正在进行中
    } else {
      status = randomStatus();
    }
    
    // 生成参与人数
    const participants = Math.floor(Math.random() * room.capacity) + 1;
    
    // 生成附加服务
    const hasLeader = Math.random() > 0.8;
    const isVideoConference = room.features?.includes('视频会议') && Math.random() > 0.5;
    const needsTeaService = Math.random() > 0.7;
    const needsNameCard = hasLeader && Math.random() > 0.5;
    
    const booking = {
      user_id: user.id,
      resource_id: room.id,
      type: 'ROOM',
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      status: status,
      purpose: randomElement(CONFIG.purposes),
      participants: participants,
      current_node_index: status === 'PENDING' ? 0 : (status === 'APPROVED' || status === 'COMPLETED' ? 2 : 0),
      approval_history: generateApprovalHistory(status),
      has_leader: hasLeader,
      leader_details: hasLeader ? '张总、李总监' : null,
      is_video_conference: isVideoConference,
      needs_tea_service: needsTeaService,
      needs_name_card: needsNameCard,
      name_card_details: needsNameCard ? '张总-CEO, 李总监-CTO' : null,
    };
    
    bookings.push(booking);
    usedSlots.add(slotKey);
  }
  
  return bookings;
}

/**
 * 插入预订数据
 */
async function insertBookings(bookings) {
  console.log(`\n📝 正在插入 ${bookings.length} 条预订记录...`);
  
  // 批量插入（每批20条）
  const batchSize = 20;
  let inserted = 0;
  let failed = 0;
  
  for (let i = 0; i < bookings.length; i += batchSize) {
    const batch = bookings.slice(i, i + batchSize);
    
    const { data, error } = await supabase
      .from('smartoffice_bookings')
      .insert(batch);
    
    if (error) {
      console.error(`   ❌ 批次 ${Math.floor(i / batchSize) + 1} 插入失败:`, error.message);
      failed += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`   ✓ 已插入 ${inserted}/${bookings.length}\r`);
    }
    
    // 添加小延迟避免限流
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`\n   ✓ 成功: ${inserted}, 失败: ${failed}`);
  return { inserted, failed };
}

/**
 * 统计信息
 */
async function printStatistics() {
  console.log('\n📈 数据统计:');
  
  // 按状态统计
  const { data: statusStats, error: statusError } = await supabase
    .from('smartoffice_bookings')
    .select('status')
    .then(({ data }) => {
      if (!data) return { data: [] };
      const stats = {};
      data.forEach(b => {
        stats[b.status] = (stats[b.status] || 0) + 1;
      });
      return { data: stats };
    });
  
  if (!statusError) {
    console.log('   预订状态分布:');
    Object.entries(statusStats).forEach(([status, count]) => {
      const emoji = {
        'APPROVED': '✅',
        'PENDING': '⏳',
        'REJECTED': '❌',
        'CANCELLED': '🚫',
        'COMPLETED': '✨',
      }[status] || '📋';
      console.log(`     ${emoji} ${status}: ${count} 条`);
    });
  }
  
  // 今日预订
  const today = new Date().toISOString().split('T')[0];
  const { count: todayCount, error: todayError } = await supabase
    .from('smartoffice_bookings')
    .select('*', { count: 'exact', head: true })
    .gte('start_time', today)
    .lt('start_time', today + 'T23:59:59');
  
  if (!todayError) {
    console.log(`   📅 今日预订: ${todayCount} 条`);
  }
  
  // 本周预订
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const { count: weekCount, error: weekError } = await supabase
    .from('smartoffice_bookings')
    .select('*', { count: 'exact', head: true })
    .gte('start_time', weekStart.toISOString());
  
  if (!weekError) {
    console.log(`   📊 本周预订: ${weekCount} 条`);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 智慧办公空间管理系统 - 示例数据生成\n');
  
  try {
    // 获取基础数据
    const { users, rooms, desks } = await getBaseData();
    
    if (users.length === 0) {
      console.error('❌ 错误: 没有用户数据，请先运行 init-data.sql');
      process.exit(1);
    }
    
    if (rooms.length === 0) {
      console.error('❌ 错误: 没有会议室资源，请先运行 init-data.sql');
      process.exit(1);
    }
    
    // 生成预订数据
    console.log(`\n🎯 生成 ${CONFIG.bookingCount} 条预订记录...`);
    const bookings = generateBookings(users, rooms, CONFIG.bookingCount);
    console.log(`   ✓ 生成成功: ${bookings.length} 条`);
    
    // 插入数据
    const { inserted, failed } = await insertBookings(bookings);
    
    // 显示统计
    await printStatistics();
    
    console.log('\n✨ 完成!');
    console.log(`\n提示:`);
    console.log(`  - 默认管理员账号: admin@company.com / admin123`);
    console.log(`  - 审批人账号: approver@company.com / approver123`);
    console.log(`  - 普通员工账号: zhangsan@company.com / user123`);
    
  } catch (error) {
    console.error('\n❌ 错误:', error.message);
    process.exit(1);
  }
}

// 运行
main();
