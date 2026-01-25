
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
  Lock, Smartphone, Mail, Key, Minus, Layers, PlayCircle, QrCode, Eye, Lightbulb
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, Department, RoleDefinition, ResourceStatus } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS, INITIAL_ROLES } from './constants';
import { getSmartRecommendation } from './services/geminiService';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V26';
const THEME_KEY = 'SMART_OFFICE_THEME';

// --- Theme Config ---
const THEMES = [
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-600' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-600' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-600' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-600' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-600' },
];

// --- Helper Functions for Scheduling ---

const formatTime = (date: Date) => {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

const formatDate = (date: Date) => {
  return date.toISOString().split('T')[0];
};

const findNextAvailableSlot = (resourceId: string, bookings: Booking[], durationMinutes: number) => {
  let pointer = new Date();
  pointer.setMinutes(Math.ceil(pointer.getMinutes() / 30) * 30, 0, 0); // Round up to next 30min
  
  const todayEnd = new Date(pointer);
  todayEnd.setHours(21, 0, 0, 0); // Support bookings until 9 PM

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
    pointer = new Date(pointer.getTime() + 30 * 60000); // Step 30 mins
  }
  
  // If not found today, suggest tomorrow 9 AM
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return { start: tomorrow, end: new Date(tomorrow.getTime() + durationMinutes * 60000) };
};

// --- Helper Components ---

const StatusBadge = ({ status, theme }: any) => {
  const styles: any = { 
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100', 
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100', 
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100', 
    APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`, 
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100', 
    COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200',
    MAINTENANCE: 'bg-gray-50 text-gray-500 border-gray-200'
  };
  const labels: any = { AVAILABLE: '空闲', PENDING: '审批中', APPROVED: '已通过', REJECTED: '驳回', OCCUPIED: '占用', COMPLETED: '结束', MAINTENANCE: '维护中' };
  return <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status] || styles.PENDING}`}>{labels[status] || status}</span>;
};

const RoleTag = ({ roleId, roles, theme }: any) => {
  const role = roles.find((r: any) => r.id === roleId);
  if (!role) return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-400">未知</span>;
  return <span className={`px-2 py-0.5 rounded text-[9px] font-bold bg-${role.color}-100 text-${role.color}-700 border border-${role.color}-200`}>{role.name}</span>;
};

const SidebarItem = ({ icon: Icon, label, id, active, onClick, theme, badge }: any) => (
  <button onClick={() => onClick(id)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${active ? `bg-${theme}-600 text-white shadow-lg` : `text-gray-500 hover:bg-${theme}-50 hover:text-${theme}-600`}`}>
    <div className="flex items-center space-x-3">
      <Icon size={18} /> 
      <span className="text-sm font-medium">{label}</span>
    </div>
    {badge > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${active ? 'bg-white text-indigo-600' : 'bg-rose-500 text-white'}`}>{badge}</span>}
  </button>
);

// --- Data Dashboard Components ---

const StatCard = ({ title, value, icon: Icon, trend, color, onClick }: any) => (
  <button onClick={onClick} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between group hover:border-gray-200 transition-all text-left">
    <div className="space-y-1">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{title}</p>
      <h3 className="text-2xl font-black text-gray-800">{value}</h3>
      {trend && <p className={`text-[10px] font-bold ${trend.startsWith('+') ? 'text-emerald-500' : 'text-rose-500'}`}>{trend} <span className="text-gray-300">较上周</span></p>}
    </div>
    <div className={`w-12 h-12 rounded-2xl bg-${color}-50 flex items-center justify-center text-${color}-600 group-hover:scale-110 transition-transform`}>
      <Icon size={24} />
    </div>
  </button>
);

const TodayResourceUsage = ({ resources, bookings, users, theme }: { resources: Resource[], bookings: Booking[], users: User[], theme: string }) => {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const startHour = 8;
  const endHour = 20;
  const totalHours = endHour - startHour;

  const currentPos = useMemo(() => {
    const currentHour = now.getHours() + now.getMinutes() / 60;
    if (currentHour < startHour || currentHour > endHour) return -1;
    return ((currentHour - startHour) / totalHours) * 100;
  }, [now]);

  const calculatePosition = (timeStr: string) => {
    const date = new Date(timeStr);
    const hour = date.getHours() + date.getMinutes() / 60;
    const pos = ((hour - startHour) / totalHours) * 100;
    return Math.max(0, Math.min(100, pos));
  };

  return (
    <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm overflow-hidden mb-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-10">
        <div className="space-y-1">
          <h4 className="font-black flex items-center space-x-2 text-lg"><Timer className={`text-${theme}-600`} size={20}/> <span>今日实时动态</span></h4>
          <p className="text-[10px] text-gray-400 font-bold uppercase pl-7">展示各资源的预订分布及预订人部门信息</p>
        </div>
        <div className="flex items-center space-x-4 bg-gray-50 px-4 py-2 rounded-2xl border border-gray-100">
           <div className="flex items-center space-x-1.5"><div className={`w-2 h-2 rounded-full bg-${theme}-500`}></div><span className="text-[10px] font-black text-gray-500">已核准</span></div>
           <div className="flex items-center space-x-1.5"><div className="w-2 h-2 rounded-full bg-amber-400"></div><span className="text-[10px] font-black text-gray-500">审批中</span></div>
        </div>
      </div>
      <div className="relative mb-4 flex"><div className="w-32 shrink-0"></div><div className="flex-1 flex justify-between relative px-1">{Array.from({ length: totalHours + 1 }).map((_, i) => (<span key={i} className="text-[9px] font-black text-gray-300 transform -translate-x-1/2">{(startHour + i).toString().padStart(2, '0')}:00</span>))}</div></div>
      <div className="space-y-3 relative">
        {currentPos !== -1 && (<div className="absolute top-0 bottom-0 w-px bg-rose-500 z-30 pointer-events-none" style={{ left: `calc(8rem + (100% - 8rem) * ${currentPos / 100})` }}><div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-rose-500 rounded-full shadow-sm" /></div>)}
        {resources.map(res => {
          const todayBookings = bookings.filter(b => b.resourceId === res.id && (b.status === 'APPROVED' || b.status === 'PENDING') && (b.startTime.startsWith(todayStr) || b.endTime.startsWith(todayStr)));
          return (
            <div key={res.id} className="flex items-center group">
              <div className="w-32 shrink-0 pr-4"><div className="flex items-center space-x-2"><div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${res.type === 'ROOM' ? 'bg-indigo-50 text-indigo-500' : 'bg-emerald-50 text-emerald-500'}`}>{res.type === 'ROOM' ? <Monitor size={12}/> : <Coffee size={12}/>}</div><span className="text-[11px] font-black text-gray-700 truncate">{res.name}</span></div></div>
              <div className="flex-1 relative h-12 bg-gray-50/50 rounded-xl border border-gray-100/50 overflow-hidden">
                {Array.from({ length: totalHours + 1 }).map((_, i) => (<div key={i} className="absolute top-0 bottom-0 w-px bg-gray-200/20" style={{ left: `${(i / totalHours) * 100}%` }} />))}
                {todayBookings.map(b => {
                  const left = calculatePosition(b.startTime);
                  const right = calculatePosition(b.endTime);
                  const dur = Math.max(2, right - left);
                  const user = users.find(u => u.id === b.userId);
                  return (
                    <div key={b.id} className={`absolute top-1 bottom-1 rounded-lg shadow-sm transition-all cursor-help z-10 flex flex-col justify-center px-3 border-l-4 ${b.status === 'APPROVED' ? `bg-${theme}-500/10 border-${theme}-500 text-${theme}-700` : 'bg-amber-400/10 border-amber-400 text-amber-700'}`} style={{ left: `${left}%`, width: `${dur}%` }} title={`${user?.name} (${user?.department}): ${b.purpose}`}>
                      {dur > 15 && (<div className="truncate pointer-events-none text-[9px]"><p className="font-black leading-tight truncate">{user?.name} · {user?.department}</p><p className="opacity-70">{b.startTime.split('T')[1].slice(0, 5)}-{b.endTime.split('T')[1].slice(0, 5)}</p></div>)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const MonthlyUsageGrid = ({ resources, bookings, users, theme, onDayClick }: { resources: Resource[], bookings: Booking[], users: User[], theme: string, onDayClick: (resourceId: string, date: Date) => void }) => {
  const [startDate, setStartDate] = useState(new Date());
  
  const displayDays = useMemo(() => {
    return Array.from({ length: 30 }).map((_, i) => {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      return d;
    });
  }, [startDate]);
  
  const getDayStatus = (resourceId: string, date: Date) => {
    const dStr = date.toISOString().split('T')[0];
    const booking = bookings.find(b => b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING') && (dStr >= b.startTime.split('T')[0] && dStr <= b.endTime.split('T')[0]));
    if (!booking) return null;
    const user = users.find(u => u.id === booking.userId);
    return { ...booking, userName: user?.name || '未知', userDept: user?.department || '未定义部门' };
  };

  return (
    <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm overflow-hidden animate-in fade-in duration-700">
      <div className="flex justify-between items-center mb-8">
        <h4 className="font-bold flex items-center space-x-2 text-lg"><PieChart className={`text-${theme}-600`} size={20}/> <span>资源占用全景 (未来30天)</span></h4>
        <div className="flex items-center bg-gray-50 p-1 rounded-2xl border">
          <button onClick={() => { const d = new Date(startDate); d.setDate(d.getDate() - 7); setStartDate(d); }} className="p-2 hover:bg-white rounded-xl text-gray-400 transition-colors"><ChevronLeft size={18}/></button>
          <span className="px-6 text-sm font-black min-w-[140px] text-center">{startDate.getMonth() + 1}月{startDate.getDate()}日起</span>
          <button onClick={() => { const d = new Date(startDate); d.setDate(d.getDate() + 7); setStartDate(d); }} className="p-2 hover:bg-white rounded-xl text-gray-400 transition-colors"><ChevronRight size={18}/></button>
        </div>
      </div>
      <div className="overflow-x-auto custom-scrollbar pb-4">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-white text-left p-4 text-[10px] font-black text-gray-400 uppercase tracking-widest min-w-[180px] border-b">资源名称</th>
              {displayDays.map((date, i) => (
                <th key={i} className={`p-2 text-center border-b min-w-[36px] font-bold text-[10px] ${date.getDay() === 0 || date.getDay() === 6 ? 'text-rose-400 bg-rose-50/30' : 'text-gray-400'}`}>
                  <div>{date.getDate()}</div>
                  <div className="text-[8px] opacity-50">{['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map(res => (
              <tr key={res.id} className="hover:bg-gray-50 transition-colors">
                <td className="sticky left-0 z-10 bg-white p-4 border-b text-xs font-bold text-gray-700 truncate">{res.name}</td>
                {displayDays.map((date, i) => { 
                  const info = getDayStatus(res.id, date); 
                  return (
                    <td key={i} className={`p-1 border-b text-center ${date.getDay() === 0 || date.getDay() === 6 ? 'bg-rose-50/10' : ''}`}>
                      <button 
                        onClick={() => onDayClick(res.id, date)}
                        className={`w-full h-8 rounded-md transition-all cursor-pointer ${info?.status === 'APPROVED' ? `bg-${theme}-600 shadow-sm hover:scale-105` : info?.status === 'PENDING' ? 'bg-amber-300 animate-pulse hover:scale-105' : 'bg-gray-50/50 hover:bg-gray-100'}`} 
                        title={info ? `${info.userName} (${info.userDept}): ${info.purpose} (点击查看详情)` : '无预约记录'}
                      />
                    </td>
                  ); 
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Main App ---

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS' | 'ROLES' | 'DEPARTMENTS' | 'APPROVAL_CENTER' | 'WORKFLOW_CONFIG' | 'DATA_CENTER'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'indigo');
  
  // Data states
  const [roles, setRoles] = useState<RoleDefinition[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).roles : INITIAL_ROLES; });
  const [users, setUsers] = useState<User[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).users : INITIAL_USERS; });
  const [resources, setResources] = useState<Resource[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).resources : INITIAL_RESOURCES; });
  const [bookings, setBookings] = useState<Booking[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved).bookings : INITIAL_BOOKINGS; });
  const [departments, setDepartments] = useState<Department[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? (JSON.parse(saved).departments || INITIAL_DEPARTMENTS) : INITIAL_DEPARTMENTS; });
  const [workflow, setWorkflow] = useState<ApprovalNode[]>(() => { const saved = localStorage.getItem(STORAGE_KEY); return saved ? (JSON.parse(saved).workflow || DEFAULT_WORKFLOW) : DEFAULT_WORKFLOW; });

  // UI States
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [editingWorkflowNode, setEditingWorkflowNode] = useState<ApprovalNode | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [viewDetail, setViewDetail] = useState<{ type: 'USER' | 'RESOURCE', data: any } | null>(null);
  const [bookingConflict, setBookingConflict] = useState<{ 
    resource: Resource, 
    requestedStart: string, 
    requestedEnd: string, 
    resourceBookings: Booking[],
    errorType: 'PAST_TIME' | 'CONFLICT',
    suggestion: { start: Date, end: Date }
  } | null>(null);
  const [showResourceCalendar, setShowResourceCalendar] = useState<Resource | null>(null);
  const [calendarDateForBooking, setCalendarDateForBooking] = useState<string | null>(null);
  const [allExpanded, setAllExpanded] = useState(true);
  const [dayDetail, setDayDetail] = useState<{ resource: Resource, date: Date, bookings: Booking[] } | null>(null);
  
  // Import States
  const [showImportModal, setShowImportModal] = useState<'USERS' | 'RESOURCES' | 'DEPARTMENTS' | null>(null);

  // Batch Selection States
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ roles, users, resources, bookings, departments, workflow })); }, [roles, users, resources, bookings, departments, workflow]);
  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);

  const canApprove = (booking: Booking) => booking.status === 'PENDING' && currentUser?.role.includes(workflow[booking.currentNodeIndex]?.approverRole);
  const pendingCount = bookings.filter(b => canApprove(b)).length;

  const stats = useMemo(() => {
    const totalResources = resources.length;
    const availableRooms = resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length;
    const availableDesks = resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length;
    const activeBookings = bookings.filter(b => b.status === 'APPROVED').length;
    return { totalResources, availableRooms, availableDesks, activeBookings };
  }, [resources, bookings]);

  const handleBooking = (resourceId: string, purpose: string, startTime: string, endTime: string) => {
    const resource = resources.find(r => r.id === resourceId);
    if (!resource || !currentUser) return;
    
    const now = new Date();
    const start = new Date(startTime);
    const end = new Date(endTime);
    const requestedDuration = (end.getTime() - start.getTime()) / 60000;

    // 1. Validation: End after Start
    if (end <= start) {
      alert("提交失败：结束时间必须晚于开始时间，请检查您的选择。");
      return;
    }

    // 2. Validation: Not in the past
    if (start < now) {
      const suggestion = findNextAvailableSlot(resourceId, bookings, requestedDuration);
      setBookingConflict({
        resource,
        requestedStart: startTime,
        requestedEnd: endTime,
        resourceBookings: bookings.filter(b => b.resourceId === resourceId && b.status !== 'REJECTED'),
        errorType: 'PAST_TIME',
        suggestion
      });
      return;
    }

    // 3. Validation: Overlap check
    const conflict = bookings.find(b => 
      b.resourceId === resourceId && 
      (b.status === 'APPROVED' || b.status === 'PENDING') && 
      (start < new Date(b.endTime) && end > new Date(b.startTime))
    );

    if (conflict) {
      const resourceBookings = bookings.filter(b => b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING'));
      const suggestion = findNextAvailableSlot(resourceId, bookings, requestedDuration);
      setBookingConflict({ 
        resource, 
        requestedStart: startTime,
        requestedEnd: endTime,
        resourceBookings,
        errorType: 'CONFLICT',
        suggestion
      });
      return;
    }

    const newBooking: Booking = { 
      id: `bk-${Date.now()}`, 
      userId: currentUser.id, 
      resourceId, 
      type: resource.type, 
      startTime, 
      endTime, 
      status: workflow.length === 0 ? 'APPROVED' : 'PENDING', 
      purpose, 
      createdAt: new Date().toISOString(), 
      currentNodeIndex: 0, 
      approvalHistory: [] 
    };
    setBookings(prev => [newBooking, ...prev]);
    setShowBookingModal(false);
    setCalendarDateForBooking(null);
  };

  const handleApprove = (booking: Booking) => {
    const isLast = booking.currentNodeIndex === workflow.length - 1;
    setBookings(prev => prev.map(b => b.id === booking.id ? { 
      ...b, 
      currentNodeIndex: isLast ? b.currentNodeIndex : b.currentNodeIndex + 1, 
      status: isLast ? 'APPROVED' : 'PENDING', 
      approvalHistory: [...b.approvalHistory, { 
        nodeName: workflow[b.currentNodeIndex].name, 
        approverName: currentUser?.name || '未知', 
        status: 'APPROVED', 
        timestamp: new Date().toISOString() 
      }] 
    } : b));
  };

  const handleReject = (booking: Booking, comment: string) => {
    setBookings(prev => prev.map(b => b.id === booking.id ? { 
      ...b, 
      status: 'REJECTED', 
      approvalHistory: [...b.approvalHistory, { 
        nodeName: workflow[b.currentNodeIndex].name, 
        approverName: currentUser?.name || '未知', 
        status: 'REJECTED', 
        comment, 
        timestamp: new Date().toISOString() 
      }] 
    } : b));
  };

  const handleLogin = (user: User) => {
    setCurrentUser(user);
  };

  const handleDayPanoramaClick = (resourceId: string, date: Date) => {
    const resource = resources.find(r => r.id === resourceId);
    if (!resource) return;
    const dStr = date.toISOString().split('T')[0];
    const dayBookings = bookings.filter(b => b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING') && (dStr >= b.startTime.split('T')[0] && dStr <= b.endTime.split('T')[0]));
    setDayDetail({ resource, date, bookings: dayBookings });
  };

  // Batch Operations Logic
  const toggleResourceSelection = (id: string) => {
    setSelectedResourceIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };
  const toggleAllResources = () => {
    setSelectedResourceIds(prev => prev.length === resources.length ? [] : resources.map(r => r.id));
  };
  const handleBatchDeleteResources = () => {
    if (confirm(`确定要删除选中的 ${selectedResourceIds.length} 个资源吗？`)) {
      setResources(prev => prev.filter(r => !selectedResourceIds.includes(r.id)));
      setSelectedResourceIds([]);
    }
  };
  const handleBatchUpdateResourceStatus = (status: ResourceStatus) => {
    setResources(prev => prev.map(r => selectedResourceIds.includes(r.id) ? { ...r, status } : r));
    setSelectedResourceIds([]);
  };

  const toggleUserSelection = (id: string) => {
    setSelectedUserIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };
  const toggleAllUsers = () => {
    setSelectedUserIds(prev => prev.length === users.length ? [] : users.map(u => u.id));
  };
  const handleBatchDeleteUsers = () => {
    if (confirm(`确定要注销选中的 ${selectedUserIds.length} 位成员吗？`)) {
      setUsers(prev => prev.filter(u => !selectedUserIds.includes(u.id)));
      setSelectedUserIds([]);
    }
  };
  const handleBatchAssignRole = (roleId: string) => {
    setUsers(prev => prev.map(u => selectedUserIds.includes(u.id) ? { ...u, role: [...new Set([...u.role, roleId])] } : u));
    setSelectedUserIds([]);
  };

  if (!currentUser) return <LoginView users={users} onLogin={handleLogin} theme={theme} />;

  return (
    <div className="min-h-screen flex bg-gray-50 overflow-hidden font-sans">
      <aside className="w-64 bg-white border-r hidden lg:flex flex-col p-6 h-screen sticky top-0 shrink-0">
        <div className="flex items-center space-x-3 mb-10 px-2 shrink-0">
          <div className={`w-8 h-8 bg-${theme}-600 rounded-lg flex items-center justify-center text-white shadow-lg`}><Cpu size={18}/></div>
          <span className="text-lg font-black tracking-tight italic">SmartOffice</span>
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto custom-scrollbar">
          <SidebarItem icon={LayoutDashboard} label="数据全景看板" id="DASHBOARD" active={view === 'DASHBOARD'} onClick={setView} theme={theme} />
          <SidebarItem icon={MapPin} label="空间资源库" id="RESOURCES" active={view === 'RESOURCES'} onClick={setView} theme={theme} />
          <SidebarItem icon={Calendar} label="我的申请" id="BOOKINGS" active={view === 'BOOKINGS'} onClick={setView} theme={theme} />
          <div className="pt-6 pb-2 px-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">流程与中心</div>
          <SidebarItem icon={ShieldCheck} label="审批工作台" id="APPROVAL_CENTER" active={view === 'APPROVAL_CENTER'} onClick={setView} theme={theme} badge={pendingCount} />
          {currentUser.role.includes('SYSTEM_ADMIN') && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">系统管理</div>
              <SidebarItem icon={GitMerge} label="流程配置" id="WORKFLOW_CONFIG" active={view === 'WORKFLOW_CONFIG'} onClick={setView} theme={theme} />
              <SidebarItem icon={Building2} label="部门管理" id="DEPARTMENTS" active={view === 'DEPARTMENTS'} onClick={setView} theme={theme} />
              <SidebarItem icon={Shield} label="角色管理" id="ROLES" active={view === 'ROLES'} onClick={setView} theme={theme} />
              <SidebarItem icon={Users} label="成员中心" id="USERS" active={view === 'USERS'} onClick={setView} theme={theme} />
              <SidebarItem icon={Database} label="数据中心" id="DATA_CENTER" active={view === 'DATA_CENTER'} onClick={setView} theme={theme} />
            </>
          )}
        </nav>

        {/* Theme Switcher */}
        <div className="mt-4 pt-4 border-t shrink-0">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-2">系统主题风格</p>
          <div className="flex items-center justify-around px-2">
            {THEMES.map(t => (
              <button 
                key={t.id} 
                onClick={() => setTheme(t.id)} 
                title={t.name}
                className={`w-6 h-6 rounded-full ${t.color} border-2 transition-all ${theme === t.id ? 'border-gray-900 scale-125' : 'border-transparent hover:scale-110'}`}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t shrink-0 flex items-center justify-between">
          <div className="flex items-center space-x-2 truncate">
            <div className={`w-8 h-8 bg-${theme}-600 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-inner`}>{currentUser.name[0]}</div>
            <p className="text-xs font-bold truncate">{currentUser.name}</p>
          </div>
          <button onClick={() => setCurrentUser(null)} className="text-gray-400 hover:text-rose-500 transition-colors"><LogOut size={16}/></button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto relative bg-gray-50 pb-32">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b px-8 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-bold">
              {view === 'DASHBOARD' && '数据全景看板'}
              {view === 'RESOURCES' && '空间资源库'}
              {view === 'USERS' && '成员中心'}
              {view === 'BOOKINGS' && '我的申请记录'}
              {view === 'APPROVAL_CENTER' && '审批中心'}
              {view === 'WORKFLOW_CONFIG' && '审批引擎配置'}
              {view === 'DEPARTMENTS' && '组织架构'}
              {view === 'ROLES' && '角色权限集'}
              {view === 'DATA_CENTER' && '数据维护中心'}
            </h2>
          </div>
          <button className={`lg:hidden p-2 text-gray-500 hover:text-${theme}-600`}><MoreHorizontal size={20}/></button>
          <div className="flex items-center space-x-3">
             <button className={`bg-${theme}-50 text-${theme}-600 px-3 py-1.5 rounded-xl font-black text-[10px] flex items-center space-x-1 hover:bg-${theme}-100 transition-all`} onClick={() => alert('请在手机端使用扫码签到功能')}>
               <QrCode size={14}/>
               <span>扫码签到</span>
             </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'DASHBOARD' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onClick={() => setView('RESOURCES')} className={`flex items-center justify-between p-5 bg-${theme}-600 rounded-[2rem] text-white shadow-lg hover:translate-y-[-2px] transition-all group overflow-hidden relative active:scale-[0.98]`}>
                  <div className="flex items-center space-x-4 relative z-10">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md group-hover:scale-110 transition-transform">
                      <Monitor size={24} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-black text-lg leading-tight">预订会议室</h3>
                      <p className="text-[10px] text-white/70 font-bold uppercase mt-1">当前可用: <span className="text-white">{stats.availableRooms}</span></p>
                    </div>
                  </div>
                  <ArrowRightCircle className="relative z-10 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all" size={24} />
                  <Monitor className="absolute -right-4 -bottom-4 text-white/10 opacity-50 group-hover:scale-125 transition-all pointer-events-none" size={100} />
                </button>

                <button onClick={() => setView('RESOURCES')} className="flex items-center justify-between p-5 bg-emerald-600 rounded-[2rem] text-white shadow-lg hover:translate-y-[-2px] transition-all group overflow-hidden relative active:scale-[0.98]">
                  <div className="flex items-center space-x-4 relative z-10">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md group-hover:scale-110 transition-transform">
                      <Coffee size={24} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-black text-lg leading-tight">申请工位</h3>
                      <p className="text-[10px] text-white/70 font-bold uppercase mt-1">当前可用: <span className="text-white">{stats.availableDesks}</span></p>
                    </div>
                  </div>
                  <ArrowRightCircle className="relative z-10 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all" size={24} />
                  <Coffee className="absolute -right-4 -bottom-4 text-white/10 opacity-50 group-hover:scale-125 transition-all pointer-events-none" size={100} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard title="资源资产总量" value={stats.totalResources} icon={MapPin} trend="+2" color={theme} onClick={() => setView('RESOURCES')} />
                <StatCard title="活跃核准单" value={stats.activeBookings} icon={Activity} trend="+12%" color="emerald" onClick={() => setView('BOOKINGS')} />
                <StatCard title="待处理任务" value={pendingCount} icon={ShieldCheck} color="amber" onClick={() => setView('APPROVAL_CENTER')} />
              </div>

              <TodayResourceUsage resources={resources} bookings={bookings} users={users} theme={theme} />
              <MonthlyUsageGrid resources={resources} bookings={bookings} users={users} theme={theme} onDayClick={handleDayPanoramaClick} />
            </div>
          )}

          {view === 'DEPARTMENTS' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h3 className="text-2xl font-black">组织架构</h3>
                  <p className="text-sm text-gray-400 mt-1">定义企业多维层级，支持跨级管理与流程路由。</p>
                </div>
                <div className="flex items-center space-x-3">
                  <button 
                    onClick={() => setAllExpanded(!allExpanded)} 
                    className="bg-white border border-gray-200 text-gray-500 px-4 py-2.5 rounded-xl font-bold text-xs hover:bg-gray-50 transition-all flex items-center space-x-2"
                  >
                    <Layers size={14}/>
                    <span>{allExpanded ? '收起全部' : '展开全部'}</span>
                  </button>
                  <button onClick={() => setShowImportModal('DEPARTMENTS')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50"><Upload size={18}/> <span>批量导入</span></button>
                  <button onClick={() => setDepartments([...departments, { id: 'dpt-' + Date.now(), name: '新一级部门' }])} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>创建根部门</span></button>
                </div>
              </div>
              
              <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-sm min-h-[500px] relative overflow-hidden">
                <div className="absolute top-0 left-10 bottom-0 w-px bg-gray-50 z-0"></div>
                {departments.filter(d => !d.parentId).map(root => (
                  <DepartmentTreeNode 
                    key={root.id} 
                    department={root} 
                    departments={departments} 
                    forceExpand={allExpanded}
                    onAdd={(pid: string) => setDepartments([...departments, { id: 'dpt-' + Date.now(), name: '子部门', parentId: pid }])} 
                    onDelete={(id: string) => { if(confirm('确定要删除该部门及其下属子部门吗？')) setDepartments(departments.filter(d => d.id !== id && d.parentId !== id)); }} 
                    onRename={(id: string, name: string) => setDepartments(departments.map(d => d.id === id ? {...d, name} : d))} 
                    theme={theme} 
                  />
                ))}
                {departments.filter(d => !d.parentId).length === 0 && (
                  <div className="flex flex-col items-center justify-center py-32 space-y-4 opacity-30">
                    <Building2 size={64}/>
                    <p className="font-bold">暂无组织架构数据</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div><h3 className="text-2xl font-black">空间资产</h3><p className="text-sm text-gray-400 mt-1">查看及预约全公司物理空间资源。</p></div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowImportModal('RESOURCES')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50"><Upload size={18}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增资源</span></button>
                </div>
              </div>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-6 py-4 w-12">
                        <button onClick={toggleAllResources} className={`transition-colors ${selectedResourceIds.length === resources.length && resources.length > 0 ? `text-${theme}-600` : 'text-gray-300'}`}>
                          {selectedResourceIds.length === resources.length && resources.length > 0 ? <CheckSquare size={18}/> : <Square size={18}/>}
                        </button>
                      </th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">资源标识</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">物理位置</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">类型/容量</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">状态</th>
                      <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {resources.map(r => (
                      <tr key={r.id} className={`hover:bg-${theme}-50/20 transition-colors ${selectedResourceIds.includes(r.id) ? `bg-${theme}-50/30` : ''}`}>
                        <td className="px-6 py-4">
                          <button onClick={() => toggleResourceSelection(r.id)} className={`transition-colors ${selectedResourceIds.includes(r.id) ? `text-${theme}-600` : 'text-gray-200 hover:text-gray-400'}`}>
                            {selectedResourceIds.includes(r.id) ? <CheckSquare size={18}/> : <Square size={18}/>}
                          </button>
                        </td>
                        <td className="px-6 py-4 font-bold text-gray-800">{r.name}</td>
                        <td className="px-6 py-4 text-xs font-medium text-gray-500">{r.location}</td>
                        <td className="px-6 py-4 text-xs text-gray-500">{r.type === 'ROOM' ? '会议室' : '工位'} / {r.capacity || 0}人</td>
                        <td className="px-6 py-4"><StatusBadge status={r.status} theme={theme} /></td>
                        <td className="px-6 py-4 text-right space-x-2">
                          <button onClick={() => setViewDetail({ type: 'RESOURCE', data: r })} className="p-2 text-gray-300 hover:text-indigo-600 transition-colors" title="详情"><Info size={16}/></button>
                          {r.type === 'DESK' && (
                            <button onClick={() => setShowResourceCalendar(r)} className={`p-2 text-gray-300 hover:text-emerald-600 transition-colors`} title="查看可用日历"><CalendarDays size={16}/></button>
                          )}
                          <button onClick={() => { setSelectedResource(r); setShowBookingModal(true); }} className={`px-4 py-1.5 bg-${theme}-600 text-white rounded-lg text-[10px] font-black shadow-md`}>预约</button>
                          {currentUser.role.includes('SYSTEM_ADMIN') && (<button onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className="p-2 text-gray-200 hover:text-indigo-600"><Edit2 size={16}/></button>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Floating Batch Action Bar for Resources */}
              {selectedResourceIds.length > 0 && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-8">
                  <div className="bg-gray-900/95 backdrop-blur-xl text-white px-8 py-4 rounded-[2.5rem] shadow-2xl border border-white/10 flex items-center space-x-8">
                    <div className="flex items-center space-x-3 pr-8 border-r border-white/10">
                      <div className={`w-8 h-8 rounded-full bg-${theme}-500 flex items-center justify-center font-black text-xs`}>{selectedResourceIds.length}</div>
                      <span className="text-xs font-bold text-gray-300">项资源已选中</span>
                    </div>
                    <div className="flex items-center space-x-4">
                      <button onClick={() => handleBatchUpdateResourceStatus('AVAILABLE')} className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white text-[10px] font-black rounded-xl transition-all border border-emerald-500/20">设为可用</button>
                      <button onClick={() => handleBatchUpdateResourceStatus('MAINTENANCE')} className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-white text-[10px] font-black rounded-xl transition-all border border-amber-500/20">维护状态</button>
                      <button onClick={handleBatchDeleteResources} className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white text-[10px] font-black rounded-xl transition-all border border-rose-500/20 flex items-center space-x-2"><Trash2 size={12}/> <span>批量删除</span></button>
                      <button onClick={() => setSelectedResourceIds([])} className="text-gray-400 hover:text-white"><X size={18}/></button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div><h3 className="text-2xl font-black">成员名录</h3><p className="text-sm text-gray-400 mt-1">管理企业员工信息及其系统角色。</p></div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowImportModal('USERS')} className="bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-xl font-bold shadow-sm flex items-center space-x-2 hover:bg-gray-50"><Upload size={18}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><UserPlus size={18}/> <span>录入成员</span></button>
                </div>
              </div>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-6 py-4 w-12">
                        <button onClick={toggleAllUsers} className={`transition-colors ${selectedUserIds.length === users.length && users.length > 0 ? `text-${theme}-600` : 'text-gray-300'}`}>
                          {selectedUserIds.length === users.length && users.length > 0 ? <CheckSquare size={18}/> : <Square size={18}/>}
                        </button>
                      </th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">基本信息</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">部门</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">系统角色</th>
                      <th className="px-6 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {users.map(u => (
                      <tr key={u.id} className={`hover:bg-${theme}-50/20 transition-colors ${selectedUserIds.includes(u.id) ? `bg-${theme}-50/30` : ''}`}>
                        <td className="px-6 py-4">
                          <button onClick={() => toggleUserSelection(u.id)} className={`transition-colors ${selectedUserIds.includes(u.id) ? `text-${theme}-600` : 'text-gray-200 hover:text-gray-400'}`}>
                            {selectedUserIds.includes(u.id) ? <CheckSquare size={18}/> : <Square size={18}/>}
                          </button>
                        </td>
                        <td className="px-6 py-4 flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full bg-${theme}-100 flex items-center justify-center font-black text-${theme}-600 text-[10px]`}>{u.name[0]}</div>
                          <div><p className="font-bold text-gray-800 text-sm">{u.name}</p><p className="text-[10px] text-gray-400">{u.email}</p></div>
                        </td>
                        <td className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">{u.department}</td>
                        <td className="px-6 py-4"><div className="flex flex-wrap gap-1">{u.role.map(rid => <RoleTag key={rid} roleId={rid} roles={roles} theme={theme}/>)}</div></td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => setViewDetail({ type: 'USER', data: u })} className="p-2 text-gray-300 hover:text-indigo-600 transition-colors"><Info size={16}/></button>
                          <button onClick={() => { setEditingUser(u); setShowUserModal(true); }} className="p-2 text-gray-200 hover:text-indigo-600"><Edit2 size={16}/></button>
                          <button onClick={() => setUsers(users.filter(user => user.id !== u.id))} className="p-2 text-gray-200 hover:text-rose-500"><Trash2 size={16}/></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Floating Batch Action Bar for Users */}
              {selectedUserIds.length > 0 && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-8">
                  <div className="bg-gray-900/95 backdrop-blur-xl text-white px-8 py-4 rounded-[2.5rem] shadow-2xl border border-white/10 flex items-center space-x-8">
                    <div className="flex items-center space-x-3 pr-8 border-r border-white/10">
                      <div className={`w-8 h-8 rounded-full bg-${theme}-500 flex items-center justify-center font-black text-xs`}>{selectedUserIds.length}</div>
                      <span className="text-xs font-bold text-gray-300">位成员已选中</span>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="relative group/roles">
                        <button className="px-4 py-2 bg-white/10 hover:bg-white text-white hover:text-gray-900 text-[10px] font-black rounded-xl transition-all border border-white/20 flex items-center space-x-1">
                          <span>分配角色</span> <ChevronUp size={12}/>
                        </button>
                        <div className="absolute bottom-full mb-4 left-0 bg-white rounded-2xl shadow-2xl border border-gray-100 p-2 hidden group-hover/roles:block min-w-[160px]">
                           {roles.map(r => (
                             <button key={r.id} onClick={() => handleBatchAssignRole(r.id)} className="w-full text-left px-4 py-2 hover:bg-gray-50 rounded-lg text-[10px] font-bold text-gray-700">{r.name}</button>
                           ))}
                        </div>
                      </div>
                      <button onClick={handleBatchDeleteUsers} className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white text-[10px] font-black rounded-xl transition-all border border-rose-500/20 flex items-center space-x-2"><Trash2 size={12}/> <span>批量注销</span></button>
                      <button onClick={() => setSelectedUserIds([])} className="text-gray-400 hover:text-white"><X size={18}/></button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === 'APPROVAL_CENTER' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="mb-8">
                <h3 className="text-3xl font-black text-gray-800">审批工作台</h3>
                <p className="text-sm text-gray-400 mt-2 flex items-center space-x-2">
                   <ShieldCheck size={14} className={`text-${theme}-600`}/>
                   <span>当前共 <strong className={`text-${theme}-600`}>{pendingCount}</strong> 项待处理申请</span>
                </p>
              </div>
              
              <div className="grid grid-cols-1 gap-6">
                {bookings.filter(b => canApprove(b)).map(b => (
                  <ApprovalTaskCard 
                    key={b.id} 
                    booking={b} 
                    workflow={workflow} 
                    users={users} 
                    resources={resources} 
                    theme={theme} 
                    onApprove={() => handleApprove(b)} 
                    onReject={(c: string) => handleReject(b, c)} 
                  />
                ))}
                {bookings.filter(b => canApprove(b)).length === 0 && (
                  <div className="text-center py-32 bg-white rounded-[3rem] border border-dashed border-gray-200">
                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-300">
                      <CheckCircle size={40}/>
                    </div>
                    <p className="text-gray-400 font-bold">工作台已全部清空，太棒了！</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'BOOKINGS' && (
            <div className="space-y-4 animate-in fade-in">
              <h3 className="text-2xl font-black mb-4">我的申请动态</h3>
              {bookings.filter(b => b.userId === currentUser.id).map(b => (
                <div key={b.id} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden p-6 hover:border-gray-200 transition-all">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-4">
                      <div className={`w-10 h-10 rounded-xl bg-${theme}-50 flex items-center justify-center text-${theme}-600`}><Briefcase size={20}/></div>
                      <div><h4 className="font-black text-gray-800">{b.purpose}</h4><p className="text-[10px] text-gray-400 font-bold uppercase">{resources.find(r => r.id === b.resourceId)?.name} · {b.startTime.replace('T', ' ')}</p></div>
                    </div>
                    <StatusBadge status={b.status} theme={theme} />
                  </div>
                  <WorkflowStepper booking={b} workflow={workflow} users={users} theme={theme} />
                </div>
              ))}
              {bookings.filter(b => b.userId === currentUser.id).length === 0 && <div className="text-center py-20 bg-white rounded-[2.5rem] border border-dashed text-gray-400 font-medium">暂无预约申请记录</div>}
            </div>
          )}

          {view === 'ROLES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">角色权限集</h3></div><button onClick={() => { setEditingRole(null); setShowRoleModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg`}><Plus size={18}/> <span>新增角色</span></button></div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {roles.map(r => (
                  <div key={r.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm relative group">
                    <div className={`w-10 h-10 rounded-xl bg-${r.color}-50 flex items-center justify-center text-${r.color}-600 mb-4`}><Shield size={20}/></div>
                    <h5 className="font-black text-gray-800">{r.name}</h5>
                    <p className="text-xs text-gray-400 mt-2 leading-relaxed">{r.description}</p>
                    <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between items-center">
                      <span className="text-[9px] font-black text-gray-300 uppercase">ID: {r.id}</span>
                      <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-all"><button onClick={() => { setEditingRole(r); setShowRoleModal(true); }} className="p-1.5 text-gray-400 hover:text-indigo-600"><Edit2 size={14}/></button></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'WORKFLOW_CONFIG' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">审批流程</h3></div><button onClick={() => { setEditingWorkflowNode(null); setShowWorkflowModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg`}><Plus size={18}/> <span>新增节点</span></button></div>
              <div className="space-y-4">
                {workflow.map((node, index) => (
                  <div key={node.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-gray-200 transition-all">
                    <div className="flex items-center space-x-6">
                      <div className={`w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-black text-${theme}-600`}>{index + 1}</div>
                      <div><h5 className="font-bold text-gray-800">{node.name}</h5><p className="text-xs text-gray-400 mt-1">负责角色：{roles.find(r => r.id === node.approverRole)?.name}</p></div>
                    </div>
                    <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => { const nw = [...workflow]; if(index > 0) { [nw[index], nw[index-1]] = [nw[index-1], nw[index]]; setWorkflow(nw); } }} disabled={index === 0} className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-30"><ChevronUp size={16}/></button>
                      <button onClick={() => { const nw = [...workflow]; if(index < nw.length-1) { [nw[index], nw[index+1]] = [nw[index+1], nw[index]]; setWorkflow(nw); } }} disabled={index === workflow.length-1} className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-30"><ChevronDown size={16}/></button>
                      <button onClick={() => { setEditingWorkflowNode(node); setShowWorkflowModal(true); }} className="p-2 text-gray-400 hover:text-indigo-600"><Edit2 size={16}/></button>
                      <button onClick={() => setWorkflow(workflow.filter(n => n.id !== node.id))} className="p-2 text-gray-400 hover:text-rose-500"><Trash2 size={16}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'DATA_CENTER' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
              <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-xl relative overflow-hidden">
                <div className={`absolute top-0 right-0 p-12 text-${theme}-600/5`}><Database size={120}/></div>
                <div className="relative z-10">
                  <h3 className="text-3xl font-black mb-2">数据维护</h3>
                  <p className="text-gray-400 text-sm mb-10 max-w-lg">本地存储数据管理，支持一键重置及备份导出。</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-gray-50 p-8 rounded-3xl border border-gray-100 space-y-4">
                      <div className={`w-12 h-12 rounded-2xl bg-${theme}-600 text-white flex items-center justify-center shadow-lg`}><Download size={24}/></div>
                      <h5 className="font-black text-lg">导出备份</h5>
                      <button onClick={() => { const data = { roles, users, resources, bookings, departments, workflow }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `SmartOffice_Backup.json`; a.click(); }} className={`w-full py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-xl`}>导出 JSON</button>
                    </div>
                    <div className="bg-gray-50 p-8 rounded-3xl border border-gray-100 space-y-4">
                      <div className="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center shadow-lg"><RefreshCw size={24}/></div>
                      <h5 className="font-black text-lg">重置系统</h5>
                      <button onClick={() => { if(confirm('重置将清空所有数据，确定吗？')) { localStorage.removeItem(STORAGE_KEY); window.location.reload(); } }} className="w-full py-4 bg-rose-500 text-white font-black rounded-2xl shadow-xl">重置数据</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* --- Modals --- */}

      {dayDetail && (
        <DayBookingDetailModal 
          detail={dayDetail} 
          users={users} 
          theme={theme} 
          onClose={() => setDayDetail(null)} 
        />
      )}

      {showImportModal && (
        <BatchImportModal 
          type={showImportModal} 
          theme={theme} 
          existingDepartments={departments}
          onClose={() => setShowImportModal(null)} 
          onImport={(data: any) => {
            if (showImportModal === 'USERS') setUsers(prev => [...prev, ...data]);
            else if (showImportModal === 'RESOURCES') setResources(prev => [...prev, ...data]);
            else if (showImportModal === 'DEPARTMENTS') setDepartments(prev => [...prev, ...data]);
            setShowImportModal(null);
          }}
        />
      )}

      {showResourceCalendar && (
        <ResourceCalendarModal 
          resource={showResourceCalendar} 
          bookings={bookings} 
          users={users} 
          theme={theme} 
          onClose={() => setShowResourceCalendar(null)} 
          onSelectDate={(date: string) => {
            setCalendarDateForBooking(date);
            setSelectedResource(showResourceCalendar);
            setShowResourceCalendar(null);
            setShowBookingModal(true);
          }}
        />
      )}

      {bookingConflict && (
        <BookingConflictModal 
          conflict={bookingConflict} 
          users={users} 
          theme={theme} 
          onClose={() => setBookingConflict(null)} 
          onApplySuggestion={(start: Date, end: Date) => {
            if (selectedResource) {
              handleBooking(selectedResource.id, "智能调整预约", start.toISOString(), end.toISOString());
              setBookingConflict(null);
            }
          }}
        />
      )}

      {viewDetail && (
        <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-[3rem] w-full max-w-4xl p-10 shadow-2xl animate-in zoom-in relative my-8">
            <button onClick={() => setViewDetail(null)} className="absolute top-8 right-8 p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-rose-500 transition-all"><X size={20}/></button>
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
              {/* Left Column: Basic Info */}
              <div className="lg:col-span-5 space-y-10">
                <div className="flex items-center space-x-6">
                  <div className={`w-20 h-20 rounded-3xl bg-${theme}-50 flex items-center justify-center text-${theme}-600 shadow-sm`}>{viewDetail.type === 'USER' ? <UserCircle size={40}/> : <MapPin size={40}/>}</div>
                  <div className="text-left"><h2 className="text-3xl font-black text-gray-800">{viewDetail.data.name}</h2><p className="text-gray-400 font-bold">{viewDetail.type === 'USER' ? viewDetail.data.department : viewDetail.data.location}</p></div>
                </div>

                <div className="grid grid-cols-1 gap-6 text-left">
                  {viewDetail.type === 'USER' ? (<>
                    <div className="space-y-1"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">邮箱地址</p><p className="font-bold text-gray-700">{viewDetail.data.email}</p></div>
                    <div className="space-y-1"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">手机号码</p><p className="font-bold text-gray-700">{viewDetail.data.mobile || '--'}</p></div>
                    <div className="space-y-2"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">所属角色</p><div className="flex flex-wrap gap-1">{viewDetail.data.role.map((r: string) => <RoleTag key={r} roleId={r} roles={roles} theme={theme}/>)}</div></div>
                  </>) : (<>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">资源类型</p><p className="font-bold text-gray-700">{viewDetail.data.type === 'ROOM' ? '多功能会议室' : '独立办公工位'}</p></div>
                      <div className="space-y-1"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">额定人数</p><p className="font-bold text-gray-700">{viewDetail.data.capacity} 人</p></div>
                    </div>
                    <div className="space-y-2"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">内置设施</p><div className="flex flex-wrap gap-2">{viewDetail.data.features.map((f: string) => <span key={f} className="px-3 py-1 bg-gray-50 border rounded-lg text-[10px] font-bold text-gray-500">{f}</span>)}</div></div>
                  </>)}
                </div>
                <button onClick={() => setViewDetail(null)} className={`w-full py-4 bg-gray-100 hover:bg-gray-200 text-gray-500 font-black rounded-2xl transition-all`}>关闭详情</button>
              </div>

              {/* Right Column: Dynamic Schedule */}
              {viewDetail.type === 'RESOURCE' && (
                <div className="lg:col-span-7 space-y-6">
                  <div className="bg-gray-50/50 rounded-[2.5rem] p-8 border border-gray-100 shadow-inner">
                    <div className="flex items-center justify-between mb-8">
                       <h4 className="font-black text-gray-800 flex items-center space-x-2">
                         <History className={`text-${theme}-600`} size={18}/>
                         <span>排期看板 (今日/本周)</span>
                       </h4>
                       <div className="flex items-center space-x-2 bg-white px-3 py-1 rounded-full shadow-sm border border-gray-100">
                          <Activity size={12} className="text-emerald-500 animate-pulse"/>
                          <span className="text-[10px] font-bold text-gray-500 uppercase">实时同步中</span>
                       </div>
                    </div>

                    <div className="space-y-6 overflow-y-auto custom-scrollbar max-h-[400px] pr-2">
                       <div>
                          <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-4">今日实时占用</p>
                          <div className="space-y-3">
                            {(() => {
                              const todayStr = new Date().toISOString().split('T')[0];
                              const todayBookings = bookings.filter(b => b.resourceId === viewDetail.data.id && b.startTime.startsWith(todayStr) && (b.status === 'APPROVED' || b.status === 'PENDING'));
                              
                              if (todayBookings.length === 0) {
                                return <div className="p-6 bg-white rounded-2xl border border-dashed border-gray-200 text-center"><p className="text-xs text-gray-400 font-bold italic">今日暂无预订排期</p></div>;
                              }

                              return todayBookings.sort((a, b) => a.startTime.localeCompare(b.startTime)).map(b => {
                                const user = users.find(u => u.id === b.userId);
                                const isNow = new Date() >= new Date(b.startTime) && new Date() <= new Date(b.endTime);
                                return (
                                  <div key={b.id} className={`p-4 bg-white rounded-2xl border transition-all ${isNow ? `ring-2 ring-${theme}-500/20 border-${theme}-500 shadow-lg scale-[1.02]` : 'border-gray-100 shadow-sm'}`}>
                                     <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-3">
                                          <div className={`w-8 h-8 rounded-full bg-${theme}-50 flex items-center justify-center font-black text-${theme}-600 text-[10px]`}>{user?.name[0]}</div>
                                          <div>
                                            <p className="text-xs font-black text-gray-800">{user?.name} · {user?.department}</p>
                                            <p className="text-[10px] text-gray-400 font-medium">用途: {b.purpose}</p>
                                          </div>
                                        </div>
                                        <div className="text-right">
                                           <div className="flex items-center space-x-1.5 justify-end">
                                              <Clock size={10} className={isNow ? `text-${theme}-600` : 'text-gray-300'}/>
                                              <p className={`text-[11px] font-black ${isNow ? `text-${theme}-600` : 'text-gray-700'}`}>{b.startTime.split('T')[1].slice(0, 5)} - {b.endTime.split('T')[1].slice(0, 5)}</p>
                                           </div>
                                           {isNow && <span className={`inline-block px-1.5 py-0.5 rounded bg-${theme}-600 text-white text-[8px] font-black mt-1 animate-pulse`}>使用中</span>}
                                        </div>
                                     </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                       </div>

                       <div className="pt-4 border-t border-gray-100">
                          <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-4">本周后续预览</p>
                          <div className="grid grid-cols-1 gap-2">
                             {(() => {
                               const now = new Date();
                               const endOfWeek = new Date();
                               endOfWeek.setDate(now.getDate() + 7);
                               const weekBookings = bookings.filter(b => {
                                 const start = new Date(b.startTime);
                                 return b.resourceId === viewDetail.data.id && start > now && start <= endOfWeek && (b.status === 'APPROVED' || b.status === 'PENDING');
                               });

                               if (weekBookings.length === 0) {
                                 return <p className="text-[10px] text-gray-400 italic">本周余下时段暂无预约</p>;
                               }

                               return weekBookings.sort((a, b) => a.startTime.localeCompare(b.startTime)).map(b => (
                                 <div key={b.id} className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-gray-50 hover:border-gray-200 transition-colors group">
                                    <div className="flex items-center space-x-3">
                                       <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
                                       <p className="text-[10px] font-bold text-gray-500">{b.startTime.replace('T', ' ').slice(5, 16)}</p>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                       <span className="text-[9px] font-black text-gray-400 group-hover:text-gray-700 transition-colors">{users.find(u => u.id === b.userId)?.name}</span>
                                       <ChevronRight size={10} className="text-gray-200"/>
                                    </div>
                                 </div>
                               ));
                             })()}
                          </div>
                       </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showUserModal && <UserModal user={editingUser} departments={departments} roles={roles} onClose={() => setShowUserModal(false)} onSave={(data: any) => { if(editingUser) setUsers(users.map(u => u.id === editingUser.id ? {...u, ...data} : u)); else setUsers([...users, { id: 'u-'+Date.now(), ...data }]); setShowUserModal(false); }} theme={theme} />}
      {showResourceModal && <ResourceModal resource={editingResource} onClose={() => setShowResourceModal(false)} onSave={(data: any) => { if(editingResource) setResources(resources.map(r => r.id === editingResource.id ? {...r, ...data} : r)); else setResources([...resources, { id: 'r-'+Date.now(), status: 'AVAILABLE', features: [], ...data }]); setShowResourceModal(false); }} theme={theme} />}
      {showRoleModal && <RoleModal role={editingRole} onClose={() => setShowRoleModal(false)} onSave={(data: any) => { if(editingRole) setRoles(roles.map(r => r.id === editingRole.id ? {...r, ...data} : r)); else setRoles([...roles, { id: 'rl-'+Date.now(), ...data }]); setShowRoleModal(false); }} theme={theme} />}
      {showWorkflowModal && <WorkflowModal node={editingWorkflowNode} roles={roles} onClose={() => setShowWorkflowModal(false)} onSave={(data: any) => { if(editingWorkflowNode) setWorkflow(workflow.map(n => n.id === editingWorkflowNode.id ? {...n, ...data} : n)); else setWorkflow([...workflow, { id: 'wf-'+Date.now(), ...data }]); setShowWorkflowModal(false); }} theme={theme} />}
      {showBookingModal && selectedResource && (<BookingFormModal resource={selectedResource} theme={theme} initialDate={calendarDateForBooking} onClose={() => { setShowBookingModal(false); setCalendarDateForBooking(null); }} onConfirm={handleBooking} availableResources={resources.filter(r => r.status === 'AVAILABLE')}/>)}
    </div>
  );
};

// --- Login View ---

const LoginView = ({ users, onLogin, theme }: any) => {
  const [id, setId] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find((u: User) => (u.email === id || u.mobile === id));
    if (user) {
      onLogin(user);
    } else {
      setError('未找到该邮箱或手机号关联的成员');
    }
  };

  return (
    <div className={`min-h-screen bg-${theme}-600 flex items-center justify-center p-6 transition-colors duration-500`}>
      <div className="bg-white p-12 rounded-[3rem] shadow-2xl w-full max-w-md animate-in zoom-in">
        <div className="flex justify-center mb-6 transition-all duration-500"><div className={`w-16 h-16 bg-${theme}-600 rounded-2xl flex items-center justify-center text-white shadow-xl`}><Cpu size={32}/></div></div>
        <h1 className="text-2xl font-black text-center mb-2">SmartOffice</h1>
        <p className="text-gray-400 text-xs font-bold text-center mb-10 uppercase tracking-widest">智慧办公登录中心</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={18}/>
            <input 
              required
              value={id} 
              onChange={e => setId(e.target.value)}
              placeholder="企业邮箱 / 手机号码" 
              className="w-full pl-12 pr-4 py-4 bg-gray-50 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100 transition-all font-medium text-sm" 
            />
          </div>
          {error && <p className="text-rose-500 text-[10px] font-bold px-2">{error}</p>}
          <button type="submit" className={`w-full py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-lg hover:shadow-xl transition-all active:scale-95 mt-4`}>一键登录</button>
        </form>
        <div className="mt-8 text-center">
          <p className="text-[10px] text-gray-300 font-bold mb-2">演示账号：</p>
          <div className="flex flex-col space-y-1">
             <span className="text-[9px] text-indigo-400 font-mono">sysadmin@company.com</span>
             <span className="text-[9px] text-indigo-400 font-mono">approver@company.com</span>
             <span className="text-[9px] text-indigo-400 font-mono">li@company.com</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Specialized Components ---

const BookingConflictModal = ({ conflict, users, theme, onClose, onApplySuggestion }: any) => {
  const [showDetails, setShowDetails] = useState(false);
  const isPastTime = conflict.errorType === 'PAST_TIME';
  
  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] w-full max-w-2xl p-10 shadow-2xl animate-in zoom-in overflow-hidden">
        <div className="text-center mb-8">
           <div className={`w-20 h-20 bg-rose-50 ${isPastTime ? 'text-amber-500' : 'text-rose-500'} rounded-3xl flex items-center justify-center border-4 border-rose-100 mx-auto mb-6 shadow-xl shadow-rose-200/50`}>
             <AlertTriangle size={40} />
           </div>
           <h3 className="text-3xl font-black text-gray-800 mb-2">
             {isPastTime ? '无法预约过去的时间' : '预约时段冲突'}
           </h3>
           <p className="text-gray-400 font-medium leading-relaxed px-4">
             {isPastTime 
               ? '您选择的开始时间早于当前时刻，系统无法处理该请求。' 
               : `资源 ${conflict.resource.name} 在您申请的时段已被占用。`}
           </p>
        </div>

        {/* Suggestion Box */}
        <div className={`p-6 bg-${theme}-50 border-2 border-${theme}-100 rounded-[2.5rem] mb-8 relative overflow-hidden group`}>
           <div className="flex items-center justify-between mb-4">
              <h5 className={`text-[11px] font-black text-${theme}-600 uppercase tracking-widest flex items-center space-x-2`}>
                <Lightbulb size={16} className="animate-bounce" /> <span>智能预订建议</span>
              </h5>
              <span className={`text-[10px] font-bold text-${theme}-400`}>为您匹配到最近空档</span>
           </div>
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black text-gray-800 leading-tight">
                  {formatDate(conflict.suggestion.start) === formatDate(new Date()) ? '今日' : '明日'} {formatTime(conflict.suggestion.start)} - {formatTime(conflict.suggestion.end)}
                </p>
                <p className="text-[10px] text-gray-400 font-bold mt-1 uppercase tracking-tighter">
                   {conflict.resource.name} · {conflict.resource.location}
                </p>
              </div>
              <button 
                onClick={() => onApplySuggestion(conflict.suggestion.start, conflict.suggestion.end)}
                className={`px-6 py-3 bg-${theme}-600 text-white font-black rounded-2xl shadow-lg hover:scale-105 transition-all text-xs flex items-center space-x-2`}
              >
                <Check size={14}/> <span>采用此建议</span>
              </button>
           </div>
           <Zap className={`absolute -right-4 -bottom-4 text-${theme}-600/5 group-hover:scale-110 transition-transform`} size={120}/>
        </div>

        {/* Conflicting Request Info */}
        {!isPastTime && (
          <div className="mb-8">
            <button 
              onClick={() => setShowDetails(!showDetails)}
              className="w-full py-4 bg-white border-2 border-dashed border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 rounded-2xl flex items-center justify-center space-x-2 transition-all font-bold text-sm"
            >
              <Eye size={18}/> <span>{showDetails ? '隐藏冲突详情' : '查看具体冲突项'}</span>
            </button>
            
            {showDetails && (
              <div className="mt-4 p-4 bg-gray-50 border border-gray-100 rounded-[2rem] space-y-3 max-h-48 overflow-y-auto custom-scrollbar animate-in slide-in-from-top-2">
                {conflict.resourceBookings.filter((b: Booking) => {
                   const bStart = new Date(b.startTime);
                   const bEnd = new Date(b.endTime);
                   const rStart = new Date(conflict.requestedStart);
                   const rEnd = new Date(conflict.requestedEnd);
                   return (rStart < bEnd && rEnd > bStart);
                }).map((b: Booking) => {
                  const user = users.find((u: User) => u.id === b.userId);
                  return (
                    <div key={b.id} className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm flex justify-between items-start">
                      <div>
                        <p className="text-xs font-black text-gray-700">{user?.name} · {user?.department}</p>
                        <p className="text-[10px] text-gray-400 mt-1">用途: {b.purpose}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded mb-1 inline-block">占用中</span>
                        <p className="text-[10px] font-bold text-gray-500">{b.startTime.split('T')[1].slice(0, 5)} - {b.endTime.split('T')[1].slice(0, 5)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex space-x-4">
          <button onClick={onClose} className="flex-1 py-5 bg-gray-100 hover:bg-gray-200 text-gray-500 font-black rounded-3xl transition-all">取消预订</button>
          <button onClick={onClose} className={`flex-1 py-5 bg-${theme}-600/10 text-${theme}-600 font-black rounded-3xl border border-${theme}-200 transition-all`}>手动调整时间</button>
        </div>
      </div>
    </div>
  );
};

const DayBookingDetailModal = ({ detail, users, theme, onClose }: any) => {
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] w-full max-w-2xl p-10 shadow-2xl animate-in zoom-in overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <div className={`w-14 h-14 rounded-3xl bg-${theme}-50 flex items-center justify-center text-${theme}-600 border border-${theme}-100`}>
              <CalendarDays size={28}/>
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-800">{detail.resource.name}</h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{detail.date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} 预订分布</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-rose-500 transition-colors"><X size={20}/></button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
          {detail.bookings.length > 0 ? (
            detail.bookings.sort((a: any, b: any) => a.startTime.localeCompare(b.startTime)).map((b: Booking) => {
              const user = users.find((u: User) => u.id === b.userId);
              return (
                <div key={b.id} className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100 flex flex-col md:flex-row md:items-center justify-between group hover:bg-white hover:shadow-lg transition-all">
                  <div className="flex items-center space-x-4">
                    <div className={`w-10 h-10 rounded-full bg-${theme}-100 flex items-center justify-center font-black text-${theme}-700 text-xs`}>{user?.name[0]}</div>
                    <div>
                      <h5 className="font-black text-gray-800">{user?.name} · {user?.department}</h5>
                      <p className="text-xs text-gray-400 font-medium">用途：{b.purpose}</p>
                    </div>
                  </div>
                  <div className="mt-4 md:mt-0 flex items-center space-x-6">
                    <div className="text-right">
                       <div className="flex items-center space-x-2 justify-end mb-1">
                          <Clock size={12} className={`text-${theme}-600`}/>
                          <span className="text-xs font-black text-gray-700">{b.startTime.split('T')[1].slice(0, 5)} - {b.endTime.split('T')[1].slice(0, 5)}</span>
                       </div>
                       <StatusBadge status={b.status} theme={theme} />
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-20 bg-gray-50 rounded-[3rem] border border-dashed border-gray-200">
               <Activity size={40} className="mx-auto text-gray-300 mb-4" />
               <p className="text-gray-400 font-bold">该日期暂无任何核准中或已通过的预订记录</p>
            </div>
          )}
        </div>

        <div className="mt-8 pt-6 border-t border-gray-50">
           <button onClick={onClose} className={`w-full py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-xl`}>关闭窗口</button>
        </div>
      </div>
    </div>
  );
};

const BatchImportModal = ({ type, theme, existingDepartments, onClose, onImport }: any) => {
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const templates: any = {
    USERS: "姓名,邮箱,部门,角色(用|隔开),手机号(可选)\n张三,zhangsan@company.com,技术部,EMPLOYEE,13800000000",
    RESOURCES: "资源名称,类型(ROOM/DESK),容量,位置,设施(用|隔开)\n会议室X,ROOM,10,2号楼,投屏|白板\n工位Z,DESK,1,A区,双显",
    DEPARTMENTS: "部门名称,上级部门名称(可选)\n财务部,集团总部\n研发中心,信息技术部"
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([templates[type]], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Template_${type}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setImportText(event.target?.result as string);
      reader.readAsText(file);
    }
  };

  const processImport = () => {
    setError(null);
    const lines = importText.trim().split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return setError("数据格式不正确：请至少包含标题行和一行数据。");
    
    const [header, ...rows] = lines;
    const importedData: any[] = [];

    try {
      rows.forEach((row, idx) => {
        const parts = row.split(',').map(p => p.trim());
        if (type === 'USERS') {
          const [name, email, department, rolesStr, mobile] = parts;
          if (!name || !email) throw new Error(`第 ${idx + 2} 行数据不完整`);
          importedData.push({
            id: `u-import-${Date.now()}-${idx}`,
            name,
            email,
            mobile: mobile || '',
            department: department || '未分配',
            role: rolesStr ? rolesStr.split('|') : ['EMPLOYEE']
          });
        } else if (type === 'RESOURCES') {
          const [name, rType, capacity, location, featuresStr] = parts;
          if (!name || !rType) throw new Error(`第 ${idx + 2} 行数据不完整`);
          importedData.push({
            id: `r-import-${Date.now()}-${idx}`,
            name,
            type: rType === 'ROOM' ? 'ROOM' : 'DESK',
            capacity: parseInt(capacity) || 0,
            location: location || '未定义',
            features: featuresStr ? featuresStr.split('|') : [],
            status: 'AVAILABLE'
          });
        } else if (type === 'DEPARTMENTS') {
          const [name, parentName] = parts;
          if (!name) throw new Error(`第 ${idx + 2} 行数据不完整`);
          const parent = parentName ? existingDepartments.find((d: any) => d.name === parentName) : null;
          importedData.push({
            id: `d-import-${Date.now()}-${idx}`,
            name,
            parentId: parent?.id
          });
        }
      });
      onImport(importedData);
    } catch (e: any) {
      setError(e.message || "解析失败，请检查数据格式。");
    }
  };

  return (
    <div className="fixed inset-0 z-[160] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] w-full max-w-2xl p-10 shadow-2xl animate-in zoom-in overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <div className={`w-14 h-14 rounded-3xl bg-${theme}-50 flex items-center justify-center text-${theme}-600 border border-${theme}-100`}>
              <FileUp size={28}/>
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-800">批量导入{type === 'USERS' ? '成员' : type === 'RESOURCES' ? '资源' : '部门'}</h3>
              <p className="text-xs text-gray-400 font-medium">支持 CSV 格式或纯文本粘贴。</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-rose-500"><X size={20}/></button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto custom-scrollbar pr-2">
           <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
              <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center space-x-2">
                <FileText size={14}/> <span>导入说明与模版</span>
              </h5>
              <div className="bg-white p-4 rounded-2xl border border-gray-100 mb-4 overflow-x-auto">
                 <pre className="text-[10px] text-indigo-600 font-mono leading-relaxed">{templates[type]}</pre>
              </div>
              <button onClick={handleDownloadTemplate} className="text-[10px] font-black text-indigo-600 hover:underline flex items-center space-x-1">
                <Download size={12}/> <span>下载标准 CSV 模版</span>
              </button>
           </div>

           <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">粘贴数据或上传文件</label>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv,.txt" className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-black text-indigo-600 hover:underline">浏览文件...</button>
              </div>
              <textarea 
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder="在此粘贴 CSV 格式文本..."
                className="w-full h-48 p-6 bg-gray-50 rounded-[2.5rem] border border-gray-100 outline-none text-xs font-mono shadow-inner resize-none focus:ring-2 focus:ring-indigo-100"
              />
              {error && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center space-x-3 text-rose-500 text-xs font-bold animate-pulse">
                  <AlertTriangle size={16}/> <span>{error}</span>
                </div>
              )}
           </div>
        </div>

        <div className="mt-10 flex space-x-4 pt-4 border-t border-gray-50">
           <button onClick={onClose} className="flex-1 py-5 font-bold text-gray-400 hover:text-gray-600">取消</button>
           <button 
             disabled={!importText.trim()}
             onClick={processImport} 
             className={`flex-1 py-5 bg-${theme}-600 text-white font-black rounded-3xl shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed`}
           >
             开始导入
           </button>
        </div>
      </div>
    </div>
  );
};

const ResourceCalendarModal = ({ resource, bookings, users, theme, onClose, onSelectDate }: any) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const daysInMonth = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];
    
    // Fill leading empty days
    const firstDayOfWeek = firstDay.getDay();
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }
    
    // Fill actual days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  }, [currentMonth]);

  const getBookingForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return bookings.find((b: any) => 
      b.resourceId === resource.id && 
      (b.status === 'APPROVED' || b.status === 'PENDING') &&
      dateStr >= b.startTime.split('T')[0] && 
      dateStr <= b.endTime.split('T')[0]
    );
  };

  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] w-full max-w-2xl p-8 shadow-2xl animate-in zoom-in overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <div className={`w-12 h-12 rounded-2xl bg-${theme}-50 flex items-center justify-center text-${theme}-600 shadow-sm border border-${theme}-100`}>
              <CalendarDays size={24}/>
            </div>
            <div>
              <h3 className="text-xl font-black text-gray-800">{resource.name} 可用性</h3>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{resource.location}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-rose-500 transition-colors">
            <X size={20}/>
          </button>
        </div>

        <div className="flex items-center justify-between bg-gray-50 p-4 rounded-3xl mb-6">
          <button onClick={prevMonth} className="p-2 hover:bg-white rounded-xl transition-all shadow-sm"><ChevronLeft size={20}/></button>
          <span className="text-lg font-black text-gray-700">{currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月</span>
          <button onClick={nextMonth} className="p-2 hover:bg-white rounded-xl transition-all shadow-sm"><ChevronRight size={20}/></button>
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar">
          <div className="grid grid-cols-7 gap-3 mb-4 text-center">
            {['日', '一', '二', '三', '四', '五', '六'].map(d => (
              <span key={d} className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-3 pb-4">
            {daysInMonth.map((date, i) => {
              if (!date) return <div key={i} className="aspect-square"></div>;
              const booking = getBookingForDate(date);
              const isToday = date.toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
              const isPast = date < new Date(new Date().setHours(0,0,0,0));
              
              return (
                <button 
                  key={i} 
                  disabled={!!booking || isPast}
                  onClick={() => onSelectDate(date.toISOString().split('T')[0])}
                  className={`aspect-square rounded-2xl flex flex-col items-center justify-center relative border transition-all group ${
                    booking 
                      ? 'bg-rose-50 border-rose-100 text-rose-300 cursor-not-allowed' 
                      : isPast 
                        ? 'bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed'
                        : `bg-white border-gray-100 hover:border-${theme}-400 hover:shadow-lg hover:scale-105`
                  } ${isToday ? `border-${theme}-600 ring-2 ring-${theme}-100` : ''}`}
                >
                  <span className={`text-sm font-black ${isToday ? `text-${theme}-600` : booking ? 'text-rose-400' : 'text-gray-700'}`}>
                    {date.getDate()}
                  </span>
                  {booking && (
                    <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-400"></div>
                  )}
                  {!booking && !isPast && (
                    <div className={`mt-1 opacity-0 group-hover:opacity-100 transition-opacity bg-${theme}-100 p-1 rounded-full text-${theme}-600`}>
                      <Plus size={10}/>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-100 flex items-center justify-between">
          <div className="flex items-center space-x-6">
             <div className="flex items-center space-x-2"><div className="w-3 h-3 rounded-full bg-white border border-gray-200"></div><span className="text-[10px] font-bold text-gray-400">空闲</span></div>
             <div className="flex items-center space-x-2"><div className="w-3 h-3 rounded-full bg-rose-100"></div><span className="text-[10px] font-bold text-gray-400">已占用</span></div>
             <div className="flex items-center space-x-2"><div className="w-3 h-3 rounded-full bg-gray-100"></div><span className="text-[10px] font-bold text-gray-400">过去时间</span></div>
          </div>
          <p className="text-[10px] font-black text-gray-300 italic">点击空格日期直接发起预约</p>
        </div>
      </div>
    </div>
  );
};

const ApprovalTaskCard = ({ booking, workflow, users, resources, theme, onApprove, onReject }: any) => {
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const user = users.find((u: any) => u.id === booking.userId);
  const resource = resources.find((r: any) => r.id === booking.resourceId);

  const handleAction = (e: React.MouseEvent, action: 'APPROVE' | 'REJECT') => {
    e.stopPropagation();
    if (action === 'APPROVE') {
      onApprove();
    } else {
      setIsRejecting(true);
    }
  };

  const submitReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectReason.trim()) return;
    onReject(rejectReason);
    setIsRejecting(false);
  };

  return (
    <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden hover:border-gray-200 hover:shadow-xl transition-all duration-300 group">
      <div className="flex flex-col lg:flex-row">
        <div className="p-8 flex-1 space-y-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-4">
              <div className={`w-14 h-14 rounded-3xl bg-${theme}-50 flex items-center justify-center text-${theme}-600 group-hover:scale-110 transition-transform`}>
                {booking.type === 'ROOM' ? <Monitor size={28}/> : <Coffee size={28}/>}
              </div>
              <div>
                <h4 className="text-xl font-black text-gray-800 leading-tight">{booking.purpose || '常规预约使用'}</h4>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">资源：{resource?.name || '未知资源'} · {resource?.location}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-4 border-t border-gray-50">
            <div className="space-y-1">
              <p className="text-[9px] font-black text-gray-300 uppercase">申请人</p>
              <div className="flex items-center space-x-2">
                <div className={`w-5 h-5 rounded-full bg-${theme}-100 flex items-center justify-center text-[8px] font-black text-${theme}-700`}>{user?.name?.[0]}</div>
                <p className="text-xs font-bold text-gray-700">{user?.name} · {user?.department}</p>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] font-black text-gray-300 uppercase">开始时间</p>
              <p className="text-xs font-black text-gray-600">{booking.startTime.replace('T', ' ')}</p>
            </div>
            <div className="hidden md:block space-y-1">
              <p className="text-[9px] font-black text-gray-300 uppercase">结束时间</p>
              <p className="text-xs font-black text-gray-600">{booking.endTime.replace('T', ' ')}</p>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-50">
            <p className="text-[9px] font-black text-gray-300 uppercase mb-4">流转轨迹</p>
            <div className="flex items-center">
              <div className="flex items-center">
                <div className="w-4 h-4 rounded-full bg-emerald-500 shadow-sm flex items-center justify-center"><Check size={8} className="text-white"/></div>
                <div className="h-0.5 w-6 bg-emerald-100"></div>
              </div>
              {workflow.map((node: any, idx: number) => {
                const isCurrent = booking.currentNodeIndex === idx;
                const isPast = idx < booking.currentNodeIndex;
                const isLast = idx === workflow.length - 1;
                return (
                  <React.Fragment key={node.id}>
                    <div className="flex items-center group/node relative">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-black transition-all ${
                        isPast ? 'bg-emerald-100 text-emerald-600' : isCurrent ? `bg-${theme}-600 text-white shadow-lg animate-pulse` : 'bg-gray-100 text-gray-400'
                      }`}>
                        {idx + 1}
                      </div>
                      <span className={`absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-black ${isCurrent ? `text-${theme}-600` : 'text-gray-300'}`}>
                        {node.name}
                      </span>
                    </div>
                    {!isLast && <div className={`h-0.5 w-8 ${isPast ? 'bg-emerald-100' : 'bg-gray-100'}`}></div>}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        <div className={`w-full lg:w-48 bg-gray-50/50 p-6 flex flex-col justify-center space-y-3 border-l border-gray-50 transition-all ${isRejecting ? 'lg:w-80' : ''}`}>
          {!isRejecting ? (
            <>
              <button 
                onClick={(e) => handleAction(e, 'APPROVE')} 
                className={`w-full py-4 bg-${theme}-600 hover:bg-${theme}-700 text-white font-black rounded-2xl shadow-xl shadow-${theme}-600/10 hover:translate-y-[-2px] active:translate-y-[1px] transition-all flex items-center justify-center space-x-2`}
              >
                <CheckCircle size={18}/> <span>一键核准</span>
              </button>
              <button 
                onClick={(e) => handleAction(e, 'REJECT')} 
                className="w-full py-4 bg-white border border-rose-100 text-rose-500 font-bold rounded-2xl hover:bg-rose-50 hover:border-rose-200 transition-all flex items-center justify-center space-x-2"
              >
                <XCircle size={18}/> <span>驳回申请</span>
              </button>
            </>
          ) : (
            <form onSubmit={submitReject} className="space-y-4 animate-in slide-in-from-right-4">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-black text-rose-500 uppercase flex items-center space-x-2">
                  <MessageSquare size={14}/> <span>请输入驳回理由</span>
                </h5>
                <button type="button" onClick={() => setIsRejecting(false)} className="text-gray-400 hover:text-gray-600"><X size={16}/></button>
              </div>
              <textarea 
                autoFocus
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="例如：时段冲突、资料不全..."
                className="w-full h-24 p-4 bg-white border border-rose-100 rounded-2xl outline-none text-xs focus:ring-2 focus:ring-rose-200 transition-all resize-none shadow-inner"
              />
              <button 
                type="submit" 
                className="w-full py-3 bg-rose-500 text-white font-black rounded-xl text-xs flex items-center justify-center space-x-2"
              >
                <Send size={14}/> <span>确认驳回</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Standard UI Components ---

const UserModal = ({ user, departments, roles, onClose, onSave, theme }: any) => {
  const [data, setData] = useState<Partial<User>>(user || { name: '', email: '', role: ['EMPLOYEE'], department: departments[0]?.name || '' });
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-6">{user ? '编辑档案' : '录入成员'}</h2>
        <div className="space-y-4">
          <input value={data.name} onChange={e => setData({...data, name: e.target.value})} placeholder="真实姓名" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
          <input value={data.email} onChange={e => setData({...data, email: e.target.value})} placeholder="企业邮箱" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
          <input value={data.mobile} onChange={e => setData({...data, mobile: e.target.value})} placeholder="手机号码" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
          <select value={data.department} onChange={e => setData({...data, department: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl font-bold">{departments.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}</select>
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onSave(data)} className={`flex-1 py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-lg`}>保存</button></div>
      </div>
    </div>
  );
};

const ResourceModal = ({ resource, onClose, onSave, theme }: any) => {
  const [data, setData] = useState<Partial<Resource>>(resource || { name: '', type: 'ROOM', capacity: 0, location: '' });
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-6">{resource ? '编辑资产' : '新增办公资产'}</h2>
        <div className="space-y-4">
          <input value={data.name} onChange={e => setData({...data, name: e.target.value})} placeholder="资源名称" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
          <div className="grid grid-cols-2 gap-4">
            <select value={data.type} onChange={e => setData({...data, type: e.target.value as any})} className="w-full p-4 bg-gray-50 rounded-2xl font-bold"><option value="ROOM">会议室</option><option value="DESK">工位</option></select>
            <input type="number" value={data.capacity} onChange={e => setData({...data, capacity: parseInt(e.target.value)})} placeholder="容量" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
          </div>
          <input value={data.location} onChange={e => setData({...data, location: e.target.value})} placeholder="地理位置" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onSave(data)} className={`flex-1 py-4 bg-${theme}-600 text-white font-black rounded-2xl`}>入库</button></div>
      </div>
    </div>
  );
};

const BookingFormModal = ({ resource, theme, initialDate, onClose, onConfirm, availableResources }: any) => {
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState(initialDate || new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState("09:00");
  
  const [endDate, setEndDate] = useState(() => {
    if (initialDate) return initialDate;
    const d = new Date();
    if (resource.type === 'DESK') d.setMonth(d.getMonth() + 1); 
    return d.toISOString().split('T')[0];
  });
  const [endTime, setEndTime] = useState(() => {
    if (resource.type === 'ROOM') return "10:00"; 
    return "18:00";
  });

  const [loadingAI, setLoadingAI] = useState(false);
  const [recommendation, setRecommendation] = useState('');

  return (
    <div className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-[3rem] w-full max-w-lg shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-1">资源预约</h2>
        <p className="text-xs text-gray-400 mb-8">目标: <span className={`text-${theme}-600 font-bold`}>{resource.name}</span> | {resource.type === 'ROOM' ? '时分预约' : '天数预约'}</p>
        <div className="space-y-6">
           <div className="grid grid-cols-2 gap-4 text-left">
             <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">开始日期</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold border-none" /></div>
             <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">结束日期</label><input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold border-none" /></div>
           </div>
           {resource.type === 'ROOM' && (
             <div className="grid grid-cols-2 gap-4 text-left">
               <div className="space-y-1"><label className="text-[9px] text-gray-300 font-black ml-1 uppercase">开始时刻</label><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold border-none" /></div>
               <div className="space-y-1"><label className="text-[9px] text-gray-300 font-black ml-1 uppercase">结束时刻</label><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold border-none" /></div>
             </div>
           )}
           <textarea value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="预约理由（例如：周度项目复盘、独立办公等）" className="w-full p-4 bg-gray-50 rounded-[2rem] h-24 outline-none text-sm resize-none shadow-inner" />
           <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 text-left">
              <button onClick={async () => { setLoadingAI(true); const rec = await getSmartRecommendation(purpose, 1, availableResources); setRecommendation(rec); setLoadingAI(false); }} className="text-[10px] font-black text-indigo-600 flex items-center space-x-1 mb-1 hover:opacity-70 transition-all"><Zap size={12}/> <span>AI 选址建议</span></button>
              <p className="text-[10px] text-indigo-700/70 italic leading-relaxed min-h-[1.5em]">{loadingAI ? '分析中...' : recommendation || '输入用途后点击 AI 按钮获取建议。'}</p>
           </div>
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onConfirm(resource.id, purpose, `${startDate}T${startTime}`, `${endDate}T${endTime}`)} className={`flex-1 py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-lg transition-all active:scale-95`}>立即申请</button></div>
      </div>
    </div>
  );
};

const WorkflowStepper = ({ booking, workflow, users, theme }: any) => (
  <div className="space-y-4">
    <div className="flex items-center space-x-4">
      <div className={`w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]`}></div>
      <p className="text-[10px] font-black text-gray-400 uppercase">流程记录</p>
    </div>
    <div className="flex flex-wrap gap-4">
      <div className="flex items-center space-x-2"><div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600"><Check size={12}/></div><span className="text-[10px] font-bold text-gray-500">已提交</span></div>
      {workflow.map((node: any, index: number) => {
        const history = booking.approvalHistory[index];
        const isCurrent = booking.status === 'PENDING' && booking.currentNodeIndex === index;
        const isApproved = history?.status === 'APPROVED';
        const isRejected = history?.status === 'REJECTED';
        return (
          <div key={node.id} className="flex items-center space-x-2">
            <ChevronRight size={12} className="text-gray-300"/>
            <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl border transition-all ${isRejected ? 'bg-rose-50 border-rose-100 text-rose-600' : isApproved ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : isCurrent ? 'bg-amber-50 border-amber-100 text-amber-600 shadow-sm animate-pulse' : 'bg-gray-50 border-gray-100 text-gray-400'}`}>
              <span className="text-[10px] font-black">{node.name}</span>
              {isApproved && <Check size={10}/>}
              {isRejected && <X size={10}/>}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const RoleModal = ({ role, onClose, onSave, theme }: any) => {
  const [data, setData] = useState<Partial<RoleDefinition>>(role || { name: '', description: '', color: 'indigo' });
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-6">{role ? '编辑角色' : '新增角色'}</h2>
        <div className="space-y-4">
          <input value={data.name} onChange={e => setData({...data, name: e.target.value})} placeholder="角色名称" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
          <select value={data.color} onChange={e => setData({...data, color: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl font-bold"><option value="indigo">靛蓝色</option><option value="emerald">祖母绿</option><option value="rose">玫瑰红</option><option value="amber">琥珀色</option></select>
          <textarea value={data.description} onChange={e => setData({...data, description: e.target.value})} placeholder="角色职能描述" className="w-full p-4 bg-gray-50 rounded-2xl h-24 outline-none resize-none" />
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onSave(data)} className={`flex-1 py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-lg`}>保存</button></div>
      </div>
    </div>
  );
};

const WorkflowModal = ({ node, roles, onClose, onSave, theme }: any) => {
  const [data, setData] = useState<Partial<ApprovalNode>>(node || { name: '', approverRole: roles[0]?.id || '' });
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-6">{node ? '编辑节点' : '新增审批节点'}</h2>
        <div className="space-y-4">
          <input value={data.name} onChange={e => setData({...data, name: e.target.value})} placeholder="节点名称（如：部门预审）" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
          <select value={data.approverRole} onChange={e => setData({...data, approverRole: e.target.value})} className="w-full p-4 bg-gray-50 rounded-2xl font-bold">{roles.map((r:any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onSave(data)} className={`flex-1 py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-lg`}>确认</button></div>
      </div>
    </div>
  );
};

const DepartmentTreeNode = ({ department, departments, onAdd, onDelete, onRename, theme, forceExpand }: any) => {
  const children = departments.filter((d: any) => d.parentId === department.id);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(department.name);

  useEffect(() => {
    setIsExpanded(forceExpand);
  }, [forceExpand]);

  const handleRename = () => { if(newName.trim()) onRename(department.id, newName); setIsEditing(false); };
  
  const isRoot = !department.parentId;

  return (
    <div className={`relative ${!isRoot ? 'ml-10' : ''}`}>
      {!isRoot && (
        <div className="absolute -left-[2.5rem] top-0 bottom-0 w-px bg-gray-100">
           <div className="absolute top-6 left-0 w-6 h-px bg-gray-100 rounded-full"></div>
        </div>
      )}

      <div className="flex items-center group relative z-10 py-1.5">
        <div className={`flex items-center space-x-3 bg-white p-3 rounded-[1.25rem] border border-gray-100 shadow-sm hover:border-${theme}-300 transition-all flex-1 min-w-0 ${isRoot ? 'ring-2 ring-indigo-50 border-indigo-100' : ''}`}>
          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
              children.length > 0 ? `bg-${theme}-50 text-${theme}-600 hover:bg-${theme}-100` : 'bg-gray-50 text-gray-400 cursor-default'
            }`}
          >
            {children.length > 0 ? (isExpanded ? <Minus size={14} /> : <Plus size={14} />) : <div className="w-1.5 h-1.5 rounded-full bg-gray-300"></div>}
          </button>
          
          <div className="flex-1 flex items-center space-x-3 overflow-hidden">
            <div className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${isRoot ? `bg-${theme}-600 text-white shadow-md` : 'bg-gray-50 text-gray-400'}`}>
              {isRoot ? <Building2 size={16} /> : children.length > 0 ? <FolderTree size={16} /> : <Layers size={14} />}
            </div>

            {isEditing ? (
              <input 
                autoFocus 
                value={newName} 
                onChange={e => setNewName(e.target.value)} 
                onBlur={handleRename} 
                onKeyDown={e => e.key === 'Enter' && handleRename()} 
                className="flex-1 bg-gray-50 border-none outline-none text-sm font-black p-1 rounded-md" 
              />
            ) : (
              <div className="flex flex-col min-w-0">
                <span className={`text-sm font-black truncate ${isRoot ? 'text-gray-900' : 'text-gray-700'}`}>
                  {department.name}
                </span>
                {children.length > 0 && (
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                    包含 {children.length} 个子部门
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-all">
            <button onClick={() => setIsEditing(true)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-indigo-600 transition-colors" title="重命名"><Edit2 size={14}/></button>
            <button onClick={() => onAdd(department.id)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-emerald-600 transition-colors" title="添加子部门"><Plus size={14}/></button>
            <button onClick={() => onDelete(department.id)} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-rose-500 transition-colors" title="删除"><Trash2 size={14}/></button>
          </div>
        </div>
      </div>

      {isExpanded && children.length > 0 && (
        <div className="animate-in slide-in-from-top-1 duration-200">
          {children.map((child: any) => (
            <DepartmentTreeNode 
              key={child.id} 
              department={child} 
              departments={departments} 
              onAdd={onAdd} 
              onDelete={onDelete} 
              onRename={onRename} 
              theme={theme} 
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default App;
