import React, { useState, useMemo } from 'react';
import { Calendar, Users, MapPin, Video, Coffee, UserCheck, FileText, Filter, ChevronDown } from 'lucide-react';
import { Booking, Resource, User as UserType } from '../../../types';

interface MeetingServiceViewProps {
  bookings: Booking[];
  resources: Resource[];
  users: UserType[];
  theme: string;
}

const MeetingServiceView: React.FC<MeetingServiceViewProps> = ({
  bookings,
  resources,
  users,
  theme
}) => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : 'bg-white border-gray-100';
  const darkText = isFinanceTheme ? 'text-white' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-white/60' : 'text-gray-400';
  const darkSecondary = isFinanceTheme ? 'bg-[#334155] text-white/80' : 'bg-gray-100 text-gray-600';
  const darkBorder = isFinanceTheme ? 'border-[#334155]' : 'border-gray-100';
  const darkPrimary = isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A]' : `bg-${theme}-600 text-white`;
  const darkPrimaryBorder = isFinanceTheme ? 'border-[#F59E0B]' : `border-${theme}-600`;
  const darkCardBg = isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white';

  const statusConfig: Record<string, { label: string; color: string; bgColor: string }> = {
    PENDING: { 
      label: '待审批', 
      color: isFinanceTheme ? 'text-[#F59E0B]' : 'text-amber-600', 
      bgColor: isFinanceTheme ? 'bg-[#F59E0B]/10' : 'bg-amber-50' 
    },
    APPROVED: { 
      label: '已通过', 
      color: isFinanceTheme ? 'text-[#10B981]' : 'text-emerald-600', 
      bgColor: isFinanceTheme ? 'bg-[#10B981]/10' : 'bg-emerald-50' 
    },
    REJECTED: { 
      label: '已拒绝', 
      color: isFinanceTheme ? 'text-[#F43F5E]' : 'text-rose-600', 
      bgColor: isFinanceTheme ? 'bg-[#F43F5E]/10' : 'bg-rose-50' 
    },
    CANCELLED: { 
      label: '已取消', 
      color: isFinanceTheme ? 'text-white/50' : 'text-gray-500', 
      bgColor: isFinanceTheme ? 'bg-[#334155]' : 'bg-gray-100' 
    },
    COMPLETED: { 
      label: '已完成', 
      color: isFinanceTheme ? 'text-[#8B5CF6]' : 'text-indigo-600', 
      bgColor: isFinanceTheme ? 'bg-[#8B5CF6]/10' : 'bg-indigo-50' 
    },
  };

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
    <div className={`min-h-screen ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-gray-50'} pb-24 font-['IBM_Plex_Sans']`}>
      <div className={`${isFinanceTheme ? 'bg-[#1E293B] border-[#334155]' : `bg-${theme}-600`} ${isFinanceTheme ? 'text-white' : 'text-white'} p-4 border-b ${darkBorder}`}>
        <div>
          <h1 className="text-lg font-bold">会议服务</h1>
          <p className={`text-xs ${isFinanceTheme ? 'text-white/70' : 'text-white/70'}`}>会议室预约管理</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className={`${darkCardBg} p-4 rounded-2xl border ${darkBorder}`}>
          <label className={`text-[10px] font-bold ${darkSubtext} uppercase mb-3 block`}>选择日期</label>
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
                      ? `${darkPrimary} ${darkPrimaryBorder} shadow-md` 
                      : isToday 
                        ? `${darkCardBg} border-gray-300 ${darkText}`
                        : `${darkCardBg} ${darkBorder} ${darkSubtext}`
                  }`}
                >
                  <span className="text-[10px] opacity-80">周{dayName}</span>
                  <span className="text-lg font-black leading-none mt-0.5">{d.getDate()}</span>
                  {count > 0 && (
                    <span className={`text-[9px] mt-0.5 px-1.5 rounded-full ${isSelected ? (isFinanceTheme ? 'bg-[#0F172A]/20' : 'bg-white/20') : (isFinanceTheme ? 'bg-[#334155]' : 'bg-gray-100')}`}>
                      {count}场
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className={`${darkCardBg} p-4 rounded-2xl border ${darkBorder}`}>
          <label className={`text-[10px] font-bold ${darkSubtext} uppercase mb-2 block`}>状态筛选</label>
          <div className="flex flex-wrap gap-2">
            {
              [
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
                      ? darkPrimary 
                      : darkSecondary
                  }`}
                >
                  {opt.label}
                </button>
              ))
            }
          </div>
        </div>

        <div className="space-y-3">
          {filteredBookings.length === 0 ? (
            <div className={`text-center py-12 ${darkSubtext}`}>
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
                <div key={booking.id} className={`${darkCardBg} rounded-2xl border ${darkBorder} overflow-hidden shadow-sm`}>
                  <div 
                    onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                    className="p-4 cursor-pointer active:bg-opacity-90 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className={`font-bold ${darkText}`}>{formatTime(booking.startTime)} - {formatTime(booking.endTime)}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${status.bgColor} ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      <span className={`text-xs ${darkSubtext}`}>{resource?.name || '未知'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm ${darkText} font-medium`}>{booking.purpose}</span>
                      <span className={`text-xs ${darkSubtext}`}>{user?.name || '未知用户'}</span>
                    </div>
                    <div className="flex items-center justify-end mt-2">
                      <ChevronDown size={16} className={`${darkSubtext} transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className={`px-4 pb-4 pt-2 border-t ${darkBorder} ${isFinanceTheme ? 'bg-[#1A2332]' : 'bg-gray-50/50'}`}>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className={`${darkCardBg} p-3 rounded-xl border ${darkBorder}`}>
                          <div className={`flex items-center space-x-2 ${darkSubtext} mb-1`}>
                            <MapPin size={12} />
                            <span className="text-[10px]">会议室</span>
                          </div>
                          <p className={`text-sm font-bold ${darkText}`}>{resource?.name || '未知'}</p>
                          <p className={`text-[10px] ${darkSubtext}`}>{resource?.location}</p>
                        </div>
                        <div className={`${darkCardBg} p-3 rounded-xl border ${darkBorder}`}>
                          <div className={`flex items-center space-x-2 ${darkSubtext} mb-1`}>
                            <Users size={12} />
                            <span className="text-[10px]">参与人数</span>
                          </div>
                          <p className={`text-sm font-bold ${darkText}`}>{booking.participants || 1} 人</p>
                        </div>
                      </div>

                      <div className="space-y-2 mb-3">
                        <div className={`flex items-center justify-between text-xs ${darkCardBg} p-2.5 rounded-lg border ${darkBorder}`}>
                          <span className={darkSubtext}>申请人</span>
                          <span className={`font-medium ${darkText}`}>{user?.name} ({user?.department})</span>
                        </div>
                        <div className={`flex items-center justify-between text-xs ${darkCardBg} p-2.5 rounded-lg border ${darkBorder}`}>
                          <span className={darkSubtext}>联系电话</span>
                          <span className={`font-medium ${darkText}`}>{user?.mobile || '未填写'}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-3">
                        {booking.hasLeader && (
                          <div className={`flex items-center space-x-1.5 px-3 py-1.5 ${statusConfig.PENDING.bgColor} ${statusConfig.PENDING.color} rounded-lg text-xs`}>
                            <UserCheck size={14} />
                            <span className="font-medium">领导参会: {booking.leaderDetails || '是'}</span>
                          </div>
                        )}
                        {booking.isVideoConference && (
                          <div className={`flex items-center space-x-1.5 px-3 py-1.5 ${isFinanceTheme ? 'bg-[#8B5CF6]/10 text-[#8B5CF6]' : 'bg-indigo-50 text-indigo-700'} rounded-lg text-xs`}>
                            <Video size={14} />
                            <span className="font-medium">视频会议</span>
                          </div>
                        )}
                        {booking.needsTeaService && (
                          <div className={`flex items-center space-x-1.5 px-3 py-1.5 ${isFinanceTheme ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-emerald-50 text-emerald-700'} rounded-lg text-xs`}>
                            <Coffee size={14} />
                            <span className="font-medium">茶水服务</span>
                          </div>
                        )}
                        {booking.needsNameCard && (
                          <div className={`flex items-center space-x-1.5 px-3 py-1.5 ${isFinanceTheme ? 'bg-[#F43F5E]/10 text-[#F43F5E]' : 'bg-rose-50 text-rose-700'} rounded-lg text-xs`}>
                            <FileText size={14} />
                            <span className="font-medium">桌牌: {booking.nameCardDetails || '需要'}</span>
                          </div>
                        )}
                      </div>

                      {resource?.features && resource.features.length > 0 && (
                        <div className={`text-xs ${darkSubtext}`}>
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

export default MeetingServiceView;
