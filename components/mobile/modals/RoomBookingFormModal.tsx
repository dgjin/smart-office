import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, AlertTriangle, Calendar, X, Video, Coffee, Repeat, CalendarDays } from 'lucide-react';
import { Resource, Booking } from '../../../types';
import { getServerTime, getServerToday, isDateBeforeToday } from '../../../utils/dateUtils';

interface RoomBookingFormModalProps {
  resource: Resource;
  bookings: Booking[];
  theme: string;
  maxBookingDays?: number;
  onClose: () => void;
  onConfirm: (data: any) => void;
}

export const RoomBookingFormModal: React.FC<RoomBookingFormModalProps> = ({
  resource,
  bookings,
  theme,
  maxBookingDays = 20,
  onClose,
  onConfirm
}) => {
  const [today, setToday] = useState<string>(new Date().toISOString().split('T')[0]);
  const [serverTime, setServerTime] = useState<Date>(new Date());
  const [isLoadingTime, setIsLoadingTime] = useState(true);

  // 初始化服务器时间
  useEffect(() => {
    const initServerTime = async () => {
      setIsLoadingTime(true);
      try {
        const serverNow = await getServerTime();
        setServerTime(serverNow);
        setToday(serverNow.toISOString().split('T')[0]);
      } catch (error) {
        console.warn('获取服务器时间失败，使用本地时间:', error);
        const localNow = new Date();
        setServerTime(localNow);
        setToday(localNow.toISOString().split('T')[0]);
      } finally {
        setIsLoadingTime(false);
      }
    };
    initServerTime();
  }, []);

  // 预订模式：单次或长期
  const [bookingMode, setBookingMode] = useState<'single' | 'longTerm'>('single');

  // 单次预订状态
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });

  // 长期预订状态
  const [longTermType, setLongTermType] = useState<'daily' | 'weekly'>('daily');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [dailyTimeRange, setDailyTimeRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });

  // 按周预订状态
  const [selectedWeekDays, setSelectedWeekDays] = useState<number[]>([]);
  const [weekCount, setWeekCount] = useState(1);

  // 共同字段
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

  const isFinanceTheme = theme === 'finance';
  const themeColors = {
    bg: isFinanceTheme ? 'bg-slate-800' : 'bg-white',
    border: isFinanceTheme ? 'border-slate-600' : 'border-gray-100',
    text: isFinanceTheme ? 'text-slate-100' : 'text-gray-800',
    lightText: isFinanceTheme ? 'text-slate-400' : 'text-gray-400',
    accent: isFinanceTheme ? 'bg-amber-500 text-slate-900' : `bg-${theme}-600 text-white`,
    inputBg: isFinanceTheme ? 'bg-slate-700 text-slate-100' : 'bg-gray-50 text-gray-800',
    cardBg: isFinanceTheme ? 'bg-slate-800' : 'bg-white',
  };

  const showToast = (message: string, type: 'error' | 'warning' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const dateOptions = useMemo(() => {
    // 使用服务器时间作为基准
    const baseDate = new Date(today);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [today]);

  const getBookingsForResource = useMemo(() => {
    const dateStart = new Date(`${selectedDate}T00:00:00`);
    const dateEnd = new Date(`${selectedDate}T23:59:59`);
    
    return bookings.filter(b => {
      if (b.resourceId !== resource.id) return false;
      if (['REJECTED', 'CANCELLED'].includes(b.status)) return false;
      
      const bStart = new Date(b.startTime);
      const isOnSelectedDate = bStart >= dateStart && bStart <= dateEnd;
      return isOnSelectedDate;
    });
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
      if (isOverlapping) return true;
    }
    return false;
  };

  const isSlotPast = (time: string): boolean => {
    const [hours, minutes] = time.split(':').map(Number);
    const slotDate = new Date(selectedDate);
    slotDate.setHours(hours, minutes, 0, 0);
    // 使用服务器时间判断
    const minTime = new Date(serverTime.getTime() + 10 * 60000);
    return slotDate < minTime;
  };

  // 检查日期是否早于今天（过去日期）
  const isDateInPast = (dateStr: string): boolean => {
    return dateStr < today;
  };

  // 检查长期预订模式下某时段是否被占用（检查日期范围内每一天）
  const isSlotBookedForLongTerm = (time: string): boolean => {
    if (bookingMode !== 'longTerm') return false;

    const [hours, minutes] = time.split(':').map(Number);

    // 根据长期预订类型获取要检查的日期列表
    const datesToCheck: string[] = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (longTermType === 'daily') {
      // 连续日期模式
      if (!startDate || !endDate) return false;
      const currentDate = new Date(startDate);
      const endDateTime = new Date(endDate);
      while (currentDate <= endDateTime) {
        if (currentDate >= now) {
          datesToCheck.push(currentDate.toISOString().split('T')[0]);
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    } else {
      // 按周模式
      if (selectedWeekDays.length === 0 || weekCount < 1) return false;
      const start = new Date(startDate);
      for (let week = 0; week < weekCount; week++) {
        for (const dayOfWeek of selectedWeekDays) {
          const targetDate = new Date(start);
          targetDate.setDate(start.getDate() + week * 7 + ((dayOfWeek - start.getDay() + 7) % 7));
          if (targetDate >= now) {
            datesToCheck.push(targetDate.toISOString().split('T')[0]);
          }
        }
      }
    }

    // 如果没有有效的未来日期，返回true（表示不可用）
    if (datesToCheck.length === 0) return true;

    // 检查每个日期的时段占用情况
    for (const dateStr of datesToCheck) {
      const dayStart = new Date(`${dateStr}T00:00:00`);
      const dayEnd = new Date(`${dateStr}T23:59:59`);

      const dayBookings = bookings.filter(b => {
        if (b.resourceId !== resource.id) return false;
        if (['REJECTED', 'CANCELLED'].includes(b.status)) return false;
        const bStart = new Date(b.startTime);
        return bStart >= dayStart && bStart <= dayEnd;
      });

      for (const b of dayBookings) {
        const bStart = new Date(b.startTime);
        const bEnd = new Date(b.endTime);
        const checkSlotStart = new Date(dateStr);
        checkSlotStart.setHours(hours, minutes, 0, 0);
        const checkSlotEnd = new Date(checkSlotStart.getTime() + 30 * 60000);

        if (checkSlotStart < bEnd && checkSlotEnd > bStart) {
          return true;
        }
      }
    }

    return false;
  };

  // 切换星期选择
  const toggleWeekDay = (day: number) => {
    setSelectedWeekDays(prev => {
      if (prev.includes(day)) {
        return prev.filter(d => d !== day);
      } else {
        return [...prev, day].sort();
      }
    });
    setDailyTimeRange({ start: null, end: null });
  };

  const handleTimeClick = (time: string) => {
    setHighlightField(null);

    // 检查时段是否被占用或已过期
    if (bookingMode === 'single') {
      if (isSlotBooked(time) || isSlotPast(time)) return;
    } else {
      // 长期预订模式下，检查日期范围内每一天的占用情况
      if (isSlotBookedForLongTerm(time)) {
        showToast(`该时段在预订日期范围内已被占用`, 'error');
        return;
      }
    }

    // 根据预订模式使用不同的时间范围状态
    const timeRange = bookingMode === 'longTerm' ? dailyTimeRange : selectedTimeRange;
    const setTimeRange = bookingMode === 'longTerm' ? setDailyTimeRange : setSelectedTimeRange;

    const { start, end } = timeRange;

    if (!start || (start && end)) {
      setTimeRange({ start: time, end: null });
    } else {
      if (time === start) {
        setTimeRange({ start: null, end: null });
        return;
      }

      const timeVal = parseInt(time.replace(':', ''));
      const startVal = parseInt(start.replace(':', ''));

      if (timeVal <= startVal) {
        showToast('结束时间必须晚于开始时间', 'warning');
        return;
      }

      // 检查时段冲突
      const startIndex = timeSlots.indexOf(start);
      const endIndex = timeSlots.indexOf(time);

      for (let i = startIndex; i < endIndex; i++) {
        if (bookingMode === 'single') {
          if (isSlotBooked(timeSlots[i])) {
            showToast('选择的时间段内包含已被占用的时段', 'error');
            setTimeRange({ start: time, end: null });
            return;
          }
        } else {
          if (isSlotBookedForLongTerm(timeSlots[i])) {
            showToast('选择的时间段内包含已被占用的时段', 'error');
            setTimeRange({ start: time, end: null });
            return;
          }
        }
      }

      setTimeRange({ start, end: time });
    }
  };

  const isSlotSelected = (time: string): boolean => {
    const timeRange = bookingMode === 'longTerm' ? dailyTimeRange : selectedTimeRange;
    return timeRange.start === time || timeRange.end === time;
  };

  const isSlotInRange = (time: string): boolean => {
    const timeRange = bookingMode === 'longTerm' ? dailyTimeRange : selectedTimeRange;
    if (!timeRange.start || !timeRange.end) return false;
    const t = parseInt(time.replace(':', ''));
    const s = parseInt(timeRange.start.replace(':', ''));
    const e = parseInt(timeRange.end.replace(':', ''));
    return t > s && t < e;
  };

  const handleSubmit = async () => {
    if (!purpose.trim()) {
      showToast('请输入会议主题', 'error');
      setHighlightField('purpose');
      purposeInputRef.current?.focus();
      return;
    }

    // 根据预订模式验证时间选择
    const timeRange = bookingMode === 'longTerm' ? dailyTimeRange : selectedTimeRange;
    if (!timeRange.start || !timeRange.end) {
      showToast(bookingMode === 'longTerm' ? '请选择每天的时段' : '请选择开始和结束时间', 'error');
      setHighlightField('time');
      timeSlotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (participants > (resource.capacity || 1)) {
      showToast(`参与人数超过会议室容量（最大 ${resource.capacity} 人）`, 'warning');
      return;
    }

    const [startH, startM] = timeRange.start.split(':').map(Number);
    const [endH, endM] = timeRange.end.split(':').map(Number);

    // 获取最新的服务器时间进行校验
    let currentServerTime: Date;
    try {
      currentServerTime = await getServerTime();
    } catch (error) {
      currentServerTime = new Date();
    }

    // 验证单次预订
    if (bookingMode === 'single') {
      // 校验选择的日期是否是过去日期
      if (isDateInPast(selectedDate)) {
        showToast('不能选择过去的日期进行预订', 'error');
        return;
      }

      const startTime = new Date(selectedDate);
      startTime.setHours(startH, startM, 0, 0);
      const endTime = new Date(selectedDate);
      endTime.setHours(endH, endM, 0, 0);

      // 使用服务器时间校验
      if (startTime < currentServerTime) {
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
          showToast('选择的时间段与已有预约冲突', 'error');
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
        nameCardDetails: needsNameCard ? nameCardDetails : undefined,
        isLongTerm: false
      });
    }
    // 验证长期预订
    else {
      if (!startDate || !endDate) {
        showToast('请选择开始和结束日期', 'error');
        return;
      }

      // 校验开始日期是否是过去日期
      if (isDateInPast(startDate)) {
        showToast('开始日期不能是过去的日期', 'error');
        return;
      }

      // 根据预订类型生成日期列表并检查冲突
      const datesToBook: string[] = [];

      if (longTermType === 'daily') {
        // 连续日期模式：检查天数限制
        const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
        if (days > maxBookingDays) {
          showToast(`最长预订时间不能超过 ${maxBookingDays} 天`, 'error');
          return;
        }

        if (days < 2) {
          showToast('长期预订至少需要2天', 'warning');
          return;
        }
        // 连续日期模式
        const currentDate = new Date(startDate);
        const endDateTime = new Date(endDate);
        while (currentDate <= endDateTime) {
          const dateStr = currentDate.toISOString().split('T')[0];
          // 只添加今天及以后的日期
          if (!isDateInPast(dateStr)) {
            datesToBook.push(dateStr);
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else {
        // 按周模式
        if (selectedWeekDays.length === 0) {
          showToast('请至少选择一个星期几', 'error');
          return;
        }
        const start = new Date(startDate);

        for (let week = 0; week < weekCount; week++) {
          for (const dayOfWeek of selectedWeekDays) {
            const targetDate = new Date(start);
            targetDate.setDate(start.getDate() + week * 7 + ((dayOfWeek - start.getDay() + 7) % 7));
            const dateStr = targetDate.toISOString().split('T')[0];
            // 只添加今天及以后的日期
            if (!isDateInPast(dateStr)) {
              datesToBook.push(dateStr);
            }
          }
        }

        // 检查是否有有效的未来日期
        if (datesToBook.length === 0) {
          showToast('所选日期均已过期，请选择未来的日期', 'error');
          return;
        }
      }

      // 检查每一天的时段冲突
      const conflictDates: string[] = [];
      for (const dateStr of datesToBook) {
        const dayStartTime = new Date(dateStr);
        dayStartTime.setHours(startH, startM, 0, 0);
        const dayEndTime = new Date(dateStr);
        dayEndTime.setHours(endH, endM, 0, 0);

        // 检查这一天是否有冲突
        for (const b of bookings) {
          if (b.resourceId !== resource.id) continue;
          if (['REJECTED', 'CANCELLED'].includes(b.status)) continue;

          const bStart = new Date(b.startTime);
          const bEnd = new Date(b.endTime);

          if (dayStartTime < bEnd && dayEndTime > bStart) {
            conflictDates.push(dateStr);
            break;
          }
        }
      }

      if (conflictDates.length > 0) {
        const formattedDates = conflictDates.slice(0, 3).map(d => {
          const date = new Date(d);
          return `${date.getMonth() + 1}月${date.getDate()}日`;
        }).join('、');
        const more = conflictDates.length > 3 ? `等${conflictDates.length}天` : '';
        showToast(`${formattedDates}${more}的所选时段已被占用`, 'error');
        return;
      }

      // 生成长期预订数据
      const longTermGroupId = `lt_${Date.now()}`;
      const bookingData = {
        resourceId: resource.id,
        purpose,
        participants,
        type: resource.type,
        hasLeader,
        leaderDetails: hasLeader ? leaderDetails : undefined,
        isVideoConference,
        needsTeaService,
        needsNameCard,
        nameCardDetails: needsNameCard ? nameCardDetails : undefined,
        isLongTerm: true,
        longTermGroupId,
        longTermStartDate: startDate,
        longTermEndDate: longTermType === 'daily' ? endDate : datesToBook[datesToBook.length - 1],
        dailyStartTime: timeRange.start,
        dailyEndTime: timeRange.end,
        longTermType,
        selectedWeekDays: longTermType === 'weekly' ? selectedWeekDays : undefined,
        weekCount: longTermType === 'weekly' ? weekCount : undefined,
        bookings: [] as any[]
      };

      // 生成每天的预订
      for (const dateStr of datesToBook) {
        const dayStartTime = new Date(dateStr);
        dayStartTime.setHours(startH, startM, 0, 0);
        const dayEndTime = new Date(dateStr);
        dayEndTime.setHours(endH, endM, 0, 0);

        bookingData.bookings.push({
          startTime: dayStartTime.toISOString(),
          endTime: dayEndTime.toISOString(),
          date: dateStr
        });
      }

      if (bookingData.bookings.length === 0) {
        showToast('没有有效的预订日期', 'error');
        return;
      }

      onConfirm(bookingData);
    }

    onClose();
  };

  const timeSlots: string[] = [];
  for (let h = 8; h <= 20; h++) {
    timeSlots.push(`${String(h).padStart(2, '0')}:00`);
    timeSlots.push(`${String(h).padStart(2, '0')}:30`);
  }

  const formatTimeDisplay = (dateStr: string): string => {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex flex-col" style={{ maxWidth: '448px', margin: '0 auto' }}>
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-[300] animate-in slide-in-from-top-4 fade-in" style={{ maxWidth: '416px', margin: '0 auto' }}>
          <div className={`p-4 rounded-2xl shadow-lg flex items-center space-x-3 transition-all duration-300 ${
            toast.type === 'error' 
              ? (isFinanceTheme ? 'bg-red-900/60 text-red-200' : 'bg-rose-500 text-white') 
              : (isFinanceTheme ? 'bg-amber-900/60 text-amber-200' : 'bg-amber-500 text-white')
          }`}>
            <AlertTriangle size={20} />
            <span className="flex-1 font-medium text-sm">{toast.message}</span>
            <button onClick={() => setToast(null)} className="p-1 rounded-full hover:bg-white/20">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className={`${themeColors.cardBg} px-4 py-3 flex items-center justify-between shrink-0 border-b ${themeColors.border}`}>
        <button onClick={onClose} className={`p-2 -ml-2 ${isFinanceTheme ? 'text-slate-400 hover:text-slate-200' : 'text-gray-400 hover:text-gray-600'}`}>
          <ChevronLeft size={24} />
        </button>
        <h3 className={`font-bold ${themeColors.text}`}>预约会议室 - {resource.name}</h3>
        <div className="w-8" />
      </div>

      <div className={`flex-1 overflow-y-auto ${isFinanceTheme ? 'bg-slate-900' : 'bg-gray-50'}`}>
        <div className="p-4 space-y-4">
          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <div className="flex items-center space-x-3">
              <div className={`w-12 h-12 rounded-xl ${
                isFinanceTheme ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-50 text-indigo-600'
              } flex items-center justify-center`}>
                <Calendar size={24} />
              </div>
              <div>
                <h4 className={`font-bold ${themeColors.text}`}>{resource.name}</h4>
                <p className={`text-xs ${themeColors.lightText}`}>{resource.location} · 容量 {resource.capacity || 1}人</p>
              </div>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-2 block ${themeColors.lightText}`}>会议主题 *</label>
            <input
              ref={purposeInputRef}
              value={purpose}
              onChange={e => { setPurpose(e.target.value); setHighlightField(null); }}
              placeholder="请输入会议主题..."
              className={`w-full p-3 rounded-xl border-none outline-none font-bold text-sm ${themeColors.inputBg}`}
            />
          </div>

          {/* 预订模式切换 */}
          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-3 block ${themeColors.lightText}`}>预订模式</label>
            <div className="flex space-x-3">
              <button
                onClick={() => setBookingMode('single')}
                className={`flex-1 py-3 rounded-xl border-2 transition-all duration-300 flex items-center justify-center space-x-2 ${
                  bookingMode === 'single'
                    ? (isFinanceTheme ? 'bg-amber-500 border-amber-500 text-slate-900' : `bg-${theme}-600 border-${theme}-600 text-white`)
                    : (isFinanceTheme ? 'bg-slate-800 border-slate-600 text-slate-400' : 'bg-white border-gray-200 text-gray-600')
                }`}
              >
                <Calendar size={18} />
                <span className="font-bold">单次预订</span>
              </button>
              <button
                onClick={() => setBookingMode('longTerm')}
                className={`flex-1 py-3 rounded-xl border-2 transition-all duration-300 flex items-center justify-center space-x-2 ${
                  bookingMode === 'longTerm'
                    ? (isFinanceTheme ? 'bg-amber-500 border-amber-500 text-slate-900' : `bg-${theme}-600 border-${theme}-600 text-white`)
                    : (isFinanceTheme ? 'bg-slate-800 border-slate-600 text-slate-400' : 'bg-white border-gray-200 text-gray-600')
                }`}
              >
                <Repeat size={18} />
                <span className="font-bold">长期预订</span>
              </button>
            </div>
            {bookingMode === 'longTerm' && (
              <p className={`text-[10px] mt-2 ${isFinanceTheme ? 'text-amber-400' : 'text-amber-600'}`}>
                最长可预订 {maxBookingDays} 天，系统将为您每天创建相同时间段的预订
              </p>
            )}
          </div>

          {/* 单次预订 - 日期选择 */}
          {bookingMode === 'single' && (
            <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
              <label className={`text-[10px] font-bold uppercase mb-3 block ${themeColors.lightText}`}>选择日期</label>
              <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
                {dateOptions.map(d => {
                  const dateStr = d.toISOString().split('T')[0];
                  const isSelected = dateStr === selectedDate;
                  const dayName = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
                  const isToday = dateStr === today;
                  const isPast = isDateInPast(dateStr);
                  return (
                    <button
                      key={dateStr}
                      onClick={() => {
                        if (isPast) {
                          showToast('不能选择过去的日期', 'error');
                          return;
                        }
                        setSelectedDate(dateStr);
                        setSelectedTimeRange({ start: null, end: null });
                        setHighlightField(null);
                      }}
                      disabled={isPast}
                      className={`flex flex-col items-center justify-center w-14 h-16 rounded-xl border-2 transition-all shrink-0 ${
                        isPast
                          ? (isFinanceTheme ? 'bg-slate-900 border-slate-700 text-slate-600 cursor-not-allowed opacity-50' : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-50')
                          : isSelected
                            ? (isFinanceTheme ? 'bg-amber-500 border-amber-500 text-slate-900' : `bg-${theme}-600 border-${theme}-600 text-white`)
                            : isToday
                              ? (isFinanceTheme ? 'bg-slate-700 border-slate-500 text-white' : 'bg-white border-gray-300 text-gray-600')
                              : (isFinanceTheme ? 'bg-slate-800 border-slate-600 text-slate-400' : 'bg-white border-gray-100 text-gray-400')
                      }`}
                    >
                      <span className="text-[10px] opacity-80">周{dayName}</span>
                      <span className="text-lg font-black leading-none mt-1">{d.getDate()}</span>
                      {isToday && !isSelected && !isPast && <span className={`text-[8px] ${isFinanceTheme ? 'text-amber-400' : 'text-amber-500'}`}>今天</span>}
                      {isPast && <span className="text-[8px] line-through">已过期</span>}
                    </button>
                  );
                })}
              </div>
              {isLoadingTime && (
                <p className={`text-[10px] mt-2 ${themeColors.lightText}`}>正在同步服务器时间...</p>
              )}
            </div>
          )}

          {/* 长期预订 - 类型选择 */}
          {bookingMode === 'longTerm' && (
            <>
              {/* 长期预订类型切换 */}
              <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
                <label className={`text-[10px] font-bold uppercase mb-3 block ${themeColors.lightText}`}>预订方式</label>
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setLongTermType('daily');
                      setDailyTimeRange({ start: null, end: null });
                    }}
                    className={`flex-1 py-3 rounded-xl border-2 transition-all duration-300 flex items-center justify-center space-x-2 ${
                      longTermType === 'daily'
                        ? (isFinanceTheme ? 'bg-amber-500 border-amber-500 text-slate-900' : `bg-${theme}-600 border-${theme}-600 text-white`)
                        : (isFinanceTheme ? 'bg-slate-800 border-slate-600 text-slate-400' : 'bg-white border-gray-200 text-gray-600')
                    }`}
                  >
                    <Calendar size={18} />
                    <span className="font-bold">连续日期</span>
                  </button>
                  <button
                    onClick={() => {
                      setLongTermType('weekly');
                      setDailyTimeRange({ start: null, end: null });
                    }}
                    className={`flex-1 py-3 rounded-xl border-2 transition-all duration-300 flex items-center justify-center space-x-2 ${
                      longTermType === 'weekly'
                        ? (isFinanceTheme ? 'bg-amber-500 border-amber-500 text-slate-900' : `bg-${theme}-600 border-${theme}-600 text-white`)
                        : (isFinanceTheme ? 'bg-slate-800 border-slate-600 text-slate-400' : 'bg-white border-gray-200 text-gray-600')
                    }`}
                  >
                    <CalendarDays size={18} />
                    <span className="font-bold">按周重复</span>
                  </button>
                </div>
                <p className={`text-[10px] mt-2 ${isFinanceTheme ? 'text-amber-400' : 'text-amber-600'}`}>
                  {longTermType === 'daily' 
                    ? `最长可预订 ${maxBookingDays} 天，系统将为您每天创建相同时间段的预订`
                    : '系统将根据您选择的周数自动计算结束日期'}
                </p>
              </div>

              {/* 连续日期模式 */}
              {longTermType === 'daily' && (
                <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
                  <label className={`text-[10px] font-bold uppercase mb-3 block ${themeColors.lightText}`}>选择日期范围</label>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <div className="flex-1">
                        <label className={`text-[10px] block mb-1 ${themeColors.lightText}`}>开始日期</label>
                        <input
                          type="date"
                          value={startDate}
                          min={today}
                          onChange={e => {
                            const newStart = e.target.value;
                            // 校验不能选择过去日期
                            if (isDateInPast(newStart)) {
                              showToast('不能选择过去的日期作为开始日期', 'error');
                              return;
                            }
                            setStartDate(newStart);
                            if (endDate < newStart) {
                              setEndDate(newStart);
                            }
                            const days = Math.ceil((new Date(endDate).getTime() - new Date(newStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
                            if (days > maxBookingDays) {
                              const maxEnd = new Date(newStart);
                              maxEnd.setDate(maxEnd.getDate() + maxBookingDays - 1);
                              setEndDate(maxEnd.toISOString().split('T')[0]);
                              showToast(`最长预订时间为 ${maxBookingDays} 天，已自动调整`, 'warning');
                            }
                            setDailyTimeRange({ start: null, end: null });
                          }}
                          className={`w-full p-3 rounded-xl border-none outline-none text-sm ${themeColors.inputBg}`}
                        />
                      </div>
                      <div className="pt-5">
                        <span className={`text-sm ${themeColors.lightText}`}>至</span>
                      </div>
                      <div className="flex-1">
                        <label className={`text-[10px] block mb-1 ${themeColors.lightText}`}>结束日期</label>
                        <input
                          type="date"
                          value={endDate}
                          min={startDate}
                          max={(() => {
                            const maxDate = new Date(startDate);
                            maxDate.setDate(maxDate.getDate() + maxBookingDays - 1);
                            return maxDate.toISOString().split('T')[0];
                          })()}
                          onChange={e => {
                            const newEnd = e.target.value;
                            const days = Math.ceil((new Date(newEnd).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
                            if (days > maxBookingDays) {
                              showToast(`最长预订时间不能超过 ${maxBookingDays} 天`, 'error');
                              return;
                            }
                            setEndDate(newEnd);
                            setDailyTimeRange({ start: null, end: null });
                          }}
                          className={`w-full p-3 rounded-xl border-none outline-none text-sm ${themeColors.inputBg}`}
                        />
                      </div>
                    </div>

                    {startDate && endDate && (
                      <div className={`p-3 rounded-xl ${isFinanceTheme ? 'bg-slate-700' : 'bg-gray-50'}`}>
                        <div className="flex items-center justify-between text-sm">
                          <span className={themeColors.lightText}>预订天数</span>
                          <span className={`font-bold ${themeColors.text}`}>
                            {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1} 天
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm mt-1">
                          <span className={themeColors.lightText}>最长限制</span>
                          <span className={`font-bold ${isFinanceTheme ? 'text-amber-400' : 'text-amber-600'}`}>
                            {maxBookingDays} 天
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 按周重复模式 */}
              {longTermType === 'weekly' && (
                <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
                  <label className={`text-[10px] font-bold uppercase mb-3 block ${themeColors.lightText}`}>按周预订设置</label>
                  <div className="space-y-4">
                    {/* 开始日期 */}
                    <div>
                      <label className={`text-[10px] block mb-2 ${themeColors.lightText}`}>开始日期（第一周的起始日）</label>
                      <input
                        type="date"
                        value={startDate}
                        min={today}
                        onChange={e => {
                          const newStart = e.target.value;
                          // 校验不能选择过去日期
                          if (isDateInPast(newStart)) {
                            showToast('不能选择过去的日期作为开始日期', 'error');
                            return;
                          }
                          setStartDate(newStart);
                          setDailyTimeRange({ start: null, end: null });
                        }}
                        className={`w-full p-3 rounded-xl border-none outline-none text-sm ${themeColors.inputBg}`}
                      />
                    </div>

                    {/* 选择星期几 */}
                    <div>
                      <label className={`text-[10px] block mb-2 ${themeColors.lightText}`}>选择每周的哪一天</label>
                      <div className="grid grid-cols-7 gap-2">
                        {['日', '一', '二', '三', '四', '五', '六'].map((day, index) => (
                          <button
                            key={index}
                            onClick={() => toggleWeekDay(index)}
                            className={`py-2 rounded-lg text-sm font-bold transition-all ${
                              selectedWeekDays.includes(index)
                                ? (isFinanceTheme ? 'bg-amber-500 text-slate-900' : `bg-${theme}-600 text-white`)
                                : (isFinanceTheme ? 'bg-slate-700 text-slate-400 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
                            }`}
                          >
                            {day}
                          </button>
                        ))}
                      </div>
                      {selectedWeekDays.length > 0 && (
                        <p className={`text-[10px] mt-2 ${themeColors.lightText}`}>
                          已选择：周{selectedWeekDays.sort().map(d => ['日', '一', '二', '三', '四', '五', '六'][d]).join('、')}
                        </p>
                      )}
                    </div>

                    {/* 选择周数 */}
                    <div>
                      <label className={`text-[10px] block mb-2 ${themeColors.lightText}`}>预订周数</label>
                      <div className="flex items-center space-x-4">
                        <input
                          type="range"
                          min={1}
                          max={4}
                          value={weekCount}
                          onChange={e => {
                            setWeekCount(parseInt(e.target.value));
                            setDailyTimeRange({ start: null, end: null });
                          }}
                          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className={`font-bold text-lg ${themeColors.text} w-12 text-center`}>{weekCount}周</span>
                      </div>
                      <p className={`text-[10px] mt-1 ${themeColors.lightText}`}>结束日期将根据开始日期和周数自动计算</p>
                    </div>

                    {/* 预订统计 */}
                    {selectedWeekDays.length > 0 && (
                      <div className={`p-3 rounded-xl ${isFinanceTheme ? 'bg-slate-700' : 'bg-gray-50'}`}>
                        <div className="flex items-center justify-between text-sm">
                          <span className={themeColors.lightText}>每周预订天数</span>
                          <span className={`font-bold ${themeColors.text}`}>{selectedWeekDays.length} 天</span>
                        </div>
                        <div className="flex items-center justify-between text-sm mt-1">
                          <span className={themeColors.lightText}>总预订天数</span>
                          <span className={`font-bold ${isFinanceTheme ? 'text-amber-400' : 'text-amber-600'}`}>
                            {selectedWeekDays.length * weekCount} 天
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 日期范围显示 */}
                    {selectedWeekDays.length > 0 && startDate && (
                      <div className={`p-3 rounded-xl border ${isFinanceTheme ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'}`}>
                        <label className={`text-[10px] block mb-2 ${themeColors.lightText}`}>预订日期范围</label>
                        <div className="flex items-center justify-between">
                          <div className="text-center flex-1">
                            <p className={`text-xs ${themeColors.lightText}`}>开始日期</p>
                            <p className={`font-bold ${themeColors.text}`}>
                              {new Date(startDate).getMonth() + 1}月{new Date(startDate).getDate()}日
                            </p>
                          </div>
                          <div className="px-3">
                            <span className={`text-lg ${themeColors.lightText}`}>→</span>
                          </div>
                          <div className="text-center flex-1">
                            <p className={`text-xs ${themeColors.lightText}`}>结束日期</p>
                            <p className={`font-bold ${themeColors.text}`}>
                              {(() => {
                                const start = new Date(startDate);
                                const lastWeekDay = Math.max(...selectedWeekDays);
                                const endDate = new Date(start);
                                endDate.setDate(start.getDate() + (weekCount - 1) * 7 + ((lastWeekDay - start.getDay() + 7) % 7));
                                return `${endDate.getMonth() + 1}月${endDate.getDate()}日`;
                              })()}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          <div ref={timeSlotRef} className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <div className="flex items-center justify-between mb-3">
              <label className={`text-[10px] font-bold uppercase ${themeColors.lightText}`}>
                {bookingMode === 'longTerm' ? '选择每天时段 *' : '选择时段 *'}
              </label>
              {bookingMode === 'single' && selectedTimeRange.start && selectedTimeRange.end && (
                <span className={`text-xs font-bold ${isFinanceTheme ? 'text-amber-400' : `text-${theme}-600`}`}>
                  {selectedTimeRange.start} - {selectedTimeRange.end}
                </span>
              )}
              {bookingMode === 'longTerm' && dailyTimeRange.start && dailyTimeRange.end && (
                <span className={`text-xs font-bold ${isFinanceTheme ? 'text-amber-400' : `text-${theme}-600`}`}>
                  每天 {dailyTimeRange.start} - {dailyTimeRange.end}
                </span>
              )}
            </div>
            
            <div className="flex items-center space-x-3 mb-3 text-[10px]">
              <span className={`flex items-center ${isFinanceTheme ? 'text-gray-400' : 'text-gray-600'}`}><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-slate-600' : 'bg-gray-100'}`}></span>可选</span>
              <span className={`flex items-center ${isFinanceTheme ? 'text-gray-400' : 'text-gray-600'}`}><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-red-900/50' : 'bg-rose-400'}`}></span>已占用</span>
              <span className={`flex items-center ${isFinanceTheme ? 'text-gray-400' : 'text-gray-600'}`}><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-amber-500' : `bg-${theme}-600`}`}></span>已选</span>
            </div>
            
            <div className="grid grid-cols-4 gap-2">
              {timeSlots.map(time => {
                const booked = bookingMode === 'single' ? isSlotBooked(time) : isSlotBookedForLongTerm(time);
                const past = bookingMode === 'single' && isSlotPast(time);
                const selected = isSlotSelected(time);
                const inRange = isSlotInRange(time);

                return (
                  <button
                    key={time}
                    onClick={() => handleTimeClick(time)}
                    disabled={booked || past}
                    className={`py-2 rounded-lg text-xs font-bold transition-all ${
                      booked
                        ? (isFinanceTheme ? 'bg-red-900/40 text-red-400 border border-red-800 cursor-not-allowed' : 'bg-rose-100 text-rose-600 border border-rose-300 cursor-not-allowed')
                        : past
                          ? (isFinanceTheme ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-gray-300 text-gray-500 cursor-not-allowed')
                          : selected
                            ? (isFinanceTheme ? 'bg-amber-500 text-slate-900' : `bg-${theme}-600 text-white`)
                            : inRange
                              ? (isFinanceTheme ? 'bg-amber-500/20 text-amber-400' : `bg-${theme}-100 text-${theme}-600`)
                              : (isFinanceTheme ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-50 text-gray-600 hover:bg-gray-100')
                    }`}
                  >
                    {time}
                  </button>
                );
              })}
            </div>
            
            {getBookingsForResource.length > 0 && (
              <div className={`mt-3 pt-3 border-t ${isFinanceTheme ? 'border-slate-600' : 'border-gray-100'}`}>
                <p className={`text-[10px] font-bold mb-2 ${themeColors.lightText}`}>已预订时段：</p>
                <div className="space-y-1">
                  {getBookingsForResource.map((b, idx) => (
                    <div key={idx} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border ${
                      isFinanceTheme ? 'bg-red-900/40 text-red-400 border-red-800' : 'bg-rose-50 text-rose-600 border-rose-100'
                    }`}>
                      <span className="font-medium">{formatTimeDisplay(b.startTime)} - {formatTimeDisplay(b.endTime)}</span>
                      <span>{b.purpose}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-2 block ${themeColors.lightText}`}>参与人数</label>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setParticipants(Math.max(1, participants - 1))}
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${themeColors.inputBg}`}
              >
                -
              </button>
              <span className={`flex-1 text-center font-bold text-lg ${themeColors.text}`}>{participants} 人</span>
              <button
                onClick={() => setParticipants(Math.min(resource.capacity || 10, participants + 1))}
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${themeColors.inputBg}`}
              >
                +
              </button>
            </div>
            <p className={`text-[10px] mt-2 text-center ${themeColors.lightText}`}>最大容量：{resource.capacity || 1}人</p>
          </div>

          <div className={`p-4 rounded-2xl border space-y-3 ${themeColors.cardBg} ${themeColors.border}`}>
            <div className="flex items-center justify-between">
              <label className={`text-xs font-bold ${themeColors.text}`}>领导参会</label>
              <button
                onClick={() => setHasLeader(!hasLeader)}
                className={`w-12 h-7 rounded-full p-1 transition-all ${
                  hasLeader 
                    ? (isFinanceTheme ? 'bg-amber-500' : `bg-${theme}-600`)
                    : (isFinanceTheme ? 'bg-slate-600' : 'bg-gray-200')
                }`}
              >
                <div className={`w-5 h-5 rounded-full shadow-sm transition-all ${hasLeader ? 'translate-x-5' : 'translate-x-0'} ${isFinanceTheme ? 'bg-slate-900' : 'bg-white'}`} />
              </button>
            </div>
            {hasLeader && (
              <input
                value={leaderDetails}
                onChange={e => setLeaderDetails(e.target.value)}
                placeholder="请输入参会领导姓名..."
                className={`w-full p-3 rounded-xl border-none outline-none text-sm ${themeColors.inputBg}`}
              />
            )}
            
            <div className="flex items-center justify-between">
              <label className={`text-xs font-bold ${themeColors.text}`}>视频会议</label>
              <button
                onClick={() => setIsVideoConference(!isVideoConference)}
                className={`w-12 h-7 rounded-full p-1 transition-all ${
                  isVideoConference 
                    ? (isFinanceTheme ? 'bg-amber-500' : `bg-${theme}-600`)
                    : (isFinanceTheme ? 'bg-slate-600' : 'bg-gray-200')
                }`}
              >
                <div className={`w-5 h-5 rounded-full shadow-sm transition-all ${isVideoConference ? 'translate-x-5' : 'translate-x-0'} ${isFinanceTheme ? 'bg-slate-900' : 'bg-white'}`} />
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <label className={`text-xs font-bold ${themeColors.text}`}>茶水服务</label>
              <button
                onClick={() => setNeedsTeaService(!needsTeaService)}
                className={`w-12 h-7 rounded-full p-1 transition-all ${
                  needsTeaService 
                    ? (isFinanceTheme ? 'bg-amber-500' : `bg-${theme}-600`)
                    : (isFinanceTheme ? 'bg-slate-600' : 'bg-gray-200')
                }`}
              >
                <div className={`w-5 h-5 rounded-full shadow-sm transition-all ${needsTeaService ? 'translate-x-5' : 'translate-x-0'} ${isFinanceTheme ? 'bg-slate-900' : 'bg-white'}`} />
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <label className={`text-xs font-bold ${themeColors.text}`}>需要桌牌</label>
              <button
                onClick={() => setNeedsNameCard(!needsNameCard)}
                className={`w-12 h-7 rounded-full p-1 transition-all ${
                  needsNameCard 
                    ? (isFinanceTheme ? 'bg-amber-500' : `bg-${theme}-600`)
                    : (isFinanceTheme ? 'bg-slate-600' : 'bg-gray-200')
                }`}
              >
                <div className={`w-5 h-5 rounded-full shadow-sm transition-all ${needsNameCard ? 'translate-x-5' : 'translate-x-0'} ${isFinanceTheme ? 'bg-slate-900' : 'bg-white'}`} />
              </button>
            </div>
            {needsNameCard && (
              <input
                value={nameCardDetails}
                onChange={e => setNameCardDetails(e.target.value)}
                placeholder="请输入桌牌姓名（多人用逗号分隔）..."
                className={`w-full p-3 rounded-xl border-none outline-none text-sm ${themeColors.inputBg}`}
              />
            )}
          </div>
        </div>
      </div>

      <div className={`p-4 border-t shrink-0 ${themeColors.cardBg} ${themeColors.border}`}>
        <button
          onClick={handleSubmit}
          className={`w-full py-3.5 rounded-xl font-bold shadow-lg active:scale-[0.98] transition-all ${themeColors.accent}`}
        >
          确认预约
        </button>
      </div>
    </div>
  );
};
