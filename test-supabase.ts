import { createClient } from '@supabase/supabase-js';

// Supabase 配置
const SUPABASE_URL = 'https://ggqyitnxjcbulitacogg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdncXlpdG54amNidWxpdGFjb2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NDM1NTAsImV4cCI6MjA4NjUxOTU1MH0.GDVFAwfjsheB9jujnAhIKNPXGOmsOKizLiutGJPKKYI';

// 创建 Supabase 客户端
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 测试连接
async function testConnection() {
  try {
    console.log('开始测试Supabase连接...');
    console.log('Supabase URL:', SUPABASE_URL);
    console.log('Supabase Key 是否存在:', !!SUPABASE_ANON_KEY);
    
    const { data, error } = await supabase.from('smartoffice_bookings').select('*').limit(1);
    if (error) {
      console.error('Supabase 连接测试失败:', error);
      return false;
    }
    console.log('连接成功，数据:', data);
    return true;
  } catch (error: any) {
    console.error('Supabase 连接测试异常:', error?.message || error);
    return false;
  }
}

// 测试资源数据
async function testResources() {
  try {
    console.log('开始测试获取资源数据...');
    const { data, error } = await supabase.from('smartoffice_resources').select('*');
    if (error) {
      console.error('获取资源数据失败:', error);
      return false;
    }
    console.log('获取到资源数据:', data.length);
    console.log('资源数据示例:', data.slice(0, 2));
    return true;
  } catch (error: any) {
    console.error('获取资源数据异常:', error?.message || error);
    return false;
  }
}

// 测试预订数据
async function testBookings() {
  try {
    console.log('开始测试获取预订数据...');
    const { data, error } = await supabase.from('smartoffice_bookings').select('*');
    if (error) {
      console.error('获取预订数据失败:', error);
      return false;
    }
    console.log('获取到预订数据:', data.length);
    console.log('预订数据示例:', data.slice(0, 2));
    return true;
  } catch (error: any) {
    console.error('获取预订数据异常:', error?.message || error);
    return false;
  }
}

// 测试所有预订日期
async function testBookingDates() {
  try {
    console.log('开始测试获取所有预订日期...');
    const { data, error } = await supabase.from('smartoffice_bookings').select('start_time, status');
    if (error) {
      console.error('获取预订日期失败:', error);
      return false;
    }
    console.log('所有预订日期:');
    data.forEach((booking, index) => {
      console.log(`${index + 1}. 日期: ${booking.start_time}, 状态: ${booking.status}`);
    });
    return true;
  } catch (error: any) {
    console.error('获取预订日期异常:', error?.message || error);
    return false;
  }
}

// 运行所有测试
async function runTests() {
  console.log('=== Supabase 连接测试 ===');
  await testConnection();
  console.log('\n=== 资源数据测试 ===');
  await testResources();
  console.log('\n=== 预订数据测试 ===');
  await testBookings();
  console.log('\n=== 预订日期测试 ===');
  await testBookingDates();
  console.log('\n=== 测试完成 ===');
}

runTests();
