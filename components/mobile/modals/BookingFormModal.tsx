import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, AlertTriangle, Clock, Users, Calendar, CheckCircle, X } from 'lucide-react';
import { Resource, Booking } from '../../../types';

interface BookingFormModalProps {
  resource: Resource;
  bookings: Booking[];
  theme: string;
  onClose: () => void;
  onConfirm: (data: any) => void;
}

const timeSlots: string[] = [];
for (let h = 8; h <= 20; h++) {
  timeSlots.push(`${String(h).padStart(2, '0')}:00`);
  timeSlots.push(`${String(h).padStart(2, '0')}:30`);
}

export const BookingFormModal: React.FC<BookingFormModalProps> = ({
  resource,
  bookings,
  theme,
  onClose,
  onConfirm
}) => {
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [purpose, setPurpose] = useState('');
  const [participants, setParticipants] = useState(resource.capacity || 1);
  const [hasLeader, setHasLeader] = useState(false);
  const [leaderDetails, setLeaderDetails] = useState('');
  const [isVideoConference, setIsVideoConference] = useState(false);
  const [needsTeaService, setNeedsTeaService] = useState(false);
  const [needsNameCard, setNeedsNameCard] = useState(false);
  const [nameCardDetails, setNameCardDetails] = useState('');
  
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'warning' } | null>(null);
  const [highlightField, setHighlightField] = useState<string | null>(null);
  
  const purposeInputRef = useRef<HTMLInputElement>(null);
  const timeSlotRef = useRef<HTMLDivElement>(null);

  // Theme variables
  const isFinanceTheme = theme === 'finance';
  const themeColors = {
    bg: isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white',
    border: isFinanceTheme ? 'border-[#334155]' : 'border-gray-100',
    text: isFinanceTheme ? 'text-white' : 'text-gray-800',
    lightText: isFinanceTheme ? 'text-gray-400' : 'text-gray-400',
    accent: isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A]' : `bg-${theme}-600 text-white`,
    accentColor: isFinanceTheme ? '#F59E0B' : '',
    inputBg: isFinanceTheme ? 'bg-[#334155] text-white' : 'bg-gray-50 text-gray-800',
    cardBg: isFinanceTheme ? 'bg-[#1E293B]' : 'bg-white',
    buttonBg: isFinanceTheme ? 'bg-[#334155] text-white/80' : 'bg-gray-100 text-gray-600',
    buttonHover: isFinanceTheme ? 'hover:bg-[#475569]' : 'hover:bg-gray-200',
    error: isFinanceTheme ? 'bg-red-900/40 text-red-400 border-red-800' : 'bg-rose-50 text-rose-600 border-rose-100',
    success: isFinanceTheme ? 'bg-green-900/40 text-green-400 border-green-800' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
  };

  const showToast = (message: string, type: 'error' | 'warning' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const dateOptions = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);

  const getBookingsForResource = useMemo(() => {
    const dateStart = new Date(`${selectedDate}T00:00:00`);
    const dateEnd = new Date(`${selectedDate}T23:59:59`);
    
    const result = bookings.filter(b => {
      if (b.resourceId !== resource.id) return false;
      if (['REJECTED', 'CANCELLED'].includes(b.status)) return false;
      
      const bStart = new Date(b.startTime);
      const isOnSelectedDate = bStart >= dateStart && bStart <= dateEnd;
      return isOnSelectedDate;
    });
    
    return result;
  }, [bookings, resource.id, selectedDate]);

  const isSlotBooked = (time: string): boolean => {
    const [hours, minutes] = time.split(':').map(Number);
    const slotStart = new Date(selectedDate);
    slotStart.setHours(hours, minutes, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
    
    for (const b of getBookingsForResource) {
      const bStart = new Date(b.startTime);
      const bEnd = new Date(b.endTime);
      const isOverlapping = slotStart.getTime() < bEnd.getTime() && slotEnd.getTime() > bStart.getTime();
      if (isOverlapping) {
        return true;
      }
    }
    return false;
  };

  const isSlotPast = (time: string): boolean => {
    const [hours, minutes] = time.split(':').map(Number);
    const slotDate = new Date(selectedDate);
    slotDate.setHours(hours, minutes, 0, 0);
    const now = new Date();
    const minTime = new Date(now.getTime() + 10 * 60000);
    return slotDate < minTime;
  };

  const handleTimeClick = (time: string) => {
    setHighlightField(null);
    
    if (isSlotBooked(time)) {
      return;
    }
    
    if (isSlotPast(time)) {
      return;
    }
    
    const { start, end } = selectedTimeRange;
    
    if (!start || (start && end)) {
      setSelectedTimeRange({ start: time, end: null });
    } else {
      if (time === start) {
        setSelectedTimeRange({ start: null, end: null });
        return;
      }
      
      const timeVal = parseInt(time.replace(':', ''));
      const startVal = parseInt(start.replace(':', ''));
      
      if (timeVal <= startVal) {
        showToast('结束时间必须晚于开始时间', 'warning');
        return;
      }
      
      const startIndex = timeSlots.indexOf(start);
      const endIndex = timeSlots.indexOf(time);
      
      for (let i = startIndex; i < endIndex; i++) {
        if (isSlotBooked(timeSlots[i])) {
          showToast('选择的时间段内包含已被占用的时段', 'error');
          setSelectedTimeRange({ start: time, end: null });
          return;
        }
      }
      
      setSelectedTimeRange({ start, end: time });
    }
  };

  const isSlotSelected = (time: string): boolean => {
    return selectedTimeRange.start === time || selectedTimeRange.end === time;
  };

  const isSlotInRange = (time: string): boolean => {
    if (!selectedTimeRange.start || !selectedTimeRange.end) return false;
    const t = parseInt(time.replace(':', ''));
    const s = parseInt(selectedTimeRange.start.replace(':', ''));
    const e = parseInt(selectedTimeRange.end.replace(':', ''));
    return t > s && t < e;
  };

  const handleSubmit = () => {
    if (!purpose.trim()) {
      showToast('请输入会议主题', 'error');
      setHighlightField('purpose');
      purposeInputRef.current?.focus();
      return;
    }
    
    if (!selectedTimeRange.start || !selectedTimeRange.end) {
      showToast('请选择开始和结束时间', 'error');
      setHighlightField('time');
      timeSlotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    
    if (participants > (resource.capacity || 1)) {
      showToast(`参与人数超过资源容量（最大 ${resource.capacity} 人）`, 'warning');
      return;
    }
    
    const [startH, startM] = selectedTimeRange.start.split(':').map(Number);
    const [endH, endM] = selectedTimeRange.end.split(':').map(Number);
    
    const startTime = new Date(selectedDate);
    startTime.setHours(startH, startM, 0, 0);
    const endTime = new Date(selectedDate);
    endTime.setHours(endH, endM, 0, 0);
    const now = new Date();
    
    if (startTime < now) {
      showToast('不能预约过去的时间', 'error');
      return;
    }
    
    if (endTime <= startTime) {
      showToast('结束时间必须晚于开始时间', 'error');
      return;
    }
    
    const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    if (duration > 4) {
      showToast('单次预约时长不能超过4小时', 'warning');
      return;
    }
    
    for (const b of getBookingsForResource) {
      const bStart = new Date(b.startTime);
      const bEnd = new Date(b.endTime);
      if (startTime < bEnd && endTime > bStart) {
        showToast('选择的时间段与已有预约冲突，请重新选择', 'error');
        return;
      }
    }
    
    onConfirm({
      resourceId: resource.id,
      purpose,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      participants,
      type: resource.type,
      hasLeader,
      leaderDetails: hasLeader ? leaderDetails : undefined,
      isVideoConference,
      needsTeaService,
      needsNameCard,
      nameCardDetails: needsNameCard ? nameCardDetails : undefined
    });
    onClose();
  };

  const formatTimeDisplay = (dateStr: string): string => {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex flex-col" style={{ maxWidth: '448px', margin: '0 auto' }}>
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 left-4 right-4 z-[300] animate-in slide-in-from-top-4 fade-in`} style={{ maxWidth: '416px', margin: '0 auto' }}>
          <div className={`p-4 rounded-2xl shadow-lg flex items-center space-x-3 transition-all duration-300 ${toast.type === 'error' ? (isFinanceTheme ? 'bg-red-900 text-red-200' : 'bg-rose-500 text-white') : (isFinanceTheme ? 'bg-amber-900 text-amber-200' : 'bg-amber-500 text-white')}`}>
            <AlertTriangle size={20} />
            <span className="flex-1 font-medium text-sm">{toast.message}</span>
            <button onClick={() => setToast(null)} className={`p-1 rounded-full transition-colors duration-300 ${toast.type === 'error' ? (isFinanceTheme ? 'hover:bg-red-800' : 'hover:bg-white/20') : (isFinanceTheme ? 'hover:bg-amber-800' : 'hover:bg-white/20')}`}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className={`${themeColors.cardBg} px-4 py-3 flex items-center justify-between shrink-0 border-b ${themeColors.border} transition-all duration-300`}>
        <button onClick={onClose} className={`p-2 -ml-2 transition-colors duration-300 ${isFinanceTheme ? 'text-white/60 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}>
          <ChevronLeft size={24} />
        </button>
        <h3 className={`font-bold transition-colors duration-300 ${themeColors.text}`}>预约 {resource.name}</h3>
        <div className="w-8" />
      </div>

      <div className={`flex-1 overflow-y-auto transition-colors duration-300 ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-gray-50'}`}>
        <div className="p-4 space-y-4">
          <div className={`p-4 rounded-2xl border transition-all duration-300 ${themeColors.cardBg} ${themeColors.border}`}>
            <div className="flex items-center space-x-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-300 ${isFinanceTheme ? 'bg-[#334155] text-[#F59E0B]' : (resource.type === 'ROOM' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600')}`}>
                <Calendar size={24} />
              </div>
              <div>
                <h4 className={`font-bold transition-colors duration-300 ${themeColors.text}`}>{resource.name}</h4>
                <p className={`text-xs transition-colors duration-300 ${themeColors.lightText}`}>{resource.location} · 容量 {resource.capacity || 1}人</p>
              </div>
            </div>
          </div>

          {/* Purpose Input */}
          <div className={`p-4 rounded-2xl border transition-all duration-300 ${themeColors.cardBg} ${highlightField === 'purpose' ? (isFinanceTheme ? 'border-red-600 ring-2 ring-red-900/20' : 'border-rose-400 ring-2 ring-rose-100') : themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-2 block transition-colors duration-300 ${themeColors.lightText}`}>会议主题 *</label>
            <input
              ref={purposeInputRef}
              value={purpose}
              onChange={e => { setPurpose(e.target.value); setHighlightField(null); }}
              placeholder={isFinanceTheme ? "请输入会议主题..." : "请输入会议主题..."}
              className={`w-full p-3 rounded-xl border-none outline-none font-bold text-sm transition-all duration-300 ${themeColors.inputBg} focus:ring-2 focus:ring-offset-2 ${isFinanceTheme ? 'focus:ring-[#F59E0B]/30' : 'focus:ring-indigo-200'}`}
            />
          </div>

          <div className={`p-4 rounded-2xl border transition-all duration-300 ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-3 block transition-colors duration-300 ${themeColors.lightText}`}>选择日期</label>
            <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              {dateOptions.map(d => {
                const dateStr = d.toISOString().split('T')[0];
                const isSelected = dateStr === selectedDate;
                const dayName = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
                const isToday = dateStr === today;
                return (
                  <button
                    key={dateStr}
                    onClick={() => { 
                      setSelectedDate(dateStr); 
                      setSelectedTimeRange({ start: null, end: null }); 
                      setHighlightField(null);
                    }}
                    className={`flex flex-col items-center justify-center w-14 h-16 rounded-xl border-2 transition-all shrink-0 ${isSelected ? (isFinanceTheme ? 'bg-[#F59E0B] border-[#F59E0B] text-[#0F172A] shadow-md' : `bg-${theme}-600 border-${theme}-600 text-white shadow-md`) : isToday ? (isFinanceTheme ? 'bg-[#334155] border-[#475569] text-white' : 'bg-white border-gray-300 text-gray-600') : (isFinanceTheme ? 'bg-[#1E293B] border-[#334155] text-gray-400' : 'bg-white border-gray-100 text-gray-400')}`}
                  >
                    <span className="text-[10px] opacity-80">周{dayName}</span>
                    <span className="text-lg font-black leading-none mt-1">{d.getDate()}</span>
                    {isToday && !isSelected && <span className={`text-[8px] transition-colors duration-300 ${themeColors.lightText}`}>今天</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time Slots */}
          <div ref={timeSlotRef} className={`p-4 rounded-2xl border transition-all duration-300 ${themeColors.cardBg} ${highlightField === 'time' ? (isFinanceTheme ? 'border-red-600 ring-2 ring-red-900/20' : 'border-rose-400 ring-2 ring-rose-100') : themeColors.border}`}>
            <div className="flex items-center justify-between mb-3">
              <label className={`text-[10px] font-bold uppercase transition-colors duration-300 ${themeColors.lightText}`}>选择时段 *</label>
              {selectedTimeRange.start && selectedTimeRange.end && (
                <span className={`text-xs font-bold transition-colors duration-300 ${isFinanceTheme ? 'text-[#F59E0B]' : `text-${theme}-600`}`}>
                  {selectedTimeRange.start} - {selectedTimeRange.end}
                </span>
              )}
            </div>
            
            <div className="flex items-center space-x-3 mb-3 text-[10px]">
              <span className="flex items-center"><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-[#334155]' : 'bg-gray-100'}`}></span>可选</span>
              <span className="flex items-center"><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-red-900/50' : 'bg-rose-400'}`}></span>已占用</span>
              <span className="flex items-center"><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-gray-600' : 'bg-gray-400'}`}></span>已过期</span>
              <span className="flex items-center"><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-[#F59E0B]' : `bg-${theme}-600`}`}></span>已选</span>
            </div>
            
            <div className="grid grid-cols-4 gap-2">
              {timeSlots.map(time => {
                const booked = isSlotBooked(time);
                const past = isSlotPast(time);
                const selected = isSlotSelected(time);
                const inRange = isSlotInRange(time);
                
                return (
                  <button
                    key={time}
                    onClick={() => handleTimeClick(time)}
                    disabled={booked || past}
                    className={`py-2 rounded-lg text-xs font-bold transition-all duration-300 ${booked ? (isFinanceTheme ? 'bg-red-900/40 text-red-400 border border-red-800 cursor-not-allowed' : 'bg-rose-100 text-rose-600 border border-rose-300 cursor-not-allowed') : past ? (isFinanceTheme ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-300 text-gray-500 cursor-not-allowed') : selected ? (isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A] shadow-md' : `bg-${theme}-600 text-white shadow-md`) : inRange ? (isFinanceTheme ? 'bg-[#F59E0B]/20 text-[#F59E0B]' : `bg-${theme}-100 text-${theme}-600`) : (isFinanceTheme ? 'bg-[#334155] text-gray-300 hover:bg-[#475569]' : 'bg-gray-50 text-gray-600 hover:bg-gray-100')}`}
                  >
                    {time}
                  </button>
                );
              })}
            </div>
            
            {getBookingsForResource.length > 0 && (
              <div className={`mt-3 pt-3 border-t transition-colors duration-300 ${isFinanceTheme ? 'border-[#334155]' : 'border-gray-100'}`}>
                <p className={`text-[10px] font-bold mb-2 transition-colors duration-300 ${themeColors.lightText}`}>已预订时段：</p>
                <div className="space-y-1">
                  {getBookingsForResource.map((b, idx) => (
                    <div key={idx} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border transition-all duration-300 ${isFinanceTheme ? 'bg-red-900/40 text-red-400 border-red-800' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                      <span className="font-medium">{formatTimeDisplay(b.startTime)} - {formatTimeDisplay(b.endTime)}</span>
                      <span className={isFinanceTheme ? 'text-red-500' : 'text-rose-400'}>{b.purpose}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={`p-4 rounded-2xl border transition-all duration-300 ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-2 block transition-colors duration-300 ${themeColors.lightText}`}>参与人数</label>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setParticipants(Math.max(1, participants - 1))}
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold transition-all duration-300 ${themeColors.buttonBg} ${themeColors.buttonHover}`}
              >
                -
              </button>
              <span className={`flex-1 text-center font-bold transition-colors duration-300 ${themeColors.text}`}>{participants} 人</span>
              <button
                onClick={() => setParticipants(Math.min(resource.capacity || 10, participants + 1))}
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold transition-all duration-300 ${themeColors.buttonBg} ${themeColors.buttonHover}`}
              >
                +
              </button>
            </div>
            <p className={`text-[10px] mt-2 text-center transition-colors duration-300 ${themeColors.lightText}`}>最大容量：{resource.capacity || 1}人</p>
          </div>

          <div className={`p-4 rounded-2xl border space-y-3 transition-all duration-300 ${themeColors.cardBg} ${themeColors.border}`}>
            <div className="flex items-center justify-between">
              <label className={`text-xs font-bold transition-colors duration-300 ${themeColors.text}`}>领导参会</label>
              <button
                onClick={() => setHasLeader(!hasLeader)}
                className={`w-12 h-7 rounded-full p-1 transition-all duration-300 ${hasLeader ? (isFinanceTheme ? 'bg-[#F59E0B]' : `bg-${theme}-600`) : (isFinanceTheme ? 'bg-[#475569]' : 'bg-gray-200')}`}
              >
                <div className={`w-5 h-5 rounded-full shadow-sm transition-all duration-300 ${hasLeader ? 'translate-x-5' : 'translate-x-0'} ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-white'}`} />
              </button>
            </div>
            {hasLeader && (
              <input
                value={leaderDetails}
                onChange={e => setLeaderDetails(e.target.value)}
                placeholder={isFinanceTheme ? "请输入参会领导姓名..." : "请输入参会领导姓名..."}
                className={`w-full p-3 rounded-xl border-none outline-none text-sm transition-all duration-300 ${themeColors.inputBg}`}
              />
            )}
            
            <div className="flex items-center justify-between">
              <label className={`text-xs font-bold transition-colors duration-300 ${themeColors.text}`}>视频会议</label>
              <button
                onClick={() => setIsVideoConference(!isVideoConference)}
                className={`w-12 h-7 rounded-full p-1 transition-all duration-300 ${isVideoConference ? (isFinanceTheme ? 'bg-[#F59E0B]' : `bg-${theme}-600`) : (isFinanceTheme ? 'bg-[#475569]' : 'bg-gray-200')}`}
              >
                <div className={`w-5 h-5 rounded-full shadow-sm transition-all duration-300 ${isVideoConference ? 'translate-x-5' : 'translate-x-0'} ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-white'}`} />
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <label className={`text-xs font-bold transition-colors duration-300 ${themeColors.text}`}>茶水服务</label>
              <button
                onClick={() => setNeedsTeaService(!needsTeaService)}
                className={`w-12 h-7 rounded-full p-1 transition-all duration-300 ${needsTeaService ? (isFinanceTheme ? 'bg-[#F59E0B]' : `bg-${theme}-600`) : (isFinanceTheme ? 'bg-[#475569]' : 'bg-gray-200')}`}
              >
                <div className={`w-5 h-5 rounded-full shadow-sm transition-all duration-300 ${needsTeaService ? 'translate-x-5' : 'translate-x-0'} ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-white'}`} />
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <label className={`text-xs font-bold transition-colors duration-300 ${themeColors.text}`}>需要桌牌</label>
              <button
                onClick={() => setNeedsNameCard(!needsNameCard)}
                className={`w-12 h-7 rounded-full p-1 transition-all duration-300 ${needsNameCard ? (isFinanceTheme ? 'bg-[#F59E0B]' : `bg-${theme}-600`) : (isFinanceTheme ? 'bg-[#475569]' : 'bg-gray-200')}`}
              >
                <div className={`w-5 h-5 rounded-full shadow-sm transition-all duration-300 ${needsNameCard ? 'translate-x-5' : 'translate-x-0'} ${isFinanceTheme ? 'bg-[#0F172A]' : 'bg-white'}`} />
              </button>
            </div>
            {needsNameCard && (
              <input
                value={nameCardDetails}
                onChange={e => setNameCardDetails(e.target.value)}
                placeholder={isFinanceTheme ? "请输入桌牌姓名（多人用逗号分隔）..." : "请输入桌牌姓名（多人用逗号分隔）..."}
                className={`w-full p-3 rounded-xl border-none outline-none text-sm transition-all duration-300 ${themeColors.inputBg}`}
              />
            )}
          </div>
        </div>
      </div>

      <div className={`p-4 border-t shrink-0 safe-area-bottom transition-all duration-300 ${themeColors.cardBg} ${themeColors.border}`}>
        <button
          onClick={handleSubmit}
          className={`w-full py-3.5 rounded-xl font-bold shadow-lg active:scale-[0.98] transition-all duration-300 ${isFinanceTheme ? 'bg-[#F59E0B] text-[#0F172A] shadow-[#F59E0B]/20' : `bg-${theme}-600 text-white shadow-${theme}-100`}`}
        >
          确认预约
        </button>
      </div>
    </div>
  );
};
