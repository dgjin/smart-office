import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, MapPin, Calendar, CheckCircle, XCircle, LayoutDashboard, Plus, LogOut, 
  Cpu, Monitor, Coffee, Edit2, Trash2, UserPlus, RefreshCw,
  Clock, GitMerge, ChevronRight, ArrowRight, ChevronDown, ChevronUp,
  Zap, ShieldCheck, Check, X, Building2, 
  PieChart, ChevronLeft, Timer, Briefcase, Shield, FolderTree,
  UserCircle, AlertTriangle, Download, Upload, Database,
  Info, MoreHorizontal, Activity, ArrowRightCircle, MessageSquare, Send,
  CalendarDays, History, Square, CheckSquare, Search, FileText, FileUp,
  Lock, Smartphone, Mail, Key, Minus, Layers, PlayCircle, QrCode, Eye, Lightbulb, Bell, Filter,
  Save, RotateCcw, Phone, Ban, Video, CupSoda, Crown, Cloud, CloudOff
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, Department, RoleDefinition, ResourceStatus, Notification, WorkOrder } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS, INITIAL_ROLES } from './constants';
import { getSmartRecommendation, type SmartRecommendation } from './services/aiService';
import { formatDate, formatTime, migrateBookings, pad2, toLocalDateString, toLocalDateTimeString, toLocalTimeString } from './utils/dateTime';
import { findBookingConflicts, findNextAvailableSlot, hasBookingConflict, isActiveBooking } from './utils/bookingRules';
import { approveBooking, canApproveBooking, isLastApprovalNode, rejectBooking } from './utils/approval';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V35';
const THEME_KEY = 'SMART_OFFICE_THEME';

// --- Theme Config ---
const THEMES = [
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-600', text: 'text-indigo-600', border: 'border-indigo-100', bg: 'bg-indigo-50' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-100', bg: 'bg-emerald-50' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-600', text: 'text-orange-600', border: 'border-orange-100', bg: 'bg-orange-50' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-600', text: 'text-rose-600', border: 'border-rose-100', bg: 'bg-rose-50' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-600', text: 'text-purple-600', border: 'border-purple-100', bg: 'bg-purple-50' },
];

const downloadBookingIcs = (booking: Booking, resource: Resource, users: User[]) => {
  const timestamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const organizer = users.find(u => u.id === booking.userId);
  const attendees = (booking.attendeeIds || []).map(id => users.find(u => u.id === id)).filter(Boolean) as User[];
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SmartOffice//Booking//ZH-CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${booking.id}@smartoffice.local`, `DTSTAMP:${timestamp(new Date().toISOString())}`,
    `DTSTART:${timestamp(booking.startTime)}`, `DTEND:${timestamp(booking.endTime)}`,
    `SUMMARY:${escape(booking.purpose)}`, `LOCATION:${escape(resource.name)}`,
    organizer ? `ORGANIZER;CN=${escape(organizer.name)}:MAILTO:${organizer.email}` : '',
    ...attendees.map(u => `ATTENDEE;CN=${escape(u.name)};RSVP=TRUE:MAILTO:${u.email}`),
    'END:VEVENT', 'END:VCALENDAR'
  ].filter(Boolean);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${booking.purpose.replace(/[\\/:*?"<>|]/g, '_')}.ics`;
  link.click();
  URL.revokeObjectURL(url);
};

const useModalA11y = (onClose: () => void) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const focusables = () => [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])];
    focusables()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, []);
  return ref;
};

// --- Sub-components ---

const StatusBadge = ({ status, theme }: { status: string, theme: string }) => {
  const styles: any = { 
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100', 
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100', 
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100', 
    APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`, 
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100', 
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200 line-through',
    COMPLETED: 'bg-gray-100 text-gray-500 border-gray-200',
    MAINTENANCE: 'bg-gray-50 text-gray-500 border-gray-200'
  };
  const labels: any = { 
    AVAILABLE: '空闲', PENDING: '审批中', APPROVED: '已通过', REJECTED: '驳回', 
    OCCUPIED: '占用', CANCELLED: '已撤销', COMPLETED: '结束', MAINTENANCE: '维护中' 
  };
  return <span className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${styles[status] || styles.PENDING}`}>{labels[status] || status}</span>;
};

const RoleTag = ({ roleId, roles, theme }: any) => {
  const role = roles.find((r: any) => r.id === roleId);
  if (!role) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">未知</span>;
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold bg-${role.color}-100 text-${role.color}-700 border border-${role.color}-200`}>{role.name}</span>;
};

const SidebarItem = ({ icon: Icon, label, id, active, onClick, theme, badge }: any) => (
  <button onClick={() => onClick(id)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${active ? `bg-${theme}-600 text-white shadow-lg` : `text-gray-500 hover:bg-${theme}-50 hover:text-${theme}-600`}`}>
    <div className="flex items-center space-x-3">
      <Icon size={18} /> 
      <span className="text-sm font-medium">{label}</span>
    </div>
    {badge > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${active ? 'bg-white text-indigo-600' : 'bg-rose-500 text-white'}`}>{badge}</span>}
  </button>
);

const StatCard = ({ title, value, icon: Icon, trend, color, onClick }: any) => (
  <button onClick={onClick} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between group hover:border-gray-200 transition-all text-left">
    <div className="space-y-1">
      <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">{title}</p>
      <h3 className="text-2xl font-black text-gray-800">{value}</h3>
      {trend && <p className={`text-[11px] font-bold ${trend.startsWith('+') ? 'text-emerald-500' : 'text-rose-500'}`}>{trend} <span className="text-gray-500">较上周</span></p>}
    </div>
    <div className={`w-12 h-12 rounded-2xl bg-${color}-50 flex items-center justify-center text-${color}-600 group-hover:scale-110 transition-transform`}>
      <Icon size={24} />
    </div>
  </button>
);

const QRScannerModal = ({ theme, bookings, resources, onClose, onCheckIn }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const modalRef = useModalA11y(onClose);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        setError('无法访问摄像头，可直接选择当前会议签到。');
      }
    };
    startCamera();
    return () => { stream?.getTracks().forEach(track => track.stop()); };
  }, []);

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="会议签到" className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-md p-6 md:p-8 shadow-2xl animate-in zoom-in overflow-y-auto max-h-[90vh] relative">
        <button onClick={onClose} aria-label="关闭签到" className="absolute top-6 right-6 p-2 bg-gray-100 rounded-xl text-gray-500 hover:text-rose-500 z-10"><X size={20}/></button>
        <div className="text-center mb-5">
          <h3 className="text-xl font-black text-gray-800">会议签到</h3>
          <p className="text-xs text-gray-500 font-medium mt-1">开始前 15 分钟开放，选择当前会议完成签到</p>
        </div>
        <div className="relative aspect-video bg-gray-900 rounded-3xl overflow-hidden mb-5 border-4 border-gray-100 flex items-center justify-center">
          {error ? <p className="p-6 text-center text-white text-xs font-bold">{error}</p> : <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />}
        </div>
        <div className="space-y-3">
          {bookings.map((b: Booking) => <button key={b.id} onClick={() => { if (onCheckIn(b.id)) onClose(); }} className={`w-full p-4 rounded-2xl bg-${theme}-50 border border-${theme}-100 text-left hover:bg-${theme}-100 transition-colors`}>
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm font-black text-gray-800">{b.purpose}</p><p className="text-[11px] text-gray-500 mt-1">{resources.find((r: Resource) => r.id === b.resourceId)?.name} · {toLocalDateTimeString(b.startTime)} - {toLocalTimeString(b.endTime)}</p></div>
              <span className={`shrink-0 px-3 py-2 rounded-xl bg-${theme}-600 text-white text-xs font-black`}>确认签到</span>
            </div>
          </button>)}
          {bookings.length === 0 && <div className="py-8 text-center bg-gray-50 rounded-2xl"><Clock size={28} className="mx-auto text-gray-500 mb-3"/><p className="text-sm font-bold text-gray-600">当前没有可签到的会议</p><p className="text-[11px] text-gray-500 mt-2">仅已核准且未结束的本人或受邀会议可签到</p></div>}
        </div>
      </div>
    </div>
  );
};

const LoginView = ({ users, onLogin, theme }: any) => {
  return (
    <div className={`min-h-screen bg-gray-50 flex items-center justify-center p-4`}>
      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-xl p-10 border border-gray-100">
        <div className="text-center mb-10">
          <div className={`w-16 h-16 bg-${theme}-600 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg mb-6`}>
            <Cpu size={32} />
          </div>
          <h1 className="text-3xl font-black text-gray-800 tracking-tight">SmartOffice</h1>
          <p className="text-gray-500 font-medium mt-2">请选择演示账号登录</p>
        </div>
        <div className="space-y-3">
          {users.map((u: any) => (
            <button key={u.id} onClick={() => onLogin(u)} className="w-full p-4 flex items-center space-x-4 rounded-2xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all group text-left">
              <div className={`w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center font-black text-gray-500 group-hover:bg-indigo-200 group-hover:text-indigo-600 transition-colors`}>{u.name[0]}</div>
              <div>
                <h4 className="font-bold text-gray-800">{u.name}</h4>
                <p className="text-xs text-gray-500">{u.role.join(', ')}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const TodayResourceUsage = ({ resources, bookings, users, theme, onBookingClick }: any) => {
  const hours = Array.from({ length: 13 }, (_, i) => i + 8); // 8:00 - 20:00
  return (
    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 overflow-x-auto">
      <h3 className="font-black text-lg mb-6">今日资源占用概览</h3>
      <div className="min-w-[600px]">
        <div className="flex mb-4">
          <div className="w-32 shrink-0 p-2 text-xs font-black text-gray-500 uppercase tracking-widest">资源名称</div>
          <div className="flex-1 flex justify-between text-xs text-gray-500 font-bold uppercase relative">
            {hours.map(h => <div key={h} className="flex-1 text-center border-l border-gray-100">{h}:00</div>)}
          </div>
        </div>
        <div className="space-y-3">
          {resources.slice(0, 5).map((r: any) => {
            const dailyBookings = bookings.filter((b: any) => 
              b.resourceId === r.id && 
              b.status === 'APPROVED' && 
              new Date(b.startTime).toDateString() === new Date().toDateString()
            );

            return (
              <div key={r.id} className="flex items-center group">
                <div className="w-32 shrink-0 text-xs font-bold text-gray-600 truncate pr-4 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${r.type === 'ROOM' ? 'bg-indigo-400' : 'bg-emerald-400'}`}></div>
                  {r.name}
                </div>
                <div className="flex-1 h-10 bg-gray-50/50 rounded-xl relative overflow-hidden border border-transparent group-hover:border-gray-100 transition-all">
                   {/* Background Grid Lines */}
                   <div className="absolute inset-0 flex">
                      {hours.map(h => <div key={h} className="flex-1 border-l border-gray-100 first:border-l-0"></div>)}
                   </div>

                   {dailyBookings.map((b: any) => {
                    const start = new Date(b.startTime);
                    const end = new Date(b.endTime);
                    const startHour = start.getHours() + start.getMinutes() / 60;
                    const endHour = end.getHours() + end.getMinutes() / 60;
                    
                    // Clamp to view 8-20
                    let s = Math.max(startHour, 8);
                    let e = Math.min(endHour, 21);
                    if (s >= 21 || e <= 8) return null;

                    const left = ((s - 8) / 13) * 100;
                    const width = ((e - s) / 13) * 100;
                    
                    const user = users?.find((u: any) => u.id === b.userId);

                    return (
                      <button 
                        key={b.id} 
                        onClick={() => onBookingClick && onBookingClick({ resource: r, date: new Date(), bookings: dailyBookings })}
                        className={`absolute top-1.5 bottom-1.5 bg-${theme}-500/90 rounded-lg text-white text-[10px] font-bold flex items-center px-2 hover:bg-${theme}-600 transition-all shadow-sm hover:shadow-md z-10 hover:z-20 border border-${theme}-400/20 overflow-hidden whitespace-nowrap`} 
                        style={{ left: `${left}%`, width: `${width}%` }} 
                        title={`${user?.name || '未知'} · ${b.purpose}`}
                      >
                         {user?.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const ResourceUsageGrid = ({ title, days, resources, bookings, onDayClick, theme }: any) => {
  const isBookingActiveOnDay = (booking: Booking, day: Date, resourceId: string) => {
    if (booking.resourceId !== resourceId) return false;
    if (booking.status !== 'APPROVED') return false;
    
    const dayStart = new Date(day); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(day); dayEnd.setHours(23,59,59,999);
    const bStart = new Date(booking.startTime);
    const bEnd = new Date(booking.endTime);
    
    return bStart < dayEnd && bEnd > dayStart;
  };

  return (
    <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col">
      <h3 className="font-black text-lg mb-4">{title}</h3>
      <div className="overflow-x-auto custom-scrollbar pb-2">
        <table className="border-collapse w-full min-w-[800px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-white p-3 text-left text-xs font-black text-gray-500 uppercase tracking-widest border-b border-gray-100 min-w-[140px]">资源名称</th>
              {days.map((d: Date, i: number) => {
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <th key={i} className={`p-2 text-[11px] font-bold text-gray-500 border-b border-gray-100 min-w-[40px] text-center ${isWeekend ? 'bg-slate-50 text-slate-400' : ''}`}>
                    {d.getMonth() + 1}/{d.getDate()}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {resources.map((r: any) => (
              <tr key={r.id} className="group hover:bg-gray-50/30 transition-colors">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50/30 p-3 text-xs font-bold text-gray-700 border-b border-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] truncate max-w-[140px]" title={r.name}>
                  <div className="flex items-center space-x-2">
                    <span className={`w-2 h-2 rounded-full ${r.type === 'ROOM' ? 'bg-indigo-400' : 'bg-emerald-400'}`}></span>
                    <span className="truncate">{r.name}</span>
                  </div>
                </td>
                {days.map((d: Date, i: number) => {
                  const dayBookings = bookings.filter((b: any) => isBookingActiveOnDay(b, d, r.id));
                  const bookingCount = dayBookings.length;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  
                  // Logic for continuous bars visualization
                  let connectLeft = false;
                  let connectRight = false;
                  
                  // Only apply continuous logic if there is exactly one booking, to avoid confusion with overlaps
                  if (bookingCount === 1) {
                      const currentBookingId = dayBookings[0].id;
                      if (i > 0) {
                         const prevD = days[i-1];
                         const prevBookings = bookings.filter((b: any) => isBookingActiveOnDay(b, prevD, r.id));
                         if (prevBookings.some((b: any) => b.id === currentBookingId)) connectLeft = true;
                      }
                      if (i < days.length - 1) {
                         const nextD = days[i+1];
                         const nextBookings = bookings.filter((b: any) => isBookingActiveOnDay(b, nextD, r.id));
                         if (nextBookings.some((b: any) => b.id === currentBookingId)) connectRight = true;
                      }
                  }

                  let shapeClass = 'rounded-lg';
                  let widthClass = 'w-full';
                  let marginClass = '';
                  
                  if (connectLeft && connectRight) {
                      shapeClass = 'rounded-none';
                      widthClass = 'w-[calc(100%+9px)]'; 
                      marginClass = '-mx-1';
                  } else if (connectLeft) {
                      shapeClass = 'rounded-l-none rounded-r-lg';
                      widthClass = 'w-[calc(100%+4px)]';
                      marginClass = '-ml-1';
                  } else if (connectRight) {
                      shapeClass = 'rounded-l-lg rounded-r-none';
                      widthClass = 'w-[calc(100%+4px)]';
                      marginClass = '-mr-1';
                  }

                  return (
                    <td key={i} className={`p-1 border-b border-gray-50 text-center relative ${isWeekend ? 'bg-slate-50' : ''}`}>
                      <div className="relative w-full h-8 flex items-center justify-center">
                        <button 
                          onClick={() => onDayClick(r.id, d)}
                          className={`h-full flex items-center justify-center transition-all ${bookingCount > 0 ? `bg-${theme}-600 border-${theme}-700 border shadow-sm ${shapeClass} ${widthClass} ${marginClass} z-10` : 'w-full hover:bg-gray-100 rounded-lg'}`}
                          title={bookingCount > 0 ? `${bookingCount} 项预订` : '空闲'}
                        >
                          {bookingCount > 0 && (
                            <span className="text-[10px] font-bold text-white">{bookingCount > 1 ? bookingCount : ''}</span>
                          )}
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center space-x-4 text-[11px] text-gray-500 font-bold justify-end">
        <div className="flex items-center space-x-1"><span className={`w-3 h-3 rounded bg-${theme}-600 border border-${theme}-700`}></span><span>已预订</span></div>
        <div className="flex items-center space-x-1"><span className="w-3 h-3 rounded bg-white border border-gray-200"></span><span>空闲</span></div>
        <div className="flex items-center space-x-1"><span className="w-3 h-3 rounded bg-slate-50"></span><span>周末</span></div>
      </div>
    </div>
  );
};

const WorkflowStepper = ({ booking, workflow, theme }: any) => {
  return (
    <div className="flex items-center justify-between relative mt-4">
      <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-100 -z-10"></div>
      {workflow.map((node: any, idx: number) => {
        const isPassed = booking.currentNodeIndex > idx || (booking.currentNodeIndex === idx && booking.status === 'APPROVED');
        const isCurrent = booking.currentNodeIndex === idx && booking.status === 'PENDING';
        return (
          <div key={node.id} className="flex flex-col items-center bg-white px-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${isPassed ? `bg-${theme}-600 border-${theme}-600 text-white` : isCurrent ? `bg-white border-${theme}-600 text-${theme}-600` : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
              {isPassed ? <Check size={12}/> : idx + 1}
            </div>
            <span className={`text-[10px] mt-1 font-bold ${isCurrent ? `text-${theme}-600` : 'text-gray-500'}`}>{node.name}</span>
          </div>
        );
      })}
    </div>
  );
};

const ApprovalTaskCard = ({ booking, workflow, users, resources, theme, onApprove, onReject, selected, onToggleSelect }: any) => {
  const user = users.find((u: any) => u.id === booking.userId);
  const resource = resources.find((r: any) => r.id === booking.resourceId);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const reject = () => {
    if (!comment.trim()) { setError('驳回时必须填写具体原因'); return; }
    onReject(comment.trim());
  };
  return (
    <div className={`bg-white p-6 rounded-[2rem] border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 ${selected ? `border-${theme}-300 ring-2 ring-${theme}-50` : 'border-gray-100'}`}>
      <button onClick={onToggleSelect} aria-label={`选择${user?.name}的申请`} className={`self-start md:self-center ${selected ? `text-${theme}-600` : 'text-gray-200 hover:text-gray-500'}`}>{selected ? <CheckSquare size={20}/> : <Square size={20}/>}</button>
      <div className="flex items-center space-x-4 flex-1">
        <div className={`w-12 h-12 rounded-2xl bg-${theme}-50 flex items-center justify-center text-${theme}-600 font-bold text-xs shrink-0`}>{user?.name[0]}</div>
        <div>
           <div className="flex items-center space-x-2">
             <h4 className="font-bold text-gray-800 text-lg">{user?.name} 申请 {resource?.name}</h4>
             {(booking.hasLeader || booking.isVideoConference || booking.needsTeaService) && <span className="bg-rose-50 text-rose-600 px-2 py-0.5 rounded-md text-[11px] font-black border border-rose-100">特殊需求</span>}
           </div>
           <p className="text-xs text-gray-500 font-medium">{toLocalDateTimeString(booking.startTime)} 至 {toLocalDateTimeString(booking.endTime)} · {booking.purpose}</p>
           
           {(booking.hasLeader || booking.isVideoConference || booking.needsTeaService) && (
             <div className="mt-2 flex flex-wrap gap-2">
               {booking.hasLeader && (
                 <div className="flex items-center space-x-1 text-[11px] text-gray-600 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                   <Crown size={12} className="text-amber-500"/>
                   <span className="font-bold">领导参会: {booking.leaderDetails}</span>
                 </div>
               )}
               {booking.isVideoConference && (
                 <div className="flex items-center space-x-1 text-[11px] text-gray-600 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                   <Video size={12} className="text-indigo-500"/>
                   <span className="font-bold">视频会议</span>
                 </div>
               )}
               {booking.needsTeaService && (
                 <div className="flex items-center space-x-1 text-[11px] text-gray-600 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                   <CupSoda size={12} className="text-emerald-500"/>
                   <span className="font-bold">茶水服务</span>
                 </div>
               )}
             </div>
           )}
        </div>
      </div>
      <div className="w-full md:w-72 shrink-0 space-y-2">
        <label className="sr-only" htmlFor={`comment-${booking.id}`}>审批附言</label>
        <textarea id={`comment-${booking.id}`} value={comment} onChange={e => { setComment(e.target.value); setError(''); }} placeholder="审批附言（通过可选，驳回必填）" className="w-full p-3 rounded-xl bg-gray-50 border border-gray-100 text-xs outline-none focus:ring-2 ring-indigo-100 resize-none" rows={2}/>
        {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
        <div className="flex space-x-3">
          <button onClick={reject} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-bold text-xs hover:bg-gray-50 transition-colors">驳回</button>
          <button onClick={() => onApprove(comment.trim())} className={`flex-1 px-4 py-2.5 rounded-xl bg-${theme}-600 text-white font-bold text-xs shadow-lg hover:shadow-xl transition-all`}>通过审批</button>
        </div>
      </div>
    </div>
  );
};

const DayBookingDetailModal = ({ detail, onClose, users, resources, theme }: any) => (
  <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl p-8 max-w-md w-full relative animate-in zoom-in">
      <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:text-gray-600"><X size={20}/></button>
      <h3 className="font-black text-xl mb-1 text-gray-800">{formatDate(detail.date)}</h3>
      <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-6">{detail.resource.name}</p>
      
      <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
         {detail.bookings.length === 0 ? (
           <div className="py-12 text-center border-2 border-dashed border-gray-100 rounded-2xl">
             <p className="text-gray-500 text-sm font-bold">该日暂无预订记录</p>
           </div>
         ) : (
           detail.bookings.map((b: any) => {
             const user = users.find((u: any) => u.id === b.userId);
             const resource = resources ? resources.find((r: any) => r.id === b.resourceId) : null;
             return (
               <div key={b.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-indigo-100 transition-all">
                 <div className="flex justify-between items-start mb-2">
                   <div>
                     <p className={`text-xs font-black text-${theme}-600 mb-0.5`}>{toLocalTimeString(b.startTime)} - {toLocalTimeString(b.endTime)}</p>
                     {resource && <p className="text-[11px] text-gray-500 font-bold uppercase">{resource.name}</p>}
                   </div>
                   <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${b.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                     {b.status === 'APPROVED' ? '已核准' : '待审批'}
                   </span>
                 </div>
                 <div className="flex items-center space-x-3 mt-3 pt-3 border-t border-gray-200/50">
                   <div className={`w-8 h-8 rounded-full bg-white flex items-center justify-center text-[11px] font-bold text-gray-600 shadow-sm`}>
                     {user?.name?.[0]}
                   </div>
                   <div>
                     <p className="text-xs font-bold text-gray-800">{user?.name} <span className="text-gray-500 font-medium">· {user?.department}</span></p>
                     <p className="text-[11px] text-gray-500 mt-0.5">{b.purpose}</p>
                   </div>
                 </div>

                 {(b.hasLeader || b.isVideoConference || b.needsTeaService) && (
                   <div className="mt-3 pt-2 border-t border-gray-200/50 flex flex-wrap gap-2">
                     {b.hasLeader && (
                       <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-bold bg-amber-50 text-amber-600 border border-amber-100">
                         <Crown size={12} className="mr-1"/> 领导{b.leaderDetails ? `: ${b.leaderDetails}` : ''}
                       </span>
                     )}
                     {b.isVideoConference && (
                       <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                         <Video size={12} className="mr-1"/> 视频会
                       </span>
                     )}
                     {b.needsTeaService && (
                       <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
                         <CupSoda size={12} className="mr-1"/> 茶水
                       </span>
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

const BatchImportModal = ({ type, onClose, onImport, theme, existingDepartments = [], roles = [] }: any) => {
  const [text, setText] = useState('');
  
  const getTemplate = () => {
    if (type === 'USERS') return "姓名,邮箱,部门,角色(可选),办公电话(可选),移动电话(可选)\n张三,zhangsan@company.com,市场部,正式员工,010-88886666,13800000001";
    if (type === 'RESOURCES') return "资源名称,类型(会议室/工位),容量,位置\nGamma 演示厅,会议室,20,2号楼";
    if (type === 'DEPARTMENTS') return "部门名称,上级部门名称(可选)\n华北区,\n北京分公司,华北区";
    return "";
  };

  const handleDownloadTemplate = () => {
    const template = getTemplate();
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `template_${type.toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const processData = () => {
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
         onImport(JSON.parse(trimmed));
         return;
      }

      const lines = trimmed.split('\n');
      const data: any[] = [];
      const headerKeywords = ['名称', '姓名', '资源', '部门', 'name'];
      const hasHeader = headerKeywords.some(key => lines[0].toLowerCase().includes(key));
      const startIndex = hasHeader ? 1 : 0;
      
      if (type === 'DEPARTMENTS') {
         const deptMap = new Map();
         existingDepartments.forEach((d: any) => deptMap.set(d.name, d.id));
         
         for (let i = startIndex; i < lines.length; i++) {
            const parts = lines[i].split(/,|，/);
            const name = parts[0]?.trim();
            const parentName = parts[1]?.trim();
            
            if (!name) continue;
            
            const newId = `dpt-imp-${Date.now()}-${i}`;
            // If the user imports duplicates, we skip or handle? Simple skip if exists in map.
            if (deptMap.has(name)) continue;

            const parentId = parentName ? deptMap.get(parentName) : undefined;
            const newDept = { id: newId, name, parentId };
            
            data.push(newDept);
            deptMap.set(name, newId); 
         }
      } else if (type === 'USERS') {
         for (let i = startIndex; i < lines.length; i++) {
            const parts = lines[i].split(/,|，/);
            const name = parts[0]?.trim();
            if (!name) continue;
            const email = parts[1]?.trim();
            const department = parts[2]?.trim();
            const roleName = parts[3]?.trim();
            const landline = parts[4]?.trim();
            const mobile = parts[5]?.trim();
            
            let roleIds = ['EMPLOYEE'];
            if (roleName) {
               const foundRole = roles.find((r: any) => r.name === roleName);
               if (foundRole) roleIds = [foundRole.id];
            }
            
            data.push({
               id: `u-imp-${Date.now()}-${i}`,
               name,
               email: email || `${name}@company.com`,
               department: department || '待分配',
               role: roleIds,
               landline,
               mobile
            });
         }
      } else if (type === 'RESOURCES') {
         for (let i = startIndex; i < lines.length; i++) {
            const parts = lines[i].split(/,|，/);
            const name = parts[0]?.trim();
            if (!name) continue;
            const typeStr = parts[1]?.trim().toUpperCase();
            const capacity = parts[2]?.trim();
            const location = parts[3]?.trim();

            data.push({
               id: `r-imp-${Date.now()}-${i}`,
               name,
               type: (typeStr === '会议室' || typeStr === 'ROOM' || typeStr.includes('室')) ? 'ROOM' : 'DESK',
               capacity: parseInt(capacity) || 1,
               location: location || '未标注',
               status: 'AVAILABLE',
               features: []
            });
         }
      }
      
      if (data.length > 0) {
         onImport(data);
      } else {
         alert("未解析到有效数据，请检查格式。");
      }

    } catch (e) {
      alert('数据解析失败，请检查格式。');
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-lg w-full shadow-2xl animate-in zoom-in">
        <div className="flex justify-between items-center mb-6">
           <h3 className="font-black text-xl text-gray-800">批量导入 {type === 'USERS' ? '成员' : (type === 'RESOURCES' ? '资源' : '部门')}</h3>
           <button onClick={handleDownloadTemplate} className={`text-xs font-bold text-${theme}-600 bg-${theme}-50 px-3 py-1.5 rounded-lg hover:bg-${theme}-100 transition-colors flex items-center space-x-1`}>
             <Download size={14}/> <span>下载模板</span>
           </button>
        </div>
        
        <div className="mb-4">
           <p className="text-xs text-gray-500 mb-2 font-bold">请粘贴 CSV 文本或 JSON 数据：</p>
           <textarea 
             className="w-full h-64 border border-gray-200 rounded-2xl p-4 text-xs font-mono mb-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all bg-gray-50/50" 
             placeholder={getTemplate()} 
             value={text} 
             onChange={e => setText(e.target.value)}
           ></textarea>
           <p className="text-[11px] text-gray-500">支持中文逗号(，)与英文逗号(,)分隔。第一行如果是表头将被自动跳过。</p>
        </div>

        <div className="flex space-x-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500 hover:bg-gray-200 transition-colors">取消</button>
          <button onClick={processData} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all`}>确认导入</button>
        </div>
      </div>
    </div>
  );
};

const DepartmentNode = ({ dept, allDepts, theme, onEdit, onDelete, onAddSub, depth = 0 }: any) => {
  const children = allDepts.filter((d: any) => d.parentId === dept.id);
  const hasChildren = children.length > 0;
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="relative">
      <div className={`flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 hover:border-${theme}-200 shadow-sm hover:shadow-md transition-all group mb-3 relative z-10`}>
        {/* Connector line for non-root nodes */}
        {depth > 0 && (
          <div className="absolute -left-6 top-1/2 w-6 h-px bg-gray-200"></div>
        )}
        {/* Vertical connector line segment from parent */}
        {depth > 0 && (
           <div className="absolute -left-6 bottom-1/2 h-[calc(100%+12px)] w-px bg-gray-200 -z-10 origin-bottom"></div>
        )}

        <div className="flex items-center space-x-4 flex-1">
          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            disabled={!hasChildren}
            className={`w-6 h-6 flex items-center justify-center rounded-lg transition-colors ${hasChildren ? `hover:bg-${theme}-50 text-gray-500 hover:text-${theme}-600 cursor-pointer` : 'opacity-0 cursor-default'}`}
          >
             {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          <div className={`w-10 h-10 rounded-xl ${hasChildren ? `bg-${theme}-50 text-${theme}-600` : 'bg-gray-50 text-gray-500'} flex items-center justify-center transition-colors shrink-0`}>
             {hasChildren ? <FolderTree size={20}/> : <Building2 size={20}/>}
          </div>
          <div>
            <div className="flex items-center space-x-2">
                <span className="font-bold text-gray-800 text-sm">{dept.name}</span>
                {depth === 0 && <span className="px-1.5 py-0.5 rounded-md bg-gray-800 text-white text-[11px] font-bold">总部</span>}
            </div>
            <p className="text-[11px] text-gray-500 font-medium mt-0.5">ID: {dept.id}</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onAddSub(dept.id)} className={`p-2 text-${theme}-600 hover:bg-${theme}-50 rounded-lg transition-colors`} title="添加子部门"><Plus size={16} /></button>
          <button onClick={() => onEdit(dept)} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Edit2 size={16} /></button>
          <button onClick={() => onDelete(dept.id)} className="p-2 text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"><Trash2 size={16} /></button>
        </div>
      </div>
      
      {hasChildren && isExpanded && (
        <div className="pl-6 ml-6 relative space-y-3 pt-3 pb-1 border-l border-gray-200">
          {children.map((child: any) => (
            <DepartmentNode key={child.id} dept={child} allDepts={allDepts} theme={theme} onEdit={onEdit} onDelete={onDelete} onAddSub={onAddSub} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

// ... (DepartmentModal, ResourceCalendarModal, UserModal, ResourceModal, RoleModal, WorkflowModal, BookingFormModal, BookingConflictModal, DetailViewModal omitted as they are unchanged) ...

const DepartmentModal = ({ department, parentId, theme, onClose, onSave }: any) => {
  const [name, setName] = useState(department?.name || '');
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6 text-gray-800">{department ? '编辑部门' : '新增部门'}</h3>
        <input 
          value={name} 
          onChange={e => setName(e.target.value)} 
          placeholder="部门名称" 
          className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl mb-6 focus:ring-2 focus:ring-indigo-100 outline-none" 
        />
        <div className="flex space-x-3">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button onClick={() => { if(name) onSave({ name, parentId }); }} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold shadow-lg`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const ResourceCalendarModal = ({ resource, bookings, users, theme, onClose, onSelectDate }: any) => {
  const modalRef = useModalA11y(onClose);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [mode, setMode] = useState<'week' | 'month'>(resource.type === 'ROOM' ? 'week' : 'month');
  const activeBookings = bookings.filter((b: Booking) => b.resourceId === resource.id && ['PENDING', 'APPROVED'].includes(b.status));
  const bookingsForDay = (date: Date) => {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    return activeBookings.filter((b: Booking) => new Date(b.startTime) < dayEnd && new Date(b.endTime) > dayStart)
      .sort((a: Booking, b: Booking) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  };
  const weekStart = new Date(currentDate);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDay = (new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay() + 6) % 7;
  const navigate = (direction: number) => {
    const next = new Date(currentDate);
    if (mode === 'week') next.setDate(next.getDate() + direction * 7);
    else next.setMonth(next.getMonth() + direction);
    setCurrentDate(next);
  };

  return (
    <div ref={modalRef} className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`${resource.name}排期`}>
      <div className="bg-white rounded-[2.5rem] p-6 md:p-8 max-w-6xl w-full shadow-2xl animate-in zoom-in relative max-h-[92vh] overflow-y-auto">
        <button onClick={onClose} aria-label="关闭排期" className="absolute top-6 right-6 p-2 bg-gray-100 rounded-xl text-gray-500 hover:text-rose-500"><X size={20}/></button>
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 pr-10">
          <div><h3 className="text-xl font-black text-gray-800 flex items-center gap-2"><Calendar size={20}/> {resource.name} 排期</h3><p className="text-xs text-gray-500 mt-1">已核准与待审批均占用时段；点击空白日期可直接预约</p></div>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 p-1 rounded-xl">
              {(['week', 'month'] as const).map(m => <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${mode === m ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>{m === 'week' ? '周历' : '月历'}</button>)}
            </div>
            <button onClick={() => navigate(-1)} aria-label="上一周期" className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200"><ChevronLeft size={16}/></button>
            <span className="font-bold text-gray-600 min-w-28 text-center text-sm">{currentDate.getFullYear()}年{currentDate.getMonth() + 1}月</span>
            <button onClick={() => navigate(1)} aria-label="下一周期" className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200"><ChevronRight size={16}/></button>
          </div>
        </div>
        <div className="flex gap-4 mb-5 text-[11px] font-bold text-gray-500"><span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-emerald-400"/>已核准</span><span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-amber-400"/>待审批</span></div>

        {mode === 'week' ? (
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            {weekDays.map(date => {
              const dayBookings = bookingsForDay(date);
              const isToday = formatDate(date) === formatDate(new Date());
              return (
                <div key={formatDate(date)} className={`rounded-2xl border p-3 min-h-52 ${isToday ? `border-${theme}-300 bg-${theme}-50/30` : 'border-gray-100 bg-gray-50/50'}`}>
                  <button onClick={() => onSelectDate(`${formatDate(date)}T09:00`)} className="w-full text-left group" title="选择此日期预约">
                    <span className="text-[11px] font-bold text-gray-500">周{['日','一','二','三','四','五','六'][date.getDay()]}</span>
                    <span className={`block text-lg font-black group-hover:text-${theme}-600 ${isToday ? `text-${theme}-600` : 'text-gray-700'}`}>{date.getMonth() + 1}/{date.getDate()}</span>
                  </button>
                  <div className="space-y-2 mt-3">
                    {dayBookings.map((b: Booking) => <div key={b.id} title={b.purpose} className={`p-2 rounded-xl border text-[11px] font-bold ${b.status === 'APPROVED' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}><p>{toLocalTimeString(b.startTime)}-{toLocalTimeString(b.endTime)}</p><p className="truncate mt-1 opacity-80">{b.purpose}</p></div>)}
                    <button onClick={() => onSelectDate(`${formatDate(date)}T09:00`)} className={`w-full py-2 rounded-xl border border-dashed text-[11px] font-bold text-gray-500 hover:text-${theme}-600 hover:border-${theme}-300`}>{dayBookings.length ? '+ 预约其他时段' : '+ 空白日期，点击预约'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-2 mb-2 text-center">{['一', '二', '三', '四', '五', '六', '日'].map(d => <div key={d} className="text-xs font-bold text-gray-500">{d}</div>)}</div>
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: firstDay }, (_, i) => <div key={`blank-${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), i + 1);
                const dayBookings = bookingsForDay(date);
                const hasApproved = dayBookings.some((b: Booking) => b.status === 'APPROVED');
                const hasPending = dayBookings.some((b: Booking) => b.status === 'PENDING');
                return <button key={i + 1} onClick={() => onSelectDate(`${formatDate(date)}T09:00`)} className={`aspect-square rounded-xl flex flex-col items-center justify-center border-2 transition-all ${formatDate(date) === formatDate(new Date()) ? `border-${theme}-600` : 'border-transparent hover:border-indigo-100'} ${hasPending ? 'bg-amber-50 text-amber-700' : hasApproved ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-600'}`}><span className="text-sm font-bold">{i + 1}</span><span className="flex gap-1 mt-1">{hasApproved && <i className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>}{hasPending && <i className="w-1.5 h-1.5 rounded-full bg-amber-500"/>}</span></button>;
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const UserModal = ({ user, departments, roles, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    department: user?.department || departments[0]?.name || '',
    role: user?.role?.[0] || 'EMPLOYEE',
    mobile: user?.mobile || '',
    landline: user?.landline || ''
  });

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6">{user ? '编辑成员' : '录入新成员'}</h3>
        <div className="space-y-4">
          <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="姓名" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <input value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="电子邮箱" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <select value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100">
            {departments.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
          <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100">
            {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input value={formData.mobile} onChange={e => setFormData({...formData, mobile: e.target.value})} placeholder="移动电话" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <input value={formData.landline} onChange={e => setFormData({...formData, landline: e.target.value})} placeholder="办公电话" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
        </div>
        <div className="flex space-x-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button onClick={() => onSave({...formData, role: [formData.role]})} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const ResourceModal = ({ resource, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState({
    name: resource?.name || '',
    type: resource?.type || 'ROOM',
    capacity: resource?.capacity || 4,
    location: resource?.location || '',
  });

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6">{resource ? '编辑资源' : '新增资源'}</h3>
        <div className="space-y-4">
          <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="资源名称" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <div className="flex space-x-2">
            <button onClick={() => setFormData({...formData, type: 'ROOM'})} className={`flex-1 p-3 rounded-xl border ${formData.type === 'ROOM' ? `bg-${theme}-50 border-${theme}-200 text-${theme}-600` : 'bg-gray-50 border-gray-100 text-gray-500'}`}>会议室</button>
            <button onClick={() => setFormData({...formData, type: 'DESK'})} className={`flex-1 p-3 rounded-xl border ${formData.type === 'DESK' ? `bg-${theme}-50 border-${theme}-200 text-${theme}-600` : 'bg-gray-50 border-gray-100 text-gray-500'}`}>工位</button>
          </div>
          <input type="number" value={formData.capacity} onChange={e => setFormData({...formData, capacity: parseInt(e.target.value)})} placeholder="容量" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <input value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} placeholder="位置" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
        </div>
        <div className="flex space-x-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button onClick={() => onSave(formData)} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const RoleModal = ({ role, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState({
    name: role?.name || '',
    description: role?.description || '',
    color: role?.color || 'indigo'
  });

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6">{role ? '编辑角色集' : '新增角色集'}</h3>
        <div className="space-y-4">
          <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="角色名称" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="职能描述" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 h-24" />
          <div className="flex space-x-2">
            {['indigo', 'emerald', 'amber', 'rose', 'purple'].map(c => (
              <button key={c} onClick={() => setFormData({...formData, color: c})} className={`w-8 h-8 rounded-full bg-${c}-500 ${formData.color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`} />
            ))}
          </div>
        </div>
        <div className="flex space-x-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button onClick={() => onSave(formData)} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const WorkflowModal = ({ node, roles, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState({
    name: node?.name || '',
    approverRole: node?.approverRole || roles[0]?.id || ''
  });

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6">{node ? '编辑节点' : '新增审批节点'}</h3>
        <div className="space-y-4">
          <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="节点名称（如：行政初审）" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <div>
            <label className="text-xs text-gray-500 font-bold ml-1 mb-1 block">审批负责人角色</label>
            <select value={formData.approverRole} onChange={e => setFormData({...formData, approverRole: e.target.value})} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100">
              {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex space-x-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button onClick={() => onSave(formData)} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const ResourceFinder = ({ resources, bookings, theme, onBook }: any) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [date, setDate] = useState(formatDate(tomorrow));
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('11:00');
  const [participants, setParticipants] = useState(2);
  const [requirements, setRequirements] = useState({ video: false, display: false, whiteboard: false });

  const startDate = new Date(`${date}T${start}`);
  const endDate = new Date(`${date}T${end}`);
  const validTime = endDate > startDate;
  const matches = resources.filter((r: Resource) => {
    if (r.type !== 'ROOM' || r.status !== 'AVAILABLE' || (r.capacity || 0) < participants) return false;
    if (requirements.video && !r.features.some(f => /视频|远程|会议系统/.test(f))) return false;
    if (requirements.display && !r.features.some(f => /投屏|显示器|屏幕/.test(f))) return false;
    if (requirements.whiteboard && !r.features.some(f => /白板/.test(f))) return false;
    if (!validTime) return false;
    return !bookings.some((b: Booking) => b.resourceId === r.id
      && ['PENDING', 'APPROVED'].includes(b.status)
      && startDate < new Date(b.endTime) && endDate > new Date(b.startTime));
  });

  const toggle = (key: keyof typeof requirements) => setRequirements(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5" aria-label="按条件找会议室">
      <div className="flex items-center justify-between">
        <div><h4 className="font-black text-gray-800">按条件找会议室</h4><p className="text-xs text-gray-500 mt-1">实时排除容量不足、设备不符和时段冲突的会议室</p></div>
        <Search size={20} className={`text-${theme}-600`}/>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="text-xs font-bold text-gray-500">日期<input aria-label="查找日期" type="date" min={formatDate(new Date())} value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-indigo-100"/></label>
        <label className="text-xs font-bold text-gray-500">开始<input aria-label="查找开始时间" type="time" step="1800" min="08:00" max="19:30" value={start} onChange={e => setStart(e.target.value)} className="mt-1 w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-indigo-100"/></label>
        <label className="text-xs font-bold text-gray-500">结束<input aria-label="查找结束时间" type="time" step="1800" min="08:30" max="20:00" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-indigo-100"/></label>
        <label className="text-xs font-bold text-gray-500">人数<input aria-label="查找人数" type="number" min="1" value={participants} onChange={e => setParticipants(Math.max(1, parseInt(e.target.value) || 1))} className="mt-1 w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-indigo-100"/></label>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="设备条件">
        {([['video', '视频会议'], ['display', '投屏显示器'], ['whiteboard', '白板']] as const).map(([key, label]) => (
          <button key={key} aria-pressed={requirements[key]} onClick={() => toggle(key)} className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${requirements[key] ? `bg-${theme}-600 text-white border-${theme}-600` : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>{label}</button>
        ))}
      </div>
      {!validTime ? <p className="text-xs font-bold text-rose-500">结束时间必须晚于开始时间</p> : (
        <div className="space-y-2">
          <p className="text-xs font-black text-gray-500">找到 {matches.length} 间可用会议室</p>
          {matches.map((r: Resource) => (
            <div key={r.id} className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100">
              <div className="min-w-0"><p className="font-bold text-sm text-gray-800 truncate">{r.name}</p><p className="text-[11px] text-gray-500 mt-1 truncate">{r.location} · {r.capacity} 人 · {r.features.join('、') || '无特殊设备'}</p></div>
              <button onClick={() => onBook(r, { start: startDate.toISOString(), end: endDate.toISOString(), participants, extras: { isVideoConference: requirements.video } })} className={`shrink-0 px-4 py-2 rounded-xl bg-${theme}-600 text-white text-xs font-black`}>按此条件预约</button>
            </div>
          ))}
          {matches.length === 0 && <p className="p-6 text-center text-xs font-bold text-gray-500 border border-dashed rounded-2xl">暂无满足条件的会议室，请调整时间、人数或设备要求</p>}
        </div>
      )}
    </section>
  );
};

const BookingFormModal = ({ resource, theme, initialDate, initialValues, onClose, onConfirm, onResourceChange, availableResources, availableUsers = [], currentUserId, bookings = [] }: any) => {
  const modalRef = useModalA11y(onClose);
  const isRoom = resource.type === 'ROOM';
  const initialDateObj = initialValues?.start ? new Date(initialValues.start) : initialDate ? new Date(initialDate) : new Date();
  
  const [selectedDate, setSelectedDate] = useState(initialDateObj);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{start: string | null, end: string | null}>({ 
    start: initialValues?.start ? formatTime(new Date(initialValues.start)) : isRoom ? null : '09:00', 
    end: initialValues?.end ? formatTime(new Date(initialValues.end)) : isRoom ? null : '18:00' 
  });
  const [deskEndDate, setDeskEndDate] = useState(initialDateObj);
  
  const [purpose, setPurpose] = useState(initialValues?.purpose || '');
  const [participants, setParticipants] = useState(initialValues?.participants || resource.capacity || 1);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<SmartRecommendation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // New state variables for additional requirements
  const [hasLeader, setHasLeader] = useState(initialValues?.extras?.hasLeader || false);
  const [leaderDetails, setLeaderDetails] = useState(initialValues?.extras?.leaderDetails || '');
  const [isVideoConference, setIsVideoConference] = useState(initialValues?.extras?.isVideoConference || false);
  const [needsTeaService, setNeedsTeaService] = useState(initialValues?.extras?.needsTeaService || false);
  const [attendeeIds, setAttendeeIds] = useState<string[]>(initialValues?.extras?.attendeeIds || []);
  const [repeatFrequency, setRepeatFrequency] = useState<'NONE' | 'WEEKLY' | 'BIWEEKLY'>('NONE');
  const [repeatCount, setRepeatCount] = useState(4);

  const initialDateKey = formatDate(initialDateObj);
  const dateOptions = useMemo(() => {
    const dates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + i);
      return d;
    });
    if (!dates.some(d => formatDate(d) === initialDateKey)) dates.push(new Date(`${initialDateKey}T12:00`));
    return dates.sort((a, b) => a.getTime() - b.getTime());
  }, [initialDateKey]);

  const timeSlots = useMemo(() => {
    const slots = [];
    for(let h=8; h<20; h++) {
        slots.push(`${String(h).padStart(2,'0')}:00`);
        slots.push(`${String(h).padStart(2,'0')}:30`);
    }
    slots.push('20:00'); // 仅作为结束时间
    return slots;
  }, []);

  const isSlotBooked = (time: string) => {
    const slotStart = new Date(`${formatDate(selectedDate)}T${time}`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
    
    return bookings.some((b: any) => {
        if (b.resourceId !== resource.id || !isActiveBooking(b)) return false;
        const bStart = new Date(b.startTime);
        const bEnd = new Date(b.endTime);
        return (slotStart < bEnd && slotEnd > bStart);
    });
  };

  const isSlotPast = (time: string) => {
    return new Date(`${formatDate(selectedDate)}T${time}`).getTime() <= Date.now();
  };

  const timeToMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
  const minutesToTime = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
  const selectRange = (start: string, end: string) => {
    setFormError(null);
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      setFormError('结束时间必须晚于开始时间');
      setSelectedTimeRange({ start, end: null });
      return;
    }
    const startIndex = timeSlots.indexOf(start);
    const endIndex = timeSlots.indexOf(end);
    for (let i = startIndex; i < endIndex; i++) {
      if (isSlotBooked(timeSlots[i])) {
        setFormError('选择的时间段内包含已被占用的时段，请重新选择');
        setSelectedTimeRange({ start, end: null });
        return;
      }
      if (isSlotPast(timeSlots[i])) {
        setFormError('不能选择已过时间，请调整开始时间');
        setSelectedTimeRange({ start, end: null });
        return;
      }
    }
    setSelectedTimeRange({ start, end });
  };

  const handleTimeClick = (time: string) => {
    if (isSlotBooked(time) || isSlotPast(time)) return;
    if (time === '20:00' && (!selectedTimeRange.start || selectedTimeRange.end)) return;
    setFormError(null);
    
    const { start, end } = selectedTimeRange;
    
    if (!start || (start && end)) {
        setSelectedTimeRange({ start: time, end: null });
    } else {
        if (time === start) {
            setSelectedTimeRange({ start: null, end: null });
            return;
        }
        const timeVal = parseInt(time.replace(':',''));
        const startVal = parseInt(start.replace(':',''));
        
        if (timeVal < startVal) {
            setSelectedTimeRange({ start: time, end: null });
        } else {
            // Validate continuous range
            let valid = true;
            const startIndex = timeSlots.indexOf(start);
            const endIndex = timeSlots.indexOf(time);
            for(let i = startIndex; i <= endIndex; i++) {
                if (isSlotBooked(timeSlots[i])) {
                    valid = false;
                    break;
                }
            }
            if (!valid) {
                setFormError("选择的时间段内包含已被占用的时段，请重新选择。");
                setSelectedTimeRange({ start: time, end: null });
            } else {
                setSelectedTimeRange({ start, end: time });
            }
        }
    }
  };

  const handleSmartRecommend = async () => {
    if (!purpose.trim()) {
      setFormError('请先填写会议主题或申请用途');
      return;
    }
    if (isRoom && (!selectedTimeRange.start || !selectedTimeRange.end)) {
      setFormError('请先选择完整的预约时段，AI 才能排除冲突会议室');
      return;
    }
    const start = isRoom
      ? new Date(`${formatDate(selectedDate)}T${selectedTimeRange.start}:00`)
      : new Date(`${formatDate(selectedDate)}T09:00:00`);
    const end = isRoom
      ? new Date(`${formatDate(selectedDate)}T${selectedTimeRange.end}:00`)
      : new Date(`${formatDate(deskEndDate)}T18:00:00`);
    setFormError(null);
    setLoadingAI(true);
    try {
      const suggestion = await getSmartRecommendation({
        purpose,
        participants,
        resources: availableResources,
        bookings,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        requirements: {
          video: isVideoConference || /视频|远程|连线|线上/.test(purpose),
          display: /投屏|显示器|屏幕|投影|演示|汇报/.test(purpose),
          whiteboard: /白板|头脑风暴|脑暴|研讨/.test(purpose)
        },
        resourceType: resource.type,
        excludeBookingId: initialValues?.id
      });
      setAiSuggestion(suggestion);
    } finally {
      setLoadingAI(false);
    }
  };

  const handleSubmit = () => {
    setFormError(null);

    if (!purpose.trim()) {
        setFormError('请填写会议主题或申请用途');
        return;
    }
    if (!Number.isFinite(participants) || participants < 1) {
        setFormError('请填写有效的参与人数');
        return;
    }
    if (isRoom && resource.capacity && participants > resource.capacity) {
        setFormError(`「${resource.name}」最多容纳 ${resource.capacity} 人，请减少人数或更换更大的会议室`);
        return;
    }

    let finalStart, finalEnd;

    if (isRoom) {
        if (!selectedTimeRange.start || !selectedTimeRange.end) {
            setFormError("请选择开始和结束时间");
            return;
        }
        finalStart = `${formatDate(selectedDate)}T${selectedTimeRange.start}:00`;
        finalEnd = `${formatDate(selectedDate)}T${selectedTimeRange.end}:00`;
    } else {
        finalStart = `${formatDate(selectedDate)}T09:00:00`;
        finalEnd = `${formatDate(deskEndDate)}T18:00:00`;
        if (new Date(deskEndDate) < new Date(selectedDate)) {
             setFormError("结束日期不能早于开始日期");
             return;
        }
    }

    onConfirm(resource.id, purpose, finalStart, finalEnd, participants, {
        hasLeader,
        leaderDetails: hasLeader ? leaderDetails : undefined,
        isVideoConference,
        needsTeaService,
        attendeeIds,
        recurrence: repeatFrequency === 'NONE' ? undefined : { frequency: repeatFrequency, count: repeatCount }
    });
  };

  const isSlotSelected = (time: string) => {
      if (!selectedTimeRange.start) return false;
      if (selectedTimeRange.start === time) return true;
      if (selectedTimeRange.end === time) return true; 
      return selectedTimeRange.start === time || selectedTimeRange.end === time;
  };

  const isSlotInRange = (time: string) => {
      if (!selectedTimeRange.start || !selectedTimeRange.end) return false;
      const t = parseInt(time.replace(':',''));
      const s = parseInt(selectedTimeRange.start.replace(':',''));
      const e = parseInt(selectedTimeRange.end.replace(':',''));
      return t > s && t < e;
  };

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label={`${initialValues?.id ? '修改预约' : '预约'}${resource.name}`} className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl animate-in zoom-in max-h-[90vh] overflow-y-auto custom-scrollbar">
        <h3 className="font-black text-xl mb-6 flex items-center gap-2">
            {isRoom ? <Monitor size={24} className={`text-${theme}-600`}/> : <Coffee size={24} className={`text-${theme}-600`}/>}
            <span>{initialValues?.id ? '修改预约' : '预约'} {resource.name}</span>
        </h3>
        
        <div className="space-y-6">
          {/* Purpose & AI */}
          <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">申请用途</label>
            <div className="flex space-x-2">
              <input 
                value={purpose} 
                onChange={e => setPurpose(e.target.value)} 
                placeholder="会议主题或办公内容..." 
                className="flex-1 bg-gray-50 p-4 rounded-2xl border-none outline-none font-bold shadow-inner focus:ring-2 ring-indigo-100 transition-all text-sm" 
              />
              <button 
                onClick={handleSmartRecommend} 
                disabled={loadingAI || !purpose}
                className={`p-4 bg-${theme}-50 text-${theme}-600 rounded-2xl font-bold flex items-center space-x-1 hover:bg-${theme}-100 transition-colors disabled:opacity-50`}
              >
                {loadingAI ? <RefreshCw size={18} className="animate-spin" /> : <Zap size={18}/>}
                <span>AI</span>
              </button>
            </div>
          </div>
          
          {aiSuggestion && (
            <div className={`p-4 rounded-2xl bg-${theme}-50 text-${theme}-700 text-[11px] leading-relaxed border border-${theme}-100 animate-in slide-in-from-top-2 space-y-3`}>
              <p>
                <strong>{aiSuggestion.source === 'AI' ? 'AI 建议' : '本地推荐（AI 不可用）'}：</strong>
                {aiSuggestion.resourceId && `建议「${availableResources.find((r: Resource) => r.id === aiSuggestion.resourceId)?.name || aiSuggestion.resourceId}」，`}
                {aiSuggestion.reason}
              </p>
              {aiSuggestion.resourceId && (
                <button
                  onClick={() => {
                    const recommended = availableResources.find((r: Resource) => r.id === aiSuggestion.resourceId);
                    if (recommended) {
                      onResourceChange(recommended);
                      setFormError(null);
                    }
                  }}
                  disabled={resource.id === aiSuggestion.resourceId}
                  className={`px-3 py-2 rounded-xl bg-${theme}-600 text-white font-black disabled:opacity-50`}
                >
                  {resource.id === aiSuggestion.resourceId ? '已选中推荐资源' : '采纳推荐并保留当前条件'}
                </button>
              )}
            </div>
          )}

          {/* Date Picker - Horizontal Scroll */}
          <div className="space-y-2">
             <div className="flex items-center justify-between">
               <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">选择日期</label>
               <input aria-label="自定义预约日期" type="date" min={formatDate(new Date())} value={formatDate(selectedDate)} onChange={e => { if (!e.target.value) return; setSelectedDate(new Date(`${e.target.value}T12:00`)); setSelectedTimeRange({ start: null, end: null }); }} className="text-xs font-bold text-gray-500 bg-gray-50 rounded-lg px-2 py-1 outline-none"/>
             </div>
             <div className="flex space-x-3 overflow-x-auto pb-2 custom-scrollbar">
                {dateOptions.map((d) => {
                    const isSelected = formatDate(d) === formatDate(selectedDate);
                    const isToday = formatDate(d) === formatDate(new Date());
                    const dayName = ['日','一','二','三','四','五','六'][d.getDay()];
                    return (
                        <button 
                            key={formatDate(d)}
                            onClick={() => { setSelectedDate(d); setSelectedTimeRange({start:null,end:null}); }}
                            aria-pressed={isSelected}
                            className={`flex flex-col items-center justify-center w-14 h-20 rounded-2xl border-2 transition-all shrink-0 ${isSelected ? `bg-${theme}-600 border-${theme}-600 text-white shadow-lg scale-105` : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200 hover:bg-gray-50'}`}
                        >
                            <span className={`text-[10px] font-bold ${isToday && !isSelected ? `text-${theme}-600` : 'opacity-80'}`}>{isToday ? '今天' : `周${dayName}`}</span>
                            <span className="text-lg font-black leading-none mt-1">{d.getDate()}</span>
                            <span className="text-[10px] font-medium opacity-70 mt-1">{d.getMonth() + 1}月</span>
                        </button>
                    );
                })}
             </div>
          </div>

          {isRoom ? (
            <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex justify-between">
                    <span>选择时段 (08:00 - 20:00)</span>
                    {selectedTimeRange.start && selectedTimeRange.end && <span className={`text-${theme}-600`}>{selectedTimeRange.start} - {selectedTimeRange.end}</span>}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select aria-label="预约开始时间" value={selectedTimeRange.start || ''} onChange={e => { setFormError(null); setSelectedTimeRange({ start: e.target.value, end: null }); }} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none">
                    <option value="" disabled>开始时间</option>
                    {timeSlots.filter(t => t !== '20:00').map(t => <option key={t} value={t} disabled={isSlotBooked(t) || isSlotPast(t)}>{t}{isSlotBooked(t) ? '（已占用）' : ''}</option>)}
                  </select>
                  <select aria-label="预约结束时间" value={selectedTimeRange.end || ''} disabled={!selectedTimeRange.start} onChange={e => selectRange(selectedTimeRange.start!, e.target.value)} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none disabled:opacity-50">
                    <option value="" disabled>结束时间</option>
                    {timeSlots.map(t => <option key={t} value={t} disabled={!selectedTimeRange.start || timeToMinutes(t) <= timeToMinutes(selectedTimeRange.start)}>{t}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-gray-500 shrink-0">快捷时长</span>
                  {[30, 60, 90, 120].map(minutes => <button key={minutes} disabled={!selectedTimeRange.start || timeToMinutes(selectedTimeRange.start) + minutes > 1200} onClick={() => selectRange(selectedTimeRange.start!, minutesToTime(timeToMinutes(selectedTimeRange.start!) + minutes))} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border disabled:opacity-30 ${selectedTimeRange.start && selectedTimeRange.end && timeToMinutes(selectedTimeRange.end) - timeToMinutes(selectedTimeRange.start) === minutes ? `border-${theme}-300 bg-${theme}-50 text-${theme}-600` : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}>{minutes < 60 ? `${minutes}分钟` : `${minutes / 60}小时`}</button>)}
                </div>
                <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                    {timeSlots.map(time => {
                        const booked = isSlotBooked(time);
                        const past = isSlotPast(time);
                        const endOnlyBlocked = time === '20:00' && (!selectedTimeRange.start || !!selectedTimeRange.end);
                        const disabled = booked || past || endOnlyBlocked;
                        const selected = isSlotSelected(time);
                        const inRange = isSlotInRange(time);
                        return (
                            <button
                                key={time}
                                onClick={() => handleTimeClick(time)}
                                disabled={disabled}
                                title={booked ? '该时段已被预订' : past ? '已过时间不可预订' : endOnlyBlocked ? '20:00 仅可作为结束时间' : undefined}
                                className={`py-2.5 rounded-xl text-xs font-bold transition-all border ${
                                    booked ? 'bg-gray-100 text-gray-500 border-transparent cursor-not-allowed line-through' :
                                    disabled ? 'bg-gray-50 text-gray-500 border-transparent cursor-not-allowed' :
                                    selected ? `bg-${theme}-600 text-white border-${theme}-600 shadow-md transform scale-105` :
                                    inRange ? `bg-${theme}-50 text-${theme}-600 border-${theme}-200` :
                                    'bg-white text-gray-600 border-gray-100 hover:border-gray-300'
                                }`}
                            >
                                {time}
                            </button>
                        );
                    })}
                </div>
                <p className="text-[11px] text-gray-500 text-center pt-2">点击开始时间，再次点击结束时间</p>
            </div>
          ) : (
            <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">结束日期 (工位通常按天预订)</label>
                <input type="date" value={formatDate(deskEndDate)} onChange={e => setDeskEndDate(new Date(e.target.value))} className="w-full bg-gray-50 p-4 rounded-2xl border-none outline-none font-bold shadow-inner text-sm" />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex justify-between">
              <span>人数</span>
              {resource.capacity ? <span className="text-gray-500 normal-case">该空间最多 {resource.capacity} 人</span> : null}
            </label>
            <input type="number" min="1" max={resource.capacity || undefined} value={Number.isNaN(participants) ? '' : participants} onChange={e => setParticipants(parseInt(e.target.value))} className="w-full bg-gray-50 p-4 rounded-2xl border-none outline-none font-bold shadow-inner text-sm" />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">参会人（可选）</label>
            <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded-2xl">
              {availableUsers.filter((u: User) => u.id !== currentUserId).map((u: User) => <label key={u.id} className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer"><input type="checkbox" checked={attendeeIds.includes(u.id)} onChange={() => setAttendeeIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])} className="accent-indigo-600"/><span>{u.name}<small className="block text-gray-500 font-medium">{u.department}</small></span></label>)}
            </div>
          </div>

          {isRoom && !initialValues?.id && <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">周期会议</label>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="重复频率" value={repeatFrequency} onChange={e => setRepeatFrequency(e.target.value as any)} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none"><option value="NONE">不重复</option><option value="WEEKLY">每周重复</option><option value="BIWEEKLY">隔周重复</option></select>
              <select aria-label="重复次数" value={repeatCount} disabled={repeatFrequency === 'NONE'} onChange={e => setRepeatCount(Number(e.target.value))} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none disabled:opacity-50">{[2, 3, 4, 6, 8, 12].map(n => <option key={n} value={n}>共 {n} 次</option>)}</select>
            </div>
            {repeatFrequency !== 'NONE' && <p className="text-[11px] text-gray-500">提交后逐次检测冲突，冲突单次可跳过或改期</p>}
          </div>}

          {/* New Fields Section */}
          <div className="space-y-4 pt-4 border-t border-gray-100">
             <div className="flex items-center justify-between">
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex items-center space-x-1">
                    <Crown size={12}/> <span>领导参会</span>
                </label>
                <button 
                    onClick={() => setHasLeader(!hasLeader)} 
                    className={`w-10 h-6 rounded-full p-1 transition-all ${hasLeader ? `bg-${theme}-600` : 'bg-gray-200'}`}
                >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${hasLeader ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </button>
             </div>
             {hasLeader && (
                 <input 
                    value={leaderDetails} 
                    onChange={e => setLeaderDetails(e.target.value)} 
                    placeholder="请输入参会领导姓名或职位..." 
                    className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 text-sm focus:border-indigo-200 outline-none animate-in fade-in slide-in-from-top-2" 
                 />
             )}

             <div className="flex items-center justify-between">
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex items-center space-x-1">
                    <Video size={12}/> <span>视频会议</span>
                </label>
                <button 
                    onClick={() => setIsVideoConference(!isVideoConference)} 
                    className={`w-10 h-6 rounded-full p-1 transition-all ${isVideoConference ? `bg-${theme}-600` : 'bg-gray-200'}`}
                >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${isVideoConference ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </button>
             </div>

             <div className="flex items-center justify-between">
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex items-center space-x-1">
                    <CupSoda size={12}/> <span>茶水服务</span>
                </label>
                <button 
                    onClick={() => setNeedsTeaService(!needsTeaService)} 
                    className={`w-10 h-6 rounded-full p-1 transition-all ${needsTeaService ? `bg-${theme}-600` : 'bg-gray-200'}`}
                >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${needsTeaService ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </button>
             </div>
          </div>

          {formError && (
            <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">{formError}</p>
          )}

          <div className="flex space-x-3 mt-6 pt-4 border-t border-gray-100">
            <button onClick={onClose} className="flex-1 py-3 rounded-2xl bg-gray-50 font-bold text-gray-500 hover:bg-gray-100 transition-colors">取消</button>
            <button 
              onClick={handleSubmit} 
              className={`flex-1 py-4 bg-${theme}-600 text-white rounded-2xl font-black shadow-lg shadow-${theme}-100 hover:scale-[1.02] active:scale-95 transition-all`}
            >
              {initialValues?.id ? '保存修改' : '确认预约'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const BookingConflictModal = ({ conflict, users, theme, onClose, onApplySuggestion }: any) => {
  const modalRef = useModalA11y(onClose);
  const { resource, resourceBookings, errorType, suggestion } = conflict;

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="预约冲突提示" className="fixed inset-0 z-[1050] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] p-8 max-w-md w-full shadow-2xl animate-in zoom-in">
        <div className="text-center mb-6">
           <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mx-auto mb-4">
              <AlertTriangle size={32}/>
           </div>
           <h3 className="font-black text-xl text-gray-800">预约冲突提示</h3>
           <p className="text-xs font-bold text-gray-500 mt-2">
             {errorType === 'PAST_TIME' ? "您选择的时间已是过去式" : "该时段已被其他同事预订"}
           </p>
        </div>

        {errorType === 'CONFLICT' && (
          <div className="bg-gray-50 rounded-2xl p-4 mb-6 max-h-32 overflow-y-auto custom-scrollbar">
             {resourceBookings.map((b: any) => {
                const user = users.find((u: any) => u.id === b.userId);
                return (
                   <div key={b.id} className="flex items-center space-x-3 mb-2 last:mb-0 pb-2 border-b border-gray-100 last:border-0 last:pb-0">
                      <div className={`w-6 h-6 rounded-full bg-white flex items-center justify-center text-[11px] font-bold shadow-sm shrink-0`}>{user?.name[0]}</div>
                      <div>
                         <p className="text-xs font-bold text-gray-700">{user?.name} · {b.purpose}</p>
                         <p className="text-[11px] text-gray-500">{toLocalDateTimeString(b.startTime)} - {toLocalTimeString(b.endTime)}</p>
                      </div>
                   </div>
                );
             })}
          </div>
        )}

        <div className="space-y-3">
           <button 
             onClick={() => onApplySuggestion(suggestion.start, suggestion.end)} 
             className={`w-full py-4 bg-${theme}-600 text-white rounded-xl font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center justify-center space-x-2`}
           >
             <Lightbulb size={18} className="animate-pulse"/>
             <span className="text-sm">采纳建议：{toLocalDateTimeString(suggestion.start.toISOString())} - {formatTime(suggestion.end)}</span>
           </button>
           <button onClick={onClose} className="w-full py-3 bg-gray-100 text-gray-500 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">取消</button>
        </div>
      </div>
    </div>
  );
};

const RecurringConflictModal = ({ plan, theme, onSkip, onReschedule, onCreate, onClose }: any) => {
  const modalRef = useModalA11y(onClose);
  const remaining = plan.occurrences.filter((o: any) => !o.skip);
  const unresolved = remaining.filter((o: any) => o.conflicts?.length);
  return <div ref={modalRef} role="dialog" aria-modal="true" aria-label="周期会议冲突处理" className="fixed inset-0 z-[1100] bg-black/60 flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <h3 className="text-xl font-black text-gray-800">周期会议冲突处理</h3>
      <p className="text-xs text-gray-500 mt-2">共 {plan.occurrences.length} 次，{unresolved.length} 次待处理。可逐次跳过或自动改期。</p>
      <div className="space-y-3 my-6">
        {plan.occurrences.map((o: any, index: number) => <div key={`${o.start}-${index}`} className={`p-4 rounded-2xl border ${o.skip ? 'bg-gray-50 border-gray-100 opacity-50' : o.conflicts?.length ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div><p className="text-sm font-black text-gray-700">第 {index + 1} 次 · {toLocalDateTimeString(o.start)} - {toLocalTimeString(o.end)}</p><p className="text-[11px] text-gray-500 mt-1">{o.skip ? '已跳过' : o.conflicts?.length ? `与 ${o.conflicts.length} 项预约冲突` : '时段可用'}</p></div>
            {!o.skip && o.conflicts?.length > 0 && <div className="flex gap-2"><button onClick={() => onSkip(index)} className="px-3 py-2 rounded-xl bg-white text-gray-600 text-xs font-bold border">跳过此次</button><button onClick={() => onReschedule(index)} className={`px-3 py-2 rounded-xl bg-${theme}-600 text-white text-xs font-bold`}>自动改期</button></div>}
          </div>
        </div>)}
      </div>
      <div className="flex gap-3"><button onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-500 font-bold">取消</button><button disabled={!remaining.length || unresolved.length > 0} onClick={() => onCreate(remaining)} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold disabled:opacity-40`}>创建 {remaining.length} 次预约</button></div>
    </div>
  </div>;
};

const DetailViewModal = ({ viewDetail, onClose, users, bookings, theme, roles }: any) => {
  const { type, data } = viewDetail;
  const relatedBookings = bookings.filter((b: any) => 
    type === 'USER' ? b.userId === data.id : b.resourceId === data.id
  ).sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full relative animate-in zoom-in max-h-[80vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:text-gray-600"><X size={20}/></button>
        
        <div className="text-center mb-6">
           <div className={`w-20 h-20 mx-auto rounded-full bg-${theme}-50 flex items-center justify-center text-${theme}-600 mb-4`}>
             {type === 'USER' ? <UserCircle size={40}/> : <MapPin size={40}/>}
           </div>
           <h3 className="font-black text-xl text-gray-800">{data.name}</h3>
           <p className="text-gray-500 text-sm font-bold">{type === 'USER' ? data.email : data.location}</p>
        </div>

        <div className="space-y-6">
           {type === 'USER' && (
             <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
               <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">详细信息</h4>
               <div className="space-y-2 text-sm font-medium text-gray-600">
                 <div className="flex justify-between"><span>部门</span><span className="text-gray-900 font-bold">{data.department}</span></div>
                 <div className="flex justify-between"><span>角色</span><span className="text-gray-900 font-bold">{data.role.map((rId: string) => roles.find((r: any) => r.id === rId)?.name || rId).join(', ')}</span></div>
                 <div className="flex justify-between"><span>办公电话</span><span className="text-gray-900 font-bold">{data.landline || '-'}</span></div>
                 <div className="flex justify-between"><span>移动电话</span><span className="text-gray-900 font-bold">{data.mobile || '-'}</span></div>
               </div>
             </div>
           )}

           {type === 'RESOURCE' && (
             <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
               <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">资源详情</h4>
               <div className="space-y-2 text-sm font-medium text-gray-600">
                 <div className="flex justify-between"><span>类型</span><span className="text-gray-900 font-bold">{data.type === 'ROOM' ? '会议室' : '工位'}</span></div>
                 <div className="flex justify-between"><span>容量</span><span className="text-gray-900 font-bold">{data.capacity} 人</span></div>
                 <div className="flex justify-between"><span>状态</span><StatusBadge status={data.status} theme={theme} /></div>
               </div>
             </div>
           )}

           <div>
              <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">最近相关活动</h4>
              <div className="space-y-2">
                 {relatedBookings.slice(0, 3).map((b: any) => (
                   <div key={b.id} className="p-3 border border-gray-100 rounded-xl text-xs flex justify-between items-center">
                      <div>
                        <p className="font-bold text-gray-700">{b.purpose}</p>
                        <p className="text-gray-500 mt-0.5">{toLocalDateTimeString(b.startTime)}</p>
                      </div>
                      <StatusBadge status={b.status} theme={theme} />
                   </div>
                 ))}
                 {relatedBookings.length === 0 && <p className="text-center text-gray-500 text-xs py-4 font-bold">暂无记录</p>}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS' | 'ROLES' | 'DEPARTMENTS' | 'APPROVAL_CENTER' | 'WORK_ORDERS' | 'REPORTS' | 'WORKFLOW_CONFIG' | 'DATA_CENTER'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'indigo');
  
  // --- Persistent State Logic ---
  const [isOnline, setIsOnline] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  // Load initial state from local storage first for speed, then try server
  const [roles, setRoles] = useState<RoleDefinition[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).roles : INITIAL_ROLES; });
  const [users, setUsers] = useState<User[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).users : INITIAL_USERS; });
  const [resources, setResources] = useState<Resource[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).resources : INITIAL_RESOURCES; });
  const [bookings, setBookings] = useState<Booking[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? migrateBookings(JSON.parse(saved).bookings) : INITIAL_BOOKINGS; });
  const [departments, setDepartments] = useState<Department[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? (JSON.parse(saved).departments || INITIAL_DEPARTMENTS) : INITIAL_DEPARTMENTS; });
  const [workflow, setWorkflow] = useState<ApprovalNode[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? (JSON.parse(saved).workflow || DEFAULT_WORKFLOW) : DEFAULT_WORKFLOW; });
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? (JSON.parse(saved).workOrders || []) : []; });

  // Sync: Load from server on mount
  useEffect(() => {
    fetch('/api/db')
      .then(res => res.json())
      .then(data => {
        setIsOnline(true);
        // 服务端空库（首次启用后端）时保留本地数据，由防抖保存逻辑上行初始化，避免本地数据被空库覆盖。
        const hasServerData = data && typeof data === 'object' && (data.users || data.bookings || data.resources || data.departments);
        if (hasServerData) {
          if(data.users) setUsers(data.users);
          if(data.resources) setResources(data.resources);
          if(data.bookings) setBookings(migrateBookings(data.bookings));
          if(data.departments) setDepartments(data.departments);
          if(data.roles) setRoles(data.roles);
          if(data.workflow) setWorkflow(data.workflow);
          if(data.workOrders) setWorkOrders(data.workOrders);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
      })
      .catch((err) => {
        console.warn("Could not load from server, using local cache.", err);
        setIsOnline(false);
      });
  }, []);

  // Sync: Save to server on change (Debounced)
  useEffect(() => {
    const data = { roles, users, resources, bookings, departments, workflow, workOrders };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    const saveToServer = async () => {
      setSaveStatus('saving');
      try {
        const res = await fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        setSaveStatus('saved');
        setIsOnline(true);
      } catch (err) {
        console.error("Save failed", err);
        setSaveStatus('error');
        setIsOnline(false);
      }
    };

    const timer = setTimeout(saveToServer, 2000); // 2s debounce to prevent flooding
    return () => clearTimeout(timer);
  }, [roles, users, resources, bookings, departments, workflow, workOrders]);

  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);

  const NOTIF_KEY = 'SMART_OFFICE_NOTIFICATIONS';
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    try { return JSON.parse(localStorage.getItem('SMART_OFFICE_NOTIFICATIONS') || '[]'); } catch { return []; }
  });
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  useEffect(() => { localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications.slice(0, 50))); }, [notifications]);
  const [searchQuery, setSearchQuery] = useState('');
  const [reportRange, setReportRange] = useState<'7' | '30' | '90' | 'ALL'>('30');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [editingWorkflowNode, setEditingWorkflowNode] = useState<ApprovalNode | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [viewDetail, setViewDetail] = useState<{ type: 'USER' | 'RESOURCE', data: any } | null>(null);
  const [bookingConflict, setBookingConflict] = useState<{ 
    resource: Resource, 
    requestedStart: string, 
    requestedEnd: string, 
    purpose: string,
    participants?: number,
    extras?: any,
    resourceBookings: Booking[],
    errorType: 'PAST_TIME' | 'CONFLICT',
    suggestion: { start: Date, end: Date }
  } | null>(null);
  const [recurringPlan, setRecurringPlan] = useState<any>(null);
  const [showResourceCalendar, setShowResourceCalendar] = useState<Resource | null>(null);
  const [showResourceFinder, setShowResourceFinder] = useState(false);
  const [bookingPrefill, setBookingPrefill] = useState<any>(null);
  const [calendarDateForBooking, setCalendarDateForBooking] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<any | null>(null);
  
  const [showImportModal, setShowImportModal] = useState<'USERS' | 'RESOURCES' | 'DEPARTMENTS' | null>(null);
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // New states for Department management
  const [showDepartmentModal, setShowDepartmentModal] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [departmentParentId, setDepartmentParentId] = useState<string | null>(null);
  
  // States for Booking List Pagination & Expansion
  const [bookingPage, setBookingPage] = useState(1);
  const [expandedBookingIds, setExpandedBookingIds] = useState<Set<string>>(new Set());
  const [selectedApprovalIds, setSelectedApprovalIds] = useState<string[]>([]);
  const ITEMS_PER_PAGE = 5;

  // Computed days for dashboard views
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000)), []);
  const monthDays = useMemo(() => Array.from({ length: 30 }, (_, i) => new Date(Date.now() + i * 86400000)), []);

  const markNotificationRead = (id: string) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));

  const addNotification = (title: string, content: string, type: 'INFO' | 'SUCCESS' | 'WARNING' = 'INFO', userId?: string) => {
    const newNotif: Notification = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, userId: userId || currentUser?.id || 'sys', title, content, timestamp: new Date().toISOString(), isRead: false, type };
    setNotifications(prev => [newNotif, ...prev].slice(0, 50));
    // Toast 8 秒后自动标记已读；通知本体保留在通知中心，不再直接删除。
    setTimeout(() => markNotificationRead(newNotif.id), 8000);
  };

  const myNotifications = currentUser ? notifications.filter(n => n.userId === currentUser.id || n.userId === 'sys') : notifications;
  const unreadCount = myNotifications.filter(n => !n.isRead).length;
  const remindedBookingIds = useRef<Set<string>>(new Set(JSON.parse(localStorage.getItem('SMART_OFFICE_REMINDERS') || '[]')));
  const noShowNotifiedIds = useRef<Set<string>>(new Set(bookings.filter(b => b.noShow).map(b => b.id)));

  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      bookings.filter(b => b.status === 'APPROVED').forEach(b => {
        const start = new Date(b.startTime).getTime();
        const remaining = start - now;
        if (remaining <= 0 || remaining > 15 * 60000 || remindedBookingIds.current.has(b.id)) return;
        const resource = resources.find(r => r.id === b.resourceId);
        [b.userId, ...(b.attendeeIds || [])].forEach(userId => addNotification('会前 15 分钟提醒', `「${b.purpose}」将于 ${formatTime(new Date(b.startTime))} 在 ${resource?.name || '预约空间'} 开始，请准时到场。`, 'INFO', userId));
        remindedBookingIds.current.add(b.id);
        localStorage.setItem('SMART_OFFICE_REMINDERS', JSON.stringify([...remindedBookingIds.current]));
      });
    };
    checkReminders();
    const timer = setInterval(checkReminders, 30000);
    return () => clearInterval(timer);
  }, [bookings, resources]);

  useEffect(() => {
    const releaseNoShows = () => {
      const now = Date.now();
      const noShows = bookings.filter(b => b.type === 'ROOM' && b.status === 'APPROVED' && !b.checkedInAt && now >= new Date(b.startTime).getTime() + 15 * 60000);
      if (!noShows.length) return;
      const ids = new Set(noShows.map(b => b.id));
      setBookings(prev => prev.map(b => ids.has(b.id) ? { ...b, status: 'CANCELLED' as BookingStatus, noShow: true } : b));
      noShows.forEach(b => {
        if (noShowNotifiedIds.current.has(b.id)) return;
        noShowNotifiedIds.current.add(b.id);
        const resource = resources.find(r => r.id === b.resourceId);
        [...new Set([b.userId, ...(b.attendeeIds || [])])].forEach(userId => addNotification('未签到，会议室已释放', `「${b.purpose}」开始 15 分钟后仍未签到，${resource?.name || '会议室'} 已自动释放。`, 'WARNING', userId));
      });
    };
    releaseNoShows();
    const timer = setInterval(releaseNoShows, 30000);
    return () => clearInterval(timer);
  }, [bookings, resources]);

  useEffect(() => {
    setWorkOrders(prev => {
      const existing = new Set(prev.map(order => order.id));
      const missing = bookings.filter(b => b.status === 'APPROVED').flatMap(b => {
        const orders: WorkOrder[] = [];
        if (b.needsTeaService) orders.push({ id: `wo-${b.id}-TEA`, bookingId: b.id, type: 'TEA', title: `「${b.purpose}」茶水服务`, assigneeRole: 'APPROVAL_ADMIN', status: 'TODO', createdAt: new Date().toISOString() });
        if (b.isVideoConference) orders.push({ id: `wo-${b.id}-VIDEO`, bookingId: b.id, type: 'VIDEO', title: `「${b.purpose}」视频会议保障`, assigneeRole: 'SYSTEM_ADMIN', status: 'TODO', createdAt: new Date().toISOString() });
        return orders;
      }).filter(order => !existing.has(order.id));
      return missing.length ? [...missing, ...prev] : prev;
    });
  }, [bookings]);

  const canApprove = (booking: Booking) => !!currentUser && canApproveBooking(booking, workflow, currentUser.role);
  const approvableBookings = bookings.filter(b => canApprove(b));
  const pendingCount = approvableBookings.length;
  const canAccessApproval = !!currentUser && workflow.some(node => currentUser.role.includes(node.approverRole));
  const canAccessWorkOrders = !!currentUser && currentUser.role.some(role => ['SYSTEM_ADMIN', 'APPROVAL_ADMIN'].includes(role));
  const visibleWorkOrders = workOrders.filter(order => currentUser?.role.includes('SYSTEM_ADMIN') || currentUser?.role.includes(order.assigneeRole)).sort((a, b) => a.status === b.status ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : a.status === 'TODO' ? -1 : 1);
  const openWorkOrderCount = visibleWorkOrders.filter(order => order.status === 'TODO').length;

  const stats = useMemo(() => {
    const totalResources = resources.length;
    const availableRooms = resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length;
    const availableDesks = resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length;
    const activeBookings = bookings.filter(b => b.status === 'APPROVED').length;
    return { totalResources, availableRooms, availableDesks, activeBookings };
  }, [resources, bookings]);

  const reportData = useMemo(() => {
    const end = new Date();
    const earliest = bookings.length ? Math.min(...bookings.map(b => new Date(b.startTime).getTime()).filter(Number.isFinite)) : end.getTime();
    const start = new Date(reportRange === 'ALL' ? earliest : end.getTime() - (Number(reportRange) - 1) * 86400000);
    start.setHours(0, 0, 0, 0);
    const relevant = bookings.filter(b => {
      const time = new Date(b.startTime).getTime();
      return time >= start.getTime() && time <= end.getTime();
    });
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
    const buildRow = (dimension: 'RESOURCE' | 'DEPARTMENT' | 'OVERALL', id: string, name: string, items: Booking[], resourceCount: number) => {
      const usageMinutes = items.reduce((total, b) => {
        if (!['APPROVED', 'COMPLETED'].includes(b.status)) return total;
        const actualEnd = new Date(b.endedEarlyAt || b.endTime).getTime();
        const overlap = Math.min(actualEnd, end.getTime()) - Math.max(new Date(b.startTime).getTime(), start.getTime());
        return total + Math.max(0, overlap) / 60000;
      }, 0);
      const approvalDurations = items.filter(b => b.currentNodeIndex >= workflow.length - 1).map(b => {
        const finalApproval = [...b.approvalHistory].reverse().find(record => record.status === 'APPROVED');
        return finalApproval ? (new Date(finalApproval.timestamp).getTime() - new Date(b.createdAt).getTime()) / 3600000 : null;
      }).filter((value): value is number => value !== null && value >= 0);
      const percent = (count: number) => items.length ? Number((count / items.length * 100).toFixed(1)) : 0;
      return {
        dimension, id, name,
        bookingCount: items.length,
        usageHours: Number((usageMinutes / 60).toFixed(1)),
        utilization: Number(Math.min(100, usageMinutes / (days * 12 * 60 * Math.max(1, resourceCount)) * 100).toFixed(1)),
        cancellationRate: percent(items.filter(b => b.status === 'CANCELLED' && !b.noShow).length),
        noShowRate: percent(items.filter(b => b.noShow).length),
        rejectionRate: percent(items.filter(b => b.status === 'REJECTED').length),
        averageApprovalHours: approvalDurations.length ? Number((approvalDurations.reduce((a, b) => a + b, 0) / approvalDurations.length).toFixed(1)) : 0
      };
    };
    const resourceRows = resources.map(resource => buildRow('RESOURCE', resource.id, resource.name, relevant.filter(b => b.resourceId === resource.id), 1));
    const departmentRows = [...new Set<string>(users.map(u => u.department))].map(department => {
      const userIds = new Set<string>(users.filter(u => u.department === department).map(u => u.id));
      return buildRow('DEPARTMENT', department, department, relevant.filter(b => userIds.has(b.userId)), resources.length);
    });
    return { start, end, rows: [...resourceRows, ...departmentRows], overall: buildRow('OVERALL', 'ALL', '全公司', relevant, resources.length) };
  }, [bookings, resources, users, workflow, reportRange]);

  const downloadReportCsv = () => {
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [reportData.overall, ...reportData.rows];
    const csv = '\uFEFF' + [
      ['维度', '名称', '预约数', '使用小时', '使用率(%)', '取消率(%)', 'No-show率(%)', '驳回率(%)', '平均审批时长(小时)'],
      ...rows.map(row => [row.dimension === 'RESOURCE' ? '资源' : row.dimension === 'DEPARTMENT' ? '部门' : '整体', row.name, row.bookingCount, row.usageHours, row.utilization, row.cancellationRate, row.noShowRate, row.rejectionRate, row.averageApprovalHours])
    ].map(row => row.map(escape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `运营报表_${formatDate(reportData.start)}_${formatDate(reportData.end)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Filters
  const filteredResources = resources.filter(r => 
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.department.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // My Bookings Computation for Pagination
  const myBookings = useMemo(() => {
      return bookings
          .filter(b => b.userId === currentUser?.id || b.attendeeIds?.includes(currentUser?.id || ''))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [bookings, currentUser]);

  const checkableBookings = bookings.filter(b => {
    const now = Date.now();
    return b.type === 'ROOM' && b.status === 'APPROVED' && !b.checkedInAt
      && (b.userId === currentUser?.id || b.attendeeIds?.includes(currentUser?.id || ''))
      && now >= new Date(b.startTime).getTime() - 15 * 60000
      && now < new Date(b.endTime).getTime();
  });

  const totalBookingPages = Math.ceil(myBookings.length / ITEMS_PER_PAGE);
  const currentPageBookings = myBookings.slice((bookingPage - 1) * ITEMS_PER_PAGE, bookingPage * ITEMS_PER_PAGE);

  const toggleBookingExpand = (id: string) => {
      const next = new Set(expandedBookingIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setExpandedBookingIds(next);
  };

  const saveBookingSeries = async (plan: any, occurrences: any[]) => {
    if (!currentUser || !occurrences.length) return;
    const seriesId = `series-${Date.now()}`;
    const status = workflow.length === 0 ? 'APPROVED' as const : 'PENDING' as const;
    const newBookings: Booking[] = occurrences.map((o, index) => ({
      id: `bk-${Date.now()}-${index}`,
      userId: currentUser.id,
      resourceId: plan.resource.id,
      type: plan.resource.type,
      startTime: new Date(o.start).toISOString(),
      endTime: new Date(o.end).toISOString(),
      status,
      purpose: plan.purpose,
      participants: plan.participants,
      createdAt: new Date().toISOString(),
      currentNodeIndex: 0,
      approvalHistory: [],
      ...plan.extras,
      recurrence: undefined,
      seriesId,
      recurrenceIndex: o.occurrenceIndex ?? index
    }));
    if (isOnline) {
      try {
        const res = await fetch('/api/bookings/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookings: newBookings }) });
        if (res.status === 409) {
          const result = await res.json();
          const conflictsByIndex = new Map((result.conflicts || []).map((c: any) => [c.index, c.conflicts]));
          setRecurringPlan({ ...plan, occurrences: occurrences.map((o, index) => ({ ...o, conflicts: conflictsByIndex.get(index) || [] })) });
          return;
        }
        if (!res.ok) throw new Error(`series save failed: ${res.status}`);
      } catch (err) {
        console.warn('Series server save unavailable, using local save.', err);
        addNotification('离线保存', '周期会议仅保存在本机，请在联网后核对冲突。', 'WARNING');
      }
    }
    setBookings(prev => [...newBookings, ...prev]);
    setRecurringPlan(null);
    setShowBookingModal(false);
    setBookingPrefill(null);
    addNotification('周期会议已创建', `已创建 ${newBookings.length} 次「${plan.purpose}」预约。`, 'SUCCESS');
    (plan.extras?.attendeeIds || []).forEach((id: string) => addNotification('周期会议邀请', `${currentUser.name} 邀请您参加 ${newBookings.length} 次「${plan.purpose}」。`, 'INFO', id));
    const firstRole = workflow[0]?.approverRole;
    if (firstRole) users.filter(u => u.role.includes(firstRole)).forEach(u => addNotification('周期会议待审批', `${currentUser.name} 提交了 ${newBookings.length} 次「${plan.purpose}」。`, 'INFO', u.id));
  };

  const prepareRecurringBooking = (resource: Resource, purpose: string, start: Date, end: Date, participants: number | undefined, extras: any, latestBookings: Booking[]) => {
    const intervalDays = extras.recurrence.frequency === 'BIWEEKLY' ? 14 : 7;
    const occurrences = Array.from({ length: extras.recurrence.count }, (_, index) => {
      const occurrenceStart = new Date(start); occurrenceStart.setDate(start.getDate() + index * intervalDays);
      const occurrenceEnd = new Date(end); occurrenceEnd.setDate(end.getDate() + index * intervalDays);
      const conflicts = findBookingConflicts(latestBookings, { resourceId: resource.id, startTime: occurrenceStart.toISOString(), endTime: occurrenceEnd.toISOString() });
      return { occurrenceIndex: index, start: occurrenceStart.toISOString(), end: occurrenceEnd.toISOString(), conflicts };
    });
    const plan = { resource, purpose, participants, extras, occurrences, latestBookings };
    if (occurrences.some(o => o.conflicts.length)) setRecurringPlan(plan);
    else saveBookingSeries(plan, occurrences);
  };

  const rescheduleRecurringOccurrence = (index: number) => {
    if (!recurringPlan) return;
    const occurrence = recurringPlan.occurrences[index];
    const duration = (new Date(occurrence.end).getTime() - new Date(occurrence.start).getTime()) / 60000;
    const planned = recurringPlan.occurrences.filter((o: any, i: number) => i !== index && !o.skip).map((o: any) => ({ resourceId: recurringPlan.resource.id, status: 'PENDING', startTime: o.start, endTime: o.end }));
    const suggestion = findNextAvailableSlot(recurringPlan.resource.id, [...recurringPlan.latestBookings, ...planned], duration);
    setRecurringPlan({ ...recurringPlan, occurrences: recurringPlan.occurrences.map((o: any, i: number) => i === index ? { ...o, start: suggestion.start.toISOString(), end: suggestion.end.toISOString(), conflicts: [] } : o) });
  };

  const handleBooking = async (resourceId: string, purpose: string, startTime: string, endTime: string, participants?: number, extras?: any) => {
    const resource = resources.find(r => r.id === resourceId);
    if (!resource || !currentUser) return;

    const now = new Date();
    const start = new Date(startTime);
    const end = new Date(endTime);
    const requestedDuration = (end.getTime() - start.getTime()) / 60000;

    if (end <= start) {
      addNotification("预约失败", "结束时间必须晚于开始时间", "WARNING");
      return;
    }

    // 表单打开期间可能已有他人抢先预订：提交时以最新持久化数据重校验，而不是只用 React state 快照。
    const latestBookings: Booking[] = (() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? migrateBookings(JSON.parse(saved).bookings) : bookings;
      } catch { return bookings; }
    })().filter(b => b.id !== editingBooking?.id);

    const openConflict = (errorType: 'PAST_TIME' | 'CONFLICT') => {
      const suggestion = findNextAvailableSlot(resourceId, latestBookings, requestedDuration);
      setBookingConflict({
        resource,
        requestedStart: startTime,
        requestedEnd: endTime,
        purpose,
        participants,
        extras,
        resourceBookings: latestBookings.filter(b => b.resourceId === resourceId && isActiveBooking(b)),
        errorType,
        suggestion
      });
    };

    if (start < now && resource.type === 'ROOM') {
      openConflict('PAST_TIME');
      return;
    }

    if (extras?.recurrence && !editingBooking) {
      await prepareRecurringBooking(resource, purpose, start, end, participants, extras, latestBookings);
      return;
    }

    if (hasBookingConflict(latestBookings, { resourceId, startTime: start.toISOString(), endTime: end.toISOString() })) {
      openConflict('CONFLICT');
      return;
    }

    const newBooking: Booking = {
      ...editingBooking,
      id: editingBooking?.id || `bk-${Date.now()}`,
      userId: currentUser.id,
      resourceId,
      type: resource.type,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      status: workflow.length === 0 ? 'APPROVED' : 'PENDING',
      purpose,
      participants,
      createdAt: editingBooking?.createdAt || new Date().toISOString(),
      currentNodeIndex: 0,
      approvalHistory: editingBooking?.approvalHistory || [],
      ...extras
    };

    // 连接服务器时由服务端做原子校验，409 表示已被他人抢先预订。
    if (isOnline) {
      try {
        const res = await fetch(editingBooking ? `/api/bookings/${editingBooking.id}` : '/api/bookings', {
          method: editingBooking ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking: newBooking })
        });
        if (res.status === 409) {
          openConflict('CONFLICT');
          return;
        }
        if (!res.ok) throw new Error(`booking save failed: ${res.status}`);
      } catch (err) {
        console.warn('Server-side booking check unavailable, falling back to local save.', err);
        addNotification("离线保存", "无法连接服务器，本次预约仅保存在本机，可能存在冲突风险。", "WARNING");
      }
    }

    setBookings(prev => editingBooking ? prev.map(b => b.id === editingBooking.id ? newBooking : b) : [newBooking, ...prev]);
    setShowBookingModal(false);
    setCalendarDateForBooking(null);
    setBookingPrefill(null);
    setEditingBooking(null);
    addNotification(editingBooking ? "预约已修改" : "预约申请已提交", editingBooking ? `资源 ${resource.name} 的预约已更新，并重新进入审批流程。` : `资源 ${resource.name} 的预约已进入审批流程。`, "SUCCESS");
    (extras?.attendeeIds || []).filter((id: string) => id !== currentUser.id).forEach((id: string) => addNotification('会议邀请', `${currentUser.name} 邀请您参加「${purpose}」，时间：${toLocalDateTimeString(newBooking.startTime)}。`, 'INFO', id));
    const firstRole = workflow[0]?.approverRole;
    if (firstRole) users.filter(u => u.id !== currentUser.id && u.role.includes(firstRole)).forEach(u => addNotification('新预约待审批', `${currentUser.name} 提交了「${purpose}」，资源：${resource.name}，时间：${toLocalDateTimeString(newBooking.startTime)}。`, 'INFO', u.id));
  };

  const handleCancelBooking = (id: string) => {
    if (confirm("确定要撤销此项预约申请吗？撤销后该时段资源将立即释放。")) {
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'CANCELLED' as BookingStatus } : b));
      addNotification("申请已撤销", "相关资源已释放，可重新进行预订。", "SUCCESS");
    }
  };

  const handleCheckIn = (id: string) => {
    const booking = bookings.find(b => b.id === id);
    const now = Date.now();
    const isParticipant = booking && (booking.userId === currentUser?.id || booking.attendeeIds?.includes(currentUser?.id || ''));
    if (!booking || !isParticipant || booking.status !== 'APPROVED' || now < new Date(booking.startTime).getTime() - 15 * 60000 || now >= new Date(booking.endTime).getTime()) {
      addNotification('暂时无法签到', '请在会议开始前 15 分钟至会议结束前完成签到。', 'WARNING');
      return false;
    }
    const checkedInAt = new Date(now).toISOString();
    setBookings(prev => prev.map(b => b.id === id ? { ...b, checkedInAt, noShow: false } : b));
    addNotification('签到成功', `「${booking.purpose}」已签到，时间：${toLocalTimeString(checkedInAt)}。`, 'SUCCESS');
    return true;
  };

  const handleEndEarly = (id: string) => {
    const booking = bookings.find(b => b.id === id);
    const now = Date.now();
    if (!booking || booking.userId !== currentUser?.id || booking.status !== 'APPROVED' || !booking.checkedInAt || now < new Date(booking.startTime).getTime() || now >= new Date(booking.endTime).getTime()) return;
    const endedEarlyAt = new Date(now).toISOString();
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'COMPLETED' as BookingStatus, endedEarlyAt } : b));
    [...new Set([booking.userId, ...(booking.attendeeIds || [])])].forEach(userId => addNotification('会议已提前结束', `「${booking.purpose}」已于 ${toLocalTimeString(endedEarlyAt)} 结束，剩余时段已释放。`, 'SUCCESS', userId));
  };

  const handleCompleteWorkOrder = (id: string) => {
    const order = workOrders.find(item => item.id === id);
    if (!order || order.status === 'DONE') return;
    const completedAt = new Date().toISOString();
    setWorkOrders(prev => prev.map(item => item.id === id ? { ...item, status: 'DONE', completedAt } : item));
    const booking = bookings.find(b => b.id === order.bookingId);
    if (booking) addNotification('服务需求已处理', `${order.title}已完成。`, 'SUCCESS', booking.userId);
  };

  // ... existing handlers
  const handleApprove = (booking: Booking, comment?: string) => {
    const isLast = isLastApprovalNode(booking, workflow);
    setBookings(prev => prev.map(b => b.id === booking.id ? approveBooking(b, workflow, currentUser?.name || '未知', comment) : b));
    addNotification(isLast ? "预约已核准" : "审批节点已通过", isLast ? `您的「${booking.purpose}」已通过最终核准。` : `您的「${booking.purpose}」已通过本环节预审。`, "SUCCESS", booking.userId);
    if (isLast) (booking.attendeeIds || []).forEach(id => addNotification('受邀会议已核准', `「${booking.purpose}」已核准，可下载 ICS 添加到日历。`, 'SUCCESS', id));
    if (!isLast) {
      const nextRole = workflow[booking.currentNodeIndex + 1]?.approverRole;
      users.filter(u => u.role.includes(nextRole)).forEach(u => addNotification('新预约待审批', `「${booking.purpose}」已进入您负责的审批节点。`, 'INFO', u.id));
    }
  };

  const handleBulkApprove = () => {
    const selected = approvableBookings.filter(b => selectedApprovalIds.includes(b.id));
    if (!selected.length) return;
    const selectedIds = new Set(selected.map(b => b.id));
    setBookings(prev => prev.map(b => selectedIds.has(b.id) ? approveBooking(b, workflow, currentUser?.name || '未知', '批量通过') : b));
    selected.forEach(b => {
      const isLast = isLastApprovalNode(b, workflow);
      addNotification(isLast ? '预约已核准' : '审批节点已通过', `您的「${b.purpose}」已通过当前审批节点。`, 'SUCCESS', b.userId);
      if (!isLast) {
        const nextRole = workflow[b.currentNodeIndex + 1]?.approverRole;
        users.filter(u => u.role.includes(nextRole)).forEach(u => addNotification('新预约待审批', `「${b.purpose}」已进入您负责的审批节点。`, 'INFO', u.id));
      }
    });
    setSelectedApprovalIds([]);
    addNotification('批量审批完成', `已通过 ${selected.length} 项申请。`, 'SUCCESS');
  };

  const handleReject = (booking: Booking, comment: string) => {
    setBookings(prev => prev.map(b => b.id === booking.id ? rejectBooking(b, workflow, currentUser?.name || '未知', comment) : b));
    addNotification("预约已驳回", `您的「${booking.purpose}」被驳回：${comment}`, "WARNING", booking.userId);
  };

  // --- Department Handlers ---
  const handleSaveDepartment = (data: { name: string, parentId?: string }) => {
    if (editingDepartment) {
       // Update department name
       const oldName = editingDepartment.name;
       const newName = data.name;
       
       setDepartments(prev => prev.map(d => d.id === editingDepartment.id ? { ...d, name: newName } : d));
       
       // Update users associated with this department (simple cascade)
       if (oldName !== newName) {
          setUsers(prev => prev.map(u => u.department === oldName ? { ...u, department: newName } : u));
       }
       addNotification("部门更新成功", `部门名称已更改为 ${newName}`, "SUCCESS");
    } else {
       const newDept = { id: `dpt-${Date.now()}`, name: data.name, parentId: data.parentId };
       setDepartments(prev => [...prev, newDept]);
       addNotification("部门创建成功", `已添加新部门 ${data.name}`, "SUCCESS");
    }
    setShowDepartmentModal(false);
    setEditingDepartment(null);
    setDepartmentParentId(null);
  };

  const handleDeleteDepartment = (id: string) => {
     // Check for children
     const hasChildren = departments.some(d => d.parentId === id);
     if (hasChildren) {
        addNotification("无法删除", "该部门下包含子部门，请先删除子部门。", "WARNING");
        return;
     }
     // Check for users (Warning only)
     const deptName = departments.find(d => d.id === id)?.name;
     const hasUsers = users.some(u => u.department === deptName); 
     
     if (hasUsers && !confirm(`该部门 (${deptName}) 下仍有员工，删除后这些员工的部门信息将失效。确定继续吗？`)) {
        return;
     }
     
     if (confirm("确定要删除该部门吗？此操作无法撤销。")) {
        setDepartments(prev => prev.filter(d => d.id !== id));
        addNotification("删除成功", "部门已移除。", "SUCCESS");
     }
  };

  if (!currentUser) return <LoginView users={users} onLogin={setCurrentUser} theme={theme} />;

  return (
    <div className="min-h-screen flex bg-gray-50 overflow-hidden font-sans">
      {/* Toast Notifications */}
      <div className="fixed top-6 right-6 z-[1000] space-y-3 pointer-events-none">
        {myNotifications.filter(n => !n.isRead).slice(0, 3).map(n => (
          <div key={n.id} className="w-80 p-4 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-100 flex items-start space-x-3 animate-in slide-in-from-right-8 fade-in pointer-events-auto">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.type === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600' : n.type === 'WARNING' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
              {n.type === 'SUCCESS' ? <CheckCircle size={18}/> : n.type === 'WARNING' ? <AlertTriangle size={18}/> : <Info size={18}/>}
            </div>
            <div className="flex-1">
              <h5 className="text-sm font-black text-gray-800">{n.title}</h5>
              <p className="text-xs text-gray-500 font-medium mt-0.5">{n.content}</p>
            </div>
            <button onClick={() => markNotificationRead(n.id)} className="text-gray-500 hover:text-gray-500"><X size={14}/></button>
          </div>
        ))}
      </div>

      <aside className="w-64 bg-white border-r hidden lg:flex flex-col p-6 h-screen sticky top-0 shrink-0">
        {/* ... Sidebar content ... */}
        <div className="flex items-center space-x-3 mb-10 px-2 shrink-0">
          <div className={`w-8 h-8 bg-${theme}-600 rounded-lg flex items-center justify-center text-white shadow-lg`}><Cpu size={18}/></div>
          <span className="text-lg font-black tracking-tight italic">SmartOffice</span>
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
          <SidebarItem icon={LayoutDashboard} label="数据全景看板" id="DASHBOARD" active={view === 'DASHBOARD'} onClick={setView} theme={theme} />
          <SidebarItem icon={MapPin} label="空间资源库" id="RESOURCES" active={view === 'RESOURCES'} onClick={setView} theme={theme} />
          <SidebarItem icon={Calendar} label="我的申请" id="BOOKINGS" active={view === 'BOOKINGS'} onClick={setView} theme={theme} />
          <div className="pt-6 pb-2 px-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">流程与中心</div>
          {canAccessApproval && <SidebarItem icon={ShieldCheck} label="审批工作台" id="APPROVAL_CENTER" active={view === 'APPROVAL_CENTER'} onClick={setView} theme={theme} badge={pendingCount} />}
          {canAccessWorkOrders && <SidebarItem icon={Coffee} label="服务工单" id="WORK_ORDERS" active={view === 'WORK_ORDERS'} onClick={setView} theme={theme} badge={openWorkOrderCount} />}
          {currentUser.role.includes('SYSTEM_ADMIN') && (
            <>
              <div className="pt-6 pb-2 px-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">系统管理</div>
              <SidebarItem icon={GitMerge} label="流程配置" id="WORKFLOW_CONFIG" active={view === 'WORKFLOW_CONFIG'} onClick={setView} theme={theme} />
              <SidebarItem icon={Building2} label="部门管理" id="DEPARTMENTS" active={view === 'DEPARTMENTS'} onClick={setView} theme={theme} />
              <SidebarItem icon={Shield} label="角色管理" id="ROLES" active={view === 'ROLES'} onClick={setView} theme={theme} />
              <SidebarItem icon={Users} label="成员中心" id="USERS" active={view === 'USERS'} onClick={setView} theme={theme} />
              <SidebarItem icon={PieChart} label="运营报表" id="REPORTS" active={view === 'REPORTS'} onClick={setView} theme={theme} />
              <SidebarItem icon={Database} label="数据中心" id="DATA_CENTER" active={view === 'DATA_CENTER'} onClick={setView} theme={theme} />
            </>
          )}
        </nav>

        <div className="mt-4 pt-4 border-t shrink-0">
          <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest mb-3 px-2">系统主题风格</p>
          <div className="flex items-center justify-around px-2">
            {THEMES.map(t => (
              <button key={t.id} onClick={() => setTheme(t.id)} title={t.name} className={`w-6 h-6 rounded-full ${t.color} border-2 transition-all ${theme === t.id ? 'border-gray-900 scale-125 shadow-md' : 'border-transparent hover:scale-110'}`} />
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t shrink-0">
          <div className={`flex items-center justify-between px-2 py-2 rounded-xl bg-gray-50 mb-4 ${!isOnline ? 'bg-rose-50' : ''}`}>
             <div className="flex items-center space-x-2">
               {isOnline ? <Cloud size={14} className="text-emerald-500"/> : <CloudOff size={14} className="text-rose-500"/>}
               <span className={`text-[11px] font-bold ${isOnline ? 'text-emerald-600' : 'text-rose-600'}`}>
                 {saveStatus === 'saving' ? '正在同步...' : (isOnline ? '已同步至服务器' : '仅保存在本机')}
               </span>
             </div>
             {saveStatus === 'saving' && <RefreshCw size={12} className="text-gray-500 animate-spin"/>}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 truncate">
              <div className={`w-8 h-8 bg-${theme}-600 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-inner`}>{currentUser.name[0]}</div>
              <p className="text-xs font-bold truncate">{currentUser.name}</p>
            </div>
            <button onClick={() => setCurrentUser(null)} aria-label="退出登录" title="退出登录" className="text-gray-500 hover:text-rose-500 transition-colors"><LogOut size={16}/></button>
          </div>
        </div>
      </aside>

      <nav aria-label="移动端主导航" className="lg:hidden fixed bottom-3 left-3 right-3 z-[80] bg-white/95 backdrop-blur-lg border border-gray-200 rounded-2xl shadow-2xl flex overflow-x-auto p-2 gap-1">
        {([
          { id: 'DASHBOARD', label: '看板', icon: LayoutDashboard },
          { id: 'RESOURCES', label: '资源', icon: MapPin },
          { id: 'BOOKINGS', label: '申请', icon: Calendar },
          ...(canAccessApproval ? [{ id: 'APPROVAL_CENTER', label: '审批', icon: ShieldCheck }] : []),
          ...(canAccessWorkOrders ? [{ id: 'WORK_ORDERS', label: '工单', icon: Coffee }] : []),
          ...(currentUser.role.includes('SYSTEM_ADMIN') ? [
            { id: 'WORKFLOW_CONFIG', label: '流程', icon: GitMerge },
            { id: 'DEPARTMENTS', label: '部门', icon: Building2 },
            { id: 'ROLES', label: '角色', icon: Shield },
            { id: 'USERS', label: '成员', icon: Users },
            { id: 'REPORTS', label: '报表', icon: PieChart },
            { id: 'DATA_CENTER', label: '数据', icon: Database }
          ] : [])
        ] as const).map(item => <button key={item.id} onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined} className={`min-w-16 flex-1 flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold ${view === item.id ? `bg-${theme}-600 text-white` : 'text-gray-500'}`}><item.icon size={17}/><span>{item.label}</span></button>)}
      </nav>

      <main className="flex-1 min-w-0 overflow-auto relative bg-gray-50 pb-32">
        <header className="min-h-16 bg-white/80 backdrop-blur-md border-b px-4 md:px-8 py-2 flex items-center justify-between gap-3 sticky top-0 z-40">
          <div className="flex items-center space-x-6 flex-1 max-w-2xl">
            <h2 className="text-lg font-bold shrink-0">
              {view === 'DASHBOARD' && '数据全景看板'}
              {view === 'RESOURCES' && '空间资源库'}
              {view === 'USERS' && '成员中心'}
              {view === 'BOOKINGS' && '我的申请记录'}
              {view === 'APPROVAL_CENTER' && '审批中心'}
              {view === 'WORK_ORDERS' && '服务工单中心'}
              {view === 'WORKFLOW_CONFIG' && '审批引擎配置'}
              {view === 'DEPARTMENTS' && '组织架构'}
              {view === 'ROLES' && '角色权限集'}
              {view === 'REPORTS' && '运营报表'}
              {view === 'DATA_CENTER' && '数据维护中心'}
            </h2>
            {(view === 'RESOURCES' || view === 'USERS') && (
              <div className="relative flex-1 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-indigo-500 transition-colors" size={16}/>
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={view === 'RESOURCES' ? "搜索资源名称或位置..." : "搜索姓名、邮箱或部门..."} 
                  className="w-full pl-10 pr-4 py-2 bg-gray-100/50 border border-transparent rounded-xl outline-none text-sm focus:bg-white focus:border-indigo-100 transition-all font-medium" 
                />
              </div>
            )}
          </div>
          <div className="flex items-center space-x-4">
             <button className={`bg-${theme}-50 text-${theme}-600 px-4 py-2 rounded-xl font-black text-[11px] flex items-center space-x-2 hover:bg-${theme}-100 transition-all shadow-sm border border-${theme}-100`} onClick={() => setShowQRScanner(true)}>
               <QrCode size={14}/>
               <span>扫码签到</span>
             </button>
             <div className="relative">
               <button onClick={() => setShowNotificationPanel(v => !v)} className="relative p-2 text-gray-500 hover:text-indigo-600 transition-colors" aria-label="通知中心">
                 <Bell size={20}/>
                 {unreadCount > 0 && (
                   <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{unreadCount > 99 ? '99+' : unreadCount}</span>
                 )}
               </button>
               {showNotificationPanel && (
                 <div className="absolute right-0 top-12 w-96 max-w-[90vw] bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                   <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                     <h4 className="font-black text-sm text-gray-800">通知中心</h4>
                     <button onClick={() => setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))} className="text-[11px] font-bold text-indigo-500 hover:text-indigo-700">全部已读</button>
                   </div>
                   <div className="max-h-96 overflow-y-auto custom-scrollbar">
                     {myNotifications.length === 0 && <p className="text-center text-xs text-gray-500 font-bold py-10">暂无通知</p>}
                     {myNotifications.slice(0, 20).map(n => (
                       <button key={n.id} onClick={() => markNotificationRead(n.id)} className="w-full text-left px-5 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors flex items-start space-x-3">
                         <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.isRead ? 'bg-gray-200' : n.type === 'WARNING' ? 'bg-amber-400' : n.type === 'SUCCESS' ? 'bg-emerald-400' : 'bg-indigo-400'}`}></span>
                         <span className="flex-1 min-w-0">
                           <span className={`block text-xs ${n.isRead ? 'text-gray-500 font-medium' : 'text-gray-800 font-black'}`}>{n.title}</span>
                           <span className="block text-[11px] text-gray-500 mt-0.5 break-words">{n.content}</span>
                           <span className="block text-[11px] text-gray-500 mt-1">{toLocalDateTimeString(n.timestamp)}</span>
                         </span>
                       </button>
                     ))}
                   </div>
                 </div>
               )}
             </div>
          </div>
        </header>

        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {view === 'DASHBOARD' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className={`flex items-center justify-between p-5 bg-${theme}-600 rounded-[2rem] text-white shadow-lg hover:translate-y-[-2px] transition-all group overflow-hidden relative active:scale-[0.98]`}>
                  <div className="flex items-center space-x-4 relative z-10">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md group-hover:scale-110 transition-transform">
                      <Monitor size={24} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-black text-lg leading-tight">预订会议室</h3>
                      <p className="text-[11px] text-white/70 font-bold uppercase mt-1">当前可用: <span className="text-white">{stats.availableRooms}</span></p>
                    </div>
                  </div>
                  <ArrowRightCircle className="relative z-10 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all" size={24} />
                  <Monitor className="absolute -right-4 -bottom-4 text-white/10 opacity-50 group-hover:scale-125 transition-all pointer-events-none" size={100} />
                </button>

                <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className={`flex items-center justify-between p-5 bg-${theme}-500 rounded-[2rem] text-white shadow-lg hover:translate-y-[-2px] transition-all group overflow-hidden relative active:scale-[0.98]`}>
                  <div className="flex items-center space-x-4 relative z-10">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md group-hover:scale-110 transition-transform">
                      <Coffee size={24} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-black text-lg leading-tight">申请工位</h3>
                      <p className="text-[11px] text-white/70 font-bold uppercase mt-1">当前可用: <span className="text-white">{stats.availableDesks}</span></p>
                    </div>
                  </div>
                  <ArrowRightCircle className="relative z-10 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all" size={24} />
                  <Coffee className="absolute -right-4 -bottom-4 text-white/10 opacity-50 group-hover:scale-125 transition-all pointer-events-none" size={100} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard title="资源资产总量" value={stats.totalResources} icon={MapPin} trend="+2" color={theme} onClick={() => setView('RESOURCES')} />
                <StatCard title="活跃核准单" value={stats.activeBookings} icon={Activity} trend="+12%" color="emerald" onClick={() => setView('BOOKINGS')} />
                {canAccessApproval ? <StatCard title="待处理任务" value={pendingCount} icon={ShieldCheck} color="amber" onClick={() => setView('APPROVAL_CENTER')} /> : <StatCard title="我的进行中申请" value={bookings.filter(b => b.userId === currentUser.id && b.status === 'PENDING').length} icon={Activity} color="amber" onClick={() => setView('BOOKINGS')} />}
              </div>

              <TodayResourceUsage 
                resources={resources} 
                bookings={bookings} 
                users={users} 
                theme={theme}
                onBookingClick={(detail: any) => setDayDetail(detail)}
              />
              
              {/* Weekly View */}
              <ResourceUsageGrid 
                title="本周资源申请情况 (7天)" 
                days={weekDays} 
                resources={resources} 
                bookings={bookings} 
                users={users} 
                theme={theme} 
                onDayClick={(resId: string | null, date: Date) => { 
                  const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
                  const dayEnd = new Date(date); dayEnd.setHours(23,59,59,999);
                  
                  const targetResource = resId ? resources.find(r => r.id === resId) : { name: '全公司资源概览' };
                  
                  const dayBookings = bookings.filter(b => {
                    if (b.status !== 'APPROVED') return false;
                    if (resId && b.resourceId !== resId) return false;
                    const bStart = new Date(b.startTime);
                    const bEnd = new Date(b.endTime);
                    return bStart < dayEnd && bEnd > dayStart;
                  });
                  
                  setDayDetail({ 
                    resource: targetResource, 
                    date, 
                    bookings: dayBookings 
                  }); 
                }} 
              />
              
              {/* Monthly View */}
              <ResourceUsageGrid 
                title="未来30天资源申请情况" 
                days={monthDays} 
                resources={resources} 
                bookings={bookings} 
                users={users} 
                theme={theme} 
                onDayClick={(resId: string | null, date: Date) => { 
                  const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
                  const dayEnd = new Date(date); dayEnd.setHours(23,59,59,999);
                  
                  const targetResource = resId ? resources.find(r => r.id === resId) : { name: '全公司资源概览' };
                  
                  const dayBookings = bookings.filter(b => {
                    if (b.status !== 'APPROVED') return false;
                    if (resId && b.resourceId !== resId) return false;
                    const bStart = new Date(b.startTime);
                    const bEnd = new Date(b.endTime);
                    return bStart < dayEnd && bEnd > dayStart;
                  });
                  
                  setDayDetail({ 
                    resource: targetResource, 
                    date, 
                    bookings: dayBookings 
                  }); 
                }} 
              />
            </div>
          )}

          {/* ... existing views ... */}
          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div><h3 className="text-2xl font-black">空间资产</h3><p className="text-sm text-gray-500 mt-1">查看及预约全公司物理空间资源。</p></div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowResourceFinder(prev => !prev)} aria-expanded={showResourceFinder} className={`px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 transition-all ${showResourceFinder ? `bg-${theme}-50 text-${theme}-600 border border-${theme}-200` : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}><Search size={18}/> <span>按条件找会议室</span></button>
                  {currentUser.role.includes('SYSTEM_ADMIN') && <><button onClick={() => setShowImportModal('RESOURCES')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50 transition-all"><Upload size={18}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2 hover:shadow-xl transition-all`}><Plus size={18}/> <span>新增资源</span></button></>}
                </div>
              </div>
              {showResourceFinder && <ResourceFinder resources={resources} bookings={bookings} theme={theme} onBook={(resource: Resource, prefill: any) => { setSelectedResource(resource); setEditingBooking(null); setBookingPrefill(prefill); setCalendarDateForBooking(null); setShowBookingModal(true); }} />}
              <div className="bg-white rounded-3xl border border-gray-100 overflow-x-auto shadow-sm">
                <table className="w-full min-w-[720px] text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-6 py-4 w-12 text-center">
                        <button onClick={() => setSelectedResourceIds(prev => prev.length === filteredResources.length ? [] : filteredResources.map(r => r.id))} className={`transition-colors ${selectedResourceIds.length === filteredResources.length && filteredResources.length > 0 ? `text-${theme}-600` : 'text-gray-500'}`}>
                          {selectedResourceIds.length === filteredResources.length && filteredResources.length > 0 ? <CheckSquare size={18}/> : <Square size={18}/>}
                        </button>
                      </th>
                      <th className="px-6 py-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">资源标识</th>
                      <th className="px-6 py-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">物理位置</th>
                      <th className="px-6 py-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">类型/容量</th>
                      <th className="px-6 py-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">状态</th>
                      <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredResources.map(r => (
                      <tr key={r.id} className={`hover:bg-${theme}-50/20 transition-colors ${selectedResourceIds.includes(r.id) ? `bg-${theme}-50/30` : ''}`}>
                        <td className="px-6 py-4 text-center">
                          <button onClick={() => setSelectedResourceIds(prev => prev.includes(r.id) ? prev.filter(id => id !== r.id) : [...prev, r.id])} className={`transition-colors ${selectedResourceIds.includes(r.id) ? `text-${theme}-600` : 'text-gray-200 hover:text-gray-500'}`}>
                            {selectedResourceIds.includes(r.id) ? <CheckSquare size={18}/> : <Square size={18}/>}
                          </button>
                        </td>
                        <td className="px-6 py-4 font-bold text-gray-800">{r.name}</td>
                        <td className="px-6 py-4 text-xs font-medium text-gray-500">{r.location}</td>
                        <td className="px-6 py-4 text-xs text-gray-500 font-bold">{r.type === 'ROOM' ? '会议室' : '工位'} / {r.capacity || 0}人</td>
                        <td className="px-6 py-4"><StatusBadge status={r.status} theme={theme} /></td>
                        <td className="px-6 py-4 text-right space-x-1">
                          <button onClick={() => setViewDetail({ type: 'RESOURCE', data: r })} className="p-2 text-gray-500 hover:text-indigo-600 transition-colors" title="详情"><Info size={16}/></button>
                          <button onClick={() => setShowResourceCalendar(r)} className="p-2 text-gray-500 hover:text-emerald-600 transition-colors" title="排期日历" aria-label={`查看${r.name}排期`}><CalendarDays size={16}/></button>
                          <button onClick={() => { setSelectedResource(r); setEditingBooking(null); setBookingPrefill(null); setCalendarDateForBooking(null); setShowBookingModal(true); }} className={`px-4 py-1.5 bg-${theme}-600 text-white rounded-lg text-[11px] font-black shadow-md hover:translate-y-[-1px] transition-all`}>预约</button>
                          {currentUser.role.includes('SYSTEM_ADMIN') && <button onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className="p-2 text-gray-200 hover:text-indigo-600 transition-colors"><Edit2 size={16}/></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredResources.length === 0 && (
                  <div className="py-20 text-center space-y-4 opacity-40">
                    <Search size={48} className="mx-auto" />
                    <p className="font-bold text-sm">未找到匹配的资源</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div><h3 className="text-2xl font-black">成员名录</h3><p className="text-sm text-gray-500 mt-1">管理企业员工信息及其系统角色。</p></div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowImportModal('USERS')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50 transition-all"><Upload size={18}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2 hover:shadow-xl transition-all`}><UserPlus size={18}/> <span>录入成员</span></button>
                </div>
              </div>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-6 py-4 w-12 text-center">
                        <button onClick={() => setSelectedUserIds(prev => prev.length === filteredUsers.length ? [] : filteredUsers.map(u => u.id))} className={`transition-colors ${selectedUserIds.length === filteredUsers.length && filteredUsers.length > 0 ? `text-${theme}-600` : 'text-gray-500'}`}>
                          {selectedUserIds.length === filteredUsers.length && filteredUsers.length > 0 ? <CheckSquare size={18}/> : <Square size={18}/>}
                        </button>
                      </th>
                      <th className="px-6 py-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">基本信息</th>
                      <th className="px-6 py-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">部门</th>
                      <th className="px-6 py-4 text-[11px] font-black text-gray-500 uppercase tracking-widest">角色</th>
                      <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredUsers.map(u => (
                      <tr key={u.id} className={`hover:bg-${theme}-50/20 transition-colors ${selectedUserIds.includes(u.id) ? `bg-${theme}-50/30` : ''}`}>
                        <td className="px-6 py-4 text-center">
                          <button onClick={() => setSelectedUserIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])} className={`transition-colors ${selectedUserIds.includes(u.id) ? `text-${theme}-600` : 'text-gray-200 hover:text-gray-500'}`}>
                            {selectedUserIds.includes(u.id) ? <CheckSquare size={18}/> : <Square size={18}/>}
                          </button>
                        </td>
                        <td className="px-6 py-4 flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full bg-${theme}-100 flex items-center justify-center font-black text-${theme}-600 text-[11px]`}>{u.name[0]}</div>
                          <div>
                            <p className="font-bold text-gray-800 text-sm">{u.name}</p>
                            <p className="text-[11px] text-gray-500 font-medium">{u.email}</p>
                            {u.mobile && <p className="text-[11px] text-indigo-400 font-bold mt-0.5 flex items-center"><Smartphone size={10} className="mr-1"/>{u.mobile}</p>}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs font-black text-gray-500 uppercase">{u.department}</td>
                        <td className="px-6 py-4"><div className="flex flex-wrap gap-1">{u.role.map(rid => <RoleTag key={rid} roleId={rid} roles={roles} theme={theme}/>)}</div></td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => setViewDetail({ type: 'USER', data: u })} className="p-2 text-gray-500 hover:text-indigo-600 transition-colors"><Info size={16}/></button>
                          <button onClick={() => { setEditingUser(u); setShowUserModal(true); }} className="p-2 text-gray-200 hover:text-indigo-600 transition-colors"><Edit2 size={16}/></button>
                          <button onClick={() => { if(confirm("确定注销该成员吗？")) setUsers(users.filter(user => user.id !== u.id)); }} className="p-2 text-gray-200 hover:text-rose-500 transition-colors"><Trash2 size={16}/></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredUsers.length === 0 && (
                  <div className="py-20 text-center space-y-4 opacity-40">
                    <Users size={48} className="mx-auto" />
                    <p className="font-bold text-sm">未找到匹配的成员</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'APPROVAL_CENTER' && canAccessApproval && (
            <div className="space-y-6 animate-in fade-in">
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h3 className="text-3xl font-black text-gray-800 tracking-tight">审批工作台</h3>
                  <p className="text-sm text-gray-500 mt-2 flex items-center space-x-2">
                    <ShieldCheck size={14} className={`text-${theme}-600`}/>
                    <span>当前共 <strong className={`text-${theme}-600`}>{pendingCount}</strong> 项待处理申请</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setSelectedApprovalIds(selectedApprovalIds.length === approvableBookings.length ? [] : approvableBookings.map(b => b.id))} className="bg-white border border-gray-200 text-gray-600 px-4 py-2.5 rounded-xl text-xs font-bold">{selectedApprovalIds.length === approvableBookings.length && approvableBookings.length ? '取消全选' : '全选'}</button>
                  <button onClick={handleBulkApprove} disabled={!selectedApprovalIds.length} className={`bg-${theme}-600 text-white px-4 py-2.5 rounded-xl text-xs font-bold disabled:opacity-40`}>批量通过{selectedApprovalIds.length ? ` (${selectedApprovalIds.length})` : ''}</button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6">
                {approvableBookings.map(b => (
                  <ApprovalTaskCard key={b.id} booking={b} workflow={workflow} users={users} resources={resources} theme={theme} selected={selectedApprovalIds.includes(b.id)} onToggleSelect={() => setSelectedApprovalIds(prev => prev.includes(b.id) ? prev.filter(id => id !== b.id) : [...prev, b.id])} onApprove={(comment?: string) => handleApprove(b, comment)} onReject={(c: string) => handleReject(b, c)} />
                ))}
                {approvableBookings.length === 0 && (
                  <div className="text-center py-32 bg-white rounded-[3rem] border border-dashed border-gray-200">
                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-200">
                      <CheckCircle size={40}/>
                    </div>
                    <p className="text-gray-500 font-black">所有任务已处理完毕，保持高效！</p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {view === 'BOOKINGS' && (
             <div className="space-y-6 animate-in fade-in">
                 <div className="flex justify-between items-center mb-4">
                     <h3 className="text-2xl font-black">我的申请动态</h3>
                     <span className="text-xs font-bold text-gray-500 bg-white px-3 py-1 rounded-full shadow-sm border border-gray-100">
                         共 {myBookings.length} 条记录
                     </span>
                 </div>

                 {myBookings.length === 0 ? (
                   <div className="text-center py-32 bg-white rounded-[3rem] border border-dashed text-gray-500 font-bold">
                     <History size={48} className="mx-auto mb-4 opacity-20"/>
                     暂无预约申请记录，去资源库看看吧。
                   </div>
                 ) : (
                   <>
                       <div className="space-y-4">
                           {currentPageBookings.map(b => {
                               const isExpanded = expandedBookingIds.has(b.id);
                               const resource = resources.find(r => r.id === b.resourceId);
                               return (
                                   <div key={b.id} className={`bg-white rounded-[2rem] border transition-all duration-300 overflow-hidden ${isExpanded ? 'shadow-lg border-indigo-100' : 'shadow-sm border-gray-100 hover:border-gray-200'}`}>
                                       {/* Header - Click to Toggle */}
                                       <div 
                                           onClick={() => toggleBookingExpand(b.id)}
                                           className="p-6 cursor-pointer flex items-center justify-between hover:bg-gray-50/50 transition-colors"
                                       >
                                           <div className="flex items-center space-x-4">
                                               <div className={`w-12 h-12 rounded-2xl ${isExpanded ? `bg-${theme}-100 text-${theme}-600` : 'bg-gray-50 text-gray-500'} flex items-center justify-center transition-colors`}>
                                                   {b.type === 'ROOM' ? <Monitor size={20}/> : <Briefcase size={20}/>}
                                               </div>
                                               <div>
                                                   <h4 className="font-black text-gray-800 text-base">{b.purpose}</h4>
                                                   <div className="flex items-center space-x-2 mt-1">
                                                       <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide bg-gray-50 px-1.5 py-0.5 rounded">{resource?.name || '未知资源'}</span>
                                                       <span className="text-[11px] font-medium text-gray-500">·</span>
                                                       <span className="text-[11px] font-medium text-gray-500">{toLocalDateString(b.startTime)}</span>
                                                   </div>
                                               </div>
                                           </div>
                                           
                                           <div className="flex items-center space-x-4">
                                               {b.userId !== currentUser.id && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">受邀会议</span>}
                                               {b.checkedInAt && <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">已签到 {toLocalTimeString(b.checkedInAt)}</span>}
                                               {b.noShow && <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-lg">未签到</span>}
                                               <StatusBadge status={b.status} theme={theme} />
                                               <div className={`p-2 rounded-full transition-transform duration-300 ${isExpanded ? 'rotate-180 bg-gray-100 text-gray-600' : 'text-gray-500'}`}>
                                                   <ChevronDown size={16}/>
                                               </div>
                                           </div>
                                       </div>

                                       {/* Expanded Content */}
                                       {isExpanded && (
                                           <div className="px-6 pb-8 pt-2 border-t border-gray-50 animate-in slide-in-from-top-2 fade-in">
                                               <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 text-xs text-gray-500">
                                                   <div className="space-y-1">
                                                       <p className="font-black text-gray-500 uppercase tracking-widest text-[11px]">时间段</p>
                                                       <p className="font-bold text-gray-700 text-sm flex items-center gap-2">
                                                           <Clock size={14}/>
                                                           {toLocalDateTimeString(b.startTime)} - {toLocalTimeString(b.endTime)}
                                                       </p>
                                                   </div>
                                                   <div className="space-y-1">
                                                       <p className="font-black text-gray-500 uppercase tracking-widest text-[11px]">参与人数</p>
                                                       <p className="font-bold text-gray-700 text-sm flex items-center gap-2">
                                                           <Users size={14}/>
                                                           {b.participants || 1} 人
                                                       </p>
                                                   </div>
                                                   <div className="space-y-1">
                                                        <p className="font-black text-gray-500 uppercase tracking-widest text-[11px]">附加选项</p>
                                                        <div className="flex flex-wrap gap-2 mt-1">
                                                            {b.hasLeader && <span className="px-2 py-0.5 bg-amber-50 text-amber-600 rounded text-[11px] font-bold border border-amber-100">领导参会</span>}
                                                            {b.isVideoConference && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[11px] font-bold border border-indigo-100">视频会议</span>}
                                                            {b.needsTeaService && <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[11px] font-bold border border-emerald-100">茶水</span>}
                                                            {!b.hasLeader && !b.isVideoConference && !b.needsTeaService && <span className="text-gray-500">-</span>}
                                                        </div>
                                                   </div>
                                               </div>

                                               <WorkflowStepper booking={b} workflow={workflow} users={users} theme={theme} />
                                               {b.approvalHistory?.length > 0 && <div className="mt-5 space-y-2">{b.approvalHistory.map((record, index) => <div key={`${record.timestamp}-${index}`} className={`p-3 rounded-xl text-xs ${record.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-gray-50 text-gray-600'}`}><span className="font-black">{record.nodeName} · {record.approverName} · {record.status === 'REJECTED' ? '驳回原因' : '审批附言'}</span><p className="mt-1">{record.comment || (record.status === 'REJECTED' ? '未填写' : '无附言')}</p></div>)}</div>}

                                               <div className="mt-8 flex justify-end gap-3 flex-wrap">
                                                 <button onClick={() => resource && downloadBookingIcs(b, resource, users)} className="flex items-center space-x-2 text-xs font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-5 py-2.5 rounded-xl border border-emerald-100"><Download size={14}/><span>下载 ICS 日历</span></button>
                                                 {checkableBookings.some(item => item.id === b.id) && <button onClick={() => setShowQRScanner(true)} className={`flex items-center space-x-2 text-xs font-bold text-${theme}-600 bg-${theme}-50 hover:bg-${theme}-100 px-5 py-2.5 rounded-xl border border-${theme}-100`}><CheckCircle size={14}/><span>会议签到</span></button>}
                                                 {b.status === 'APPROVED' && b.checkedInAt && b.userId === currentUser.id && Date.now() >= new Date(b.startTime).getTime() && Date.now() < new Date(b.endTime).getTime() && <button onClick={() => handleEndEarly(b.id)} className="flex items-center space-x-2 text-xs font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 px-5 py-2.5 rounded-xl border border-amber-100"><LogOut size={14}/><span>提前结束并释放</span></button>}
                                                 {['PENDING', 'APPROVED'].includes(b.status) && b.userId === currentUser.id && <>
                                                        <button onClick={(e) => { e.stopPropagation(); if (!resource) return; setEditingBooking(b); setSelectedResource(resource); setCalendarDateForBooking(null); setBookingPrefill({ id: b.id, purpose: b.purpose, start: b.startTime, end: b.endTime, participants: b.participants, extras: { hasLeader: b.hasLeader, leaderDetails: b.leaderDetails, isVideoConference: b.isVideoConference, needsTeaService: b.needsTeaService, attendeeIds: b.attendeeIds || [] } }); setShowBookingModal(true); }} className="flex items-center space-x-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-5 py-2.5 rounded-xl transition-all border border-indigo-100"><Edit2 size={14}/><span>修改预约</span></button>
                                                        <button
                                                           onClick={(e) => { e.stopPropagation(); handleCancelBooking(b.id); }}
                                                           className="flex items-center space-x-2 text-xs font-bold text-rose-500 bg-rose-50 hover:bg-rose-100 px-5 py-2.5 rounded-xl transition-all border border-rose-100"
                                                       >
                                                           <Ban size={14} className="stroke-[2.5px]" />
                                                           <span>撤销此申请</span>
                                                       </button>
                                                 </>}
                                               </div>
                                           </div>
                                       )}
                                   </div>
                               );
                           })}
                       </div>

                       {/* Pagination Controls */}
                       {totalBookingPages > 1 && (
                           <div className="flex items-center justify-center space-x-2 mt-8">
                               <button 
                                   onClick={() => setBookingPage(p => Math.max(1, p - 1))}
                                   disabled={bookingPage === 1}
                                   className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                               >
                                   <ChevronLeft size={16}/>
                               </button>
                               <span className="text-xs font-bold text-gray-500 px-4">
                                   {bookingPage} / {totalBookingPages}
                               </span>
                               <button 
                                   onClick={() => setBookingPage(p => Math.min(totalBookingPages, p + 1))}
                                   disabled={bookingPage === totalBookingPages}
                                   className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                               >
                                   <ChevronRight size={16}/>
                               </button>
                           </div>
                       )}
                   </>
                 )}
             </div>
          )}

          {view === 'WORKFLOW_CONFIG' && (
             <div className="space-y-6 animate-in fade-in max-w-4xl">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">审批流程引擎</h3><p className="text-sm text-gray-500 mt-1">编排资源申请的流转节点及负责人。</p></div><button onClick={() => { setEditingWorkflowNode(null); setShowWorkflowModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增节点</span></button></div>
               <div className="space-y-4">
                 {workflow.map((node, index) => (
                   <div key={node.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-gray-200 transition-all">
                     <div className="flex items-center space-x-6">
                       <div className={`w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-black text-${theme}-600 border border-gray-100 shadow-inner`}>{index + 1}</div>
                       <div><h5 className="font-bold text-gray-800">{node.name}</h5><p className="text-xs text-gray-500 mt-1 font-medium">负责角色：{roles.find(r => r.id === node.approverRole)?.name}</p></div>
                     </div>
                     <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-all">
                       <button onClick={() => { const nw = [...workflow]; if(index > 0) { [nw[index], nw[index-1]] = [nw[index-1], nw[index]]; setWorkflow(nw); } }} disabled={index === 0} className="p-2 text-gray-500 hover:text-indigo-600 disabled:opacity-30"><ChevronUp size={16}/></button>
                       <button onClick={() => { const nw = [...workflow]; if(index < nw.length-1) { [nw[index], nw[index+1]] = [nw[index+1], nw[index]]; setWorkflow(nw); } }} disabled={index === workflow.length-1} className="p-2 text-gray-500 hover:text-indigo-600 disabled:opacity-30"><ChevronDown size={16}/></button>
                       <button onClick={() => { setEditingWorkflowNode(node); setShowWorkflowModal(true); }} className="p-2 text-gray-500 hover:text-indigo-600"><Edit2 size={16}/></button>
                       <button onClick={() => setWorkflow(workflow.filter(n => n.id !== node.id))} className="p-2 text-gray-500 hover:text-rose-500"><Trash2 size={16}/></button>
                     </div>
                   </div>
                 ))}
                 {workflow.length === 0 && <div className="p-20 text-center bg-white rounded-3xl border border-dashed text-gray-500 font-bold">暂无审批节点，流程将默认免审通过。</div>}
               </div>
             </div>
          )}

          {view === 'ROLES' && (
             <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">权限集管理</h3><p className="text-sm text-gray-500 mt-1">定义系统角色及其对应的业务职能。</p></div><button onClick={() => { setEditingRole(null); setShowRoleModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增角色集</span></button></div>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {roles.map(r => (
                   <div key={r.id} className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm relative group hover:border-gray-200 hover:shadow-md transition-all">
                     <div className={`w-12 h-12 rounded-2xl bg-${r.color}-50 flex items-center justify-center text-${r.color}-600 mb-6 shadow-inner`}><Shield size={24}/></div>
                     <h5 className="font-black text-xl text-gray-800">{r.name}</h5>
                     <p className="text-xs text-gray-500 mt-3 leading-relaxed font-medium">{r.description}</p>
                     <div className="mt-6 pt-6 border-t border-gray-50 flex justify-between items-center">
                       <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">ID: {r.id}</span>
                       <button onClick={() => { setEditingRole(r); setShowRoleModal(true); }} className="p-2 text-gray-500 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all"><Edit2 size={14}/></button>
                     </div>
                   </div>
                 ))}
               </div>
             </div>
          )}

          {view === 'DEPARTMENTS' && (
            <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">组织架构</h3><p className="text-sm text-gray-500 mt-1">管理企业部门层级结构。</p></div><div className="flex space-x-3"><button onClick={() => setShowImportModal('DEPARTMENTS')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50 transition-all"><Upload size={18}/> <span>批量导入</span></button><button onClick={() => { setEditingDepartment(null); setDepartmentParentId(null); setShowDepartmentModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增一级部门</span></button></div></div>
               <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm min-h-[400px]">
                  {departments.length === 0 ? (
                     <div className="text-center py-20 text-gray-500 font-bold">暂无部门数据，请先导入或添加。</div>
                  ) : (
                     <div className="space-y-4">
                       {departments.filter(d => !d.parentId).map(root => (
                          <DepartmentNode key={root.id} dept={root} allDepts={departments} theme={theme} onEdit={(d: any) => { setEditingDepartment(d); setShowDepartmentModal(true); }} onDelete={handleDeleteDepartment} onAddSub={(pid: string) => { setEditingDepartment(null); setDepartmentParentId(pid); setShowDepartmentModal(true); }} />
                       ))}
                     </div>
                  )}
               </div>
            </div>
          )}

          {view === 'WORK_ORDERS' && canAccessWorkOrders && (
            <div className="space-y-6 animate-in fade-in">
              <div><h3 className="text-2xl font-black text-gray-800">服务工单</h3><p className="text-sm text-gray-500 mt-1">已核准会议的茶水与视频会议保障需求，共 {openWorkOrderCount} 项待处理。</p></div>
              {visibleWorkOrders.length === 0 ? <div className="py-24 text-center bg-white rounded-3xl border border-dashed text-gray-500 font-bold"><Coffee size={40} className="mx-auto mb-4 opacity-30"/>暂无服务工单</div> : <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {visibleWorkOrders.map(order => {
                  const booking = bookings.find(b => b.id === order.bookingId);
                  const resource = resources.find(r => r.id === booking?.resourceId);
                  return <div key={order.id} className={`bg-white rounded-3xl p-6 border shadow-sm ${order.status === 'DONE' ? 'opacity-70' : ''}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3"><div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${order.type === 'TEA' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>{order.type === 'TEA' ? <Coffee size={20}/> : <Video size={20}/>}</div><div><p className="text-[11px] font-black text-gray-500 uppercase">{order.type === 'TEA' ? '行政 · 茶水服务' : 'IT · 视频会议'}</p><h4 className="font-black text-gray-800 mt-1">{order.title}</h4></div></div>
                      <span className={`shrink-0 px-2 py-1 rounded-lg text-[11px] font-bold ${order.status === 'DONE' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-600'}`}>{order.status === 'DONE' ? '已处理' : '待处理'}</span>
                    </div>
                    <div className="my-5 p-4 bg-gray-50 rounded-2xl text-xs text-gray-500 space-y-1"><p className="font-bold text-gray-700">{resource?.name || '未知资源'}</p><p>{booking ? `${toLocalDateTimeString(booking.startTime)} - ${toLocalTimeString(booking.endTime)}` : '关联预约已删除'}</p>{order.completedAt && <p>处理时间：{toLocalDateTimeString(order.completedAt)}</p>}</div>
                    {order.status === 'TODO' && <button onClick={() => handleCompleteWorkOrder(order.id)} className={`w-full py-3 rounded-xl bg-${theme}-600 text-white text-xs font-black flex items-center justify-center gap-2`}><CheckCircle size={15}/>标记已处理</button>}
                  </div>;
                })}
              </div>}
            </div>
          )}

          {view === 'REPORTS' && currentUser.role.includes('SYSTEM_ADMIN') && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div><h3 className="text-2xl font-black text-gray-800">利用率与审批效率</h3><p className="text-sm text-gray-500 mt-1">{formatDate(reportData.start)} 至 {formatDate(reportData.end)} · 使用率按每日 12 小时可预约容量计算</p></div>
                <div className="flex gap-2"><select aria-label="报表时间范围" value={reportRange} onChange={e => setReportRange(e.target.value as any)} className="px-4 py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold"><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="ALL">全部数据</option></select><button onClick={downloadReportCsv} className={`px-4 py-3 bg-${theme}-600 text-white rounded-xl text-xs font-black flex items-center gap-2`}><Download size={15}/>导出 CSV</button></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {[['预约数', reportData.overall.bookingCount, '单'], ['使用时长', reportData.overall.usageHours, '小时'], ['使用率', reportData.overall.utilization, '%'], ['取消率', reportData.overall.cancellationRate, '%'], ['No-show 率', reportData.overall.noShowRate, '%'], ['平均审批', reportData.overall.averageApprovalHours, '小时']].map(([label, value, unit]) => <div key={String(label)} className="bg-white p-5 rounded-3xl border border-gray-100"><p className="text-[11px] font-black text-gray-500">{label}</p><p className="text-2xl font-black text-gray-800 mt-2">{value}<span className="text-xs text-gray-500 ml-1">{unit}</span></p></div>)}
              </div>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-x-auto">
                <table className="w-full text-left min-w-[900px]">
                  <thead><tr className="bg-gray-50 text-[11px] font-black text-gray-500 uppercase">{['维度', '名称', '预约数', '使用小时', '使用率', '取消率', 'No-show率', '驳回率', '平均审批'].map(label => <th key={label} className="px-5 py-4">{label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-50">{reportData.rows.map(row => <tr key={`${row.dimension}-${row.id}`} className="text-xs text-gray-600"><td className="px-5 py-4"><span className={`px-2 py-1 rounded-lg font-bold ${row.dimension === 'RESOURCE' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>{row.dimension === 'RESOURCE' ? '资源' : '部门'}</span></td><td className="px-5 py-4 font-black text-gray-800">{row.name}</td><td className="px-5 py-4">{row.bookingCount}</td><td className="px-5 py-4">{row.usageHours}</td><td className="px-5 py-4 font-bold">{row.utilization}%</td><td className="px-5 py-4">{row.cancellationRate}%</td><td className="px-5 py-4">{row.noShowRate}%</td><td className="px-5 py-4">{row.rejectionRate}%</td><td className="px-5 py-4">{row.averageApprovalHours} 小时</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'DATA_CENTER' && (
             <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">数据中心</h3><p className="text-sm text-gray-500 mt-1">系统数据的备份、恢复与重置。</p></div></div>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:border-gray-200 transition-all">
                    <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-6"><Download size={32}/></div>
                    <h4 className="font-black text-xl text-gray-800">全量备份</h4>
                    <p className="text-gray-500 text-xs mt-2 mb-8 px-4 h-8">导出包含用户、资源、预约记录在内的所有数据为 JSON 文件。</p>
                    <button onClick={() => {
                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ users, resources, bookings, departments, roles, workflow }));
                      const downloadAnchorNode = document.createElement('a');
                      downloadAnchorNode.setAttribute("href", dataStr);
                      downloadAnchorNode.setAttribute("download", "smart_office_backup.json");
                      document.body.appendChild(downloadAnchorNode);
                      downloadAnchorNode.click();
                      downloadAnchorNode.remove();
                      addNotification("备份成功", "数据已导出至本地。", "SUCCESS");
                    }} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:translate-y-[-2px] transition-all">立即导出</button>
                 </div>

                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:border-gray-200 transition-all">
                    <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mb-6"><RefreshCw size={32}/></div>
                    <h4 className="font-black text-xl text-gray-800">数据恢复</h4>
                    <p className="text-gray-500 text-xs mt-2 mb-8 px-4 h-8">通过 JSON 备份文件还原系统状态。</p>
                    <button onClick={() => {
                       const input = document.createElement('input');
                       input.type = 'file';
                       input.accept = 'application/json';
                       input.onchange = (e: any) => {
                         const file = e.target.files[0];
                         const reader = new FileReader();
                         reader.onload = (event) => {
                           try {
                             const data = JSON.parse(event.target?.result as string);
                             if(data.users) setUsers(data.users);
                             if(data.resources) setResources(data.resources);
                             if(data.bookings) setBookings(migrateBookings(data.bookings));
                             if(data.departments) setDepartments(data.departments);
                             if(data.roles) setRoles(data.roles);
                             if(data.workflow) setWorkflow(data.workflow);
                             addNotification("恢复成功", "系统数据已重置为备份状态。", "SUCCESS");
                           } catch(err) { alert("文件格式错误"); }
                         };
                         reader.readAsText(file);
                       };
                       input.click();
                    }} className="w-full py-3 bg-white border-2 border-emerald-100 text-emerald-600 rounded-xl font-bold hover:bg-emerald-50 transition-all">导入备份</button>
                 </div>

                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:border-gray-200 transition-all">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-600 mb-6"><Trash2 size={32}/></div>
                    <h4 className="font-black text-xl text-gray-800">重置系统</h4>
                    <p className="text-gray-500 text-xs mt-2 mb-8 px-4 h-8">清空所有业务数据，恢复至出厂默认设置。</p>
                    <button onClick={() => {
                       if(confirm("警告：此操作不可逆！将清空所有用户产生的预约和配置，确定继续？")) {
                          localStorage.removeItem(STORAGE_KEY);
                          window.location.reload();
                       }
                    }} className="w-full py-3 bg-rose-50 text-rose-600 rounded-xl font-bold hover:bg-rose-100 transition-all">恢复出厂设置</button>
                 </div>
               </div>
             </div>
          )}
        </div>
      </main>

      {/* --- Modals --- */}
      {showDepartmentModal && (
        <DepartmentModal 
          department={editingDepartment} 
          parentId={departmentParentId} 
          theme={theme} 
          onClose={() => setShowDepartmentModal(false)} 
          onSave={handleSaveDepartment} 
        />
      )}

      {showQRScanner && (
        <QRScannerModal
          theme={theme}
          bookings={checkableBookings}
          resources={resources}
          onClose={() => setShowQRScanner(false)}
          onCheckIn={handleCheckIn}
        />
      )}

      {dayDetail && (
        <DayBookingDetailModal detail={dayDetail} users={users} resources={resources} theme={theme} onClose={() => setDayDetail(null)} />
      )}

      {showImportModal && (
        <BatchImportModal 
          type={showImportModal} 
          theme={theme} 
          existingDepartments={departments} 
          roles={roles}
          onClose={() => setShowImportModal(null)} 
          onImport={(data: any) => {
            if (showImportModal === 'USERS') setUsers(prev => [...prev, ...data]);
            else if (showImportModal === 'RESOURCES') setResources(prev => [...prev, ...data]);
            else if (showImportModal === 'DEPARTMENTS') setDepartments(prev => [...prev, ...data]);
            addNotification("导入成功", `已成功导入 ${data.length} 条数据。`, "SUCCESS");
            setShowImportModal(null);
          }} 
        />
      )}

      {showResourceCalendar && (
        <ResourceCalendarModal resource={showResourceCalendar} bookings={bookings} users={users} theme={theme} onClose={() => setShowResourceCalendar(null)} onSelectDate={(date: string) => { setCalendarDateForBooking(date); setEditingBooking(null); setBookingPrefill(null); setSelectedResource(showResourceCalendar); setShowResourceCalendar(null); setShowBookingModal(true); }} />
      )}

      {viewDetail && (
        <DetailViewModal viewDetail={viewDetail} theme={theme} roles={roles} users={users} bookings={bookings} onClose={() => setViewDetail(null)} />
      )}

      {showUserModal && <UserModal user={editingUser} departments={departments} roles={roles} onClose={() => setShowUserModal(false)} onSave={(data: any) => { if(editingUser) setUsers(users.map(u => u.id === editingUser.id ? {...u, ...data} : u)); else setUsers([...users, { id: 'u-'+Date.now(), ...data }]); setShowUserModal(false); addNotification("操作成功", "成员信息已更新。", "SUCCESS"); }} theme={theme} />}
      {showResourceModal && <ResourceModal resource={editingResource} onClose={() => setShowResourceModal(false)} onSave={(data: any) => { if(editingResource) setResources(resources.map(r => r.id === editingResource.id ? {...r, ...data} : r)); else setResources([...resources, { id: 'r-'+Date.now(), status: 'AVAILABLE', features: [], ...data }]); setShowResourceModal(false); addNotification("操作成功", "资源配置已保存。", "SUCCESS"); }} theme={theme} />}
      {showRoleModal && <RoleModal role={editingRole} onClose={() => setShowRoleModal(false)} onSave={(data: any) => { if(editingRole) setRoles(roles.map(r => r.id === editingRole.id ? {...r, ...data} : r)); else setRoles([...roles, { id: 'rl-'+Date.now(), ...data }]); setShowRoleModal(false); addNotification("操作成功", "角色集已更新。", "SUCCESS"); }} theme={theme} />}
      {showWorkflowModal && <WorkflowModal node={editingWorkflowNode} roles={roles} onClose={() => setShowWorkflowModal(false)} onSave={(data: any) => { if(editingWorkflowNode) setWorkflow(workflow.map(n => n.id === editingWorkflowNode.id ? {...n, ...data} : n)); else setWorkflow([...workflow, { id: 'wf-'+Date.now(), ...data }]); setShowWorkflowModal(false); addNotification("流程已更新", "审批链路配置已生效。", "SUCCESS"); }} theme={theme} />}
      
      {showBookingModal && selectedResource && (<BookingFormModal resource={selectedResource} theme={theme} initialDate={calendarDateForBooking} initialValues={bookingPrefill} onClose={() => { setShowBookingModal(false); setCalendarDateForBooking(null); setBookingPrefill(null); setEditingBooking(null); }} onConfirm={handleBooking} onResourceChange={setSelectedResource} availableResources={resources.filter(r => r.status === 'AVAILABLE')} availableUsers={users} currentUserId={currentUser.id} bookings={bookings} />)}

      {bookingConflict && (
        <BookingConflictModal 
          conflict={bookingConflict} 
          users={users} 
          theme={theme} 
          onClose={() => setBookingConflict(null)} 
          onApplySuggestion={(start: Date, end: Date) => { 
            if (selectedResource && bookingConflict) { 
              handleBooking(selectedResource.id, bookingConflict.purpose, start.toISOString(), end.toISOString(), bookingConflict.participants, bookingConflict.extras);
              setBookingConflict(null); 
            } 
          }} 
        />
      )}

      {recurringPlan && <RecurringConflictModal
        plan={recurringPlan}
        theme={theme}
        onSkip={(index: number) => setRecurringPlan({ ...recurringPlan, occurrences: recurringPlan.occurrences.map((o: any, i: number) => i === index ? { ...o, skip: true } : o) })}
        onReschedule={rescheduleRecurringOccurrence}
        onCreate={(occurrences: any[]) => saveBookingSeries(recurringPlan, occurrences)}
        onClose={() => setRecurringPlan(null)}
      />}
    </div>
  );
};

export default App;