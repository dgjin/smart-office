
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, MapPin, Calendar, CheckCircle, XCircle, LayoutDashboard, Plus, LogOut, 
  Cpu, Monitor, Coffee, Edit2, Trash2, UserPlus, RefreshCw,
  Clock, GitMerge, ChevronRight, ArrowRight, ChevronDown, ChevronUp,
  Layers, Zap, ShieldCheck, Check, X, FileText, Building2, Palette, 
  PieChart, Activity, ChevronLeft, Sparkles, SendHorizontal, BellRing, 
  History, Timer, Briefcase, Shield, FolderTree, ArrowRightCircle,
  Settings2, MoveUp, MoveDown, UserCircle, AlertTriangle
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, ApprovalRecord, Notification, Department, RoleDefinition } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS, INITIAL_ROLES } from './constants';
import { getSmartRecommendation } from './services/geminiService';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V23';
const THEME_KEY = 'SMART_OFFICE_THEME';

// --- 通用子组件 ---

const StatusBadge = ({ status, theme }: any) => {
  const styles: any = { 
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100', 
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100', 
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100', 
    APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`, 
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100', 
    COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200',
    CANCELLED: 'bg-gray-50 text-gray-400 border-gray-100'
  };
  const labels: any = { AVAILABLE: '空闲', PENDING: '审批中', APPROVED: '已通过', REJECTED: '驳回', OCCUPIED: '占用', COMPLETED: '结束', CANCELLED: '已取消' };
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

// --- 审批流可视化组件 ---

const WorkflowStepper = ({ booking, workflow, users, theme }: { booking: Booking, workflow: ApprovalNode[], users: User[], theme: string }) => {
  return (
    <div className="flex items-start justify-between relative pt-4 pb-8">
      <div className="absolute top-[34px] left-0 right-0 h-0.5 bg-gray-100 z-0" />
      <div 
        className={`absolute top-[34px] left-0 h-0.5 bg-${theme}-500 transition-all duration-500 z-0`} 
        style={{ width: booking.status === 'REJECTED' ? '0%' : booking.status === 'APPROVED' ? '100%' : workflow.length > 0 ? `${(booking.currentNodeIndex / workflow.length) * 100}%` : '0%' }}
      />
      {workflow.map((node, index) => {
        const isCompleted = index < booking.currentNodeIndex || booking.status === 'APPROVED';
        const isActive = index === booking.currentNodeIndex && booking.status === 'PENDING';
        const isRejected = booking.status === 'REJECTED' && index === booking.currentNodeIndex;
        const approverNames = users.filter(u => u.role.includes(node.approverRole)).map(u => u.name).join(', ');
        return (
          <div key={node.id} className="relative z-10 flex flex-col items-center flex-1">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-white shadow-md transition-all ${
              isCompleted ? `bg-${theme}-600 text-white` : isRejected ? 'bg-rose-500 text-white' : isActive ? 'bg-white border-amber-400 text-amber-500 animate-pulse' : 'bg-white text-gray-300'
            }`}>
              {isCompleted ? <Check size={18} /> : isRejected ? <X size={18} /> : isActive ? <Clock size={18} /> : <span>{index + 1}</span>}
            </div>
            <div className="mt-3 text-center">
              <p className={`text-[11px] font-bold ${isActive ? 'text-amber-600' : isCompleted ? 'text-gray-800' : 'text-gray-400'}`}>{node.name}</p>
              <p className="text-[9px] text-gray-400 font-bold truncate max-w-[80px] mt-0.5">{approverNames || '待定'}</p>
            </div>
          </div>
        );
      })}
      {workflow.length === 0 && <div className="w-full text-center py-4 text-xs text-gray-400 italic">未配置审批流程</div>}
    </div>
  );
};

// --- 月度使用全景表 ---

const MonthlyUsageGrid = ({ resources, bookings, users, theme }: { resources: Resource[], bookings: Booking[], users: User[], theme: string }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const daysInMonth = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    return Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1);
  }, [currentDate]);

  const getDayStatus = (resourceId: string, day: number) => {
    const year = currentDate.getFullYear();
    const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    const dayStr = day.toString().padStart(2, '0');
    const datePrefix = `${year}-${month}-${dayStr}`;
    
    // 检查是否有预订覆盖该日期
    const booking = bookings.find(b => {
      if (b.resourceId !== resourceId || !['APPROVED', 'PENDING'].includes(b.status)) return false;
      const bStart = b.startTime.split('T')[0];
      const bEnd = b.endTime.split('T')[0];
      return datePrefix >= bStart && datePrefix <= bEnd;
    });

    if (!booking) return null;
    const user = users.find(u => u.id === booking.userId);
    return { ...booking, userName: user?.name, userDept: user?.department };
  };

  return (
    <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex justify-between items-center mb-8">
        <h4 className="font-bold flex items-center space-x-2 text-lg">
          <PieChart className={`text-${theme}-600`} size={20}/> 
          <span>月度资源使用全景</span>
        </h4>
        <div className="flex items-center bg-gray-50 p-1 rounded-2xl border">
          <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="p-2 hover:bg-white rounded-xl text-gray-400 transition-colors"><ChevronLeft size={18}/></button>
          <span className="px-6 text-sm font-black min-w-[140px] text-center">{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</span>
          <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="p-2 hover:bg-white rounded-xl text-gray-400 transition-colors"><ChevronRight size={18}/></button>
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar pb-4">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-white text-left p-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest min-w-[200px] border-b">资源名称</th>
              {daysInMonth.map(day => (
                <th key={day} className="p-2 text-center border-b min-w-[40px] font-bold text-gray-400 text-[10px]">{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map(res => (
              <tr key={res.id} className="hover:bg-gray-50 group">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 transition-colors p-4 border-b text-xs font-bold text-gray-700">
                  <div className="flex items-center space-x-2">
                    {res.type === 'ROOM' ? <Monitor size={12} className="text-indigo-400"/> : <Coffee size={12} className="text-emerald-400"/>}
                    <span>{res.name}</span>
                  </div>
                </td>
                {daysInMonth.map(day => {
                  const info = getDayStatus(res.id, day);
                  return (
                    <td key={day} className="p-1 border-b text-center relative group/cell">
                      <div className={`w-full h-10 rounded-lg flex items-center justify-center transition-all ${
                        info?.status === 'APPROVED' ? `bg-${theme}-600 shadow-sm shadow-${theme}-100` : 
                        info?.status === 'PENDING' ? 'bg-amber-100 animate-pulse' : 
                        'bg-gray-50/50'
                      }`}>
                        {info && <span className="text-[10px] text-white font-black drop-shadow-sm pointer-events-none">{info.userName?.slice(0, 1)}</span>}
                      </div>
                      
                      {info && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-56 bg-gray-900 text-white p-4 rounded-2xl text-[11px] invisible group-hover/cell:visible z-30 shadow-2xl animate-in zoom-in pointer-events-none">
                          <div className="space-y-2">
                            <p className="font-black text-indigo-300 flex items-center justify-between">
                              <span>{info.userName}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[8px] bg-white/10 ${info.status === 'APPROVED' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {info.status === 'APPROVED' ? '已核准' : '审批中'}
                              </span>
                            </p>
                            <div className="space-y-1 opacity-80">
                              <p className="flex items-center space-x-2"><Briefcase size={10}/> <span>{info.userDept}</span></p>
                              <p className="flex items-center space-x-2"><FileText size={10}/> <span>{info.purpose}</span></p>
                            </div>
                          </div>
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900"/>
                        </div>
                      )}
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

// --- 主程序 ---

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS' | 'ROLES' | 'DEPARTMENTS' | 'APPROVAL_CENTER' | 'WORKFLOW_CONFIG'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'indigo');
  
  // 数据状态
  const [roles, setRoles] = useState<RoleDefinition[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).roles : INITIAL_ROLES;
  });
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).users : INITIAL_USERS;
  });
  const [resources, setResources] = useState<Resource[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).resources : INITIAL_RESOURCES;
  });
  const [bookings, setBookings] = useState<Booking[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).bookings : INITIAL_BOOKINGS;
  });
  const [departments, setDepartments] = useState<Department[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved).departments || INITIAL_DEPARTMENTS) : INITIAL_DEPARTMENTS;
  });
  const [workflow, setWorkflow] = useState<ApprovalNode[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved).workflow || DEFAULT_WORKFLOW) : DEFAULT_WORKFLOW;
  });

  // 模态框状态
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [showApprovalActionModal, setShowApprovalActionModal] = useState<Booking | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [editingWorkflowNode, setEditingWorkflowNode] = useState<ApprovalNode | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ roles, users, resources, bookings, departments, workflow }));
  }, [roles, users, resources, bookings, departments, workflow]);

  // 计算属性
  const canApprove = (booking: Booking) => {
    if (booking.status !== 'PENDING') return false;
    const currentNode = workflow[booking.currentNodeIndex];
    if (!currentNode) return false;
    return currentUser?.role.includes(currentNode.approverRole);
  };
  const pendingApprovalsCount = bookings.filter(b => canApprove(b)).length;

  // 处理函数
  const handleBooking = (resourceId: string, purpose: string, startTime: string, endTime: string) => {
    const resource = resources.find(r => r.id === resourceId);
    if (!resource || !currentUser) return;

    // --- 预订冲突检测逻辑 ---
    const newStart = new Date(startTime).getTime();
    const newEnd = new Date(endTime).getTime();

    if (newEnd <= newStart) {
      alert("结束时间必须晚于开始时间，请重新选择。");
      return;
    }

    const hasConflict = bookings.some(b => {
      // 仅检查同一资源且状态为已通过或审批中的预订
      if (b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING')) {
        const existStart = new Date(b.startTime).getTime();
        const existEnd = new Date(b.endTime).getTime();
        // 时间重叠判定: (StartA < EndB) 且 (EndA > StartB)
        return newStart < existEnd && newEnd > existStart;
      }
      return false;
    });

    if (hasConflict) {
      alert(`抱歉，${resource.name} 在所选时间段内已被预订或正在审批中，请尝试其他时段。`);
      return;
    }

    const newBooking: Booking = {
      id: `bk-${Date.now()}`,
      userId: currentUser.id,
      resourceId,
      type: resource.type,
      startTime,
      endTime,
      status: 'PENDING',
      purpose,
      createdAt: new Date().toISOString(),
      currentNodeIndex: 0,
      approvalHistory: [],
    };
    if (workflow.length === 0) {
      newBooking.status = 'APPROVED';
    }
    setBookings([newBooking, ...bookings]);
    setShowBookingModal(false);
    setSelectedResource(null);
  };

  const handleSaveUser = (data: Partial<User>) => {
    if (editingUser) {
      setUsers(users.map(u => u.id === editingUser.id ? { ...u, ...data } as User : u));
    } else {
      setUsers([...users, { id: 'u-' + Date.now(), role: ['EMPLOYEE'], ...data } as User]);
    }
    setShowUserModal(false);
    setEditingUser(null);
  };

  const handleSaveRole = (data: Partial<RoleDefinition>) => {
    if (editingRole) {
      setRoles(roles.map(r => r.id === editingRole.id ? { ...r, ...data } as RoleDefinition : r));
    } else {
      setRoles([...roles, { id: 'r-' + Date.now(), ...data } as RoleDefinition]);
    }
    setShowRoleModal(false);
    setEditingRole(null);
  };

  const handleSaveResource = (data: Partial<Resource>) => {
    if (editingResource) setResources(resources.map(r => r.id === editingResource.id ? { ...r, ...data } as Resource : r));
    else setResources([...resources, { id: 'res-' + Date.now(), status: 'AVAILABLE', features: [], ...data } as Resource]);
    setShowResourceModal(false);
    setEditingResource(null);
  };

  const handleSaveWorkflowNode = (data: Partial<ApprovalNode>) => {
    if (editingWorkflowNode) {
      setWorkflow(workflow.map(n => n.id === editingWorkflowNode.id ? { ...n, ...data } as ApprovalNode : n));
    } else {
      setWorkflow([...workflow, { id: 'node-' + Date.now(), ...data } as ApprovalNode]);
    }
    setShowWorkflowModal(false);
    setEditingWorkflowNode(null);
  };

  const handleApprove = (booking: Booking) => {
    const isLastNode = booking.currentNodeIndex === workflow.length - 1;
    setBookings(bookings.map(b => b.id === booking.id ? {
      ...b,
      currentNodeIndex: isLastNode ? b.currentNodeIndex : b.currentNodeIndex + 1,
      status: isLastNode ? 'APPROVED' as BookingStatus : 'PENDING' as BookingStatus,
      approvalHistory: [...b.approvalHistory, {
        nodeName: workflow[b.currentNodeIndex].name,
        approverName: currentUser?.name || '未知',
        status: 'APPROVED' as any,
        timestamp: new Date().toISOString()
      }]
    } : b));
    setShowApprovalActionModal(null);
  };

  const handleReject = (booking: Booking, comment: string) => {
    setBookings(bookings.map(b => b.id === booking.id ? {
      ...b,
      status: 'REJECTED' as BookingStatus,
      approvalHistory: [...b.approvalHistory, {
        nodeName: workflow[b.currentNodeIndex].name,
        approverName: currentUser?.name || '未知',
        status: 'REJECTED' as any,
        timestamp: new Date().toISOString(),
        comment
      }]
    } : b));
    setShowApprovalActionModal(null);
  };

  const moveWorkflowNode = (index: number, direction: 'UP' | 'DOWN') => {
    const newWorkflow = [...workflow];
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newWorkflow.length) return;
    [newWorkflow[index], newWorkflow[targetIndex]] = [newWorkflow[targetIndex], newWorkflow[index]];
    setWorkflow(newWorkflow);
  };

  if (!currentUser) {
    return (
      <div className={`min-h-screen bg-${theme}-600 flex items-center justify-center p-6`}>
        <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-full max-w-md animate-in zoom-in">
          <div className="flex justify-center mb-6"><div className={`w-16 h-16 bg-${theme}-600 rounded-2xl flex items-center justify-center text-white shadow-xl`}><Cpu size={32}/></div></div>
          <h1 className="text-2xl font-black text-center mb-10">SmartOffice 登录</h1>
          <div className="space-y-3">
            {users.map(u => (
              <button key={u.id} onClick={() => setCurrentUser(u)} className={`w-full p-4 border border-gray-100 rounded-2xl hover:bg-${theme}-50 transition-all flex items-center justify-between group`}>
                <div className="flex items-center space-x-4"><div className={`w-10 h-10 bg-${theme}-100 rounded-full flex items-center justify-center font-bold text-${theme}-600`}>{u.name[0]}</div><div><p className="font-bold text-gray-800 text-sm">{u.name}</p><p className="text-[10px] text-gray-400">{u.department}</p></div></div>
                <ArrowRight size={16} className="text-gray-300 group-hover:text-indigo-600" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-gray-50 overflow-hidden">
      <aside className="w-64 bg-white border-r hidden lg:flex flex-col p-6 sticky top-0 h-screen">
        <div className="flex items-center space-x-3 mb-10 px-2 shrink-0"><div className={`w-8 h-8 bg-${theme}-600 rounded-lg flex items-center justify-center text-white shadow-lg`}><Cpu size={18}/></div><span className="text-lg font-black tracking-tight">SmartOffice</span></div>
        <nav className="flex-1 space-y-2 overflow-y-auto custom-scrollbar">
          <SidebarItem icon={LayoutDashboard} label="数据仪表盘" id="DASHBOARD" active={view === 'DASHBOARD'} onClick={setView} theme={theme} />
          <SidebarItem icon={MapPin} label="空间资源库" id="RESOURCES" active={view === 'RESOURCES'} onClick={setView} theme={theme} />
          <SidebarItem icon={Calendar} label="我的申请" id="BOOKINGS" active={view === 'BOOKINGS'} onClick={setView} theme={theme} />
          
          <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">流程中心</div>
          <SidebarItem icon={ShieldCheck} label="审批任务" id="APPROVAL_CENTER" active={view === 'APPROVAL_CENTER'} onClick={setView} theme={theme} badge={pendingApprovalsCount} />

          {currentUser.role.includes('SYSTEM_ADMIN') && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">系统设置</div>
              <SidebarItem icon={GitMerge} label="流程配置" id="WORKFLOW_CONFIG" active={view === 'WORKFLOW_CONFIG'} onClick={setView} theme={theme} />
              <SidebarItem icon={Building2} label="部门管理" id="DEPARTMENTS" active={view === 'DEPARTMENTS'} onClick={setView} theme={theme} />
              <SidebarItem icon={Shield} label="角色管理" id="ROLES" active={view === 'ROLES'} onClick={setView} theme={theme} />
              <SidebarItem icon={Users} label="成员中心" id="USERS" active={view === 'USERS'} onClick={setView} theme={theme} />
            </>
          )}
        </nav>
        <div className="mt-6 pt-6 border-t shrink-0 flex items-center justify-between">
           <div className="flex items-center space-x-2 truncate">
              <div className={`w-8 h-8 bg-${theme}-600 rounded-full flex items-center justify-center text-white font-bold text-xs`}>{currentUser.name[0]}</div>
              <p className="text-xs font-bold truncate">{currentUser.name}</p>
           </div>
           <button onClick={() => setCurrentUser(null)} className="text-gray-400 hover:text-rose-500 transition-colors"><LogOut size={16}/></button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b px-8 flex items-center justify-between sticky top-0 z-40">
          <h2 className="text-lg font-bold">
            {view === 'DASHBOARD' && '数据仪表盘'} 
            {view === 'WORKFLOW_CONFIG' && '审批流程配置'}
            {view === 'RESOURCES' && '空间资源库'} 
            {view === 'BOOKINGS' && '申请记录动态'}
            {view === 'USERS' && '成员管理中心'}
            {view === 'APPROVAL_CENTER' && '审批工作台'}
            {view === 'ROLES' && '角色管理'}
            {view === 'DEPARTMENTS' && '部门管理'}
          </h2>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'DASHBOARD' && (
            <div className="space-y-8 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button onClick={() => setView('RESOURCES')} className="p-8 bg-indigo-600 rounded-[2.5rem] text-white shadow-xl hover:scale-[1.02] transition-all flex items-center justify-between group relative overflow-hidden">
                   <div className="relative z-10 text-left"><p className="text-indigo-200 text-[10px] font-black uppercase mb-1">快捷入口</p><h3 className="text-2xl font-black">会议室预订</h3></div>
                   <Monitor size={56} className="text-white/10 absolute -right-4 top-1/2 -translate-y-1/2 group-hover:scale-125 transition-all" />
                </button>
                <button onClick={() => setView('RESOURCES')} className="p-8 bg-emerald-600 rounded-[2.5rem] text-white shadow-xl hover:scale-[1.02] transition-all flex items-center justify-between group relative overflow-hidden">
                   <div className="relative z-10 text-left"><p className="text-emerald-200 text-[10px] font-black uppercase mb-1">快捷入口</p><h3 className="text-2xl font-black">流动工位申请</h3></div>
                   <Coffee size={56} className="text-white/10 absolute -right-4 top-1/2 -translate-y-1/2 group-hover:scale-125 transition-all" />
                </button>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: '空闲会议室', value: resources.filter(r => r.status === 'AVAILABLE' && r.type === 'ROOM').length, icon: Monitor, color: 'text-indigo-600', target: 'RESOURCES' },
                  { label: '可用工作位', value: resources.filter(r => r.status === 'AVAILABLE' && r.type === 'DESK').length, icon: Coffee, color: 'text-emerald-600', target: 'RESOURCES' },
                  { label: '待我审批', value: pendingApprovalsCount, icon: ShieldCheck, color: 'text-amber-600', target: 'APPROVAL_CENTER' },
                  { label: '累计预订数', value: bookings.length, icon: Calendar, color: `text-${theme}-600`, target: 'BOOKINGS' },
                ].map((s, i) => (
                  <button key={i} onClick={() => setView(s.target as any)} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center space-x-4 hover:shadow-md transition-all text-left group">
                    <div className={`w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center ${s.color} group-hover:bg-gray-100 transition-colors`}><s.icon size={20}/></div>
                    <div><p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{s.label}</p><p className="text-2xl font-black">{s.value}</p></div>
                  </button>
                ))}
              </div>

              <MonthlyUsageGrid resources={resources} bookings={bookings} users={users} theme={theme} />

              <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm">
                 <div className="flex justify-between items-center mb-10">
                   <h4 className="font-bold flex items-center space-x-2 text-lg">
                     <Clock className={`text-${theme}-600`} size={20}/> 
                     <span>今日资源预订动态</span>
                   </h4>
                 </div>
                 <div className="relative ml-4 border-l-2 border-dashed border-gray-100 pl-10 space-y-8 max-h-[500px] overflow-y-auto custom-scrollbar pr-4">
                    {bookings.filter(b => {
                      const today = new Date().toISOString().split('T')[0];
                      const bStart = b.startTime.split('T')[0];
                      const bEnd = b.endTime.split('T')[0];
                      return today >= bStart && today <= bEnd;
                    }).length > 0 ? (
                      bookings.filter(b => {
                        const today = new Date().toISOString().split('T')[0];
                        const bStart = b.startTime.split('T')[0];
                        const bEnd = b.endTime.split('T')[0];
                        return today >= bStart && today <= bEnd;
                      }).map(b => {
                        const user = users.find(u => u.id === b.userId);
                        const resource = resources.find(r => r.id === b.resourceId);
                        return (
                          <div key={b.id} className="relative group">
                            <div className={`absolute -left-[49px] top-1.5 w-6 h-6 rounded-full border-4 border-white shadow-md z-10 flex items-center justify-center transition-all ${b.status === 'APPROVED' ? `bg-${theme}-600 text-white` : 'bg-amber-400 text-white'}`}>{b.status === 'APPROVED' ? <Check size={12}/> : <Clock size={12}/>}</div>
                            <div className="bg-gray-50/50 p-6 rounded-[2rem] border border-transparent hover:border-indigo-100 hover:bg-white hover:shadow-xl transition-all duration-300">
                               <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                  <div className="flex items-center space-x-4">
                                     <div className="text-center min-w-[60px]">
                                       <p className="text-lg font-black text-gray-800 leading-none">{new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                       <p className="text-[10px] text-gray-400 mt-1 uppercase">START</p>
                                     </div>
                                     <div className={`h-10 w-1 bg-${theme}-100 rounded-full opacity-50`}/>
                                     <div>
                                       <h5 className="font-bold text-sm text-gray-800">{b.purpose}</h5>
                                       <div className="flex items-center space-x-2 mt-1">
                                         <span className="px-2 py-0.5 rounded-md bg-gray-100 text-[9px] font-black text-gray-500 uppercase">{resource?.name}</span>
                                       </div>
                                     </div>
                                  </div>
                                  <div className="flex items-center space-x-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm self-start md:self-center">
                                     <div className={`w-8 h-8 rounded-full bg-${theme}-50 flex items-center justify-center text-${theme}-600`}><UserCircle size={18}/></div>
                                     <div className="min-w-0">
                                       <p className="text-xs font-bold text-gray-800 truncate">{user?.name || '未知用户'}</p>
                                       <p className="text-[9px] text-gray-400 font-bold truncate uppercase">{user?.department || '未分配部门'}</p>
                                     </div>
                                  </div>
                                  <StatusBadge status={b.status} theme={theme} />
                               </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="py-20 text-center">
                        <Calendar size={48} className="text-gray-100 mx-auto mb-4"/>
                        <p className="text-gray-300 font-bold italic">今日暂无空间占用记录</p>
                      </div>
                    )}
                 </div>
              </div>
            </div>
          )}

          {view === 'WORKFLOW_CONFIG' && (
            <div className="space-y-8 animate-in fade-in">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-2xl font-black">审批流程引擎</h3>
                  <p className="text-sm text-gray-400 mt-1">定义资源申请的流转逻辑，支持多级串行审核。</p>
                </div>
                <button onClick={() => { setEditingWorkflowNode(null); setShowWorkflowModal(true); }} className={`bg-${theme}-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg flex items-center space-x-2 active:scale-95 transition-all`}><Plus size={20}/> <span>新增环节</span></button>
              </div>

              <div className="relative space-y-4">
                {workflow.map((node, index) => (
                  <div key={node.id} className="relative group">
                    {index < workflow.length - 1 && (
                      <div className="absolute left-10 top-full h-4 w-0.5 bg-gray-100 z-0 flex items-center justify-center">
                        <ChevronDown size={14} className="text-gray-200 mt-2" />
                      </div>
                    )}
                    <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between group-hover:border-indigo-200 transition-all z-10 relative">
                       <div className="flex items-center space-x-6">
                          <div className={`w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-black text-${theme}-600 border border-gray-100 shadow-inner`}>{index + 1}</div>
                          <div>
                             <h5 className="font-black text-gray-800">{node.name}</h5>
                             <div className="flex items-center space-x-2 mt-1">
                                <RoleTag roleId={node.approverRole} roles={roles} theme={theme} />
                                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">负责此环节核准</span>
                             </div>
                          </div>
                       </div>
                       <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => moveWorkflowNode(index, 'UP')} disabled={index === 0} className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-20"><MoveUp size={16}/></button>
                          <button onClick={() => moveWorkflowNode(index, 'DOWN')} disabled={index === workflow.length - 1} className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-20"><MoveDown size={16}/></button>
                          <div className="w-px h-4 bg-gray-100 mx-2"/>
                          <button onClick={() => { setEditingWorkflowNode(node); setShowWorkflowModal(true); }} className="p-2 text-gray-400 hover:text-indigo-600"><Edit2 size={16}/></button>
                          <button onClick={() => setWorkflow(workflow.filter(n => n.id !== node.id))} className="p-2 text-gray-400 hover:text-rose-500"><Trash2 size={16}/></button>
                       </div>
                    </div>
                  </div>
                ))}
                {workflow.length === 0 && (
                  <div className="py-24 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-gray-100">
                    <Settings2 size={48} className="text-gray-100 mx-auto mb-4"/>
                    <p className="text-gray-400 font-bold italic">尚未配置流程环节，提交申请将自动通过</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'ROLES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-8">
                <div><h3 className="text-2xl font-black">角色管理</h3><p className="text-sm text-gray-400 mt-1">自定义系统角色，配置其描述与视觉标识色。</p></div>
                <button onClick={() => { setEditingRole(null); setShowRoleModal(true); }} className={`flex items-center space-x-2 bg-${theme}-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg transition-all active:scale-95`}><Plus size={20}/> <span>定义新角色</span></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {roles.map(r => (
                  <div key={r.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:border-indigo-100 transition-all group relative">
                    <div className={`w-12 h-12 rounded-2xl bg-${r.color}-50 flex items-center justify-center mb-6`}><Shield className={`text-${r.color}-600`} /></div>
                    <div className="absolute top-8 right-8 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingRole(r); setShowRoleModal(true); }} className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:text-indigo-600 transition-colors"><Edit2 size={14}/></button>
                      <button onClick={() => setRoles(roles.filter(role => role.id !== r.id))} className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:text-rose-600 transition-colors"><Trash2 size={14}/></button>
                    </div>
                    <h5 className="text-lg font-bold mb-2">{r.name}</h5>
                    <p className="text-xs text-gray-400 leading-relaxed min-h-[40px] mb-6 font-medium">{r.description}</p>
                    <div className="pt-6 border-t border-gray-50 flex justify-between items-center">
                       <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">UID: {r.id}</span>
                       <div className={`w-3 h-3 rounded-full bg-${r.color}-500 shadow-lg shadow-${r.color}-200`}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'DEPARTMENTS' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-8">
                <div><h3 className="text-2xl font-black">部门管理</h3><p className="text-sm text-gray-400 mt-1">管理维护企业的组织架构与各级职能部门。</p></div>
                <button onClick={() => setDepartments([...departments, { id: 'dpt-' + Date.now(), name: '新部门' }])} className={`bg-${theme}-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg transition-all active:scale-95`}><Plus size={20}/> <span>创建一级部门</span></button>
              </div>
              <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm min-h-[400px]">
                {departments.filter(d => !d.parentId).length > 0 ? (
                  departments.filter(d => !d.parentId).map(root => (
                    <DepartmentTreeNode 
                      key={root.id} 
                      department={root} 
                      departments={departments} 
                      onAdd={(pid: string) => setDepartments([...departments, { id: 'dpt-' + Date.now(), name: '新子部门', parentId: pid }])} 
                      onDelete={(id: string) => setDepartments(departments.filter(d => d.id !== id))} 
                      onRename={(id: string, name: string) => setDepartments(departments.map(d => d.id === id ? {...d, name} : d))} 
                      theme={theme} 
                    />
                  ))
                ) : (
                   <div className="py-20 text-center text-gray-300 italic">暂未定义任何部门</div>
                )}
              </div>
            </div>
          )}

          {view === 'RESOURCES' && (
             <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-8">
                <div><h3 className="text-2xl font-black">空间资源库</h3><p className="text-sm text-gray-400 mt-1">管理维护所有会议空间与工位资产。</p></div>
                {currentUser.role.includes('SYSTEM_ADMIN') && (
                  <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className={`bg-${theme}-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg flex items-center space-x-2 transition-all active:scale-95`}><Plus size={20}/> <span>录入资产</span></button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {resources.map(r => (
                  <div key={r.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:border-indigo-100 transition-all group relative">
                    <div className={`w-14 h-14 rounded-2xl bg-${theme}-50 flex items-center justify-center mb-6`}>{r.type === 'ROOM' ? <Monitor className={`text-${theme}-600`} /> : <Coffee className="text-emerald-600" />}</div>
                    <div className="absolute top-8 right-8 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {currentUser.role.includes('SYSTEM_ADMIN') && (
                        <>
                          <button onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:text-indigo-600 transition-colors"><Edit2 size={14}/></button>
                          <button onClick={() => setResources(resources.filter(res => res.id !== r.id))} className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:text-rose-600 transition-colors"><Trash2 size={14}/></button>
                        </>
                      )}
                    </div>
                    <h5 className="text-lg font-bold mb-1">{r.name}</h5>
                    <p className="text-xs text-gray-400 mb-6 flex items-center space-x-1"><MapPin size={10}/> <span>{r.location} · {r.capacity}人</span></p>
                    <div className="flex justify-between items-center pt-6 border-t border-gray-50">
                       <StatusBadge status={r.status} theme={theme} />
                       <button onClick={() => { setSelectedResource(r); setShowBookingModal(true); }} className={`text-xs font-bold text-${theme}-600 hover:underline transition-all`}>立即预约</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-8">
                <div><h3 className="text-2xl font-black">成员中心</h3><p className="text-sm text-gray-400 mt-1">管理企业员工资料、部门隶属及系统角色权限。</p></div>
                <button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className={`bg-${theme}-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg flex items-center space-x-2 active:scale-95 transition-all`}><UserPlus size={20}/> <span>录入成员</span></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.map(u => (
                  <div key={u.id} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col hover:border-indigo-100 transition-all">
                    <div className="flex items-center space-x-4 mb-6">
                       <div className={`w-14 h-14 bg-${theme}-50 rounded-2xl flex items-center justify-center text-${theme}-600 font-black text-xl shadow-inner`}>{u.name[0]}</div>
                       <div className="min-w-0 flex-1"><h6 className="font-bold text-gray-800 truncate">{u.name}</h6><p className="text-[10px] text-gray-400 font-bold uppercase truncate">{u.department}</p></div>
                    </div>
                    <div className="flex-1 space-y-2">
                       <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest">系统角色集</p>
                       <div className="flex flex-wrap gap-1.5">{u.role.map(rid => <RoleTag key={rid} roleId={rid} roles={roles} theme={theme}/>)}</div>
                    </div>
                    <div className="mt-6 pt-6 border-t border-gray-50 flex justify-between items-center">
                       <button onClick={() => { setEditingUser(u); setShowUserModal(true); }} className="text-xs font-bold text-gray-400 hover:text-indigo-600 flex items-center space-x-1 transition-colors"><Edit2 size={12}/> <span>资料配置</span></button>
                       <button onClick={() => setUsers(users.filter(user => user.id !== u.id))} className="p-2 text-gray-300 hover:text-rose-600 transition-colors"><Trash2 size={14}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'APPROVAL_CENTER' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="mb-8">
                <h3 className="text-2xl font-black">审批工作台</h3>
                <p className="text-sm text-gray-400 mt-1">作为流程负责人，您需要对以下申请进行合规性核准。</p>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {bookings.filter(b => canApprove(b)).map(b => (
                  <div key={b.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between group hover:border-indigo-200 transition-all">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-xl bg-${theme}-50 flex items-center justify-center text-${theme}-600`}><Briefcase size={18}/></div>
                        <h5 className="text-lg font-bold">{b.purpose}</h5>
                      </div>
                      <div className="flex items-center space-x-6 text-[11px] font-bold text-gray-500">
                         <span className="flex items-center space-x-1"><Users size={12}/> <span>{users.find(u => u.id === b.userId)?.name} ({users.find(u => u.id === b.userId)?.department})</span></span>
                         <span className="flex items-center space-x-1"><Monitor size={12}/> <span>{resources.find(r => r.id === b.resourceId)?.name}</span></span>
                         <span className="flex items-center space-x-1"><Calendar size={12}/> <span>{new Date(b.startTime).toLocaleString()}</span></span>
                      </div>
                    </div>
                    <button onClick={() => setShowApprovalActionModal(b)} className={`mt-4 md:mt-0 bg-${theme}-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg hover:shadow-indigo-200 transition-all active:scale-95 flex items-center space-x-2`}><ShieldCheck size={18}/> <span>处理核准单</span></button>
                  </div>
                ))}
                {bookings.filter(b => canApprove(b)).length === 0 && (
                  <div className="py-32 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-gray-100"><CheckCircle size={48} className="text-emerald-500 mx-auto mb-4 opacity-30"/><p className="text-gray-400 font-bold italic">目前暂无待处理的审批事项</p></div>
                )}
              </div>
            </div>
          )}

          {view === 'BOOKINGS' && (
            <div className="space-y-8 animate-in fade-in">
              {bookings.filter(b => b.userId === currentUser.id).map(b => (
                <div key={b.id} className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8 space-y-6">
                  <div className="flex items-start justify-between">
                     <div className="space-y-1">
                        <h4 className="text-xl font-black">{b.purpose}</h4>
                        <div className="flex items-center space-x-3"><StatusBadge status={b.status} theme={theme} /><p className="text-xs text-gray-400 font-bold uppercase tracking-tighter">单据标识: {b.id}</p></div>
                     </div>
                     {b.status === 'PENDING' && <button onClick={() => setBookings(bookings.map(book => book.id === b.id ? {...book, status: 'CANCELLED'} : book))} className="text-xs font-bold text-rose-500 bg-rose-50 px-4 py-2 rounded-xl hover:bg-rose-100 transition-colors">终止流程</button>}
                  </div>
                  <div className="bg-gray-50/50 p-6 rounded-3xl border border-gray-100"><WorkflowStepper booking={b} workflow={workflow} users={users} theme={theme} /></div>
                </div>
              ))}
              {bookings.filter(b => b.userId === currentUser.id).length === 0 && (
                <div className="py-32 text-center bg-white rounded-[2.5rem] border border-gray-100 shadow-sm"><FileText size={48} className="text-gray-200 mx-auto mb-4"/><p className="text-gray-400 font-bold italic">暂无历史申请记录</p></div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* 模态框管理 */}
      {showRoleModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
            <h2 className="text-2xl font-black mb-6">{editingRole ? '编辑角色配置' : '定义新型角色'}</h2>
            <div className="space-y-4">
              <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">角色名称</label><input value={editingRole?.name || ''} onChange={e => setEditingRole(prev => ({ ...prev!, name: e.target.value }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" placeholder="例如：首席执行官" /></div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">权责描述</label><textarea value={editingRole?.description || ''} onChange={e => setEditingRole(prev => ({ ...prev!, description: e.target.value }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none min-h-[100px] resize-none" placeholder="描述该角色的权限..." /></div>
            </div>
            <div className="mt-10 flex space-x-4"><button onClick={() => setShowRoleModal(false)} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => handleSaveRole(editingRole || {})} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg transition-all`}>保存设置</button></div>
          </div>
        </div>
      )}

      {showWorkflowModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
            <h2 className="text-2xl font-black mb-6">{editingWorkflowNode ? '修改环节' : '新增环节'}</h2>
            <div className="space-y-6">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">环节名称</label>
                <input value={editingWorkflowNode?.name || ''} onChange={e => setEditingWorkflowNode(prev => ({ ...prev!, name: e.target.value }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" placeholder="例如：部门经理初审" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">负责角色</label>
                <select value={editingWorkflowNode?.approverRole || ''} onChange={e => setEditingWorkflowNode(prev => ({ ...prev!, approverRole: e.target.value as Role }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none font-bold">
                  <option value="">请选择审批角色</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-10 flex space-x-4">
              <button onClick={() => setShowWorkflowModal(false)} className="flex-1 py-4 font-bold text-gray-400">取消</button>
              <button onClick={() => handleSaveWorkflowNode(editingWorkflowNode || {})} disabled={!editingWorkflowNode?.name || !editingWorkflowNode?.approverRole} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg disabled:opacity-50 transition-all`}>保存环节</button>
            </div>
          </div>
        </div>
      )}

      {showUserModal && <UserModal user={editingUser} departments={departments} roles={roles} onClose={() => setShowUserModal(false)} onSave={handleSaveUser} theme={theme} />}
      {showResourceModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
            <h2 className="text-2xl font-black mb-6">{editingResource ? '修改资产参数' : '录入办公资产'}</h2>
            <div className="space-y-4">
              <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">资产标识</label><input value={editingResource?.name || ''} onChange={e => setEditingResource(prev => ({ ...prev!, name: e.target.value }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" placeholder="例如：Alpha 会议室" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">资源品类</label><select value={editingResource?.type || 'ROOM'} onChange={e => setEditingResource(prev => ({ ...prev!, type: e.target.value as ResourceType }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none font-bold"><option value="ROOM">会议空间</option><option value="DESK">办公工位</option></select></div>
                <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">额定人数</label><input type="number" value={editingResource?.capacity || 0} onChange={e => setEditingResource(prev => ({ ...prev!, capacity: parseInt(e.target.value) }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" /></div>
              </div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">物理空间位置</label><input value={editingResource?.location || ''} onChange={e => setEditingResource(prev => ({ ...prev!, location: e.target.value }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" placeholder="例如：北塔 22F" /></div>
            </div>
            <div className="mt-10 flex space-x-4"><button onClick={() => setShowResourceModal(false)} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => handleSaveResource(editingResource || {})} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95`}>确认入库</button></div>
          </div>
        </div>
      )}

      {showApprovalActionModal && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white rounded-[3rem] w-full max-w-2xl p-10 shadow-2xl animate-in zoom-in">
              <div className="flex items-center justify-between mb-8"><h2 className="text-2xl font-black">工作流核准</h2><button onClick={() => setShowApprovalActionModal(null)} className="p-3 bg-gray-50 rounded-2xl text-gray-400 hover:text-rose-500 transition-colors"><X size={24}/></button></div>
              <div className="bg-gray-50/50 p-8 rounded-[2.5rem] border border-gray-100 mb-8"><WorkflowStepper booking={showApprovalActionModal} workflow={workflow} users={users} theme={theme} /></div>
              <div className="flex space-x-4"><button onClick={() => { const comment = prompt('请输入驳回理由:'); if(comment !== null) handleReject(showApprovalActionModal, comment); }} className="flex-1 py-5 bg-rose-50 text-rose-600 font-bold rounded-2xl transition-all hover:bg-rose-100">驳回申请</button><button onClick={() => handleApprove(showApprovalActionModal)} className={`flex-[2] py-5 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95`}>核准通过</button></div>
           </div>
        </div>
      )}

      {showBookingModal && selectedResource && (<BookingFormModal resource={selectedResource} theme={theme} onClose={() => setShowBookingModal(false)} onConfirm={handleBooking} availableResources={resources.filter(r => r.status === 'AVAILABLE')}/>)}
    </div>
  );
};

const UserModal = ({ user, departments, roles, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState<Partial<User>>(user || { name: '', email: '', role: ['EMPLOYEE'], department: departments[0]?.name || '' });
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-6">{user ? '修改成员档案' : '录入职场新秀'}</h2>
        <div className="space-y-4">
          <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">真实姓名</label><input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" placeholder="姓名..." /></div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">企业邮箱</label><input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" placeholder="user@company.com" /></div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">挂靠部门</label><select value={formData.department} onChange={e => setFormData({ ...formData, department: e.target.value })} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none font-bold">{departments.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}</select></div>
          <div className="space-y-2"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">系统角色分配</label><div className="flex flex-wrap gap-2 pt-2">{roles.map((r: any) => { const isSelected = formData.role?.includes(r.id); return (<button key={r.id} type="button" onClick={() => { const current = formData.role || []; const next = current.includes(r.id) ? current.filter(id => id !== r.id) : [...current, r.id]; setFormData({...formData, role: next}); }} className={`px-3 py-2 rounded-xl text-[10px] font-bold transition-all ${isSelected ? `bg-${theme}-600 text-white shadow-md` : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>{r.name}</button>); })}</div></div>
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onSave(formData)} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95`}>确认入库</button></div>
      </div>
    </div>
  );
};

const BookingFormModal = ({ resource, theme, onClose, onConfirm, availableResources }: any) => {
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [loadingAI, setLoadingAI] = useState(false);
  const [recommendation, setRecommendation] = useState('');

  // 快捷时间段选择
  const setQuickTime = (start: string, end: string) => {
    setStartTime(start);
    setEndTime(end);
    setEndDate(startDate); // 快捷选择默认针对单日
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-[3rem] w-full max-w-lg shadow-2xl animate-in zoom-in">
        <h2 className="text-2xl font-black mb-1">预约资源申请</h2>
        <p className="text-xs text-gray-400 mb-8 flex items-center space-x-1"><span>目标资源: <span className={`text-${theme}-600 font-black`}>{resource.name}</span></span></p>
        <div className="space-y-6">
           {/* 日期范围选择 */}
           <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                 <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">开始日期</label>
                 <input type="date" value={startDate} onChange={e => {
                    setStartDate(e.target.value);
                    if (e.target.value > endDate) setEndDate(e.target.value);
                 }} className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border-none" />
              </div>
              <div className="space-y-1">
                 <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">结束日期</label>
                 <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border-none" />
              </div>
           </div>
           
           {/* 时间段选择 */}
           <div className="space-y-4">
              <div className="flex justify-between items-center">
                 <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">选择时段</label>
                 <div className="flex space-x-2">
                    <button onClick={() => setQuickTime("09:00", "18:00")} className="px-2 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-gray-600 hover:bg-gray-200 transition-colors">全天</button>
                    <button onClick={() => setQuickTime("09:00", "12:00")} className="px-2 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-gray-600 hover:bg-gray-200 transition-colors">上午</button>
                    <button onClick={() => setQuickTime("13:00", "18:00")} className="px-2 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-gray-600 hover:bg-gray-200 transition-colors">下午</button>
                 </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-1">
                    <label className="text-[9px] text-gray-300 font-bold ml-1">开始时刻</label>
                    <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border-none" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[9px] text-gray-300 font-bold ml-1">结束时刻</label>
                    <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full p-4 bg-gray-50 rounded-2xl font-bold outline-none border-none" />
                 </div>
              </div>
           </div>

           <div className="space-y-1"><label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">申请用途详述</label><textarea value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="请输入申请理由..." className="w-full p-4 bg-gray-50 rounded-[2rem] h-24 outline-none text-sm transition-all focus:bg-white resize-none" /></div>
           
           <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100">
              <button onClick={async () => { setLoadingAI(true); const rec = await getSmartRecommendation(purpose, 1, availableResources); setRecommendation(rec); setLoadingAI(false); }} className="text-[10px] font-black text-indigo-600 flex items-center space-x-1 mb-1 hover:opacity-70 transition-opacity"><Zap size={12}/> <span>AI 智能空间匹配建议</span></button>
              <p className="text-[10px] text-indigo-700/70 italic min-h-[1.5em] leading-relaxed">{loadingAI ? 'AI 正在深度分析中...' : recommendation || '在此输入用途后，点击上方 AI 按钮可获取选址优化建议。'}</p>
           </div>
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onConfirm(resource.id, purpose, `${startDate}T${startTime}`, `${endDate}T${endTime}`)} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95`}>提交流程申请</button></div>
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
          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => setIsEditing(true)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-indigo-600 transition-colors"><Edit2 size={10}/></button><button onClick={() => onAdd(department.id)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-emerald-600 transition-colors"><Plus size={10}/></button><button onClick={() => onDelete(department.id)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-rose-600 transition-colors"><Trash2 size={10}/></button></div>
        </div>
      </div>
      {isExpanded && children.length > 0 && <div className="mt-1">{children.map((child: any) => (<DepartmentTreeNode key={child.id} department={child} departments={departments} onAdd={onAdd} onDelete={onDelete} onRename={onRename} theme={theme}/>))}</div>}
    </div>
  );
};

export default App;
