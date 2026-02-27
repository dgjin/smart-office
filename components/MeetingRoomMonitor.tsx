import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Clock, Users, MapPin, RefreshCw, Monitor, TrendingUp, AlertCircle, ChevronDown, ChevronUp, Filter, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Booking, Resource } from '../types';

interface MeetingRoomMonitorProps {
  bookings: Booking[];
  resources: Resource[];
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ['日', '一', '二', '三', '四', '五', '六'];
const ITEMS_PER_PAGE = 5;

export const MeetingRoomMonitor: React.FC<MeetingRoomMonitorProps> = ({ bookings, resources }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  
  // 初始化selectedRoom
  useEffect(() => {
    if (resources.length > 0 && !selectedRoom) {
      const firstResourceWithId = resources.find(r => r.id);
      if (firstResourceWithId) {
        setSelectedRoom(firstResourceWithId.id);
      }
    }
  }, [resources]);

  // 确保selectedRoom有值
  const effectiveSelectedRoom = selectedRoom || (resources.find(r => r.id)?.id || null);
  
  // 预订列表状态
  const [currentPage, setCurrentPage] = useState(1);
  const [filterRoom, setFilterRoom] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'time' | 'room' | 'status'>('time');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedBooking, setExpandedBooking] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');



  const meetingRooms = useMemo(() => {
    return resources.filter(r => {
      try {
        return r && typeof r === 'object' && r.type && r.type.toUpperCase() === 'ROOM';
      } catch (e) {
        return false;
      }
    });
  }, [resources]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    console.log('MeetingRoomMonitor: 检查selectedRoom初始化', { meetingRoomsLength: meetingRooms.length, currentSelectedRoom: selectedRoom });
    if (meetingRooms.length > 0 && !selectedRoom) {
      console.log('MeetingRoomMonitor: 设置默认selectedRoom为', meetingRooms[0].id, meetingRooms[0].name);
      setSelectedRoom(meetingRooms[0].id);
    }
  }, [meetingRooms, selectedRoom]);

  const getWeekDates = useMemo(() => {
    console.log('MeetingRoomMonitor: 生成getWeekDates');
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push(date);
    }
    return dates;
  }, []);

  // 正确处理UTC时间的日期格式
  const getLocalDateStr = (date: Date) => {
    // 确保输入是Date对象
    if (!(date instanceof Date)) {
      date = new Date(date);
    }
    // 使用UTC方法获取日期，确保时区一致性
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 调试：打印当前日期和时间
  useEffect(() => {
    const now = new Date();
    console.log('当前时间:', now);
    console.log('当前时间（UTC）:', now.toUTCString());
    console.log('当前日期字符串:', getLocalDateStr(now));
    
    // 打印今天的预订
    const todayBookings = getBookingsForDate(now);
    console.log('今天的预订:', todayBookings.length);
    todayBookings.forEach(b => {
      console.log('  -', b.id, b.purpose, b.startTime, b.status);
    });
  }, [bookings]);

  // 调试：打印所有预订的日期
  useEffect(() => {
    const today = new Date();
    const todayStr = getLocalDateStr(today);
    console.log('今天日期:', todayStr);
    console.log('所有预订日期:');
    bookings.forEach(b => {
      if (b.startTime) {
        const bookingDate = new Date(b.startTime);
        const bookingDateStr = getLocalDateStr(bookingDate);
        console.log('  -', b.id, '原始:', b.startTime, '本地日期:', bookingDateStr, '状态:', b.status);
      }
    });
  }, [bookings]);

  const getBookingsForDate = (date: Date, roomId?: string) => {
    const dateStr = getLocalDateStr(date);
    console.log('getBookingsForDate 调用:', { dateStr, roomId, bookingsCount: bookings.length });
    
    // 如果没有预订数据，返回空数组
    if (!bookings || bookings.length === 0) {
      console.log('没有预订数据');
      return [];
    }
    
    const filtered = bookings.filter(b => {
      try {
        if (!b || typeof b !== 'object') return false;
        if (!b.startTime) return false;
        const bookingDate = new Date(b.startTime);
        if (isNaN(bookingDate.getTime())) return false;
        const bookingDateStr = getLocalDateStr(bookingDate);
        const matchDate = bookingDateStr === dateStr;
        const matchRoom = roomId ? b.resourceId === roomId : true;
        const status = b.status || '';
        const isActive = !['REJECTED', 'CANCELLED'].includes(status);
        console.log('过滤预订:', { id: b.id, date: bookingDateStr, matchDate, matchRoom, status, isActive });
        return matchDate && matchRoom && isActive;
      } catch (e) {
        console.error('过滤预订出错:', e);
        return false;
      }
    });
    console.log('过滤结果:', filtered.length);
    return filtered;
  };

  const getBookingForHour = (date: Date, hour: number, roomId: string) => {
    const dateStr = getLocalDateStr(date);
    return bookings.find(b => {
      try {
        if (!b || typeof b !== 'object') return false;
        if (!b.startTime || !b.endTime) return false;
        const start = new Date(b.startTime);
        const end = new Date(b.endTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
        const bookingDate = getLocalDateStr(start);
        const status = b.status || '';
        // 使用本地时间进行比较
        const startHour = start.getHours();
        const endHour = end.getHours();
        return bookingDate === dateStr && 
               b.resourceId === roomId && 
               hour >= startHour && 
               hour < endHour &&
               !['REJECTED', 'CANCELLED'].includes(status);
      } catch (e) {
        return false;
      }
    });
  };

  const getTodayStats = useMemo(() => {
    const today = new Date();
    const todayBookings = getBookingsForDate(today);
    
    const totalHours = todayBookings.reduce((acc, b) => {
      try {
        if (!b || !b.startTime || !b.endTime) return acc;
        const start = new Date(b.startTime);
        const end = new Date(b.endTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return acc;
        return acc + (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      } catch (e) {
        return acc;
      }
    }, 0);
    
    const currentUTCHour = currentTime.getUTCHours();
    const ongoingMeetings = todayBookings.filter(b => {
      try {
        if (!b || !b.startTime || !b.endTime) return false;
        const start = new Date(b.startTime);
        const end = new Date(b.endTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
        const startHour = start.getUTCHours();
        const endHour = end.getUTCHours();
        return currentUTCHour >= startHour && currentUTCHour < endHour;
      } catch (e) {
        return false;
      }
    });

    const stats = {
      totalBookings: todayBookings.length,
      totalHours: Math.round(totalHours * 10) / 10,
      ongoingMeetings: ongoingMeetings.length,
      utilizationRate: Math.round((totalHours / 12) * 100)
    };
    return stats;
  }, [bookings, currentTime]);

  const getWeekStats = useMemo(() => {
    const weekBookings = getWeekDates.flatMap(date => getBookingsForDate(date));
    const totalHours = weekBookings.reduce((acc, b) => {
      try {
        if (!b || !b.startTime || !b.endTime) return acc;
        const start = new Date(b.startTime);
        const end = new Date(b.endTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return acc;
        return acc + (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      } catch (e) {
        return acc;
      }
    }, 0);

    return {
      totalBookings: weekBookings.length,
      totalHours: Math.round(totalHours * 10) / 10,
      avgPerDay: Math.round(weekBookings.length / 7 * 10) / 10
    };
  }, [bookings, getWeekDates]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED': return 'bg-green-500';
      case 'PENDING': return 'bg-yellow-500';
      case 'REJECTED': return 'bg-red-400';
      case 'CANCELLED': return 'bg-gray-400';
      default: return 'bg-blue-400';
    }
  };

  const formatTime = (date: Date) => {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const currentHour = currentTime.getHours();
  const currentMinute = currentTime.getMinutes();

  // 如果没有会议室，显示简单提示
  if (meetingRooms.length === 0) {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-6 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">会议室预订监控大屏</h1>
          <p className="text-slate-400 mb-4">暂无会议室数据</p>
          <p className="text-sm text-slate-500">资源总数: {resources.length}</p>
          <p className="text-sm text-slate-500">预约总数: {bookings.length}</p>
          <p className="text-sm text-slate-500 mt-4">正在连接到服务器...</p>
          <button 
            onClick={() => {
              console.log('手动刷新数据');
              // 尝试手动刷新数据
              window.location.reload();
            }}
            className="mt-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            手动刷新
          </button>
        </div>
      </div>
    );
  }

  // 调试：打印当前状态
  useEffect(() => {
    console.log('MeetingRoomMonitor 渲染状态:', {
      meetingRoomsLength: meetingRooms.length,
      bookingsLength: bookings.length,
      selectedRoom: selectedRoom,
      effectiveSelectedRoom: effectiveSelectedRoom
    });
  }, [meetingRooms, bookings, selectedRoom, effectiveSelectedRoom]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Monitor size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">会议室预订监控大屏</h1>
            <p className="text-slate-400 text-sm">实时监控 · 智能分析</p>
          </div>
        </div>
        <div className="flex items-center space-x-6">
          <div className="text-right">
            <p className="text-3xl font-bold">{formatTime(currentTime)}</p>
            <p className="text-slate-400 text-sm">
              {currentTime.getFullYear()}年{currentTime.getMonth() + 1}月{currentTime.getDate()}日 周{DAYS[currentTime.getDay()]}
            </p>
          </div>
          <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center animate-pulse">
            <RefreshCw size={18} className="text-blue-400" />
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <Calendar size={20} className="text-blue-200" />
            <span className="text-xs bg-blue-500/50 px-2 py-1 rounded-full">今日</span>
          </div>
          <p className="text-3xl font-bold">{getTodayStats.totalBookings}</p>
          <p className="text-blue-200 text-sm">预订会议数</p>
        </div>

        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <Clock size={20} className="text-emerald-200" />
            <span className="text-xs bg-emerald-500/50 px-2 py-1 rounded-full">今日</span>
          </div>
          <p className="text-3xl font-bold">{getTodayStats.totalHours}<span className="text-lg">h</span></p>
          <p className="text-emerald-200 text-sm">预订总时长</p>
        </div>

        <div className="bg-gradient-to-br from-amber-600 to-amber-700 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <Users size={20} className="text-amber-200" />
            <span className="text-xs bg-amber-500/50 px-2 py-1 rounded-full">进行中</span>
          </div>
          <p className="text-3xl font-bold">{getTodayStats.ongoingMeetings}</p>
          <p className="text-amber-200 text-sm">正在进行会议</p>
        </div>

        <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <TrendingUp size={20} className="text-purple-200" />
            <span className="text-xs bg-purple-500/50 px-2 py-1 rounded-full">本周</span>
          </div>
          <p className="text-3xl font-bold">{getWeekStats.totalBookings}</p>
          <p className="text-purple-200 text-sm">本周预订总数</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Today's Schedule */}
        <div className="col-span-2 bg-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center">
              <Clock size={18} className="mr-2 text-blue-400" />
              今日会议室使用情况
            </h2>
            <div className="flex items-center space-x-2">
              {meetingRooms.length > 0 ? meetingRooms.map(room => (
                <button
                  key={room.id}
                  onClick={() => setSelectedRoom(room.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    effectiveSelectedRoom === room.id 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {room.name}
                </button>
              )) : (
                <span className="text-xs text-slate-500">暂无会议室</span>
              )}
            </div>
          </div>

          {/* Time Grid */}
          <div className="relative">
            {/* Hour labels */}
            <div className="flex mb-2 pl-16">
              {HOURS.filter(h => h >= 7 && h <= 21).map(hour => (
                <div key={hour} className="flex-1 text-center text-xs text-slate-500">
                  {String(hour).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {/* Current time indicator */}
            <div 
              className="absolute top-8 h-24 w-0.5 bg-red-500 z-10"
              style={{ 
                left: `calc(4rem + ${(currentHour - 7 + currentMinute / 60) / 15 * 100}%)`,
              }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full" />
            </div>

            {/* Room rows */}
            {meetingRooms.map(room => (
              <div key={room.id} className="flex items-center mb-2">
                <div className="w-16 text-xs text-slate-400 truncate pr-2">{room.name}</div>
                <div className="flex-1 flex h-10 bg-slate-700/50 rounded-lg overflow-hidden">
                  {HOURS.filter(h => h >= 7 && h <= 20).map(hour => {
                    const booking = getBookingForHour(new Date(), hour, room.id);
                    const isCurrentHour = hour >= currentHour && hour < currentHour + 1;
                    const isFirstHourOfBooking = booking && new Date(booking.startTime).getHours() === hour;
                    
                    return (
                      <div 
                        key={hour} 
                        className={`flex-1 border-r border-slate-600/30 relative ${
                          booking ? getStatusColor(booking.status) : ''
                        } ${isCurrentHour ? 'bg-slate-600/30' : ''}`}
                        title={booking ? `${booking.purpose} (${formatTime(new Date(booking.startTime))}-${formatTime(new Date(booking.endTime))})` : ''}
                      >
                        {/* 在预订色块上显示会议室名称 */}
                        {booking && isFirstHourOfBooking && (
                          <div className="absolute inset-0 flex items-center justify-center px-1">
                            <span className="text-[10px] font-bold text-white truncate drop-shadow-md">
                              {room.name.split(' ')[0]}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center space-x-4 mt-4 text-xs">
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 bg-emerald-500 rounded" />
              <span className="text-slate-400">已确认</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 bg-amber-500 rounded" />
              <span className="text-slate-400">待审批</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3 bg-slate-600 rounded" />
              <span className="text-slate-400">空闲</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-1.5 h-3 bg-red-500 rounded" />
              <span className="text-slate-400">当前时间</span>
            </div>
          </div>
        </div>

        {/* Today's Booking List */}
        <div className="bg-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center">
              <Calendar size={18} className="mr-2 text-emerald-400" />
              今日预订列表
              <span className="ml-2 text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-400">
                {getBookingsForDate(new Date()).length}
              </span>
            </h2>
          </div>

          {/* 筛选和搜索 */}
          <div className="space-y-3 mb-4">
            {/* 搜索框 */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="搜索会议室或预订人..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-700/50 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
            
            {/* 筛选器 */}
            <div className="flex flex-wrap gap-2">
              <select
                value={filterRoom}
                onChange={(e) => { setFilterRoom(e.target.value); setCurrentPage(1); }}
                className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="all">全部会议室</option>
                {meetingRooms.map(room => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
              
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
                className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="all">全部状态</option>
                <option value="APPROVED">已确认</option>
                <option value="PENDING">待审批</option>
                <option value="ONGOING">进行中</option>
              </select>
              
              <button
                onClick={() => {
                  if (sortBy === 'time') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortBy('time');
                    setSortOrder('asc');
                  }
                }}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  sortBy === 'time' ? 'bg-emerald-600 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <Clock size={12} />
                <span>时间 {sortBy === 'time' && (sortOrder === 'asc' ? '↑' : '↓')}</span>
              </button>
              
              <button
                onClick={() => {
                  if (sortBy === 'room') {
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  } else {
                    setSortBy('room');
                    setSortOrder('asc');
                  }
                }}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  sortBy === 'room' ? 'bg-emerald-600 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                }`}
              >
                <MapPin size={12} />
                <span>会议室 {sortBy === 'room' && (sortOrder === 'asc' ? '↑' : '↓')}</span>
              </button>
            </div>
          </div>

          {/* 预订列表 */}
          <div className="space-y-2">
            {(() => {
              const today = new Date();
              let filteredBookings = getBookingsForDate(today);
              
              // 搜索筛选
              if (searchQuery) {
                filteredBookings = filteredBookings.filter(b => {
                  const room = resources.find(r => r.id === b.resourceId);
                  return room?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         b.purpose?.toLowerCase().includes(searchQuery.toLowerCase());
                });
              }
              
              // 会议室筛选
              if (filterRoom !== 'all') {
                filteredBookings = filteredBookings.filter(b => b.resourceId === filterRoom);
              }
              
              // 状态筛选
              if (filterStatus !== 'all') {
                if (filterStatus === 'ONGOING') {
                  filteredBookings = filteredBookings.filter(b => {
                    const start = new Date(b.startTime);
                    const end = new Date(b.endTime);
                    // 使用UTC时间进行比较，确保时区一致性
                    const startHour = start.getUTCHours();
                    const endHour = end.getUTCHours();
                    const currentUTCHour = new Date().getUTCHours();
                    return currentUTCHour >= startHour && currentUTCHour < endHour;
                  });
                } else {
                  filteredBookings = filteredBookings.filter(b => b.status === filterStatus);
                }
              }
              
              // 排序
              filteredBookings.sort((a, b) => {
                let comparison = 0;
                if (sortBy === 'time') {
                  comparison = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
                } else if (sortBy === 'room') {
                  const roomA = resources.find(r => r.id === a.resourceId)?.name || '';
                  const roomB = resources.find(r => r.id === b.resourceId)?.name || '';
                  comparison = roomA.localeCompare(roomB);
                } else if (sortBy === 'status') {
                  comparison = a.status.localeCompare(b.status);
                }
                return sortOrder === 'asc' ? comparison : -comparison;
              });
              
              // 分页
              const totalPages = Math.ceil(filteredBookings.length / ITEMS_PER_PAGE);
              const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
              const paginatedBookings = filteredBookings.slice(startIndex, startIndex + ITEMS_PER_PAGE);
              
              if (filteredBookings.length === 0) {
                return (
                  <div className="text-center py-8 text-slate-500">
                    <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                    <p>暂无符合条件的预订</p>
                  </div>
                );
              }
              
              return (
                <>
                  {paginatedBookings.map(booking => {
                    const room = resources.find(r => r.id === booking.resourceId);
                    const start = new Date(booking.startTime);
                    const end = new Date(booking.endTime);
                    const isOngoing = currentHour >= start.getHours() && currentHour < end.getHours();
                    const isExpanded = expandedBooking === booking.id;
                    
                    return (
                      <div 
                        key={booking.id} 
                        className={`rounded-xl overflow-hidden transition-all ${
                          isOngoing ? 'bg-emerald-900/30 border border-emerald-500/30' : 'bg-slate-700/50'
                        }`}
                      >
                        {/* 主要信息 - 始终显示 */}
                        <div 
                          className="p-3 cursor-pointer"
                          onClick={() => setExpandedBooking(isExpanded ? null : booking.id)}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <span className="font-medium text-sm">{booking.purpose}</span>
                              {isOngoing && (
                                <span className="text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                                  进行中
                                </span>
                              )}
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                booking.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400' :
                                booking.status === 'PENDING' ? 'bg-amber-500/20 text-amber-400' :
                                'bg-slate-500/20 text-slate-400'
                              }`}>
                                {booking.status === 'APPROVED' ? '已确认' :
                                 booking.status === 'PENDING' ? '待审批' :
                                 booking.status === 'REJECTED' ? '已拒绝' : '已取消'}
                              </span>
                              {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                            </div>
                          </div>
                          <div className="flex items-center text-xs text-slate-400 space-x-3">
                            <span className="flex items-center">
                              <MapPin size={12} className="mr-1" />
                              {room?.name}
                            </span>
                            <span className="flex items-center">
                              <Clock size={12} className="mr-1" />
                              {formatTime(start)}-{formatTime(end)}
                            </span>
                          </div>
                        </div>
                        
                        {/* 详细信息 - 点击展开 */}
                        {isExpanded && (
                          <div className="px-3 pb-3 border-t border-slate-600/30 pt-2">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="text-slate-500">参与人数</div>
                              <div className="text-slate-300">{booking.participants || 0} 人</div>
                              
                              {booking.hasLeader && (
                                <>
                                  <div className="text-slate-500">领导参会</div>
                                  <div className="text-slate-300">{booking.leaderDetails || '是'}</div>
                                </>
                              )}
                              
                              {booking.isVideoConference && (
                                <>
                                  <div className="text-slate-500">视频会议</div>
                                  <div className="text-slate-300">需要</div>
                                </>
                              )}
                              
                              {booking.needsTeaService && (
                                <>
                                  <div className="text-slate-500">茶水服务</div>
                                  <div className="text-slate-300">已预约</div>
                                </>
                              )}
                              
                              {booking.needsNameCard && (
                                <>
                                  <div className="text-slate-500">桌牌</div>
                                  <div className="text-slate-300">{booking.nameCardDetails || '需要'}</div>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* 分页 */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-4 border-t border-slate-700">
                      <span className="text-xs text-slate-500">
                        第 {currentPage} / {totalPages} 页
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="p-1.5 rounded-lg bg-slate-700 text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="p-1.5 rounded-lg bg-slate-700 text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Week View */}
      <div className="mt-6 bg-slate-800 rounded-2xl p-5">
        <h2 className="text-lg font-bold mb-4 flex items-center">
          <Calendar size={18} className="mr-2 text-purple-400" />
          本周预订概览
        </h2>
        <div className="grid grid-cols-7 gap-3">
          {getWeekDates.map((date, idx) => {
            const dayBookings = getBookingsForDate(date);
            const isToday = date.toDateString() === new Date().toDateString();
            
            return (
              <div 
                key={idx} 
                className={`p-4 rounded-xl ${isToday ? 'bg-blue-600/20 border border-blue-500/30' : 'bg-slate-700/30'}`}
              >
                <div className="text-center mb-3">
                  <p className="text-xs text-slate-400">周{DAYS[date.getDay()]}</p>
                  <p className={`text-xl font-bold ${isToday ? 'text-blue-400' : ''}`}>{date.getDate()}</p>
                </div>
                <div className="space-y-1">
                  {dayBookings.slice(0, 3).map(booking => {
                    const room = resources.find(r => r.id === booking.resourceId);
                    return (
                      <div 
                        key={booking.id}
                        className={`text-xs p-1.5 rounded ${getStatusColor(booking.status)} truncate`}
                        title={`${booking.purpose} - ${room?.name}`}
                      >
                        {formatTime(new Date(booking.startTime))} {room?.name?.split(' ')[0]}
                      </div>
                    );
                  })}
                  {dayBookings.length > 3 && (
                    <p className="text-xs text-slate-500 text-center">+{dayBookings.length - 3} 更多</p>
                  )}
                  {dayBookings.length === 0 && (
                    <p className="text-xs text-slate-600 text-center py-2">暂无预订</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center space-x-2">
          <AlertCircle size={14} />
          <span>实时数据更新</span>
        </div>
        <div className="flex items-center space-x-4">
          <span>会议室总数: {meetingRooms.length}</span>
          <span>|</span>
          <span>本周利用率: {getTodayStats.utilizationRate}%</span>
        </div>
      </div>
    </div>
  );
};
