import React, { useEffect, useState, useCallback } from 'react';
import { Booking, Resource } from '../types';
import { supabase } from '../services/supabaseService';
import { 
  Monitor, 
  Users, 
  Wifi, 
  WifiOff, 
  RefreshCw,
  Calendar,
  Clock,
  User,
  Building2,
  Video,
  Coffee,
  CreditCard,
  AlertCircle
} from 'lucide-react';

interface RoomDisplayProps {
  roomId: string;
}

interface DisplayBooking {
  current: Booking | null;
  next: Booking | null;
  upcoming: Booking[];
}

interface ConnectionStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
  lastUpdate: Date | null;
}

// 格式化时间工具函数
const formatTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const formatDate = (date: Date): string => {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = weekdays[date.getDay()];
  return `${year}年${month}月${day}日 ${weekday}`;
};

const isWithinInterval = (date: Date, interval: { start: Date; end: Date }): boolean => {
  return date >= interval.start && date <= interval.end;
};

const isAfter = (date: Date, compareDate: Date): boolean => {
  return date > compareDate;
};

const parseISO = (dateString: string): Date => {
  return new Date(dateString);
};

const RoomDisplay: React.FC<RoomDisplayProps> = ({ roomId }) => {
  const [room, setRoom] = useState<Resource | null>(null);
  const [bookings, setBookings] = useState<DisplayBooking>({ current: null, next: null, upcoming: [] });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: 'connecting',
    lastUpdate: null
  });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [error, setError] = useState<string | null>(null);

  // 更新当前时间
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 获取会议室信息
  const fetchRoomInfo = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('smartoffice_resources')
        .select('*')
        .eq('id', roomId)
        .single();

      if (error) throw error;
      if (!data) {
        setError('会议室不存在');
        return;
      }

      setRoom(data);
      setError(null);
    } catch (err) {
      console.error('获取会议室信息失败:', err);
      setError('获取会议室信息失败');
    }
  }, [roomId]);

  // 获取预订信息
  const fetchBookings = useCallback(async () => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      const { data, error } = await supabase
        .from('smartoffice_bookings')
        .select(`
          *,
          user:smartoffice_users(name, department)
        `)
        .eq('resource_id', roomId)
        .in('status', ['APPROVED', 'PENDING'])
        .gte('start_time', todayStart.toISOString())
        .lte('start_time', todayEnd.toISOString())
        .order('start_time', { ascending: true });

      if (error) throw error;

      // 分析预订状态
      const allBookings = data || [];
      let current: any = null;
      let next: any = null;
      const upcoming: any[] = [];

      for (const booking of allBookings) {
        const startTime = parseISO(booking.start_time);
        const endTime = parseISO(booking.end_time);

        if (isWithinInterval(now, { start: startTime, end: endTime })) {
          current = booking;
        } else if (isAfter(startTime, now)) {
          if (!next) {
            next = booking;
          } else {
            upcoming.push(booking);
          }
        }
      }

      setBookings({ current, next, upcoming: upcoming.slice(0, 3) });
      setConnectionStatus(prev => ({ ...prev, lastUpdate: new Date() }));
    } catch (err) {
      console.error('获取预订信息失败:', err);
    }
  }, [roomId]);

  // 设置实时订阅
  useEffect(() => {
    fetchRoomInfo();
    fetchBookings();

    // 订阅会议室预订变更
    const channelName = `room_display_${roomId}_${Date.now()}`;
    console.log(`[RoomDisplay] 创建订阅频道: ${channelName}`);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'smartoffice_bookings',
          filter: `resource_id=eq.${roomId}`
        },
        (payload) => {
          console.log('[RoomDisplay] 收到预订变更:', payload);
          fetchBookings();
        }
      )
      .subscribe((status) => {
        console.log(`[RoomDisplay] 订阅状态: ${status}`);
        if (status === 'SUBSCRIBED') {
          setConnectionStatus({ status: 'connected', lastUpdate: new Date() });
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setConnectionStatus({ status: 'disconnected', lastUpdate: null });
        }
      });

    // 轮询作为备用
    const pollingInterval = setInterval(() => {
      fetchBookings();
    }, 30000);

    return () => {
      channel.unsubscribe();
      clearInterval(pollingInterval);
    };
  }, [roomId, fetchRoomInfo, fetchBookings]);

  // 手动刷新
  const handleRefresh = () => {
    fetchBookings();
  };

  // 获取状态颜色
  const getStatusColor = () => {
    if (bookings.current) return 'bg-red-500';
    if (bookings.next) {
      const nextStart = parseISO(bookings.next.start_time);
      const minutesUntil = (nextStart.getTime() - currentTime.getTime()) / (1000 * 60);
      if (minutesUntil <= 15) return 'bg-yellow-500';
    }
    return 'bg-green-500';
  };

  const getStatusText = () => {
    if (bookings.current) return '会议中';
    if (bookings.next) {
      const nextStart = parseISO(bookings.next.start_time);
      const minutesUntil = (nextStart.getTime() - currentTime.getTime()) / (1000 * 60);
      if (minutesUntil <= 15) return `即将开始 (${Math.ceil(minutesUntil)}分钟)`;
    }
    return '空闲';
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="text-center">
          <AlertCircle className="w-24 h-24 mx-auto mb-6 text-red-500" />
          <h1 className="text-4xl font-bold mb-4">出错了</h1>
          <p className="text-2xl text-gray-400">{error}</p>
          <p className="text-xl text-gray-500 mt-4">请检查会议室ID是否正确</p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="text-center">
          <RefreshCw className="w-24 h-24 mx-auto mb-6 text-blue-500 animate-spin" />
          <h1 className="text-4xl font-bold">加载中...</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      {/* 头部信息 */}
      <header className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-6xl font-bold mb-4">{room.name}</h1>
          <div className="flex items-center gap-4 text-2xl text-gray-400">
            <span className="flex items-center gap-2">
              <Building2 className="w-6 h-6" />
              {room.location}
            </span>
            <span className="flex items-center gap-2">
              <Users className="w-6 h-6" />
              容量 {room.capacity} 人
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-7xl font-bold">
            {currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </div>
          <div className="text-2xl text-gray-400 mt-2">
            {formatDate(currentTime)}
          </div>
        </div>
      </header>

      {/* 状态指示器 */}
      <div className="flex items-center gap-6 mb-8">
        <div className={`w-16 h-16 rounded-full ${getStatusColor()} animate-pulse shadow-lg`} />
        <div>
          <div className="text-5xl font-bold">{getStatusText()}</div>
          {bookings.current && (
            <div className="text-2xl text-gray-400 mt-2">
              剩余时间: {Math.ceil((parseISO(bookings.current.end_time).getTime() - currentTime.getTime()) / (1000 * 60))} 分钟
            </div>
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={handleRefresh}
          className="p-4 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors"
        >
          <RefreshCw className="w-8 h-8" />
        </button>
        <div className="flex items-center gap-2 text-xl">
          {connectionStatus.status === 'connected' ? (
            <>
              <Wifi className="w-6 h-6 text-green-500" />
              <span className="text-green-500">已连接</span>
            </>
          ) : (
            <>
              <WifiOff className="w-6 h-6 text-red-500" />
              <span className="text-red-500">未连接</span>
            </>
          )}
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="grid grid-cols-2 gap-8">
        {/* 当前会议 */}
        <div className="bg-gray-800 rounded-3xl p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-4 h-4 rounded-full bg-red-500" />
            <h2 className="text-4xl font-bold">当前会议</h2>
          </div>
          
          {bookings.current ? (
            <div className="space-y-6">
              <div className="text-5xl font-bold text-white">
                {bookings.current.purpose}
              </div>
              <div className="text-3xl text-blue-400">
                <Clock className="w-8 h-8 inline mr-3" />
                {formatTime(bookings.current.start_time)} - {formatTime(bookings.current.end_time)}
              </div>
              <div className="text-2xl text-gray-300">
                <User className="w-6 h-6 inline mr-3" />
                {bookings.current.user?.name || '未知'}
                {bookings.current.user?.department && (
                  <span className="text-gray-500 ml-2">({bookings.current.user.department})</span>
                )}
              </div>
              <div className="text-2xl text-gray-400">
                <Users className="w-6 h-6 inline mr-3" />
                {bookings.current.participants} 人
              </div>
              {/* 会议服务需求 */}
              <div className="flex gap-4 mt-6">
                {bookings.current.is_video_conference && (
                  <span className="flex items-center gap-2 px-4 py-2 bg-blue-900/50 rounded-lg text-blue-300">
                    <Video className="w-5 h-5" />
                    视频会议
                  </span>
                )}
                {bookings.current.needs_tea_service && (
                  <span className="flex items-center gap-2 px-4 py-2 bg-amber-900/50 rounded-lg text-amber-300">
                    <Coffee className="w-5 h-5" />
                    茶水服务
                  </span>
                )}
                {bookings.current.needs_name_card && (
                  <span className="flex items-center gap-2 px-4 py-2 bg-purple-900/50 rounded-lg text-purple-300">
                    <CreditCard className="w-5 h-5" />
                    桌牌
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">✓</div>
              <div className="text-3xl text-gray-400">当前无会议</div>
              <div className="text-2xl text-gray-500 mt-4">会议室空闲中</div>
            </div>
          )}
        </div>

        {/* 下一会议 */}
        <div className="bg-gray-800 rounded-3xl p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-4 h-4 rounded-full bg-blue-500" />
            <h2 className="text-4xl font-bold">下一会议</h2>
          </div>
          
          {bookings.next ? (
            <div className="space-y-6">
              <div className="text-4xl font-bold text-white">
                {bookings.next.purpose}
              </div>
              <div className="text-3xl text-blue-400">
                <Clock className="w-8 h-8 inline mr-3" />
                {formatTime(bookings.next.start_time)} - {formatTime(bookings.next.end_time)}
              </div>
              <div className="text-2xl text-gray-300">
                <User className="w-6 h-6 inline mr-3" />
                {bookings.next.user?.name || '未知'}
                {bookings.next.user?.department && (
                  <span className="text-gray-500 ml-2">({bookings.next.user.department})</span>
                )}
              </div>
              <div className="text-2xl text-gray-400">
                <Users className="w-6 h-6 inline mr-3" />
                {bookings.next.participants} 人
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Calendar className="w-24 h-24 mx-auto mb-6 text-gray-600" />
              <div className="text-3xl text-gray-400">今日无更多会议</div>
            </div>
          )}
        </div>
      </div>

      {/* 后续会议列表 */}
      {bookings.upcoming.length > 0 && (
        <div className="mt-8 bg-gray-800 rounded-3xl p-8">
          <h2 className="text-3xl font-bold mb-6 flex items-center gap-4">
            <Calendar className="w-8 h-8" />
            今日后续会议
          </h2>
          <div className="space-y-4">
            {bookings.upcoming.map((booking, index) => (
              <div key={booking.id} className="flex items-center gap-6 text-xl bg-gray-700/50 rounded-xl p-4">
                <span className="text-gray-500 w-8">{index + 2}</span>
                <span className="text-blue-400 w-32">
                  {formatTime(booking.start_time)} - {formatTime(booking.end_time)}
                </span>
                <span className="flex-1 font-semibold">{booking.purpose}</span>
                <span className="text-gray-400">{booking.user?.name}</span>
                <span className="text-gray-500">{booking.participants}人</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 设备信息 */}
      <div className="mt-8 bg-gray-800 rounded-3xl p-8">
        <h2 className="text-3xl font-bold mb-6 flex items-center gap-4">
          <Monitor className="w-8 h-8" />
          会议室设备
        </h2>
        <div className="flex flex-wrap gap-4">
          {room.features?.map((feature, index) => (
            <span 
              key={index}
              className="px-6 py-3 bg-gray-700 rounded-xl text-xl text-gray-300"
            >
              {feature}
            </span>
          ))}
        </div>
      </div>

      {/* 底部信息 */}
      <footer className="mt-8 text-center text-gray-500 text-xl">
        智慧办公空间管理系统
        {connectionStatus.lastUpdate && (
          <span className="ml-4">
            最后更新: {connectionStatus.lastUpdate.toLocaleTimeString('zh-CN')}
          </span>
        )}
      </footer>
    </div>
  );
};

export default RoomDisplay;
