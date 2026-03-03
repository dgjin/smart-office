import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AlertTriangle, Calendar, X, Clock, User, Briefcase, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Resource, Booking } from '../../../types';
import { getServerTime, getServerToday, isDateBeforeToday } from '../../../utils/dateUtils';

interface DeskBookingFormModalProps {
  resource: Resource;
  bookings: Booking[];
  theme: string;
  onClose: () => void;
  onConfirm: (data: any) => void;
}

export const DeskBookingFormModal: React.FC<DeskBookingFormModalProps> = ({
  resource,
  bookings,
  theme,
  onClose,
  onConfirm
}) => {
  const [serverTime, setServerTime] = useState<Date>(new Date());
  const [today, setToday] = useState<string>(new Date().toISOString().split('T')[0]);
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

  const minStartDate = new Date(today);
  minStartDate.setDate(minStartDate.getDate() + 3);
  const minStartDateStr = minStartDate.toISOString().split('T')[0];
  
  const [startDate, setStartDate] = useState(minStartDateStr);
  const [endDate, setEndDate] = useState(minStartDateStr);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [applicantName, setApplicantName] = useState('');
  const [department, setDepartment] = useState('');
  const [purpose, setPurpose] = useState('');

  // 日历相关状态
  const [currentMonth, setCurrentMonth] = useState(new Date(minStartDate));
  const [isSelectingEndDate, setIsSelectingEndDate] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'error' | 'warning' } | null>(null);
  const [highlightField, setHighlightField] = useState<string | null>(null);

  const purposeInputRef = useRef<HTMLInputElement>(null);
  const timeSlotRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  const isFinanceTheme = theme === 'finance';
  const themeColors = {
    bg: isFinanceTheme ? 'bg-slate-800' : 'bg-white',
    border: isFinanceTheme ? 'border-slate-600' : 'border-gray-100',
    text: isFinanceTheme ? 'text-slate-100' : 'text-gray-800',
    lightText: isFinanceTheme ? 'text-slate-400' : 'text-gray-400',
    accent: isFinanceTheme ? 'bg-emerald-500 text-slate-900' : `bg-${theme}-600 text-white`,
    inputBg: isFinanceTheme ? 'bg-slate-700 text-slate-100' : 'bg-gray-50 text-gray-800',
    cardBg: isFinanceTheme ? 'bg-slate-800' : 'bg-white',
    buttonBg: isFinanceTheme ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-gray-600',
  };

  const showToast = (message: string, type: 'error' | 'warning' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const startDateOptions = useMemo(() => {
    return Array.from({ length: 88 }, (_, i) => {
      const d = new Date(minStartDate);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [minStartDate]);

  const endDateOptions = useMemo(() => {
    const start = new Date(startDate);
    return Array.from({ length: 90 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [startDate]);

  const getBookingsForDate = useMemo(() => {
    return (dateStr: string) => {
      const dateStart = new Date(`${dateStr}T00:00:00`);
      const dateEnd = new Date(`${dateStr}T23:59:59`);
      
      return bookings.filter(b => {
        if (b.resourceId !== resource.id) return false;
        if (['REJECTED', 'CANCELLED'].includes(b.status)) return false;
        
        const bStart = new Date(b.startTime);
        const isOnSelectedDate = bStart >= dateStart && bStart <= dateEnd;
        return isOnSelectedDate;
      });
    };
  }, [bookings, resource.id]);

  const isSlotBooked = (time: string, dateStr: string): boolean => {
    const [hours, minutes] = time.split(':').map(Number);
    const slotStart = new Date(`${dateStr}T${time}:00`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
    
    const dayBookings = getBookingsForDate(dateStr);
    for (const b of dayBookings) {
      const bStart = new Date(b.startTime);
      const bEnd = new Date(b.endTime);
      const isOverlapping = slotStart.getTime() < bEnd.getTime() && slotEnd.getTime() > bStart.getTime();
      if (isOverlapping) return true;
    }
    return false;
  };

  const isSlotPast = (time: string, dateStr: string): boolean => {
    const [hours, minutes] = time.split(':').map(Number);
    const slotDate = new Date(`${dateStr}T${time}:00`);
    // 使用服务器时间判断
    const minTime = new Date(serverTime.getTime() + 10 * 60000);
    return slotDate < minTime;
  };

  // 检查日期是否早于最小日期（过去日期）
  const isDateInPast = (dateStr: string): boolean => {
    return dateStr < minStartDateStr;
  };

  const handleTimeClick = (time: string) => {
    setHighlightField(null);
    const isBooked = isSlotBooked(time, startDate);
    const isPast = isSlotPast(time, startDate);
    if (isBooked || isPast) return;
    
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
        if (isSlotBooked(timeSlots[i], startDate)) {
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

  const calculateBookingDays = (): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const handleSubmit = async () => {
    if (!applicantName.trim()) {
      showToast('请输入申请人姓名', 'error');
      setHighlightField('applicantName');
      return;
    }
    
    if (!department.trim()) {
      showToast('请输入部门', 'error');
      setHighlightField('department');
      return;
    }
    
    if (!purpose.trim()) {
      showToast('请输入使用目的', 'error');
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

    // 校验开始日期是否是过去日期
    if (isDateInPast(startDate)) {
      showToast('开始日期不能早于最早可预订日期', 'error');
      return;
    }

    const [startH, startM] = selectedTimeRange.start.split(':').map(Number);
    const [endH, endM] = selectedTimeRange.end.split(':').map(Number);
    
    const startTime = new Date(`${startDate}T${selectedTimeRange.start}:00`);
    const endTime = new Date(`${endDate}T${selectedTimeRange.end}:00`);
    
    // 获取最新的服务器时间进行校验
    let currentServerTime: Date;
    try {
      currentServerTime = await getServerTime();
    } catch (error) {
      currentServerTime = new Date();
    }
    
    // 使用服务器时间校验
    if (startTime < currentServerTime) {
      showToast('不能预约过去的时间', 'error');
      return;
    }

    if (endTime <= startTime) {
      showToast('结束时间必须晚于开始时间', 'error');
      return;
    }

    const bookingDays = calculateBookingDays();
    if (bookingDays > 8) {
      showToast('单次预约时长不能超过8小时（按自然日计算）', 'warning');
      return;
    }

    const dayBookings = getBookingsForDate(startDate);
    for (const b of dayBookings) {
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
      participants: 1,
      type: resource.type,
      applicantName,
      department,
    });
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

  const formatDateDisplay = (date: Date): string => {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

  // 检查日期是否被占用
  const isDateBooked = (dateStr: string): boolean => {
    const dateStart = new Date(`${dateStr}T00:00:00`);
    const dateEnd = new Date(`${dateStr}T23:59:59`);

    return bookings.some(b => {
      if (b.resourceId !== resource.id) return false;
      if (['REJECTED', 'CANCELLED'].includes(b.status)) return false;
      const bStart = new Date(b.startTime);
      return bStart >= dateStart && bStart <= dateEnd;
    });
  };

  // 检查日期是否可选择（不能早于最小日期）
  const isDateDisabled = (date: Date): boolean => {
    const dateStr = date.toISOString().split('T')[0];
    return isDateInPast(dateStr);
  };

  // 检查日期是否在范围内
  const isDateInRange = (date: Date): boolean => {
    if (startDate === endDate) return false;
    const dateStr = date.toISOString().split('T')[0];
    return dateStr > startDate && dateStr < endDate;
  };

  // 生成日历数据
  const generateCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const days: (Date | null)[] = [];

    // 填充月初空白
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }

    // 填充日期
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  // 处理日期选择
  const handleDateSelect = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];

    if (isDateDisabled(date)) {
      showToast('该日期不可选择', 'warning');
      return;
    }

    if (!isSelectingEndDate) {
      // 选择开始日期
      setStartDate(dateStr);
      setEndDate(dateStr);
      setSelectedTimeRange({ start: null, end: null });
      setIsSelectingEndDate(true);
    } else {
      // 选择结束日期
      if (dateStr < startDate) {
        // 如果选择的日期早于开始日期，则交换
        setEndDate(startDate);
        setStartDate(dateStr);
      } else {
        setEndDate(dateStr);
      }
      setSelectedTimeRange({ start: null, end: null });
      setIsSelectingEndDate(false);
      setShowCalendar(false);
    }
  };

  // 切换到上一个月
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  // 切换到下一个月
  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  // 日历组件
  const CalendarComponent = () => {
    const calendarDays = generateCalendarDays();

    return (
      <div
        ref={calendarRef}
        className={`absolute z-50 left-4 right-4 mt-2 p-4 rounded-2xl shadow-xl border ${
          isFinanceTheme ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'
        }`}
      >
        {/* 日历头部 */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            className={`p-2 rounded-lg ${isFinanceTheme ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-600'}`}
          >
            <ChevronLeft size={20} />
          </button>
          <span className={`font-bold text-lg ${themeColors.text}`}>
            {currentMonth.getFullYear()}年 {monthNames[currentMonth.getMonth()]}
          </span>
          <button
            onClick={nextMonth}
            className={`p-2 rounded-lg ${isFinanceTheme ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-gray-100 text-gray-600'}`}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* 星期标题 */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {dayNames.map(day => (
            <div key={day} className={`text-center text-xs font-medium py-2 ${themeColors.lightText}`}>
              {day}
            </div>
          ))}
        </div>

        {/* 日期网格 */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((date, idx) => {
            if (!date) {
              return <div key={idx} className="aspect-square" />;
            }

            const dateStr = date.toISOString().split('T')[0];
            const isSelected = dateStr === startDate || dateStr === endDate;
            const isInRange = isDateInRange(date);
            const isDisabled = isDateDisabled(date);
            const isBooked = isDateBooked(dateStr);
            const isToday = dateStr === today;

            return (
              <button
                key={idx}
                onClick={() => {
                  if (isDisabled) {
                    showToast('该日期不可选择', 'warning');
                    return;
                  }
                  handleDateSelect(date);
                }}
                disabled={isDisabled}
                className={`
                  aspect-square rounded-lg text-sm font-medium relative
                  transition-all duration-200
                  ${isDisabled
                    ? isFinanceTheme
                      ? 'bg-slate-900 text-slate-600 cursor-not-allowed opacity-50 line-through'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed opacity-50 line-through'
                    : isSelected
                      ? isFinanceTheme
                        ? 'bg-emerald-500 text-slate-900'
                        : `bg-${theme}-600 text-white`
                      : isInRange
                        ? isFinanceTheme
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : `bg-${theme}-100 text-${theme}-600`
                        : isBooked
                          ? isFinanceTheme
                            ? 'bg-red-900/30 text-red-400'
                            : 'bg-rose-100 text-rose-600'
                          : isFinanceTheme
                            ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }
                `}
              >
                <span className="relative z-10">{date.getDate()}</span>
                {isBooked && !isSelected && !isDisabled && (
                  <span className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 rounded-full bg-red-500" />
                )}
                {isToday && !isDisabled && (
                  <span className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${isFinanceTheme ? 'bg-amber-400' : 'bg-amber-500'}`} />
                )}
              </button>
            );
          })}
        </div>

        {/* 图例 */}
        <div className="flex items-center justify-center space-x-4 mt-4 pt-3 border-t border-dashed border-gray-300">
          <div className="flex items-center space-x-1">
            <span className={`w-3 h-3 rounded ${isFinanceTheme ? 'bg-emerald-500' : `bg-${theme}-600`}`} />
            <span className={`text-xs ${themeColors.lightText}`}>已选</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className={`w-3 h-3 rounded ${isFinanceTheme ? 'bg-emerald-500/20' : `bg-${theme}-100`}`} />
            <span className={`text-xs ${themeColors.lightText}`}>范围内</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className={`w-3 h-3 rounded ${isFinanceTheme ? 'bg-red-900/30' : 'bg-rose-100'}`} />
            <span className={`text-xs ${themeColors.lightText}`}>已占用</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className={`w-3 h-3 rounded ${isFinanceTheme ? 'bg-slate-900' : 'bg-gray-100'}`} />
            <span className={`text-xs ${themeColors.lightText}`}>不可选</span>
          </div>
        </div>

        {/* 加载状态 */}
        {isLoadingTime && (
          <div className={`mt-3 p-3 rounded-lg ${isFinanceTheme ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
            <p className={`text-xs ${themeColors.lightText}`}>正在同步服务器时间...</p>
          </div>
        )}

        {/* 提示信息 */}
        <div className={`mt-3 p-3 rounded-lg ${isFinanceTheme ? 'bg-slate-700/50' : 'bg-gray-50'}`}>
          <p className={`text-xs ${themeColors.lightText}`}>
            {isSelectingEndDate
              ? `已选择开始日期：${formatDateDisplay(new Date(startDate))}，请选择结束日期`
              : '请选择开始日期'
            }
          </p>
        </div>

        {/* 关闭按钮 */}
        <button
          onClick={() => setShowCalendar(false)}
          className={`w-full mt-3 py-2 rounded-lg text-sm font-medium ${
            isFinanceTheme
              ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          关闭日历
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex flex-col" style={{ maxWidth: '448px', margin: '0 auto' }}>
      {toast && (
        <div className="fixed top-4 left-4 right-4 z-[300] animate-in slide-in-from-top-4 fade-in" style={{ maxWidth: '416px', margin: '0 auto' }}>
          <div className={`p-4 rounded-2xl shadow-lg flex items-center space-x-3 transition-all duration-300 ${toast.type === 'error' ? (isFinanceTheme ? 'bg-red-900/60 text-red-200' : 'bg-rose-500 text-white') : (isFinanceTheme ? 'bg-amber-900/60 text-amber-200' : 'bg-amber-500 text-white')}`}>
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
        <h3 className={`font-bold ${themeColors.text}`}>预约工位 - {resource.name}</h3>
        <div className="w-8" />
      </div>

      <div className={`flex-1 overflow-y-auto ${isFinanceTheme ? 'bg-slate-900' : 'bg-gray-50'}`}>
        <div className="p-4 space-y-4">
          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <div className="flex items-center space-x-3">
              <div className={`w-12 h-12 rounded-xl ${isFinanceTheme ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'} flex items-center justify-center`}>
                <Briefcase size={24} />
              </div>
              <div>
                <h4 className={`font-bold ${themeColors.text}`}>{resource.name}</h4>
                <p className={`text-xs ${themeColors.lightText}`}>{resource.location}</p>
              </div>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-2 block ${themeColors.lightText}`}>申请人姓名 *</label>
            <input
              value={applicantName}
              onChange={e => { setApplicantName(e.target.value); setHighlightField(null); }}
              placeholder="请输入姓名..."
              className={`w-full p-3 rounded-xl border-none outline-none font-bold text-sm ${themeColors.inputBg}`}
            />
          </div>

          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-2 block ${themeColors.lightText}`}>部门 *</label>
            <input
              value={department}
              onChange={e => { setDepartment(e.target.value); setHighlightField(null); }}
              placeholder="请输入部门名称..."
              className={`w-full p-3 rounded-xl border-none outline-none font-bold text-sm ${themeColors.inputBg}`}
            />
          </div>

          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-2 block ${themeColors.lightText}`}>使用目的 *</label>
            <input
              ref={purposeInputRef}
              value={purpose}
              onChange={e => { setPurpose(e.target.value); setHighlightField(null); }}
              placeholder="请输入使用目的..."
              className={`w-full p-3 rounded-xl border-none outline-none font-bold text-sm ${themeColors.inputBg}`}
            />
          </div>

          {/* 日历日期选择 */}
          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border} relative`}>
            <label className={`text-[10px] font-bold uppercase mb-3 block ${themeColors.lightText}`}>选择日期范围</label>

            {/* 日期显示按钮 */}
            <button
              onClick={() => setShowCalendar(!showCalendar)}
              className={`w-full p-4 rounded-xl border-2 transition-all flex items-center justify-between ${
                showCalendar
                  ? (isFinanceTheme ? 'border-emerald-500 bg-emerald-500/10' : `border-${theme}-500 bg-${theme}-50`)
                  : (isFinanceTheme ? 'border-slate-600 hover:border-slate-500' : 'border-gray-200 hover:border-gray-300')
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  isFinanceTheme ? 'bg-emerald-500/20 text-emerald-400' : `bg-${theme}-100 text-${theme}-600`
                }`}>
                  <CalendarDays size={20} />
                </div>
                <div className="text-left">
                  <p className={`text-xs ${themeColors.lightText}`}>
                    {isSelectingEndDate ? '请选择结束日期' : '请选择开始日期'}
                  </p>
                  <p className={`font-bold ${themeColors.text}`}>
                    {startDate === endDate
                      ? formatDateDisplay(new Date(startDate))
                      : `${formatDateDisplay(new Date(startDate))} - ${formatDateDisplay(new Date(endDate))}`
                    }
                  </p>
                </div>
              </div>
              <ChevronRight size={20} className={`transition-transform ${showCalendar ? 'rotate-90' : ''} ${themeColors.lightText}`} />
            </button>

            {/* 预订天数提示 */}
            {startDate !== endDate && (
              <div className={`mt-3 p-3 rounded-lg flex items-center justify-between ${
                isFinanceTheme ? 'bg-emerald-500/10' : 'bg-emerald-50'
              }`}>
                <span className={`text-sm ${themeColors.lightText}`}>预订天数</span>
                <span className={`font-bold ${isFinanceTheme ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  {calculateBookingDays()} 天
                </span>
              </div>
            )}

            {/* 日历组件 */}
            {showCalendar && <CalendarComponent />}
          </div>

          <div ref={timeSlotRef} className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <div className="flex items-center justify-between mb-3">
              <label className={`text-[10px] font-bold uppercase ${themeColors.lightText}`}>使用时段（按开始日期计算）*</label>
              {selectedTimeRange.start && selectedTimeRange.end && (
                <span className={`text-xs font-bold ${isFinanceTheme ? 'text-emerald-400' : `text-${theme}-600`}`}>
                  {selectedTimeRange.start} - {selectedTimeRange.end}
                </span>
              )}
            </div>
            
            <div className="flex items-center space-x-3 mb-3 text-[10px]">
              <span className={`flex items-center ${isFinanceTheme ? 'text-gray-400' : 'text-gray-600'}`}><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-slate-600' : 'bg-gray-100'}`}></span>可选</span>
              <span className={`flex items-center ${isFinanceTheme ? 'text-gray-400' : 'text-gray-600'}`}><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-red-900/50' : 'bg-rose-400'}`}></span>已占用</span>
              <span className={`flex items-center ${isFinanceTheme ? 'text-gray-400' : 'text-gray-600'}`}><span className={`w-3 h-3 rounded mr-1 ${isFinanceTheme ? 'bg-emerald-500' : `bg-${theme}-600`}`}></span>已选</span>
            </div>
            
            <div className="grid grid-cols-4 gap-2">
              {timeSlots.map(time => {
                const booked = isSlotBooked(time, startDate);
                const past = isSlotPast(time, startDate);
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
                            ? (isFinanceTheme ? 'bg-emerald-500 text-slate-900' : `bg-${theme}-600 text-white`)
                            : inRange 
                              ? (isFinanceTheme ? 'bg-emerald-500/20 text-emerald-400' : `bg-${theme}-100 text-${theme}-600`)
                              : (isFinanceTheme ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-50 text-gray-600 hover:bg-gray-100')
                    }`}
                  >
                    {time}
                  </button>
                );
              })}
            </div>
            
            {getBookingsForDate(startDate).length > 0 && (
              <div className={`mt-3 pt-3 border-t ${isFinanceTheme ? 'border-slate-600' : 'border-gray-100'}`}>
                <p className={`text-[10px] font-bold mb-2 ${themeColors.lightText}`}>开始日期已预订时段：</p>
                <div className="space-y-1">
                  {getBookingsForDate(startDate).map((b, idx) => (
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
