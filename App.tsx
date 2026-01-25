import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, MapPin, Calendar, CheckCircle, XCircle, LayoutDashboard, Plus, LogOut, 
  Cpu, Monitor, Coffee, Edit2, Trash2, UserPlus, RefreshCw,
  Clock, GitMerge, ChevronRight, ArrowRight, ChevronDown, ChevronUp,
  Zap, ShieldCheck, Check, X, Building2, 
  PieChart, ChevronLeft, Timer, Briefcase, Shield, FolderTree,
  UserCircle, AlertTriangle, Download, Upload, Database,
  Info, MoreHorizontal, Activity, ArrowRightCircle
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, Department, RoleDefinition } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS, INITIAL_ROLES } from './constants';
import { getSmartRecommendation } from './services/geminiService';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V26';
const THEME_KEY = 'SMART_OFFICE_THEME';

// --- Helper Components ---

const StatusBadge = ({ status, theme }: any) => {
  const styles: any = { 
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100', 
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100', 
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100', 
    APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`, 
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100', 
    COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200'
  };
  const labels: any = { AVAILABLE: '空闲', PENDING: '审批中', APPROVED: '已通过', REJECTED: '驳回', OCCUPIED: '占用', COMPLETED: '结束' };
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
  <button onClick={onClick} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between group hover:border-indigo-200 transition-all text-left">
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
          <p className="text-[10px] text-gray-400 font-bold uppercase pl-7">资源占用时间轴 (08:00 - 20:00)</p>
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
                    <div key={b.id} className={`absolute top-1 bottom-1 rounded-lg shadow-sm transition-all cursor-help z-10 flex flex-col justify-center px-3 border-l-4 ${b.status === 'APPROVED' ? `bg-${theme}-500/10 border-${theme}-500 text-${theme}-700` : 'bg-amber-400/10 border-amber-400 text-amber-700'}`} style={{ left: `${left}%`, width: `${dur}%` }} title={`${user?.name}: ${b.purpose}`}>
                      {dur > 12 && (<div className="truncate pointer-events-none text-[9px]"><p className="font-black leading-tight truncate">{user?.name}</p><p className="opacity-70">{b.startTime.split('T')[1].slice(0, 5)}-{b.endTime.split('T')[1].slice(0, 5)}</p></div>)}
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

const MonthlyUsageGrid = ({ resources, bookings, users, theme }: { resources: Resource[], bookings: Booking[], users: User[], theme: string }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const daysInMonth = useMemo(() => Array.from({ length: new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate() }, (_, i) => i + 1), [currentDate]);
  
  const getDayStatus = (resourceId: string, day: number) => {
    const dStr = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const booking = bookings.find(b => b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING') && (dStr >= b.startTime.split('T')[0] && dStr <= b.endTime.split('T')[0]));
    if (!booking) return null;
    return { ...booking, userName: users.find(u => u.id === booking.userId)?.name };
  };

  return (
    <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm overflow-hidden animate-in fade-in duration-700">
      <div className="flex justify-between items-center mb-8">
        <h4 className="font-bold flex items-center space-x-2 text-lg"><PieChart className={`text-${theme}-600`} size={20}/> <span>月度资源全景</span></h4>
        <div className="flex items-center bg-gray-50 p-1 rounded-2xl border">
          <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="p-2 hover:bg-white rounded-xl text-gray-400 transition-colors"><ChevronLeft size={18}/></button>
          <span className="px-6 text-sm font-black min-w-[140px] text-center">{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</span>
          <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="p-2 hover:bg-white rounded-xl text-gray-400 transition-colors"><ChevronRight size={18}/></button>
        </div>
      </div>
      <div className="overflow-x-auto custom-scrollbar pb-4">
        <table className="w-full border-collapse">
          <thead><tr><th className="sticky left-0 z-20 bg-white text-left p-4 text-[10px] font-black text-gray-400 uppercase min-w-[180px] border-b">资源名称</th>{daysInMonth.map(day => (<th key={day} className="p-2 text-center border-b min-w-[36px] font-bold text-gray-400 text-[10px]">{day}</th>))}</tr></thead>
          <tbody>{resources.map(res => (<tr key={res.id} className="hover:bg-gray-50 transition-colors"><td className="sticky left-0 z-10 bg-white p-4 border-b text-xs font-bold text-gray-700 truncate">{res.name}</td>{daysInMonth.map(day => { const info = getDayStatus(res.id, day); return (<td key={day} className="p-1 border-b text-center"><div className={`w-full h-8 rounded-md transition-all ${info?.status === 'APPROVED' ? `bg-${theme}-600 shadow-sm` : info?.status === 'PENDING' ? 'bg-amber-300 animate-pulse' : 'bg-gray-50'}`} title={info ? `${info.userName}: ${info.purpose}` : ''}/></td>); })}</tr>))}</tbody>
        </table>
      </div>
    </div>
  );
};

// --- Main App ---

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS' | 'ROLES' | 'DEPARTMENTS' | 'APPROVAL_CENTER' | 'WORKFLOW_CONFIG' | 'DATA_CENTER'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [theme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'indigo');
  
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
  const [showApprovalActionModal, setShowApprovalActionModal] = useState<Booking | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [editingWorkflowNode, setEditingWorkflowNode] = useState<ApprovalNode | null>(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [viewDetail, setViewDetail] = useState<{ type: 'USER' | 'RESOURCE', data: any } | null>(null);
  const [bookingConflict, setBookingConflict] = useState<{ resource: Resource, conflictingBooking: Booking, user: User } | null>(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ roles, users, resources, bookings, departments, workflow })); }, [roles, users, resources, bookings, departments, workflow]);

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
    
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    if (end <= start) {
      alert("提交失败：结束时间必须晚于开始时间，请检查您的选择。");
      return;
    }

    const conflict = bookings.find(b => 
      b.resourceId === resourceId && 
      (b.status === 'APPROVED' || b.status === 'PENDING') && 
      (start < new Date(b.endTime).getTime() && end > new Date(b.startTime).getTime())
    );

    if (conflict) {
      setBookingConflict({ 
        resource, 
        conflictingBooking: conflict, 
        user: users.find(u => u.id === conflict.userId) || { name: '未知人员', department: '--' } as any 
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
    setBookings([newBooking, ...bookings]);
    setShowBookingModal(false);
  };

  const handleApprove = (booking: Booking) => {
    const isLast = booking.currentNodeIndex === workflow.length - 1;
    setBookings(bookings.map(b => b.id === booking.id ? { 
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
    setShowApprovalActionModal(null);
  };

  const handleReject = (booking: Booking, comment: string) => {
    setBookings(bookings.map(b => b.id === booking.id ? { 
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
    setShowApprovalActionModal(null);
  };

  if (!currentUser) return (
    <div className={`min-h-screen bg-${theme}-600 flex items-center justify-center p-6`}>
      <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-full max-w-md animate-in zoom-in">
        <div className="flex justify-center mb-6"><div className={`w-16 h-16 bg-${theme}-600 rounded-2xl flex items-center justify-center text-white shadow-xl`}><Cpu size={32}/></div></div>
        <h1 className="text-2xl font-black text-center mb-10">智慧办公空间管理</h1>
        <div className="space-y-3">
          {users.map(u => (
            <button key={u.id} onClick={() => setCurrentUser(u)} className={`w-full p-4 border border-gray-100 rounded-2xl hover:bg-${theme}-50 transition-all flex items-center justify-between group`}>
              <div className="flex items-center space-x-4">
                <div className={`w-10 h-10 bg-${theme}-100 rounded-full flex items-center justify-center font-bold text-${theme}-600`}>{u.name[0]}</div>
                <div className="text-left">
                  <p className="font-bold text-gray-800 text-sm">{u.name}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">{u.department}</p>
                </div>
              </div>
              <ArrowRight size={16} className="text-gray-300 group-hover:text-indigo-600" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );

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
        <div className="mt-6 pt-6 border-t shrink-0 flex items-center justify-between">
          <div className="flex items-center space-x-2 truncate">
            <div className={`w-8 h-8 bg-${theme}-600 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-inner`}>{currentUser.name[0]}</div>
            <p className="text-xs font-bold truncate">{currentUser.name}</p>
          </div>
          <button onClick={() => setCurrentUser(null)} className="text-gray-400 hover:text-rose-500 transition-colors"><LogOut size={16}/></button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto relative bg-gray-50">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b px-8 flex items-center justify-between sticky top-0 z-40">
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
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'DASHBOARD' && (
            <div className="space-y-6 animate-in fade-in">
              {/* Top Section: Compact Quick Action Row */}
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

              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard title="资源资产总量" value={stats.totalResources} icon={MapPin} trend="+2" color="indigo" onClick={() => setView('RESOURCES')} />
                <StatCard title="活跃核准单" value={stats.activeBookings} icon={Activity} trend="+12%" color="emerald" onClick={() => setView('BOOKINGS')} />
                <StatCard title="待处理任务" value={pendingCount} icon={ShieldCheck} color="amber" onClick={() => setView('APPROVAL_CENTER')} />
              </div>

              {/* Gantt View */}
              <TodayResourceUsage resources={resources} bookings={bookings} users={users} theme={theme} />

              {/* Monthly Grid */}
              <MonthlyUsageGrid resources={resources} bookings={bookings} users={users} theme={theme} />
              
              {/* Quick Navigation Footer */}
              <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-wrap items-center justify-between gap-6">
                <div>
                  <h4 className="font-black text-gray-800">系统管理快捷导航</h4>
                  <p className="text-xs text-gray-400 mt-1">点击图标可快速跳转至对应管理面板</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => setView('RESOURCES')} className="px-5 py-2.5 bg-gray-50 hover:bg-indigo-50 text-[11px] font-black text-gray-500 hover:text-indigo-600 rounded-2xl transition-all border border-gray-100 flex items-center space-x-2 active:scale-95">
                    <MapPin size={16}/> <span>资源库</span>
                  </button>
                  <button onClick={() => setView('USERS')} className="px-5 py-2.5 bg-gray-50 hover:bg-emerald-50 text-[11px] font-black text-gray-500 hover:text-emerald-600 rounded-2xl transition-all border border-gray-100 flex items-center space-x-2 active:scale-95">
                    <Users size={16}/> <span>员工管理</span>
                  </button>
                  <button onClick={() => setView('APPROVAL_CENTER')} className="px-5 py-2.5 bg-gray-50 hover:bg-amber-50 text-[11px] font-black text-gray-500 hover:text-amber-600 rounded-2xl transition-all border border-gray-100 flex items-center space-x-2 active:scale-95">
                    <ShieldCheck size={16}/> <span>审批台</span>
                  </button>
                  {currentUser.role.includes('SYSTEM_ADMIN') && (
                    <button onClick={() => setView('WORKFLOW_CONFIG')} className="px-5 py-2.5 bg-gray-50 hover:bg-indigo-50 text-[11px] font-black text-gray-500 hover:text-indigo-600 rounded-2xl transition-all border border-gray-100 flex items-center space-x-2 active:scale-95">
                      <GitMerge size={16}/> <span>流程配置</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div><h3 className="text-2xl font-black">空间资产</h3><p className="text-sm text-gray-400 mt-1">查看及预约全公司物理空间资源。</p></div>
                <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增资源</span></button>
              </div>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead><tr className="bg-gray-50 border-b"><th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">资源标识</th><th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">物理位置</th><th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">类型/容量</th><th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">状态</th><th className="px-6 py-4 text-right">操作</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">{resources.map(r => (
                    <tr key={r.id} className="hover:bg-indigo-50/20 transition-colors">
                      <td className="px-6 py-4 font-bold text-gray-800">{r.name}</td>
                      <td className="px-6 py-4 text-xs font-medium text-gray-500">{r.location}</td>
                      <td className="px-6 py-4 text-xs text-gray-500">{r.type === 'ROOM' ? '会议室' : '工位'} / {r.capacity || 0}人</td>
                      <td className="px-6 py-4"><StatusBadge status={r.status} theme={theme} /></td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button onClick={() => setViewDetail({ type: 'RESOURCE', data: r })} className="p-2 text-gray-300 hover:text-indigo-600 transition-colors"><Info size={16}/></button>
                        <button onClick={() => { setSelectedResource(r); setShowBookingModal(true); }} className={`px-4 py-1.5 bg-${theme}-600 text-white rounded-lg text-[10px] font-black shadow-md`}>预约</button>
                        {currentUser.role.includes('SYSTEM_ADMIN') && (<button onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className="p-2 text-gray-200 hover:text-indigo-600"><Edit2 size={16}/></button>)}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-end mb-6">
                <div><h3 className="text-2xl font-black">成员名录</h3><p className="text-sm text-gray-400 mt-1">管理企业员工信息及其系统角色。</p></div>
                <button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><UserPlus size={18}/> <span>录入成员</span></button>
              </div>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left">
                  <thead><tr className="bg-gray-50 border-b"><th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">基本信息</th><th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">部门</th><th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">系统角色</th><th className="px-6 py-4 text-right">操作</th></tr></thead>
                  <tbody className="divide-y divide-gray-50">{users.map(u => (
                    <tr key={u.id} className="hover:bg-indigo-50/20 transition-colors">
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
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'ROLES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">角色权限定义</h3></div><button onClick={() => { setEditingRole(null); setShowRoleModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg`}><Plus size={18}/> <span>新增角色</span></button></div>
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

          {view === 'DEPARTMENTS' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">组织架构</h3></div><button onClick={() => setDepartments([...departments, { id: 'dpt-' + Date.now(), name: '新一级部门' }])} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg`}>创建部门</button></div>
              <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm min-h-[400px]">
                {departments.filter(d => !d.parentId).map(root => (<DepartmentTreeNode key={root.id} department={root} departments={departments} onAdd={(pid: string) => setDepartments([...departments, { id: 'dpt-' + Date.now(), name: '子部门', parentId: pid }])} onDelete={(id: string) => setDepartments(departments.filter(d => d.id !== id))} onRename={(id: string, name: string) => setDepartments(departments.map(d => d.id === id ? {...d, name} : d))} theme={theme} />))}
              </div>
            </div>
          )}

          {view === 'WORKFLOW_CONFIG' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">审批流程</h3></div><button onClick={() => { setEditingWorkflowNode(null); setShowWorkflowModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg`}><Plus size={18}/> <span>新增节点</span></button></div>
              <div className="space-y-4">
                {workflow.map((node, index) => (
                  <div key={node.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-indigo-200 transition-all">
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

          {view === 'APPROVAL_CENTER' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="mb-6"><h3 className="text-2xl font-black">审批工作台</h3><p className="text-sm text-gray-400 mt-1">处理待您核准的各类资源申请。</p></div>
              <div className="grid grid-cols-1 gap-4">
                {bookings.filter(b => canApprove(b)).map(b => (
                  <div key={b.id} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between group hover:border-indigo-200 transition-all">
                    <div className="space-y-2">
                      <div className="flex items-center space-x-3"><div className={`w-10 h-10 rounded-xl bg-${theme}-50 flex items-center justify-center text-${theme}-600`}><Briefcase size={18}/></div><h5 className="text-lg font-bold">{b.purpose}</h5></div>
                      <p className="text-xs text-gray-400 pl-13">申请人：{users.find(u => u.id === b.userId)?.name} · 资源：{resources.find(r => r.id === b.resourceId)?.name}</p>
                    </div>
                    <button onClick={() => setShowApprovalActionModal(b)} className={`mt-4 md:mt-0 bg-${theme}-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg flex items-center space-x-2`}><ShieldCheck size={18}/> <span>处理</span></button>
                  </div>
                ))}
                {bookings.filter(b => canApprove(b)).length === 0 && <div className="text-center py-20 bg-white rounded-3xl border border-dashed text-gray-400 font-medium">当前无待处理任务</div>}
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

          {view === 'BOOKINGS' && (
            <div className="space-y-4 animate-in fade-in">
              <h3 className="text-2xl font-black mb-4">我的申请动态</h3>
              {bookings.filter(b => b.userId === currentUser.id).map(b => (
                <div key={b.id} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden p-6 hover:border-indigo-200 transition-all">
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
        </div>
      </main>

      {/* --- Modals --- */}

      {bookingConflict && (
        <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[3rem] w-full max-w-lg p-10 shadow-2xl animate-in zoom-in text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center border-4 border-rose-100 mx-auto mb-6"><AlertTriangle size={32} /></div>
            <h3 className="text-2xl font-black mb-2">时间冲突</h3>
            <p className="text-gray-400 text-sm mb-8">抱歉，该时段已被 <span className="text-rose-500 font-bold">{bookingConflict.user.name}</span> 占用。</p>
            <button onClick={() => setBookingConflict(null)} className={`w-full py-4 bg-${theme}-600 text-white font-black rounded-2xl shadow-xl`}>关闭</button>
          </div>
        </div>
      )}

      {viewDetail && (
        <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[3rem] w-full max-w-xl p-10 shadow-2xl animate-in zoom-in relative">
            <button onClick={() => setViewDetail(null)} className="absolute top-8 right-8 p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-rose-500"><X size={20}/></button>
            <div className="flex items-center space-x-6 mb-10">
              <div className={`w-20 h-20 rounded-3xl bg-${theme}-50 flex items-center justify-center text-${theme}-600`}>{viewDetail.type === 'USER' ? <UserCircle size={40}/> : <MapPin size={40}/>}</div>
              <div className="text-left"><h2 className="text-3xl font-black text-gray-800">{viewDetail.data.name}</h2><p className="text-gray-400 font-bold">{viewDetail.type === 'USER' ? viewDetail.data.department : viewDetail.data.location}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-8 mb-10 text-left">
              {viewDetail.type === 'USER' ? (<>
                <div className="space-y-1"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">邮箱地址</p><p className="font-bold text-gray-700">{viewDetail.data.email}</p></div>
                <div className="space-y-1"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">手机号码</p><p className="font-bold text-gray-700">{viewDetail.data.mobile || '--'}</p></div>
                <div className="col-span-2 space-y-2"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">所属角色</p><div className="flex flex-wrap gap-1">{viewDetail.data.role.map((r: string) => <RoleTag key={r} roleId={r} roles={roles} theme={theme}/>)}</div></div>
              </>) : (<>
                <div className="space-y-1"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">资源类型</p><p className="font-bold text-gray-700">{viewDetail.data.type === 'ROOM' ? '多功能会议室' : '独立办公工位'}</p></div>
                <div className="space-y-1"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">额定人数</p><p className="font-bold text-gray-700">{viewDetail.data.capacity} 人</p></div>
                <div className="col-span-2 space-y-2"><p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">内置设施</p><div className="flex flex-wrap gap-2">{viewDetail.data.features.map((f: string) => <span key={f} className="px-3 py-1 bg-gray-50 border rounded-lg text-[10px] font-bold text-gray-500">{f}</span>)}</div></div>
              </>)}
            </div>
            <button onClick={() => setViewDetail(null)} className={`w-full py-4 bg-${theme}-600 text-white font-black rounded-2xl`}>返回</button>
          </div>
        </div>
      )}

      {showUserModal && <UserModal user={editingUser} departments={departments} roles={roles} onClose={() => setShowUserModal(false)} onSave={(data: any) => { if(editingUser) setUsers(users.map(u => u.id === editingUser.id ? {...u, ...data} : u)); else setUsers([...users, { id: 'u-'+Date.now(), ...data }]); setShowUserModal(false); }} theme={theme} />}
      {showResourceModal && <ResourceModal resource={editingResource} onClose={() => setShowResourceModal(false)} onSave={(data: any) => { if(editingResource) setResources(resources.map(r => r.id === editingResource.id ? {...r, ...data} : r)); else setResources([...resources, { id: 'r-'+Date.now(), status: 'AVAILABLE', features: [], ...data }]); setShowResourceModal(false); }} theme={theme} />}
      {showRoleModal && <RoleModal role={editingRole} onClose={() => setShowRoleModal(false)} onSave={(data: any) => { if(editingRole) setRoles(roles.map(r => r.id === editingRole.id ? {...r, ...data} : r)); else setRoles([...roles, { id: 'rl-'+Date.now(), ...data }]); setShowRoleModal(false); }} theme={theme} />}
      {showWorkflowModal && <WorkflowModal node={editingWorkflowNode} roles={roles} onClose={() => setShowWorkflowModal(false)} onSave={(data: any) => { if(editingWorkflowNode) setWorkflow(workflow.map(n => n.id === editingWorkflowNode.id ? {...n, ...data} : n)); else setWorkflow([...workflow, { id: 'wf-'+Date.now(), ...data }]); setShowWorkflowModal(false); }} theme={theme} />}
      {showBookingModal && selectedResource && (<BookingFormModal resource={selectedResource} theme={theme} onClose={() => setShowBookingModal(false)} onConfirm={handleBooking} availableResources={resources.filter(r => r.status === 'AVAILABLE')}/>)}
      {showApprovalActionModal && (<ApprovalActionModal booking={showApprovalActionModal} workflow={workflow} users={users} theme={theme} onApprove={() => handleApprove(showApprovalActionModal)} onReject={(c: any) => handleReject(showApprovalActionModal, c)} onClose={() => setShowApprovalActionModal(null)} />)}
    </div>
  );
};

// --- Modal Helper Components ---

const UserModal = ({ user, departments, roles, onClose, onSave, theme }: any) => {
  const [data, setData] = useState<Partial<User>>(user || { name: '', email: '', role: ['EMPLOYEE'], department: departments[0]?.name || '' });
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-6">{user ? '编辑档案' : '录入成员'}</h2>
        <div className="space-y-4">
          <input value={data.name} onChange={e => setData({...data, name: e.target.value})} placeholder="真实姓名" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
          <input value={data.email} onChange={e => setData({...data, email: e.target.value})} placeholder="企业邮箱" className="w-full p-4 bg-gray-50 rounded-2xl outline-none" />
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

const BookingFormModal = ({ resource, theme, onClose, onConfirm, availableResources }: any) => {
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState("09:00");
  
  // Default duration logic
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    if (resource.type === 'DESK') d.setMonth(d.getMonth() + 1); // 1 month for Desk
    return d.toISOString().split('T')[0];
  });
  const [endTime, setEndTime] = useState(() => {
    if (resource.type === 'ROOM') return "10:00"; // 1 hour for Room (09:00 - 10:00)
    return "09:00";
  });

  const [loadingAI, setLoadingAI] = useState(false);
  const [recommendation, setRecommendation] = useState('');

  return (
    <div className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-[3rem] w-full max-w-lg shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-1">资源预约</h2>
        <p className="text-xs text-gray-400 mb-8">目标: <span className={`text-${theme}-600 font-bold`}>{resource.name}</span> | {resource.type === 'ROOM' ? '默认 1 小时' : '默认 1 个月'}</p>
        <div className="space-y-6">
           <div className="grid grid-cols-2 gap-4 text-left">
             <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">开始日期</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold border-none" /></div>
             <div className="space-y-1"><label className="text-[9px] font-black text-gray-400 uppercase tracking-widest">结束日期</label><input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold border-none" /></div>
           </div>
           <div className="grid grid-cols-2 gap-4 text-left">
             <div className="space-y-1"><label className="text-[9px] text-gray-300 font-black ml-1 uppercase">开始时刻</label><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold border-none" /></div>
             <div className="space-y-1"><label className="text-[9px] text-gray-300 font-black ml-1 uppercase">结束时刻</label><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold border-none" /></div>
           </div>
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
      {workflow.map((node: any, index: any) => {
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

const ApprovalActionModal = ({ booking, workflow, users, theme, onApprove, onReject, onClose }: any) => (
  <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-white rounded-[3rem] w-full max-2xl p-10 shadow-2xl animate-in zoom-in">
      <div className="flex items-center justify-between mb-8"><h2 className="text-2xl font-black">工单审批</h2><button onClick={onClose} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-rose-500"><X size={24}/></button></div>
      <div className="bg-gray-50 p-8 rounded-[2rem] border mb-8 text-left">
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">申请理由</p>
        <p className="text-lg font-bold text-gray-800 mb-6">{booking.purpose}</p>
        <div className="grid grid-cols-2 gap-4">
          <div><p className="text-[10px] text-gray-400 uppercase font-black">申请人</p><p className="font-bold text-gray-700">{users.find((u:any) => u.id === booking.userId)?.name}</p></div>
          <div><p className="text-[10px] text-gray-400 uppercase font-black">时段</p><p className="font-bold text-gray-700">{booking.startTime.replace('T', ' ')}</p></div>
        </div>
      </div>
      <div className="flex space-x-4"><button onClick={() => { const c = prompt('理由：'); if(c !== null) onReject(c); }} className="flex-1 py-5 bg-rose-50 text-rose-600 font-bold rounded-2xl">拒绝申请</button><button onClick={onApprove} className={`flex-[2] py-5 bg-${theme}-600 text-white font-black rounded-2xl shadow-xl`}>通过核准</button></div>
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

const DepartmentTreeNode = ({ department, departments, onAdd, onDelete, onRename, theme }: any) => {
  const children = departments.filter((d: any) => d.parentId === department.id);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(department.name);
  const handleRename = () => { if(newName.trim()) onRename(department.id, newName); setIsEditing(false); };
  return (
    <div className="ml-6 border-l-2 border-gray-100 pl-6 my-2">
      <div className="flex items-center group">
        <div className="flex items-center space-x-3 bg-white p-2 rounded-xl border border-gray-100 shadow-sm hover:border-indigo-200 transition-all flex-1 min-w-0">
          <button onClick={() => setIsExpanded(!isExpanded)} className={`w-6 h-6 rounded-lg bg-${theme}-50 flex items-center justify-center text-${theme}-600 transition-colors`}>{children.length > 0 ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <FolderTree size={12} />}</button>
          {isEditing ? <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onBlur={handleRename} onKeyDown={e => e.key === 'Enter' && handleRename()} className="flex-1 bg-gray-50 border-none outline-none text-xs font-bold p-1 rounded-md" /> : <span className="text-xs font-bold text-gray-700 truncate">{department.name}</span>}
          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => setIsEditing(true)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-indigo-600 transition-colors"><Edit2 size={10}/></button><button onClick={() => onAdd(department.id)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-emerald-600 transition-colors"><Plus size={10}/></button><button onClick={() => onDelete(department.id)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-rose-500 transition-colors"><Trash2 size={10}/></button></div>
        </div>
      </div>
      {isExpanded && children.length > 0 && <div className="mt-1">{children.map((child: any) => (<DepartmentTreeNode key={child.id} department={child} departments={departments} onAdd={onAdd} onDelete={onDelete} onRename={onRename} theme={theme}/>))}</div>}
    </div>
  );
};

export default App;
