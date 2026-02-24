import React, { useState, useMemo } from 'react';
import { Calendar, Users, MapPin, Video, Coffee, UserCheck, FileText, Filter } from 'lucide-react';
import { Booking, Resource, User as UserType } from '../../../types';

interface MeetingServiceViewProps {
  bookings: Booking[];
  resources: Resource[];
  users: UserType[];
  theme: string;
}

const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  PENDING: { label: '待审批', color: 'text-amber-600', bgColor: 'bg-amber-50' },
  APPROVED: { label: '已通过', color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
  REJECTED: { label: '已拒绝', color: 'text-rose-600', bgColor: 'bg-rose-50' },
  CANCELLED: { label: '已取消', color: 'text-gray-500', bgColor: 'bg-gray-100' },
  COMPLETED: { label: '已完成', color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
};

export const MeetingServiceView: React.FC<MeetingServiceViewProps> = ({
  bookings,
  resources,
  users,
  theme
}) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dateOptions = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);

  const filteredBookings = useMemo(() => {
    return bookings.filter(b => {
      const bookingDate = new Date(b.startTime).toISOString().split('T')[0];
      if (bookingDate !== selectedDate) return false;
      if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
      if (b.type !== 'ROOM') return false;
      return true;
    }).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [bookings, selectedDate, statusFilter]);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const getResource = (resourceId: string) => resources.find(r => r.id === resourceId);
  const getUser = (userId: string) => users.find(u => u.id === userId);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className={`bg-${theme}-600 text-white p-4`}>
        <div>
          <h1 className="text-lg font-bold">会议服务</h1>
          <p className="text-xs text-white/70">会议室预约管理</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="bg-white p-4 rounded-2xl border border-gray-100">
          <label className="text-[10px] font-bold text-gray-400 uppercase mb-3 block">选择日期</label>
          <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
            {dateOptions.map(d => {
              const dateStr = d.toISOString().split('T')[0];
              const isSelected = dateStr === selectedDate;
              const dayName = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              const count = bookings.filter(b => 
                new Date(b.startTime).toISOString().split('T')[0] === dateStr && 
                b.type === 'ROOM' &&
                !['REJECTED', 'CANCELLED'].includes(b.status)
              ).length;
              
              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  className={`flex flex-col items-center justify-center w-14 h-16 rounded-xl border-2 transition-all shrink-0 ${
                    isSelected 
                      ? `bg-${theme}-600 border-${theme}-600 text-white shadow-md` 
                      : isToday 
                        ? 'bg-white border-gray-300 text-gray-600'
                        : 'bg-white border-gray-100 text-gray-400'
                  }`}
                >
                  <span className="text-[10px] opacity-80">周{dayName}</span>
                  <span className="text-lg font-black leading-none mt-0.5">{d.getDate()}</span>
                  {count > 0 && (
                    <span className={`text-[9px] mt-0.5 px-1.5 rounded-full ${isSelected ? 'bg-white/20' : 'bg-gray-100'}`}>
                      {count}场
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100">
          <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 block">状态筛选</label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'ALL', label: '全部' },
              { value: 'APPROVED', label: '已通过' },
              { value: 'PENDING', label: '待审批' },
              { value: 'COMPLETED', label: '已完成' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  statusFilter === opt.value 
                    ? `bg-${theme}-600 text-white` 
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filteredBookings.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Calendar size={40} className="mx-auto mb-3 opacity-30" />
              <p>当日暂无会议室预约</p>
            </div>
          ) : (
            filteredBookings.map(booking => {
              const resource = getResource(booking.resourceId);
              const user = getUser(booking.userId);
              const status = statusConfig[booking.status] || statusConfig.PENDING;
              const isExpanded = expandedId === booking.id;

              return (
                <div key={booking.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                  <div 
                    onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                    className="p-4 cursor-pointer"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-gray-800">{formatTime(booking.startTime)} - {formatTime(booking.endTime)}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${status.bgColor} ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">{resource?.name || '未知'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 font-medium">{booking.purpose}</span>
                      <span className="text-xs text-gray-400">{user?.name || '未知用户'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50/50">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="bg-white p-3 rounded-xl">
                          <div className="flex items-center space-x-2 text-gray-400 mb-1">
                            <MapPin size={12} />
                            <span className="text-[10px]">会议室</span>
                          </div>
                          <p className="text-sm font-bold text-gray-800">{resource?.name || '未知'}</p>
                          <p className="text-[10px] text-gray-400">{resource?.location}</p>
                        </div>
                        <div className="bg-white p-3 rounded-xl">
                          <div className="flex items-center space-x-2 text-gray-400 mb-1">
                            <Users size={12} />
                            <span className="text-[10px]">参与人数</span>
                          </div>
                          <p className="text-sm font-bold text-gray-800">{booking.participants || 1} 人</p>
                        </div>
                      </div>

                      <div className="space-y-2 mb-3">
                        <div className="flex items-center justify-between text-xs bg-white p-2.5 rounded-lg">
                          <span className="text-gray-400">申请人</span>
                          <span className="font-medium text-gray-700">{user?.name} ({user?.department})</span>
                        </div>
                        <div className="flex items-center justify-between text-xs bg-white p-2.5 rounded-lg">
                          <span className="text-gray-400">联系电话</span>
                          <span className="font-medium text-gray-700">{user?.mobile || '未填写'}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-3">
                        {booking.hasLeader && (
                          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs">
                            <UserCheck size={14} />
                            <span className="font-medium">领导参会: {booking.leaderDetails || '是'}</span>
                          </div>
                        )}
                        {booking.isVideoConference && (
                          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs">
                            <Video size={14} />
                            <span className="font-medium">视频会议</span>
                          </div>
                        )}
                        {booking.needsTeaService && (
                          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs">
                            <Coffee size={14} />
                            <span className="font-medium">茶水服务</span>
                          </div>
                        )}
                        {booking.needsNameCard && (
                          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg text-xs">
                            <FileText size={14} />
                            <span className="font-medium">桌牌: {booking.nameCardDetails || '需要'}</span>
                          </div>
                        )}
                      </div>

                      {resource?.features && resource.features.length > 0 && (
                        <div className="text-xs text-gray-400">
                          <span className="font-medium">设施：</span>
                          {resource.features.join('、')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
