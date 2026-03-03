import { supabase } from '../services/supabaseService';

/**
 * 获取服务器当前时间
 * 使用 Supabase 的 now() 函数获取服务器时间，避免客户端时间不准确的问题
 * @returns {Promise<Date>} 服务器当前时间
 */
export async function getServerTime(): Promise<Date> {
  try {
    const { data, error } = await supabase.rpc('get_server_time');
    if (error) {
      console.warn('获取服务器时间失败，使用本地时间:', error);
      return new Date();
    }
    return new Date(data);
  } catch (error) {
    console.warn('获取服务器时间异常，使用本地时间:', error);
    return new Date();
  }
}

/**
 * 获取今天的日期字符串（基于服务器时间）
 * @returns {Promise<string>} 格式为 YYYY-MM-DD 的日期字符串
 */
export async function getServerToday(): Promise<string> {
  const serverTime = await getServerTime();
  return serverTime.toISOString().split('T')[0];
}

/**
 * 检查日期是否早于今天（基于服务器时间）
 * @param {string} dateStr - 格式为 YYYY-MM-DD 的日期字符串
 * @returns {Promise<boolean>} 如果日期早于今天返回 true
 */
export async function isDateBeforeToday(dateStr: string): Promise<boolean> {
  const serverToday = await getServerToday();
  return dateStr < serverToday;
}

/**
 * 检查日期时间是否已经过去（基于服务器时间）
 * @param {Date} dateTime - 要检查的日期时间
 * @returns {Promise<boolean>} 如果日期时间已经过去返回 true
 */
export async function isDateTimeInPast(dateTime: Date): Promise<boolean> {
  const serverTime = await getServerTime();
  return dateTime < serverTime;
}

/**
 * 同步获取服务器时间（用于初始化，可能不是最新的）
 * 注意：此函数返回组件挂载时获取的时间，可能不是实时的服务器时间
 * 对于关键操作，请使用 getServerTime()
 * @returns {Date} 服务器时间或本地时间
 */
let cachedServerTime: Date | null = null;

export function getCachedServerTime(): Date {
  if (cachedServerTime) {
    return new Date(cachedServerTime.getTime() + (Date.now() - cachedServerTime.getTime()));
  }
  return new Date();
}

/**
 * 初始化服务器时间缓存
 * 应在应用启动时调用
 */
export async function initServerTimeCache(): Promise<void> {
  cachedServerTime = await getServerTime();
}

/**
 * 获取今天的日期字符串（同步版本，使用缓存）
 * @returns {string} 格式为 YYYY-MM-DD 的日期字符串
 */
export function getTodayString(): string {
  return getCachedServerTime().toISOString().split('T')[0];
}

/**
 * 检查日期是否早于今天（同步版本，使用缓存）
 * @param {string} dateStr - 格式为 YYYY-MM-DD 的日期字符串
 * @returns {boolean} 如果日期早于今天返回 true
 */
export function isDateDisabled(dateStr: string): boolean {
  const today = getTodayString();
  return dateStr < today;
}

/**
 * 格式化日期显示
 * @param {string} dateStr - 格式为 YYYY-MM-DD 的日期字符串
 * @returns {string} 格式为 M月D日 的日期字符串
 */
export function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 格式化日期时间显示
 * @param {string} dateTimeStr - ISO 格式的日期时间字符串
 * @returns {string} 格式为 HH:MM 的时间字符串
 */
export function formatTimeDisplay(dateTimeStr: string): string {
  const date = new Date(dateTimeStr);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
