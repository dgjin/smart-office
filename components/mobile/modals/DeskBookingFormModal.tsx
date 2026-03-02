import React, { useState, useMemo, useRef } from 'react';
import { AlertTriangle, Calendar, X, Clock, User, Briefcase, ChevronLeft, ChevronRight } from 'lucide-react';
import { Resource, Booking } from '../../../types';

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
  const today = new Date();
  const minStartDate = new Date(today);
  minStartDate.setDate(minStartDate.getDate() + 3);
  const minStartDateStr = minStartDate.toISOString().split('T')[0];
  
  const [startDate, setStartDate] = useState(minStartDateStr);
  const [endDate, setEndDate] = useState(minStartDateStr);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [applicantName, setApplicantName] = useState('');
  const [department, setDepartment] = useState('');
  const [purpose, setPurpose] = useState('');
  
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
    const now = new Date();
    const minTime = new Date(now.getTime() + 10 * 60000);
    return slotDate < minTime;
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

  const handleSubmit = () => {
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

    const [startH, startM] = selectedTimeRange.start.split(':').map(Number);
    const [endH, endM] = selectedTimeRange.end.split(':').map(Number);
    
    const startTime = new Date(`${startDate}T${selectedTimeRange.start}:00`);
    const endTime = new Date(`${endDate}T${selectedTimeRange.end}:00`);
    const now = new Date();
    
    if (startTime < now) {
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

          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-3 block ${themeColors.lightText}`}>开始日期（3天后可选）</label>
            <div className="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              {startDateOptions.slice(0, 14).map(d => {
                const dateStr = d.toISOString().split('T')[0];
                const isSelected = dateStr === startDate;
                const dayName = dayNames[d.getDay()];
                const isToday = dateStr === minStartDateStr;
                return (
                  <button
                    key={dateStr}
                    onClick={() => { 
                      setStartDate(dateStr);
                      if (new Date(endDate) < d) {
                        setEndDate(dateStr);
                      }
                      setSelectedTimeRange({ start: null, end: null }); 
                      setHighlightField(null);
                    }}
                    className={`flex flex-col items-center justify-center w-14 h-16 rounded-xl border-2 transition-all shrink-0 ${
                      isSelected 
                        ? (isFinanceTheme ? 'bg-emerald-500 border-emerald-500 text-slate-900' : `bg-${theme}-600 border-${theme}-600 text-white`)
                        : isToday 
                          ? (isFinanceTheme ? 'bg-slate-700 border-slate-500 text-white' : 'bg-white border-gray-300 text-gray-600')
                          : (isFinanceTheme ? 'bg-slate-800 border-slate-600 text-slate-400' : 'bg-white border-gray-100 text-gray-400')
                    }`}
                  >
                    <span className="text-[10px] opacity-80">周{dayName}</span>
                    <span className="text-lg font-black leading-none mt-1">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`p-4 rounded-2xl border ${themeColors.cardBg} ${themeColors.border}`}>
            <label className={`text-[10px] font-bold uppercase mb-3 block ${themeColors.lightText}`}>结束日期</label>
            <div className="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              {endDateOptions.slice(0, 30).map(d => {
                const dateStr = d.toISOString().split('T')[0];
                const isSelected = dateStr === endDate;
                const dayName = dayNames[d.getDay()];
                const isBeforeStart = d < new Date(startDate);
                return (
                  <button
                    key={dateStr}
                    disabled={isBeforeStart}
                    onClick={() => { 
                      setEndDate(dateStr); 
                      setSelectedTimeRange({ start: null, end: null }); 
                      setHighlightField(null);
                    }}
                    className={`flex flex-col items-center justify-center w-14 h-16 rounded-xl border-2 transition-all shrink-0 ${
                      isSelected 
                        ? (isFinanceTheme ? 'bg-emerald-500 border-emerald-500 text-slate-900' : `bg-${theme}-600 border-${theme}-600 text-white`)
                        : isBeforeStart
                          ? (isFinanceTheme ? 'bg-slate-700 border-slate-600 text-slate-600 cursor-not-allowed' : 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed')
                          : (isFinanceTheme ? 'bg-slate-800 border-slate-600 text-slate-400' : 'bg-white border-gray-100 text-gray-400')
                    }`}
                  >
                    <span className="text-[10px] opacity-80">周{dayName}</span>
                    <span className="text-lg font-black leading-none mt-1">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>
            {startDate !== endDate && (
              <p className={`text-xs mt-2 ${themeColors.lightText}`}>
                已选择 {formatDateDisplay(new Date(startDate))} - {formatDateDisplay(new Date(endDate))}，共 {calculateBookingDays()} 天
              </p>
            )}
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
