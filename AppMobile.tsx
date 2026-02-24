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
  Save, RotateCcw, Phone, Ban, Video, CupSoda, Crown, Cloud, CloudOff,
  Home, ClipboardList, Settings, User, Wifi, WifiOff
} from 'lucide-react';
import { User as UserType, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, Department, RoleDefinition, ResourceStatus, Notification } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS, INITIAL_ROLES } from './constants';
import { getSmartRecommendation } from './services/geminiService';
import {
  getUsers, getResources, getBookings, getRoles, getDepartments, getWorkflow,
  createBooking, updateBooking, createResource, updateResource, deleteResource,
  createUser, updateUser, deleteUser, createRole, updateRole, deleteRole,
  createDepartment, updateDepartment, deleteDepartment, updateWorkflow as updateWorkflowDB,
  batchImportUsers, batchImportResources, batchImportDepartments,
  exportAllData, restoreAllData, subscribeToBookings, subscribeToResources,
  testConnection,
} from './services/supabaseService';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V35';
const THEME_KEY = 'SMART_OFFICE_THEME';

// 离线缓存键
const OFFLINE_CACHE_KEY = 'SMART_OFFICE_OFFLINE_CACHE';

// --- Theme Config ---
const THEMES = [
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-600', text: 'text-indigo-600', border: 'border-indigo-100', bg: 'bg-indigo-50', lightColor: '#4F46E5' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-100', bg: 'bg-emerald-50', lightColor: '#059669' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-600', text: 'text-orange-600', border: 'border-orange-100', bg: 'bg-orange-50', lightColor: '#EA580C' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-600', text: 'text-rose-600', border: 'border-rose-100', bg: 'bg-rose-50', lightColor: '#E11D48' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-600', text: 'text-purple-600', border: 'border-purple-100', bg: 'bg-purple-50', lightColor: '#7C3AED' },
];

// --- Helper Functions ---
const formatTime = (date: Date) => {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

const formatDate = (date: Date) => {
  return date.toISOString().split('T')[0];
};

const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()} ${formatTime(date)}`;
};

const findNextAvailableSlot = (resourceId: string, bookings: Booking[], durationMinutes: number) => {
  let pointer = new Date();
  pointer.setMinutes(Math.ceil(pointer.getMinutes() / 30) * 30, 0, 0); 
  
  const todayEnd = new Date(pointer);
  todayEnd.setHours(21, 0, 0, 0); 

  while (pointer < todayEnd) {
    const end = new Date(pointer.getTime() + durationMinutes * 60000);
    const hasConflict = bookings.some(b => {
      if (b.resourceId !== resourceId || b.status === 'REJECTED' || b.status === 'CANCELLED') return false;
      const bStart = new Date(b.startTime);
      const bEnd = new Date(b.endTime);
      return (pointer < bEnd && end > bStart);
    });

    if (!hasConflict) {
      return { start: new Date(pointer), end };
    }
    pointer = new Date(pointer.getTime() + 30 * 60000); 
  }
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return { start: tomorrow, end: new Date(tomorrow.getTime() + durationMinutes * 60000) };
};

// --- Mobile Components ---

const StatusBadge = ({ status, theme }: { status: string, theme: string }) => {
  const styles: any = { 
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100', 
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100', 
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100', 
    APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`, 
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100', 
    CANCELLED: 'bg-gray-100 text-gray-400 border-gray-200 line-through',
    COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200',
    MAINTENANCE: 'bg-gray-50 text-gray-500 border-gray-200'
  };
  const labels: any = { 
    AVAILABLE: '空闲', PENDING: '审批中', APPROVED: '已通过', REJECTED: '驳回', 
    OCCUPIED: '占用', CANCELLED: '已撤销', COMPLETED: '结束', MAINTENANCE: '维护中' 
  };
  return <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status] || styles.PENDING}`}>{labels[status] || status}</span>;
};

const RoleTag = ({ roleId, roles, theme }: any) => {
  const role = roles.find((r: any) => r.id === roleId);
  if (!role) return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-400">未知</span>;
  return <span className={`px-2 py-0.5 rounded text-[9px] font-bold bg-${role.color}-100 text-${role.color}-700 border border-${role.color}-200`}>{role.name}</span>;
};

// --- Mobile Login View ---
const LoginView = ({ users, onLogin, theme, isLoading }: any) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      {/* Header */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className={`w-20 h-20 bg-${theme}-600 rounded-3xl flex items-center justify-center text-white shadow-xl mb-6`}>
          <Cpu size={40} />
        </div>
        <h1 className="text-2xl font-black text-gray-800 tracking-tight">SmartOffice</h1>
        <p className="text-gray-400 font-medium mt-2 text-sm">智慧办公空间管理</p>
      </div>

      {/* User Selection */}
      <div className="bg-white rounded-t-[2.5rem] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] p-6 pb-8">
        <h2 className="text-lg font-bold text-gray-800 mb-4">选择账号登录</h2>
        
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-8">
            <div className={`w-8 h-8 border-2 border-${theme}-600 border-t-transparent rounded-full animate-spin mb-3`}></div>
            <p className="text-sm text-gray-400">正在加载用户数据...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users size={24} className="text-gray-400" />
            </div>
            <p className="text-gray-500 font-medium mb-2">暂无用户数据</p>
            <p className="text-xs text-gray-400 mb-4">请先在 Supabase 中添加用户数据</p>
            <div className="bg-gray-50 rounded-xl p-4 text-left text-xs text-gray-500">
              <p className="font-bold mb-2">SQL 示例：</p>
              <code className="block bg-gray-100 p-2 rounded text-[10px] overflow-x-auto">
                INSERT INTO smartoffice_users (name, email, role, department) <br/>
                VALUES ('管理员', 'admin@company.com', ARRAY['SYSTEM_ADMIN'], 'IT部');
              </code>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((u: any) => (
              <button 
                key={u.id} 
                onClick={() => onLogin(u)} 
                className="w-full p-4 flex items-center space-x-4 rounded-2xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all group text-left active:scale-[0.98]"
              >
                <div className={`w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center font-black text-gray-400 group-hover:bg-indigo-200 group-hover:text-indigo-600 transition-colors text-lg`}>
                  {u.name[0]}
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-gray-800">{u.name}</h4>
                  <p className="text-xs text-gray-400">{u.role?.join(', ') || '员工'}</p>
                </div>
                <ChevronRight size={20} className="text-gray-300" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Mobile Bottom Navigation ---
const BottomNav = ({ activeTab, onTabChange, theme, pendingCount }: any) => {
  const tabs = [
    { id: 'DASHBOARD', icon: Home, label: '首页' },
    { id: 'RESOURCES', icon: MapPin, label: '资源' },
    { id: 'BOOKINGS', icon: Calendar, label: '我的' },
    { id: 'APPROVAL_CENTER', icon: ClipboardList, label: '审批', badge: pendingCount },
    { id: 'PROFILE', icon: User, label: '我的' },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-2 pb-safe z-50">
      <div className="flex items-center justify-around h-16">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center flex-1 h-full relative ${isActive ? `text-${theme}-600` : 'text-gray-400'}`}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                {tab.badge > 0 && (
                  <span className="absolute -top-1 -right-2 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-1 font-medium ${isActive ? 'font-bold' : ''}`}>{tab.label}</span>
              {isActive && (
                <div className={`absolute -bottom-0 w-8 h-1 bg-${theme}-600 rounded-full`} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// --- Mobile Stat Card ---
const MobileStatCard = ({ title, value, icon: Icon, color, onClick }: any) => (
  <button onClick={onClick} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-3 active:scale-[0.98] transition-transform">
    <div className={`w-10 h-10 rounded-xl bg-${color}-50 flex items-center justify-center text-${color}-600`}>
      <Icon size={20} />
    </div>
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase">{title}</p>
      <h3 className="text-lg font-black text-gray-800">{value}</h3>
    </div>
  </button>
);

// --- Mobile Resource Card ---
const MobileResourceCard = ({ resource, theme, onBook, onViewCalendar }: any) => (
  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center space-x-3">
        <div className={`w-10 h-10 rounded-xl ${resource.type === 'ROOM' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'} flex items-center justify-center`}>
          {resource.type === 'ROOM' ? <Monitor size={20} /> : <Coffee size={20} />}
        </div>
        <div>
          <h4 className="font-bold text-gray-800 text-sm">{resource.name}</h4>
          <p className="text-[10px] text-gray-400">{resource.location}</p>
        </div>
      </div>
      <StatusBadge status={resource.status} theme={theme} />
    </div>
    
    <div className="flex items-center justify-between text-[10px] text-gray-500 mb-3">
      <span>容量: {resource.capacity || 1}人</span>
      <span>{resource.features?.slice(0, 2).join(' · ') || '标准配置'}</span>
    </div>

    <div className="flex space-x-2">
      <button 
        onClick={() => onBook(resource)}
        className={`flex-1 py-2.5 bg-${theme}-600 text-white rounded-xl font-bold text-xs shadow-md active:scale-[0.98] transition-transform`}
      >
        立即预约
      </button>
      {resource.type === 'DESK' && (
        <button 
          onClick={() => onViewCalendar(resource)}
          className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl font-bold text-xs active:scale-[0.98] transition-transform"
        >
          <CalendarDays size={16} />
        </button>
      )}
    </div>
  </div>
);

// --- Mobile Booking Card ---
const MobileBookingCard = ({ booking, resource, theme, onCancel, expanded, onToggle }: any) => {
  const isExpanded = expanded;
  
  return (
    <div className={`bg-white rounded-2xl border transition-all duration-300 overflow-hidden ${isExpanded ? 'shadow-lg border-indigo-100' : 'shadow-sm border-gray-100'}`}>
      <div 
        onClick={onToggle}
        className="p-4 cursor-pointer flex items-center justify-between active:bg-gray-50 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-xl ${booking.type === 'ROOM' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'} flex items-center justify-center`}>
            {booking.type === 'ROOM' ? <Monitor size={18} /> : <Briefcase size={18} />}
          </div>
          <div>
            <h4 className="font-bold text-gray-800 text-sm line-clamp-1">{booking.purpose}</h4>
            <div className="flex items-center space-x-2 mt-0.5">
              <span className="text-[10px] font-medium text-gray-400">{resource?.name || '未知资源'}</span>
              <span className="text-[10px] text-gray-300">·</span>
              <span className="text-[10px] font-medium text-gray-400">{booking.startTime.split('T')[0]}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <StatusBadge status={booking.status} theme={theme} />
          <ChevronDown size={16} className={`text-gray-300 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-50 animate-in slide-in-from-top-2 fade-in">
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">时间段</span>
              <span className="font-bold text-gray-700">
                {booking.startTime.replace('T', ' ').slice(0, 16)} - {booking.endTime.split('T')[1].slice(0, 5)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">参与人数</span>
              <span className="font-bold text-gray-700">{booking.participants || 1} 人</span>
            </div>
            {(booking.hasLeader || booking.isVideoConference || booking.needsTeaService) && (
              <div className="flex flex-wrap gap-2 pt-2">
                {booking.hasLeader && (
                  <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-bold border border-amber-100 flex items-center">
                    <Crown size={10} className="mr-1"/> 领导参会
                  </span>
                )}
                {booking.isVideoConference && (
                  <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold border border-indigo-100 flex items-center">
                    <Video size={10} className="mr-1"/> 视频会议
                  </span>
                )}
                {booking.needsTeaService && (
                  <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold border border-emerald-100 flex items-center">
                    <CupSoda size={10} className="mr-1"/> 茶水服务
                  </span>
                )}
              </div>
            )}
          </div>

          {['PENDING', 'APPROVED'].includes(booking.status) && (
            <button 
              onClick={(e) => { e.stopPropagation(); onCancel(booking.id); }}
              className="w-full py-2.5 bg-rose-50 text-rose-600 rounded-xl font-bold text-xs border border-rose-100 active:scale-[0.98] transition-transform"
            >
              撤销申请
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// --- Mobile Approval Card ---
const MobileApprovalCard = ({ booking, resource, user, workflow, theme, onApprove, onReject }: any) => (
  <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
    <div className="flex items-start space-x-3 mb-3">
      <div className={`w-10 h-10 rounded-full bg-${theme}-100 flex items-center justify-center text-${theme}-600 font-bold text-sm shrink-0`}>
        {user?.name?.[0] || '?'}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-bold text-gray-800 text-sm line-clamp-1">{user?.name} 申请 {resource?.name}</h4>
        <p className="text-[10px] text-gray-400 mt-0.5">{booking.startTime.replace('T', ' ')} 至 {booking.endTime.replace('T', ' ')}</p>
        <p className="text-[10px] text-gray-500 mt-1 line-clamp-1">{booking.purpose}</p>
      </div>
    </div>

    {(booking.hasLeader || booking.isVideoConference || booking.needsTeaService) && (
      <div className="flex flex-wrap gap-2 mb-3">
        {booking.hasLeader && (
          <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-lg text-[10px] font-bold border border-amber-100 flex items-center">
            <Crown size={10} className="mr-1"/> 领导: {booking.leaderDetails}
          </span>
        )}
        {booking.isVideoConference && (
          <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold border border-indigo-100 flex items-center">
            <Video size={10} className="mr-1"/> 视频会议
          </span>
        )}
        {booking.needsTeaService && (
          <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold border border-emerald-100 flex items-center">
            <CupSoda size={10} className="mr-1"/> 茶水
          </span>
        )}
      </div>
    )}

    <div className="flex space-x-2">
      <button 
        onClick={() => onReject('不符合规定')}
        className="flex-1 py-2.5 border border-gray-200 text-gray-500 rounded-xl font-bold text-xs active:scale-[0.98] transition-transform"
      >
        驳回
      </button>
      <button 
        onClick={onApprove}
        className={`flex-1 py-2.5 bg-${theme}-600 text-white rounded-xl font-bold text-xs shadow-md active:scale-[0.98] transition-transform`}
      >
        通过
      </button>
    </div>
  </div>
);

// --- Mobile Booking Form Modal ---
const MobileBookingFormModal = ({ resource, theme, initialDate, onClose, onConfirm, availableResources, bookings = [] }: any) => {
  const isRoom = resource.type === 'ROOM';
  const initialDateObj = initialDate ? new Date(initialDate) : new Date();
  
  const [selectedDate, setSelectedDate] = useState(initialDateObj);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{start: string | null, end: string | null}>({ 
    start: isRoom ? null : '09:00', 
    end: isRoom ? null : '18:00' 
  });
  const [deskEndDate, setDeskEndDate] = useState(initialDateObj);
  
  const [purpose, setPurpose] = useState('');
  const [participants, setParticipants] = useState(resource.capacity || 1);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState('');

  const [hasLeader, setHasLeader] = useState(false);
  const [leaderDetails, setLeaderDetails] = useState('');
  const [isVideoConference, setIsVideoConference] = useState(false);
  const [needsTeaService, setNeedsTeaService] = useState(false);

  const dateOptions = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);

  const timeSlots = useMemo(() => {
    const slots = [];
    for(let h=8; h<20; h++) {
        slots.push(`${String(h).padStart(2,'0')}:00`);
        slots.push(`${String(h).padStart(2,'0')}:30`);
    }
    return slots;
  }, []);

  const isSlotBooked = (time: string) => {
    const slotStart = new Date(`${formatDate(selectedDate)}T${time}`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
    
    return bookings.some((b: any) => {
        if (b.resourceId !== resource.id || ['REJECTED', 'CANCELLED'].includes(b.status)) return false;
        const bStart = new Date(b.startTime);
        const bEnd = new Date(b.endTime);
        return (slotStart < bEnd && slotEnd > bStart);
    });
  };

  const handleTimeClick = (time: string) => {
    if (isSlotBooked(time)) return;
    
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
                alert("选择的时间段内包含已被占用的时段，请重新选择。");
                setSelectedTimeRange({ start: time, end: null });
            } else {
                setSelectedTimeRange({ start, end: time });
            }
        }
    }
  };

  const handleSmartRecommend = async () => {
    if (!purpose) return;
    setLoadingAI(true);
    const suggestion = await getSmartRecommendation(purpose, participants, availableResources);
    setAiSuggestion(suggestion);
    setLoadingAI(false);
  };

  const handleSubmit = () => {
    let finalStart, finalEnd;

    if (isRoom) {
        if (!selectedTimeRange.start || !selectedTimeRange.end) {
            alert("请选择开始和结束时间");
            return;
        }
        finalStart = `${formatDate(selectedDate)}T${selectedTimeRange.start}:00`;
        finalEnd = `${formatDate(selectedDate)}T${selectedTimeRange.end}:00`;
    } else {
        finalStart = `${formatDate(selectedDate)}T09:00:00`;
        finalEnd = `${formatDate(deskEndDate)}T18:00:00`;
        if (new Date(deskEndDate) < new Date(selectedDate)) {
             alert("结束日期必须晚于开始日期");
             return;
        }
    }

    onConfirm(resource.id, purpose, finalStart, finalEnd, participants, {
        hasLeader,
        leaderDetails: hasLeader ? leaderDetails : undefined,
        isVideoConference,
        needsTeaService
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
    <div className="fixed inset-0 z-[200] bg-black/50 flex flex-col">
      {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center justify-between shrink-0">
        <button onClick={onClose} className="p-2 -ml-2 text-gray-400">
          <ChevronLeft size={24} />
        </button>
        <h3 className="font-bold text-gray-800">预约 {resource.name}</h3>
        <div className="w-8" />
      </div>

      {/* Content */}
      <div className="flex-1 bg-gray-50 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Purpose & AI */}
          <div className="bg-white p-4 rounded-2xl border border-gray-100">
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 block">申请用途</label>
            <div className="flex space-x-2">
              <input 
                value={purpose} 
                onChange={e => setPurpose(e.target.value)} 
                placeholder="会议主题或办公内容..." 
                className="flex-1 bg-gray-50 p-3 rounded-xl border-none outline-none font-bold text-sm" 
              />
              <button 
                onClick={handleSmartRecommend} 
                disabled={loadingAI || !purpose}
                className={`px-4 bg-${theme}-50 text-${theme}-600 rounded-xl font-bold flex items-center justify-center disabled:opacity-50`}
              >
                {loadingAI ? <RefreshCw size={18} className="animate-spin" /> : <Zap size={18}/>}
              </button>
            </div>
            {aiSuggestion && (
              <div className={`mt-3 p-3 rounded-xl bg-${theme}-50 text-${theme}-700 text-xs border border-${theme}-100`}>
                <strong>AI 建议：</strong> {aiSuggestion}
              </div>
            )}
          </div>

          {/* Date Picker */}
          <div className="bg-white p-4 rounded-2xl border border-gray-100">
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-3 block">选择日期</label>
            <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
              {dateOptions.map((d) => {
                const isSelected = formatDate(d) === formatDate(selectedDate);
                const dayName = ['日','一','二','三','四','五','六'][d.getDay()];
                return (
                  <button 
                    key={d.toISOString()}
                    onClick={() => { setSelectedDate(d); setSelectedTimeRange({start:null,end:null}); }}
                    className={`flex flex-col items-center justify-center w-14 h-16 rounded-xl border-2 transition-all shrink-0 ${isSelected ? `bg-${theme}-600 border-${theme}-600 text-white shadow-md` : 'bg-white border-gray-100 text-gray-400'}`}
                  >
                    <span className="text-[10px] opacity-80">周{dayName}</span>
                    <span className="text-lg font-black leading-none mt-1">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time Slots */}
          {isRoom ? (
            <div className="bg-white p-4 rounded-2xl border border-gray-100">
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-3 block flex justify-between">
                <span>选择时段</span>
                {selectedTimeRange.start && selectedTimeRange.end && (
                  <span className={`text-${theme}-600`}>{selectedTimeRange.start} - {selectedTimeRange.end}</span>
                )}
              </label>
              <div className="grid grid-cols-4 gap-2">
                {timeSlots.map(time => {
                  const booked = isSlotBooked(time);
                  const selected = isSlotSelected(time);
                  const inRange = isSlotInRange(time);
                  return (
                    <button
                      key={time}
                      onClick={() => handleTimeClick(time)}
                      disabled={booked}
                      className={`py-2 rounded-lg text-xs font-bold transition-all ${
                        booked ? 'bg-gray-100 text-gray-300 line-through' :
                        selected ? `bg-${theme}-600 text-white shadow-md` :
                        inRange ? `bg-${theme}-50 text-${theme}-600` :
                        'bg-gray-50 text-gray-600'
                      }`}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bg-white p-4 rounded-2xl border border-gray-100">
              <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 block">结束日期</label>
              <input 
                type="date" 
                value={formatDate(deskEndDate)} 
                onChange={e => setDeskEndDate(new Date(e.target.value))} 
                className="w-full bg-gray-50 p-3 rounded-xl border-none outline-none font-bold text-sm" 
              />
            </div>
          )}

          {/* Participants */}
          <div className="bg-white p-4 rounded-2xl border border-gray-100">
            <label className="text-[10px] font-bold text-gray-400 uppercase mb-2 block">参与人数</label>
            <input 
              type="number" 
              min="1" 
              value={participants} 
              onChange={e => setParticipants(parseInt(e.target.value))} 
              className="w-full bg-gray-50 p-3 rounded-xl border-none outline-none font-bold text-sm" 
            />
          </div>

          {/* Additional Options */}
          <div className="bg-white p-4 rounded-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-600 flex items-center space-x-2">
                <Crown size={14} className="text-amber-500"/> 
                <span>领导参会</span>
              </label>
              <button 
                onClick={() => setHasLeader(!hasLeader)} 
                className={`w-12 h-7 rounded-full p-1 transition-all ${hasLeader ? `bg-${theme}-600` : 'bg-gray-200'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-all ${hasLeader ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {hasLeader && (
              <input 
                value={leaderDetails} 
                onChange={e => setLeaderDetails(e.target.value)} 
                placeholder="请输入参会领导姓名或职位..." 
                className="w-full p-3 bg-gray-50 rounded-xl border border-gray-200 text-sm outline-none" 
              />
            )}

            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-600 flex items-center space-x-2">
                <Video size={14} className="text-indigo-500"/> 
                <span>视频会议</span>
              </label>
              <button 
                onClick={() => setIsVideoConference(!isVideoConference)} 
                className={`w-12 h-7 rounded-full p-1 transition-all ${isVideoConference ? `bg-${theme}-600` : 'bg-gray-200'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-all ${isVideoConference ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-600 flex items-center space-x-2">
                <CupSoda size={14} className="text-emerald-500"/> 
                <span>茶水服务</span>
              </label>
              <button 
                onClick={() => setNeedsTeaService(!needsTeaService)} 
                className={`w-12 h-7 rounded-full p-1 transition-all ${needsTeaService ? `bg-${theme}-600` : 'bg-gray-200'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-all ${needsTeaService ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-white p-4 border-t border-gray-100 shrink-0 safe-area-bottom">
        <button 
          onClick={handleSubmit}
          className={`w-full py-3.5 bg-${theme}-600 text-white rounded-xl font-bold shadow-lg active:scale-[0.98] transition-transform`}
        >
          确认预约
        </button>
      </div>
    </div>
  );
};

// --- Mobile QR Scanner ---
const MobileQRScanner = ({ theme, onClose, onScanSuccess }: any) => {
  const [scanning, setScanning] = useState(false);

  const simulateScan = () => {
    setScanning(true);
    setTimeout(() => {
      onScanSuccess("签到成功！");
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black flex flex-col">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between">
        <button onClick={onClose} className="p-2 bg-black/50 backdrop-blur rounded-full text-white">
          <ChevronLeft size={24} />
        </button>
        <span className="text-white font-bold">扫码签到</span>
        <div className="w-10" />
      </div>

      {/* Scanner Area */}
      <div className="flex-1 flex items-center justify-center relative">
        <div className="relative w-64 h-64">
          {/* Corner Markers */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
          
          {/* Scan Line */}
          <div className={`absolute left-0 right-0 h-0.5 bg-${theme}-500 shadow-[0_0_15px_rgba(16,185,129,0.8)] animate-scan`} />
        </div>
        
        <p className="absolute bottom-32 text-white/70 text-sm">将二维码放入框内即可自动扫描</p>
      </div>

      {/* Footer */}
      <div className="p-6 pb-safe">
        <button 
          onClick={simulateScan}
          disabled={scanning}
          className={`w-full py-4 bg-${theme}-600 text-white rounded-xl font-bold shadow-lg disabled:opacity-50 flex items-center justify-center space-x-2`}
        >
          {scanning ? <RefreshCw size={20} className="animate-spin" /> : <QrCode size={20} />}
          <span>{scanning ? '扫描中...' : '模拟扫描'}</span>
        </button>
      </div>

      <style>{`
        @keyframes scan {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

// --- Mobile Profile View ---
const MobileProfileView = ({ currentUser, users, roles, theme, onLogout, onViewChange }: any) => {
  const myBookingsCount = users.filter((u: any) => u.id === currentUser?.id).length;
  
  const menuItems = [
    { icon: Users, label: '成员中心', action: () => onViewChange('USERS'), adminOnly: true },
    { icon: Shield, label: '角色管理', action: () => onViewChange('ROLES'), adminOnly: true },
    { icon: Building2, label: '部门管理', action: () => onViewChange('DEPARTMENTS'), adminOnly: true },
    { icon: GitMerge, label: '流程配置', action: () => onViewChange('WORKFLOW_CONFIG'), adminOnly: true },
    { icon: Database, label: '数据中心', action: () => onViewChange('DATA_CENTER'), adminOnly: true },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header Card */}
      <div className={`bg-${theme}-600 text-white p-6 pb-8`}>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold">个人中心</h1>
          <button onClick={onLogout} className="p-2 bg-white/20 rounded-full">
            <LogOut size={18} />
          </button>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center text-2xl font-bold">
            {currentUser?.name?.[0]}
          </div>
          <div>
            <h2 className="text-xl font-bold">{currentUser?.name}</h2>
            <p className="text-white/70 text-sm">{currentUser?.email}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {currentUser?.role?.map((rid: string) => (
                <span key={rid} className="px-2 py-0.5 bg-white/20 rounded text-[10px]">
                  {roles.find((r: any) => r.id === rid)?.name || rid}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 -mt-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex justify-around">
          <div className="text-center">
            <p className="text-xl font-black text-gray-800">{currentUser?.department}</p>
            <p className="text-[10px] text-gray-400">所属部门</p>
          </div>
          <div className="w-px bg-gray-100" />
          <div className="text-center">
            <p className="text-xl font-black text-gray-800">{currentUser?.mobile || '-'}</p>
            <p className="text-[10px] text-gray-400">联系电话</p>
          </div>
        </div>
      </div>

      {/* Admin Menu */}
      {currentUser?.role?.includes('SYSTEM_ADMIN') && (
        <div className="px-4 mt-6">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 ml-1">系统管理</h3>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {menuItems.filter(item => !item.adminOnly || currentUser?.role?.includes('SYSTEM_ADMIN')).map((item, index) => (
              <button
                key={item.label}
                onClick={item.action}
                className={`w-full flex items-center justify-between p-4 ${index !== 0 ? 'border-t border-gray-50' : ''} active:bg-gray-50`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-lg bg-${theme}-50 flex items-center justify-center text-${theme}-600`}>
                    <item.icon size={16} />
                  </div>
                  <span className="font-bold text-gray-700 text-sm">{item.label}</span>
                </div>
                <ChevronRight size={18} className="text-gray-300" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Theme Selection */}
      <div className="px-4 mt-6">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-3 ml-1">主题风格</h3>
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center justify-between">
            {THEMES.map(t => (
              <button 
                key={t.id} 
                onClick={() => {}} 
                title={t.name}
                className={`w-10 h-10 rounded-full ${t.color} border-2 transition-all ${theme === t.id ? 'border-gray-800 scale-110 shadow-md' : 'border-transparent'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main Mobile App Component ---
const AppMobile: React.FC = () => {
  const [activeTab, setActiveTab] = useState('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'indigo');
  
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');

  const [roles, setRoles] = useState<RoleDefinition[]>(INITIAL_ROLES);
  const [users, setUsers] = useState<UserType[]>(INITIAL_USERS);
  const [resources, setResources] = useState<Resource[]>(INITIAL_RESOURCES);
  const [bookings, setBookings] = useState<Booking[]>(INITIAL_BOOKINGS);
  const [departments, setDepartments] = useState<Department[]>(INITIAL_DEPARTMENTS);
  const [workflow, setWorkflow] = useState<ApprovalNode[]>(DEFAULT_WORKFLOW);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [expandedBookingIds, setExpandedBookingIds] = useState<Set<string>>(new Set());
  const [bookingConflict, setBookingConflict] = useState<any>(null);

  // 从 Supabase 加载初始数据
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        setSaveStatus('saving');
        
        // 首先测试连接
        const isConnected = await testConnection();
        if (!isConnected) {
          throw new Error('无法连接到 Supabase');
        }
        
        const [usersData, resourcesData, bookingsData, rolesData, departmentsData, workflowData] = await Promise.all([
          getUsers(),
          getResources(),
          getBookings(),
          getRoles(),
          getDepartments(),
          getWorkflow(),
        ]);

        setUsers(usersData);
        setResources(resourcesData);
        setBookings(bookingsData);
        setRoles(rolesData);
        setDepartments(departmentsData);
        setWorkflow(workflowData);
        
        setIsOnline(true);
        setSaveStatus('saved');
      } catch (error) {
        console.error('从 Supabase 加载数据失败:', error);
        // 尝试从本地缓存加载，如果没有缓存则使用默认数据
        const cached = localStorage.getItem(OFFLINE_CACHE_KEY);
        if (cached) {
          const data = JSON.parse(cached);
          setUsers(data.users || INITIAL_USERS);
          setResources(data.resources || INITIAL_RESOURCES);
          setBookings(data.bookings || INITIAL_BOOKINGS);
          setRoles(data.roles || INITIAL_ROLES);
          setDepartments(data.departments || INITIAL_DEPARTMENTS);
          setWorkflow(data.workflow || DEFAULT_WORKFLOW);
        } else {
          // 使用默认数据
          setUsers(INITIAL_USERS);
          setResources(INITIAL_RESOURCES);
          setBookings(INITIAL_BOOKINGS);
          setRoles(INITIAL_ROLES);
          setDepartments(INITIAL_DEPARTMENTS);
          setWorkflow(DEFAULT_WORKFLOW);
        }
        setIsOnline(false);
        setSaveStatus('error');
        addNotification('离线模式', '无法连接到服务器，使用默认数据', 'WARNING');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // 订阅实时更新
  useEffect(() => {
    if (!isOnline) return;

    const bookingsSubscription = subscribeToBookings((newBookings) => {
      setBookings(newBookings);
    });

    const resourcesSubscription = subscribeToResources((newResources) => {
      setResources(newResources);
    });

    return () => {
      bookingsSubscription.unsubscribe();
      resourcesSubscription.unsubscribe();
    };
  }, [isOnline]);

  // 离线缓存
  useEffect(() => {
    const data = { roles, users, resources, bookings, departments, workflow };
    localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(THEME_KEY, theme);
  }, [roles, users, resources, bookings, departments, workflow, theme]);

  const addNotification = (title: string, content: string, type: 'INFO' | 'SUCCESS' | 'WARNING' = 'INFO') => {
    const newNotif: Notification = { id: Date.now().toString(), userId: currentUser?.id || 'sys', title, content, timestamp: new Date().toISOString(), isRead: false, type };
    setNotifications(prev => [newNotif, ...prev].slice(0, 3));
    setTimeout(() => { setNotifications(prev => prev.filter(n => n.id !== newNotif.id)); }, 3000);
  };

  const canApprove = (booking: Booking) => booking.status === 'PENDING' && currentUser?.role.includes(workflow[booking.currentNodeIndex]?.approverRole);
  const pendingCount = bookings.filter(b => canApprove(b)).length;

  const stats = useMemo(() => {
    const totalResources = resources.length;
    const availableRooms = resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length;
    const availableDesks = resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length;
    const activeBookings = bookings.filter(b => b.status === 'APPROVED').length;
    return { totalResources, availableRooms, availableDesks, activeBookings };
  }, [resources, bookings]);

  const filteredResources = resources.filter(r => 
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    r.location.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const myBookings = useMemo(() => {
    return bookings
      .filter(b => b.userId === currentUser?.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [bookings, currentUser]);

  const toggleBookingExpand = (id: string) => {
    const next = new Set(expandedBookingIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedBookingIds(next);
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

    if (start < now && resource.type === 'ROOM') {
      const suggestion = findNextAvailableSlot(resourceId, bookings, requestedDuration);
      setBookingConflict({ 
        resource, 
        requestedStart: startTime, 
        requestedEnd: endTime, 
        purpose,
        resourceBookings: bookings.filter(b => b.resourceId === resourceId && b.status !== 'REJECTED' && b.status !== 'CANCELLED'), 
        errorType: 'PAST_TIME', 
        suggestion 
      });
      return;
    }

    const conflict = bookings.find(b => 
       b.resourceId === resourceId && 
       (b.status === 'APPROVED' || b.status === 'PENDING') && 
       (start < new Date(b.endTime) && end > new Date(b.startTime))
    );

    if (conflict) {
      const suggestion = findNextAvailableSlot(resourceId, bookings, requestedDuration);
      setBookingConflict({ 
        resource, 
        requestedStart: startTime, 
        requestedEnd: endTime, 
        purpose,
        resourceBookings: bookings.filter(b => b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING')), 
        errorType: 'CONFLICT', 
        suggestion 
      });
      return;
    }

    const newBooking: Omit<Booking, 'id'> = { 
      userId: currentUser.id, 
      resourceId, 
      type: resource.type, 
      startTime, 
      endTime, 
      status: workflow.length === 0 ? 'APPROVED' : 'PENDING', 
      purpose, 
      participants: participants || 1, 
      createdAt: new Date().toISOString(), 
      currentNodeIndex: 0, 
      approvalHistory: [],
      ...extras
    };

    try {
      setSaveStatus('saving');
      const createdBooking = await createBooking(newBooking);
      setBookings(prev => [createdBooking, ...prev]);
      setShowBookingModal(false);
      addNotification("预约申请已提交", `资源 ${resource.name} 的预约已进入审批流程。`, "SUCCESS");
      setSaveStatus('saved');
    } catch (error) {
      console.error('创建预约失败:', error);
      addNotification("预约失败", "网络错误，请稍后重试", "WARNING");
      setSaveStatus('error');
    }
  };

  const handleCancelBooking = async (id: string) => {
    if (confirm("确定要撤销此项预约申请吗？")) {
      try {
        setSaveStatus('saving');
        const updatedBooking = await updateBooking(id, { status: 'CANCELLED' });
        setBookings(prev => prev.map(b => b.id === id ? updatedBooking : b));
        addNotification("申请已撤销", "相关资源已释放。", "SUCCESS");
        setSaveStatus('saved');
      } catch (error) {
        console.error('撤销预约失败:', error);
        addNotification("操作失败", "网络错误，请稍后重试", "WARNING");
        setSaveStatus('error');
      }
    }
  };

  const handleApprove = async (booking: Booking) => {
    try {
      setSaveStatus('saving');
      const isLast = booking.currentNodeIndex === workflow.length - 1;
      const updatedBooking = await updateBooking(booking.id, {
        currentNodeIndex: isLast ? booking.currentNodeIndex : booking.currentNodeIndex + 1,
        status: isLast ? 'APPROVED' : 'PENDING',
        approvalHistory: [...booking.approvalHistory, { 
          nodeName: workflow[booking.currentNodeIndex].name, 
          approverName: currentUser?.name || '未知', 
          status: 'APPROVED', 
          timestamp: new Date().toISOString() 
        }]
      });
      setBookings(prev => prev.map(b => b.id === booking.id ? updatedBooking : b));
      addNotification("审批完成", isLast ? "申请已通过最终核准。" : "申请已通过本环节预审。", "SUCCESS");
      setSaveStatus('saved');
    } catch (error) {
      console.error('审批失败:', error);
      addNotification("审批失败", "网络错误，请稍后重试", "WARNING");
      setSaveStatus('error');
    }
  };

  const handleReject = async (booking: Booking, comment: string) => {
    try {
      setSaveStatus('saving');
      const updatedBooking = await updateBooking(booking.id, {
        status: 'REJECTED',
        approvalHistory: [...booking.approvalHistory, { 
          nodeName: workflow[booking.currentNodeIndex].name, 
          approverName: currentUser?.name || '未知', 
          status: 'REJECTED', 
          comment, 
          timestamp: new Date().toISOString() 
        }]
      });
      setBookings(prev => prev.map(b => b.id === booking.id ? updatedBooking : b));
      addNotification("申请已驳回", "您驳回了该项资源预约申请。", "INFO");
      setSaveStatus('saved');
    } catch (error) {
      console.error('驳回失败:', error);
      addNotification("操作失败", "网络错误，请稍后重试", "WARNING");
      setSaveStatus('error');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
        <div className={`w-16 h-16 bg-${theme}-600 rounded-2xl flex items-center justify-center text-white shadow-xl mb-4 animate-pulse`}>
          <Cpu size={32} />
        </div>
        <h1 className="text-xl font-black text-gray-800">SmartOffice</h1>
        <p className="text-gray-400 text-sm mt-2">正在连接服务器...</p>
        <div className={`mt-4 w-32 h-1 bg-gray-200 rounded-full overflow-hidden`}>
          <div className={`h-full bg-${theme}-600 animate-[loading_1s_ease-in-out_infinite]`} style={{ width: '60%' }} />
        </div>
        <style>{`
          @keyframes loading {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(200%); }
          }
        `}</style>
      </div>
    );
  }

  if (!currentUser) return <LoginView users={users} onLogin={setCurrentUser} theme={theme} isLoading={isLoading} />;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Network Status Bar */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[1001] bg-amber-500 text-white px-4 py-2 flex items-center justify-center text-xs font-bold">
          <WifiOff size={14} className="mr-2" />
          离线模式 - 数据将在恢复连接后同步
        </div>
      )}

      {/* Toast Notifications */}
      <div className={`fixed left-4 right-4 z-[1000] space-y-2 pointer-events-none ${!isOnline ? 'top-10' : 'top-4'}`}>
        {notifications.map(n => (
          <div key={n.id} className="w-full p-4 bg-white rounded-2xl shadow-lg border border-gray-100 flex items-start space-x-3 animate-in slide-in-from-top-4 fade-in pointer-events-auto">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.type === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600' : n.type === 'WARNING' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
              {n.type === 'SUCCESS' ? <CheckCircle size={16}/> : n.type === 'WARNING' ? <AlertTriangle size={16}/> : <Info size={16}/>}
            </div>
            <div className="flex-1">
              <h5 className="text-sm font-bold text-gray-800">{n.title}</h5>
              <p className="text-xs text-gray-500 mt-0.5">{n.content}</p>
            </div>
            <button onClick={() => setNotifications(prev => prev.filter(item => item.id !== n.id))} className="text-gray-300"><X size={14}/></button>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <main className="pb-20">
        {activeTab === 'DASHBOARD' && (
          <div className="animate-in fade-in">
            {/* Header */}
            <div className={`bg-${theme}-600 text-white p-4 pb-6`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Cpu size={24} />
                  <span className="text-lg font-black italic">SmartOffice</span>
                </div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowQRScanner(true)} className="p-2 bg-white/20 rounded-full">
                    <QrCode size={18} />
                  </button>
                  <button className="p-2 bg-white/20 rounded-full relative">
                    <Bell size={18} />
                    {pendingCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center font-bold">
                  {currentUser.name[0]}
                </div>
                <div>
                  <p className="font-bold">{currentUser.name}</p>
                  <p className="text-xs text-white/70">{currentUser.department}</p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="px-4 -mt-3">
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setActiveTab('RESOURCES')}
                  className={`bg-${theme}-600 text-white p-4 rounded-2xl shadow-lg active:scale-[0.98] transition-transform`}
                >
                  <Monitor size={24} className="mb-2" />
                  <p className="font-bold text-sm">预订会议室</p>
                  <p className="text-xs text-white/70 mt-0.5">可用: {stats.availableRooms}</p>
                </button>
                <button 
                  onClick={() => setActiveTab('RESOURCES')}
                  className={`bg-${theme}-500 text-white p-4 rounded-2xl shadow-lg active:scale-[0.98] transition-transform`}
                >
                  <Coffee size={24} className="mb-2" />
                  <p className="font-bold text-sm">申请工位</p>
                  <p className="text-xs text-white/70 mt-0.5">可用: {stats.availableDesks}</p>
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-4 mt-4">
              <div className="grid grid-cols-3 gap-3">
                <MobileStatCard title="资源总量" value={stats.totalResources} icon={MapPin} color={theme} />
                <MobileStatCard title="活跃预约" value={stats.activeBookings} icon={Activity} color="emerald" />
                <MobileStatCard title="待审批" value={pendingCount} icon={ShieldCheck} color="amber" onClick={() => setActiveTab('APPROVAL_CENTER')} />
              </div>
            </div>

            {/* Recent Bookings Preview */}
            <div className="px-4 mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-800">最近预约</h3>
                <button onClick={() => setActiveTab('BOOKINGS')} className={`text-${theme}-600 text-xs font-bold`}>查看全部</button>
              </div>
              {myBookings.slice(0, 3).map(booking => (
                <div key={booking.id} className="bg-white p-3 rounded-xl border border-gray-100 mb-2 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 rounded-lg ${booking.type === 'ROOM' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'} flex items-center justify-center`}>
                      {booking.type === 'ROOM' ? <Monitor size={14} /> : <Briefcase size={14} />}
                    </div>
                    <div>
                      <p className="font-bold text-sm text-gray-800 line-clamp-1">{booking.purpose}</p>
                      <p className="text-[10px] text-gray-400">{booking.startTime.split('T')[0]}</p>
                    </div>
                  </div>
                  <StatusBadge status={booking.status} theme={theme} />
                </div>
              ))}
              {myBookings.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  暂无预约记录
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'RESOURCES' && (
          <div className="animate-in fade-in min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white p-4 sticky top-0 z-10 border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <button onClick={() => setActiveTab('DASHBOARD')} className="p-2 -ml-2 text-gray-400">
                  <ChevronLeft size={24} />
                </button>
                <h1 className="text-lg font-bold text-gray-800">空间资源库</h1>
              </div>
              <div className="mt-3 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索资源名称或位置..."
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-100 rounded-xl outline-none text-sm"
                />
              </div>
            </div>

            {/* Resource List */}
            <div className="p-4 space-y-3">
              {filteredResources.map(resource => (
                <MobileResourceCard 
                  key={resource.id}
                  resource={resource}
                  theme={theme}
                  onBook={(r: Resource) => { setSelectedResource(r); setShowBookingModal(true); }}
                  onViewCalendar={() => {}}
                />
              ))}
              {filteredResources.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <Search size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="text-sm">未找到匹配的资源</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'BOOKINGS' && (
          <div className="animate-in fade-in min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white p-4 sticky top-0 z-10 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <button onClick={() => setActiveTab('DASHBOARD')} className="p-2 -ml-2 text-gray-400">
                    <ChevronLeft size={24} />
                  </button>
                  <h1 className="text-lg font-bold text-gray-800">我的申请</h1>
                </div>
                <span className="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                  {myBookings.length} 条
                </span>
              </div>
            </div>

            {/* Bookings List */}
            <div className="p-4 space-y-3">
              {myBookings.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <History size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="text-sm">暂无预约申请记录</p>
                  <button 
                    onClick={() => setActiveTab('RESOURCES')}
                    className={`mt-4 px-6 py-2 bg-${theme}-600 text-white rounded-xl font-bold text-sm`}
                  >
                    去预约
                  </button>
                </div>
              ) : (
                myBookings.map(booking => (
                  <MobileBookingCard 
                    key={booking.id}
                    booking={booking}
                    resource={resources.find(r => r.id === booking.resourceId)}
                    theme={theme}
                    onCancel={handleCancelBooking}
                    expanded={expandedBookingIds.has(booking.id)}
                    onToggle={() => toggleBookingExpand(booking.id)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'APPROVAL_CENTER' && (
          <div className="animate-in fade-in min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white p-4 sticky top-0 z-10 border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <button onClick={() => setActiveTab('DASHBOARD')} className="p-2 -ml-2 text-gray-400">
                  <ChevronLeft size={24} />
                </button>
                <div>
                  <h1 className="text-lg font-bold text-gray-800">审批工作台</h1>
                  <p className="text-xs text-gray-400">{pendingCount} 项待处理</p>
                </div>
              </div>
            </div>

            {/* Approval List */}
            <div className="p-4 space-y-3">
              {bookings.filter(b => canApprove(b)).length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle size={40} className="text-gray-300" />
                  </div>
                  <p className="text-gray-400 font-bold">所有任务已处理完毕</p>
                  <p className="text-xs text-gray-300 mt-1">保持高效！</p>
                </div>
              ) : (
                bookings.filter(b => canApprove(b)).map(booking => (
                  <MobileApprovalCard 
                    key={booking.id}
                    booking={booking}
                    resource={resources.find(r => r.id === booking.resourceId)}
                    user={users.find(u => u.id === booking.userId)}
                    workflow={workflow}
                    theme={theme}
                    onApprove={() => handleApprove(booking)}
                    onReject={(comment: string) => handleReject(booking, comment)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'PROFILE' && (
          <MobileProfileView 
            currentUser={currentUser}
            users={users}
            roles={roles}
            theme={theme}
            onLogout={() => setCurrentUser(null)}
            onViewChange={setActiveTab}
          />
        )}
      </main>

      {/* Bottom Navigation */}
      <BottomNav 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        theme={theme}
        pendingCount={pendingCount}
      />

      {/* Modals */}
      {showQRScanner && (
        <MobileQRScanner 
          theme={theme}
          onClose={() => setShowQRScanner(false)}
          onScanSuccess={(msg: string) => addNotification("签到成功", msg, "SUCCESS")}
        />
      )}

      {showBookingModal && selectedResource && (
        <MobileBookingFormModal 
          resource={selectedResource}
          theme={theme}
          onClose={() => setShowBookingModal(false)}
          onConfirm={handleBooking}
          availableResources={resources.filter(r => r.status === 'AVAILABLE')}
          bookings={bookings}
        />
      )}

      {bookingConflict && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm">
            <div className="text-center mb-4">
              <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mx-auto mb-3">
                <AlertTriangle size={28} />
              </div>
              <h3 className="font-bold text-lg text-gray-800">预约冲突</h3>
              <p className="text-xs text-gray-400 mt-1">
                {bookingConflict.errorType === 'PAST_TIME' ? "选择的时间已是过去式" : "该时段已被预订"}
              </p>
            </div>
            <button 
              onClick={() => {
                handleBooking(selectedResource!.id, bookingConflict.purpose, bookingConflict.suggestion.start.toISOString(), bookingConflict.suggestion.end.toISOString());
                setBookingConflict(null);
              }}
              className={`w-full py-3 bg-${theme}-600 text-white rounded-xl font-bold mb-2`}
            >
              采纳建议时间
            </button>
            <button 
              onClick={() => setBookingConflict(null)}
              className="w-full py-3 bg-gray-100 text-gray-500 rounded-xl font-bold"
            >
              重新选择
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppMobile;
