
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, 
  MapPin, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  LayoutDashboard, 
  Plus, 
  LogOut, 
  Search, 
  Bell, 
  Cpu, 
  Monitor, 
  Coffee, 
  Edit2, 
  Trash2, 
  UserPlus, 
  RefreshCw,
  Clock,
  GitMerge,
  ChevronRight,
  ArrowRight,
  Info,
  Map,
  ChevronDown,
  ChevronUp,
  Layers,
  Zap,
  ShieldCheck,
  Check,
  X,
  MessageSquare,
  Filter,
  Trash,
  Square,
  CheckSquare,
  MoreHorizontal,
  AlertCircle,
  FileUp,
  FileText,
  UploadCloud,
  Building2,
  FolderTree,
  CornerDownRight,
  ArrowUp,
  ArrowDown,
  Palette,
  Sun,
  Moon,
  Sunrise,
  PieChart,
  Activity,
  GripVertical,
  TreePine,
  Network,
  ChevronLeft,
  Sparkles,
  SendHorizontal,
  BellRing
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, ApprovalRecord, Notification, ResourceStatus, Department } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS } from './constants';
import { getSmartRecommendation } from './services/geminiService';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V12';
const THEME_KEY = 'SMART_OFFICE_THEME';

const THEMES = [
  { id: 'indigo', name: '深邃蓝', color: 'bg-indigo-600' },
  { id: 'blue', name: '科技蓝', color: 'bg-blue-600' },
  { id: 'violet', name: '尊贵紫', color: 'bg-violet-600' },
  { id: 'rose', name: '玫瑰红', color: 'bg-rose-600' },
  { id: 'emerald', name: '森林绿', color: 'bg-emerald-600' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-600' },
  { id: 'slate', name: '极简灰', color: 'bg-slate-600' },
];

// --- 独立子组件 ---

const StatusBadge = ({ status, theme }: any) => {
  const styles: any = { 
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100', 
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100', 
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100', 
    APPROVED: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`, 
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100', 
    MAINTENANCE: 'bg-gray-100 text-gray-400 border-gray-200', 
    COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200' 
  };
  const labels: any = { AVAILABLE: '空闲中', PENDING: '审批中', APPROVED: '已通过', REJECTED: '已驳回', OCCUPIED: '已占用', MAINTENANCE: '维护中', COMPLETED: '已结束' };
  return <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${styles[status] || styles.PENDING}`}>{labels[status] || status}</span>;
};

const RoleBadge = ({ role, theme }: any) => {
  const styles: any = { SYSTEM_ADMIN: `bg-${theme}-100 text-${theme}-700`, APPROVAL_ADMIN: 'bg-amber-100 text-amber-700', EMPLOYEE: 'bg-gray-100 text-gray-600' };
  const label: any = { SYSTEM_ADMIN: '系统管理员', APPROVAL_ADMIN: '审批负责人', EMPLOYEE: '员工' };
  return <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${styles[role]}`}>{label[role]}</span>;
};

const SidebarItem = ({ icon: Icon, label, id, active, onClick, theme }: any) => (
  <button onClick={() => onClick(id)} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${active ? `bg-${theme}-600 text-white shadow-lg` : `text-gray-500 hover:bg-${theme}-50 hover:text-${theme}-600`}`}>
    <Icon size={18} /> <span className="text-sm font-medium">{label}</span>
  </button>
);

const UserModal = ({ user, departments, onClose, onSave, theme, currentOperator }: any) => {
  const [formData, setFormData] = useState<Partial<User>>(user || { name: '', email: '', department: departments[0]?.name || '', role: ['EMPLOYEE'] });
  const isSystemAdmin = currentOperator?.role.includes('SYSTEM_ADMIN');

  const toggleRole = (role: Role) => { 
    if (!isSystemAdmin) return;
    const currentRoles = formData.role || []; 
    if (currentRoles.includes(role)) { 
      if (currentRoles.length === 1) return; 
      setFormData({ ...formData, role: currentRoles.filter(r => r !== role) }); 
    } else { 
      setFormData({ ...formData, role: [...currentRoles, role] }); 
    } 
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl">
        <h2 className="text-2xl font-bold mb-2">{user ? '修改成员资料' : '录入新成员资料'}</h2>
        {!isSystemAdmin && <p className="text-rose-500 text-xs font-bold mb-4">提示：您没有权限修改角色权限。</p>}
        <div className="space-y-6 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">姓名</label>
              <input value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} placeholder="输入姓名" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">所在部门</label>
              <select value={formData.department} onChange={e=>setFormData({...formData, department: e.target.value})} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none text-sm font-bold">
                {departments.map((d: any) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">工作邮箱</label>
            <input value={formData.email} onChange={e=>setFormData({...formData, email: e.target.value})} placeholder="example@company.com" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">角色权限 {isSystemAdmin ? '(可配置)' : '(只读)'}</label>
            <div className="space-y-2.5">
              {['EMPLOYEE', 'APPROVAL_ADMIN', 'SYSTEM_ADMIN'].map(rid => {
                const isSelected = formData.role?.includes(rid as Role);
                return (
                  <button 
                    key={rid} 
                    onClick={() => toggleRole(rid as Role)} 
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${isSelected ? `bg-${theme}-50 border-${theme}-200 shadow-sm` : 'bg-gray-50 border-gray-100'} ${!isSystemAdmin ? 'cursor-not-allowed opacity-80' : ''}`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${isSelected ? `bg-${theme}-600 border-${theme}-600 text-white` : 'bg-white'}`}>{isSelected && <Check size={14} />}</div>
                      <span className="text-sm font-bold">{rid === 'SYSTEM_ADMIN' ? '系统管理员' : rid === 'APPROVAL_ADMIN' ? '审批负责人' : '普通员工'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onSave(formData)} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all`}>确认保存</button></div>
      </div>
    </div>
  );
};

// --- 审批流可视化组件 ---

const FlowTracker = ({ booking, workflow, theme, onRemind }: { booking: Booking, workflow: ApprovalNode[], theme: string, onRemind?: (b: Booking) => void }) => {
  const totalNodes = workflow.length;
  const currentIdx = booking.currentNodeIndex;
  const isFinalStatus = ['APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'].includes(booking.status);

  return (
    <div className="py-6 px-8 bg-gray-50/50 rounded-3xl border border-gray-100 animate-in slide-in-from-top-2">
      <div className="flex items-center justify-between mb-8">
        <h5 className="text-sm font-black flex items-center space-x-2">
          <GitMerge size={16} className={`text-${theme}-600`} />
          <span>审批流转视图</span>
        </h5>
        {booking.status === 'PENDING' && onRemind && (
          <button 
            onClick={() => onRemind(booking)}
            className={`flex items-center space-x-2 text-[10px] font-bold bg-${theme}-600 text-white px-3 py-1.5 rounded-full shadow-lg shadow-${theme}-100 hover:scale-105 active:scale-95 transition-all`}
          >
            <BellRing size={12}/> <span>提醒处理</span>
          </button>
        )}
      </div>

      <div className="relative flex flex-col md:flex-row md:items-start space-y-8 md:space-y-0 md:space-x-4">
        {/* 申请发起 */}
        <div className="flex-1 relative flex flex-col items-center md:items-start text-center md:text-left group">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center z-10 border-4 border-white shadow-sm bg-indigo-600 text-white`}>
            <UserPlus size={16}/>
          </div>
          <div className="mt-3">
            <p className="text-[10px] font-black text-gray-800">提交申请</p>
            <p className="text-[9px] text-gray-400">{new Date(booking.createdAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          {/* 连接线 */}
          <div className="hidden md:block absolute top-5 left-10 right-0 h-0.5 bg-indigo-600"></div>
        </div>

        {/* 审批节点 */}
        {workflow.map((node, idx) => {
          const isCurrent = !isFinalStatus && idx === currentIdx;
          const isDone = isFinalStatus || idx < currentIdx;
          const statusText = isDone ? '已核准' : isCurrent ? '待处理' : '等待中';
          const nodeColor = isDone ? `bg-${theme}-600` : isCurrent ? 'bg-amber-400 shadow-amber-100 shadow-lg animate-pulse' : 'bg-gray-200';

          return (
            <div key={node.id} className="flex-1 relative flex flex-col items-center md:items-start text-center md:text-left group">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center z-10 border-4 border-white shadow-sm ${nodeColor} text-white`}>
                {isDone ? <Check size={16}/> : isCurrent ? <Clock size={16}/> : <ShieldCheck size={16}/>}
              </div>
              <div className="mt-3">
                <p className="text-[10px] font-black text-gray-800">{node.name}</p>
                <p className={`text-[9px] font-bold ${isCurrent ? 'text-amber-500' : 'text-gray-400'}`}>
                  负责人: {node.approverRole === 'SYSTEM_ADMIN' ? '系统管理员' : '审批负责人'}
                </p>
                <div className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter ${isDone ? 'bg-emerald-50 text-emerald-600' : isCurrent ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-300'}`}>
                  {statusText}
                </div>
              </div>
              {/* 连接线 */}
              {idx < totalNodes - 1 && (
                <div className={`hidden md:block absolute top-5 left-10 right-0 h-0.5 ${isDone ? `bg-${theme}-600` : 'bg-gray-100'}`}></div>
              )}
            </div>
          );
        })}

        {/* 最终结果 */}
        <div className="flex-1 relative flex flex-col items-center md:items-start text-center md:text-left">
           <div className={`w-10 h-10 rounded-full flex items-center justify-center z-10 border-4 border-white shadow-sm ${booking.status === 'APPROVED' ? 'bg-emerald-600 text-white' : booking.status === 'REJECTED' ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
             {booking.status === 'APPROVED' ? <CheckSquare size={16}/> : booking.status === 'REJECTED' ? <XCircle size={16}/> : <Layers size={16}/>}
           </div>
           <div className="mt-3">
             <p className="text-[10px] font-black text-gray-800">结果核定</p>
             <p className="text-[9px] text-gray-400 uppercase">{booking.status === 'APPROVED' ? '核准通过' : booking.status === 'REJECTED' ? '已驳回' : '进行中'}</p>
           </div>
        </div>
      </div>
    </div>
  );
};

// --- 部门树节点组件 ---

const DepartmentTreeNode = ({ department, departments, onAdd, onDelete, onRename, theme }: any) => {
  const children = departments.filter((d: any) => d.parentId === department.id);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(department.name);

  const handleRename = () => {
    onRename(department.id, newName);
    setIsEditing(false);
  };

  return (
    <div className="ml-6 border-l-2 border-gray-100 pl-6 my-4">
      <div className="flex items-center group">
        <div className="flex items-center space-x-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm hover:border-indigo-200 transition-all flex-1 min-w-0">
          <div className={`w-8 h-8 rounded-lg bg-${theme}-50 flex items-center justify-center text-${theme}-600`}>
            {children.length > 0 ? (
              <button onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <FolderTree size={14} />
            )}
          </div>
          {isEditing ? (
            <div className="flex items-center flex-1 space-x-2">
              <input 
                autoFocus
                value={newName} 
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                className="flex-1 bg-gray-50 border-none outline-none text-sm font-bold p-1 rounded-md"
              />
            </div>
          ) : (
            <span className="text-sm font-bold text-gray-700 truncate">{department.name}</span>
          )}
          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => setIsEditing(true)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-indigo-600"><Edit2 size={12}/></button>
            <button onClick={() => onAdd(department.id)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-emerald-600"><Plus size={12}/></button>
            <button onClick={() => onDelete(department.id)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-rose-600"><Trash2 size={12}/></button>
          </div>
        </div>
      </div>
      {isExpanded && children.length > 0 && (
        <div className="mt-2">
          {children.map((child: any) => (
            <DepartmentTreeNode 
              key={child.id} 
              department={child} 
              departments={departments} 
              onAdd={onAdd} 
              onDelete={onDelete} 
              onRename={onRename} 
              theme={theme}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- 月度占用表组件 ---

const MonthlyUsageTable = ({ resources, bookings, theme }: { resources: Resource[], bookings: Booking[], theme: string }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const daysInMonth = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => i + 1);
  }, [currentDate]);
  const monthLabel = currentDate.toLocaleString('zh-CN', { year: 'numeric', month: 'long' });
  const getStatusForDay = (resourceId: string, day: number) => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayBookings = bookings.filter(b => b.resourceId === resourceId && (b.startTime.startsWith(dateStr) || b.endTime.startsWith(dateStr)) && ['APPROVED', 'PENDING'].includes(b.status));
    if (dayBookings.length === 0) return null;
    return dayBookings.some(b => b.status === 'APPROVED') ? 'APPROVED' : 'PENDING';
  };
  const groupedResources = useMemo(() => ({ ROOM: resources.filter(r => r.type === 'ROOM'), DESK: resources.filter(r => r.type === 'DESK') }), [resources]);

  return (
    <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm overflow-hidden animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <h4 className="font-bold flex items-center space-x-2 text-lg"><PieChart className={`text-${theme}-600`} size={20}/> <span>全司资源月度排期看板</span></h4>
        <div className="flex items-center bg-gray-50 p-1 rounded-2xl border border-gray-100">
          <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} className="p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all text-gray-400 hover:text-gray-800"><ChevronLeft size={18}/></button>
          <span className="px-6 text-sm font-black text-gray-700 min-w-[120px] text-center">{monthLabel}</span>
          <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} className="p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all text-gray-400 hover:text-gray-800"><ChevronRight size={18}/></button>
        </div>
      </div>
      <div className="overflow-x-auto custom-scrollbar pb-4">
        <table className="w-full border-collapse">
          <thead>
            <tr><th className="sticky left-0 z-20 bg-white text-left p-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest min-w-[180px] border-b">资源名称</th>{daysInMonth.map(day => (<th key={day} className="p-3 text-center border-b min-w-[36px]"><span className="text-[10px] font-bold text-gray-400">{day}</span></th>))}</tr>
          </thead>
          <tbody>
            {(['ROOM', 'DESK'] as ResourceType[]).map(type => (
              <React.Fragment key={type}>
                <tr className="bg-gray-50/50"><td colSpan={daysInMonth.length + 1} className="sticky left-0 z-10 px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">{type === 'ROOM' ? '—— 会议室资源 ——' : '—— 办公工位资源 ——'}</td></tr>
                {groupedResources[type].map(res => (
                  <tr key={res.id} className="hover:bg-gray-50 group">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 transition-colors p-4 border-b text-xs font-bold text-gray-700">{res.name}</td>
                    {daysInMonth.map(day => {
                      const status = getStatusForDay(res.id, day);
                      return (<td key={day} className="p-1 border-b text-center"><div className={`w-full h-8 rounded-lg transition-all ${status === 'APPROVED' ? `bg-${theme}-600 shadow-sm` : status === 'PENDING' ? `bg-${theme}-200 animate-pulse` : 'bg-gray-50/50'}`}/></td>);
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- 主程序 ---

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS' | 'WORKFLOW' | 'DEPARTMENTS'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'indigo');
  
  // 数据状态
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
  const [workflow, setWorkflow] = useState<ApprovalNode[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved).workflow : DEFAULT_WORKFLOW;
  });
  const [departments, setDepartments] = useState<Department[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved).departments || INITIAL_DEPARTMENTS) : INITIAL_DEPARTMENTS;
  });
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved).notifications || []) : [];
  });

  // UI 模态框状态
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);

  // 快捷申请状态
  const [quickIntent, setQuickIntent] = useState('');
  const [quickRecommendation, setQuickRecommendation] = useState<string | null>(null);
  const [matchedResource, setMatchedResource] = useState<Resource | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // 持久化
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ users, resources, bookings, workflow, departments, notifications }));
  }, [users, resources, bookings, workflow, departments, notifications]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // 同步心跳
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      let changed = false;
      const updatedBookings = bookings.map(b => {
        if (['PENDING', 'APPROVED'].includes(b.status) && new Date(b.endTime) <= now) {
          changed = true;
          return { ...b, status: 'COMPLETED' as BookingStatus };
        }
        return b;
      });
      if (changed) setBookings(updatedBookings);
    }, 10000);
    return () => clearInterval(timer);
  }, [bookings]);

  const todayStr = new Date().toISOString().split('T')[0];
  const sortedTodayBookings = useMemo(() => bookings.filter(b => b.startTime.startsWith(todayStr)).sort((a, b) => a.startTime.localeCompare(b.startTime)), [bookings, todayStr]);
  const occupancyRate = useMemo(() => {
    const total = resources.length;
    if (total === 0) return 0;
    const busy = resources.filter(r => bookings.some(b => b.resourceId === r.id && (b.status === 'APPROVED' || b.status === 'PENDING') && new Date(b.startTime) <= new Date() && new Date(b.endTime) > new Date())).length;
    return Math.round((busy / total) * 100);
  }, [resources, bookings]);

  const handleSaveUser = (data: Partial<User>) => {
    if (editingUser) setUsers(users.map(u => u.id === editingUser.id ? { ...u, ...data } as User : u));
    else setUsers([...users, { id: 'u-' + Date.now(), ...data } as User]);
    setShowUserModal(false); setEditingUser(null);
  };
  const handleDeleteUser = (id: string) => { 
    if (id === currentUser?.id) return alert('不能删除自己'); 
    if (confirm('确定移除该成员吗？')) setUsers(users.filter(u => u.id !== id)); 
  };
  const handleSaveResource = (data: Partial<Resource>) => {
    if (editingResource) setResources(resources.map(r => r.id === editingResource.id ? { ...r, ...data } as Resource : r));
    else setResources([...resources, { id: 'r-' + Date.now(), status: 'AVAILABLE', features: [], ...data } as Resource]);
    setShowResourceModal(false); setEditingResource(null);
  };
  const handleDeleteResource = (id: string) => { if (confirm('确定删除该资源吗？')) setResources(resources.filter(r => r.id !== id)); };

  const handleBooking = (resourceId: string, purpose: string, startTime: string, endTime: string) => {
    const resource = resources.find(r => r.id === resourceId);
    if (!resource || !currentUser) return;
    const newBooking: Booking = { id: `bk-${Date.now()}`, userId: currentUser.id, resourceId, type: resource.type, startTime, endTime, status: 'PENDING', purpose, createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: [] };
    setBookings([newBooking, ...bookings]);
    setShowBookingModal(false); setSelectedResource(null);
    setNotifications([{ id: `nt-${Date.now()}`, userId: currentUser.id, title: '申请提交成功', content: `您已成功提交 ${resource.name} 的预约申请。`, timestamp: new Date().toISOString(), isRead: false, type: 'SUCCESS', linkView: 'BOOKINGS' }, ...notifications]);
    setQuickIntent(''); setQuickRecommendation(null); setMatchedResource(null);
  };

  const handleApprove = (bookingId: string, status: 'APPROVED' | 'REJECTED') => {
    setBookings(bookings.map(b => {
      if (b.id !== bookingId) return b;
      const history: ApprovalRecord = { nodeName: workflow[b.currentNodeIndex]?.name || '核准', approverName: currentUser?.name || '管理员', status, timestamp: new Date().toISOString() };
      if (status === 'REJECTED') return { ...b, status: 'REJECTED', approvalHistory: [...b.approvalHistory, history] };
      return b.currentNodeIndex === workflow.length - 1 ? { ...b, status: 'APPROVED', approvalHistory: [...b.approvalHistory, history] } : { ...b, currentNodeIndex: b.currentNodeIndex + 1, approvalHistory: [...b.approvalHistory, history] };
    }));
  };

  // 催办逻辑
  const handleSendReminder = (booking: Booking) => {
    if (!currentUser) return;
    const currentNode = workflow[booking.currentNodeIndex];
    const targetApprovers = users.filter(u => u.role.includes(currentNode.approverRole));
    
    // 发送通知给所有该节点的审批人
    const newNotifs = targetApprovers.map(u => ({
      id: `nt-remind-${Date.now()}-${u.id}`,
      userId: u.id,
      title: '📋 待处理催办提醒',
      content: `${currentUser.name} 催促您处理 ${resources.find(r => r.id === booking.resourceId)?.name} 的预约申请。`,
      timestamp: new Date().toISOString(),
      isRead: false,
      type: 'WARNING' as any,
      linkView: 'BOOKINGS' as any
    }));

    setNotifications([...newNotifs, ...notifications]);
    alert(`催办消息已发送给 ${targetApprovers.length} 位相关审批人。`);
  };

  const handleAiQuickMatch = async () => {
    if (!quickIntent.trim()) return;
    setIsAiLoading(true);
    try {
      const available = resources.filter(r => r.status === 'AVAILABLE');
      const rec = await getSmartRecommendation(quickIntent, 1, available);
      setQuickRecommendation(rec);
      const match = available.find(r => rec.includes(r.name)) || available[0];
      setMatchedResource(match);
    } catch (e) { console.error(e); } finally { setIsAiLoading(false); }
  };

  const handleQuickBookConfirm = () => {
    if (!matchedResource) return;
    const now = new Date();
    const start = new Date(now.getTime() + 30 * 60000).toISOString().slice(0, 16);
    const end = new Date(now.getTime() + 90 * 60000).toISOString().slice(0, 16);
    handleBooking(matchedResource.id, quickIntent || "快捷申请", start, end);
  };

  const addWorkflowNode = () => setWorkflow([...workflow, { id: 'n-' + Date.now(), name: '新审批节点', approverRole: 'APPROVAL_ADMIN' }]);
  const removeWorkflowNode = (id: string) => { if (workflow.length === 1) return alert('流程至少需要一个节点'); setWorkflow(workflow.filter(n => n.id !== id)); };
  const moveWorkflowNode = (index: number, direction: 'UP' | 'DOWN') => {
    const newW = [...workflow]; const target = direction === 'UP' ? index - 1 : index + 1;
    if (target < 0 || target >= workflow.length) return;
    [newW[index], newW[target]] = [newW[target], newW[index]]; setWorkflow(newW);
  };
  const updateWorkflowNode = (id: string, updates: Partial<ApprovalNode>) => setWorkflow(workflow.map(n => n.id === id ? { ...n, ...updates } : n));
  const addDepartment = (parentId?: string) => setDepartments([...departments, { id: 'dpt-' + Date.now(), name: '新子部门', parentId }]);
  const deleteDepartment = (id: string) => {
    if (departments.some(d => d.parentId === id)) return alert('该部门下有子部门');
    if (users.some(u => u.department === departments.find(d => d.id === id)?.name)) return alert('部门下有成员');
    if (confirm('确定删除？')) setDepartments(departments.filter(d => d.id !== id));
  };
  const renameDepartment = (id: string, newName: string) => setDepartments(departments.map(d => d.id === id ? { ...d, name: newName } : d));

  if (!currentUser) {
    return (
      <div className={`min-h-screen bg-${theme}-600 flex items-center justify-center p-6`}>
        <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-full max-w-md animate-in zoom-in">
          <div className="flex justify-center mb-6"><div className={`w-16 h-16 bg-${theme}-600 rounded-2xl flex items-center justify-center text-white shadow-xl`}><Cpu size={32}/></div></div>
          <h1 className="text-2xl font-black text-center mb-2">SmartOffice 登录</h1>
          <div className="space-y-3 mt-8">
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
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-64 bg-white border-r hidden lg:flex flex-col p-6 sticky top-0 h-screen">
        <div className="flex items-center space-x-3 mb-10 px-2"><div className={`w-8 h-8 bg-${theme}-600 rounded-lg flex items-center justify-center text-white shadow-lg`}><Cpu size={18}/></div><span className="text-lg font-black tracking-tight">SmartOffice</span></div>
        <nav className="flex-1 space-y-2">
          <SidebarItem icon={LayoutDashboard} label="数据仪表盘" id="DASHBOARD" active={view === 'DASHBOARD'} onClick={setView} theme={theme} />
          <SidebarItem icon={MapPin} label="空间资源" id="RESOURCES" active={view === 'RESOURCES'} onClick={setView} theme={theme} />
          <SidebarItem icon={Calendar} label="申请历史" id="BOOKINGS" active={view === 'BOOKINGS'} onClick={setView} theme={theme} />
          {currentUser.role.includes('SYSTEM_ADMIN') && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">组织管理</div>
              <SidebarItem icon={Building2} label="架构树配置" id="DEPARTMENTS" active={view === 'DEPARTMENTS'} onClick={setView} theme={theme} />
              <SidebarItem icon={GitMerge} label="流程引擎" id="WORKFLOW" active={view === 'WORKFLOW'} onClick={setView} theme={theme} />
              <SidebarItem icon={Users} label="权限中心" id="USERS" active={view === 'USERS'} onClick={setView} theme={theme} />
            </>
          )}
        </nav>
        {/* 通知气泡显示 */}
        {notifications.filter(n => n.userId === currentUser.id && !n.isRead).length > 0 && (
          <div className={`mx-4 mb-4 p-3 bg-${theme}-50 border border-${theme}-100 rounded-2xl animate-bounce`}>
            <div className="flex items-center space-x-2 text-[10px] font-black text-indigo-700">
              <Bell size={12}/> <span>您有新通知！</span>
            </div>
          </div>
        )}
        <div className="mt-auto pt-6 border-t flex flex-col space-y-4">
           <button onClick={() => setShowThemeModal(true)} className="flex items-center space-x-3 px-2 text-gray-500 hover:text-gray-800 transition-colors"><Palette size={18} /> <span className="text-sm font-medium">视觉风格</span></button>
           <div className="flex items-center justify-between bg-gray-50 p-3 rounded-2xl"><div className="flex items-center space-x-2 truncate"><div className={`w-8 h-8 bg-${theme}-600 rounded-full flex items-center justify-center text-white font-bold text-xs`}>{currentUser.name[0]}</div><p className="text-xs font-bold truncate">{currentUser.name}</p></div><button onClick={() => setCurrentUser(null)} className="text-gray-400 hover:text-rose-500"><LogOut size={16}/></button></div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b px-8 flex items-center justify-between sticky top-0 z-40"><h2 className="text-lg font-bold">{view === 'DASHBOARD' && '概览仪表盘'} {view === 'RESOURCES' && '空间资源库'} {view === 'BOOKINGS' && '我的申请'} {view === 'USERS' && '成员角色管理'} {view === 'WORKFLOW' && '流程引擎配置'} {view === 'DEPARTMENTS' && '集团架构树'}</h2></header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'DASHBOARD' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: '空闲会议室', value: resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length, icon: Monitor, color: 'text-indigo-600' },
                  { label: '可用工位', value: resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length, icon: Coffee, color: 'text-cyan-600' },
                  { label: '待我审批', value: bookings.filter(b => b.status === 'PENDING' && currentUser.role.includes(workflow[b.currentNodeIndex]?.approverRole)).length, icon: FileText, color: 'text-amber-600' },
                  { label: '全司占用率', value: `${occupancyRate}%`, icon: Activity, color: `text-${theme}-600` },
                ].map((s, i) => (
                  <div key={i} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex items-center space-x-4"><div className={`w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center ${s.color}`}><s.icon size={20}/></div><div><p className="text-[10px] text-gray-400 font-bold uppercase">{s.label}</p><p className="text-xl font-black">{s.value}</p></div></div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm">
                  <div className="flex justify-between items-center mb-10"><h4 className="font-bold flex items-center space-x-2 text-lg"><Calendar className={`text-${theme}-600`} size={20}/> <span>今日空间占用排期</span></h4><span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-3 py-1 rounded-full">{todayStr}</span></div>
                  <div className="relative ml-4 border-l-2 border-dashed border-gray-100 pl-10 space-y-12 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
                    {sortedTodayBookings.length > 0 ? sortedTodayBookings.map(b => (
                      <div key={b.id} className="relative group">
                        <div className={`absolute -left-[49px] top-1.5 w-6 h-6 rounded-full border-4 border-white shadow-md z-10 flex items-center justify-center transition-all ${b.status === 'APPROVED' ? `bg-${theme}-600` : b.status === 'REJECTED' ? 'bg-rose-500' : 'bg-amber-400'}`}>{b.status === 'APPROVED' ? <Check size={12} className="text-white"/> : b.status === 'PENDING' ? <Clock size={12} className="text-white"/> : <X size={12} className="text-white"/>}</div>
                        <div className="bg-gray-50/50 p-6 rounded-[2rem] border border-transparent hover:border-gray-200 hover:bg-white hover:shadow-xl transition-all duration-300">
                           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                              <div className="flex items-center space-x-4"><div className="text-center min-w-[60px]"><p className="text-lg font-black text-gray-800 leading-none">{new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p><p className="text-[10px] text-gray-400 mt-1 uppercase">Start</p></div><div className={`h-8 w-1 bg-${theme}-100 rounded-full opacity-50`}></div><div><h5 className="font-bold text-gray-800 text-sm group-hover:text-indigo-600 transition-colors">{b.purpose}</h5><p className="text-[10px] text-gray-400 flex items-center space-x-1 mt-0.5">{b.type === 'ROOM' ? <Monitor size={10}/> : <Coffee size={10}/>} <span>{b.type === 'ROOM' ? '会议室预订' : '工位申请'}</span></p></div></div>
                              <StatusBadge status={b.status} theme={theme} />
                           </div>
                           <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100"><div className="flex items-center space-x-2"><MapPin size={14} className="text-gray-300"/><p className="text-[11px] font-bold text-gray-700">{resources.find(r => r.id === b.resourceId)?.name}</p></div><div className="flex items-center space-x-2"><Users size={14} className="text-gray-300"/><p className="text-[11px] font-bold text-gray-700">{users.find(u => u.id === b.userId)?.name}</p></div></div>
                        </div>
                      </div>
                    )) : (<div className="py-20 text-center border-2 border-dashed border-gray-100 rounded-[2rem]"><p className="text-gray-300 italic text-sm">今日排期暂无资源占用</p></div>)}
                  </div>
                </div>

                <div className="flex flex-col space-y-8">
                  <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm relative overflow-hidden group">
                    <div className={`absolute top-0 right-0 w-32 h-32 bg-${theme}-600/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700`}/>
                    <h4 className="font-bold flex items-center space-x-2 text-lg mb-6"><Sparkles className={`text-${theme}-600`} size={20}/> <span>AI 快捷任务中心</span></h4>
                    <p className="text-xs text-gray-400 mb-6">自然语言匹配最优资源。</p>
                    <div className="space-y-4">
                      <div className="relative">
                        <textarea value={quickIntent} onChange={(e) => setQuickIntent(e.target.value)} placeholder="例如：5个人下午3点开会..." className="w-full bg-gray-50 border-none rounded-3xl p-5 text-sm outline-none focus:ring-2 focus:ring-indigo-100 h-32 resize-none transition-all pr-12"/>
                        <button onClick={handleAiQuickMatch} disabled={isAiLoading || !quickIntent} className={`absolute bottom-4 right-4 p-2 bg-${theme}-600 text-white rounded-xl shadow-lg hover:scale-110 active:scale-95 transition-all disabled:opacity-50`}>{isAiLoading ? <RefreshCw className="animate-spin" size={20}/> : <SendHorizontal size={20}/>}</button>
                      </div>
                      {quickRecommendation && (
                        <div className={`p-6 bg-${theme}-50/50 rounded-3xl border border-${theme}-100 animate-in zoom-in`}>
                          <p className={`text-xs text-${theme}-800 leading-relaxed mb-4 italic font-medium`}>"{quickRecommendation}"</p>
                          {matchedResource && (
                            <div className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-50">
                               <div className="flex items-center space-x-3"><div className={`w-10 h-10 rounded-xl bg-${theme}-100 flex items-center justify-center text-${theme}-600`}>{matchedResource.type === 'ROOM' ? <Monitor size={18}/> : <Coffee size={18}/>}</div><div><p className="text-xs font-black">{matchedResource.name}</p><p className="text-[10px] text-gray-400 uppercase tracking-tighter">{matchedResource.location}</p></div></div>
                               <button onClick={handleQuickBookConfirm} className={`px-4 py-2 bg-${theme}-600 text-white text-[10px] font-bold rounded-xl shadow-md`}>确认预约</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <MonthlyUsageTable resources={resources} bookings={bookings} theme={theme} />
            </div>
          )}

          {view === 'BOOKINGS' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-white rounded-[2.5rem] border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr><th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">申请单内容</th><th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">预约时段</th><th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">当前进度</th><th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">操作</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {bookings.map(b => (
                      <React.Fragment key={b.id}>
                        <tr className={`hover:bg-gray-50/30 transition-colors ${expandedBookingId === b.id ? 'bg-gray-50/50' : ''}`}>
                          <td className="px-8 py-6">
                            <p className="font-bold text-gray-800">{resources.find(r => r.id === b.resourceId)?.name || '未知资源'}</p>
                            <p className="text-[10px] text-gray-400 mt-1 truncate max-w-[150px]">{b.purpose}</p>
                          </td>
                          <td className="px-8 py-6">
                            <p className="text-[11px] font-bold text-gray-600">{new Date(b.startTime).toLocaleDateString()} {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            <p className="text-[10px] text-gray-400">至 {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                          </td>
                          <td className="px-8 py-6 text-center">
                             <div className="flex flex-col items-center">
                                <StatusBadge status={b.status} theme={theme} />
                                <button 
                                  onClick={() => setExpandedBookingId(expandedBookingId === b.id ? null : b.id)}
                                  className={`mt-2 text-[9px] font-black text-${theme}-600 hover:underline`}
                                >
                                  {expandedBookingId === b.id ? '折叠详情' : '查看轨迹'}
                                </button>
                             </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center justify-center space-x-2">
                              {b.status === 'PENDING' && currentUser.role.includes(workflow[b.currentNodeIndex]?.approverRole) ? (
                                <div className="flex space-x-1">
                                  <button onClick={() => handleApprove(b.id, 'APPROVED')} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all"><CheckCircle size={18}/></button>
                                  <button onClick={() => handleApprove(b.id, 'REJECTED')} className="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-600 hover:text-white transition-all"><XCircle size={18}/></button>
                                </div>
                              ) : (
                                <span className="text-[10px] text-gray-300 italic">无可用操作</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedBookingId === b.id && (
                          <tr>
                            <td colSpan={4} className="px-8 py-6 bg-gray-50/30 border-b border-gray-100">
                              <FlowTracker 
                                booking={b} 
                                workflow={workflow} 
                                theme={theme} 
                                onRemind={b.userId === currentUser.id ? handleSendReminder : undefined}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center">
                 <div><h3 className="text-xl font-bold">成员中枢</h3><p className="text-sm text-gray-400">管理公司成员及其系统角色。</p></div>
                 <button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-md`}>录入成员</button>
               </div>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {users.map(u => (
                   <div key={u.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col group hover:border-indigo-100 transition-all">
                     <div className="flex items-center space-x-4 mb-6">
                        <div className={`w-12 h-12 bg-${theme}-50 rounded-2xl flex items-center justify-center text-${theme}-600 font-bold text-lg`}>{u.name[0]}</div>
                        <div className="flex-1 min-w-0"><h6 className="font-bold text-gray-800 truncate">{u.name}</h6><p className="text-[10px] text-gray-400 font-bold uppercase truncate">{u.department}</p></div>
                     </div>
                     <div className="space-y-2 flex-1">
                        <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">角色权限</p>
                        <div className="flex flex-wrap gap-1">{u.role.map(r => <RoleBadge key={r} role={r} theme={theme}/>)}</div>
                     </div>
                     <div className="mt-6 pt-4 border-t border-gray-50 flex justify-between">
                        <button onClick={() => { setEditingUser(u); setShowUserModal(true); }} className={`flex items-center space-x-1.5 text-xs font-bold text-gray-400 hover:text-${theme}-600 transition-colors`}><Edit2 size={12}/> <span>编辑资料</span></button>
                        <button onClick={() => handleDeleteUser(u.id)} className="flex items-center space-x-1.5 text-xs font-bold text-gray-400 hover:text-rose-600 transition-colors"><Trash2 size={12}/> <span>移除</span></button>
                     </div>
                   </div>
                 ))}
               </div>
            </div>
          )}

          {/* 其他视图 */}
          {view === 'DEPARTMENTS' && (
             <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-8"><div><h3 className="text-2xl font-black">集团架构配置</h3><p className="text-sm text-gray-400 mt-1">按层级维护组织部门。</p></div><button onClick={() => addDepartment()} className={`flex items-center space-x-2 bg-${theme}-600 text-white px-5 py-3 rounded-2xl font-bold shadow-lg transition-all`}><Plus size={20}/> <span>添加一级部门</span></button></div>
               <div className="bg-white/50 p-8 rounded-[3rem] border border-gray-100 shadow-sm backdrop-blur-sm">{departments.filter(d => !d.parentId).map(rootDept => (<DepartmentTreeNode key={rootDept.id} department={rootDept} departments={departments} onAdd={addDepartment} onDelete={deleteDepartment} onRename={renameDepartment} theme={theme}/>))}</div>
            </div>
          )}
          
          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in"><div className="flex justify-between items-center"><div><h3 className="text-xl font-bold">物理资源</h3><p className="text-sm text-gray-400">管理全司的会议室与工位资源。</p></div>{currentUser.role.includes('SYSTEM_ADMIN') && <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className={`bg-${theme}-600 text-white p-3 rounded-xl shadow-lg`}><Plus size={20}/></button>}</div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{resources.map(r => (<div key={r.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-md transition-all group relative flex flex-col h-full">{currentUser.role.includes('SYSTEM_ADMIN') && (<div className="absolute top-6 right-6 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"><button onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className={`p-2 bg-gray-50 rounded-full hover:bg-${theme}-50 text-gray-400 hover:text-${theme}-600 transition-colors`}><Edit2 size={14}/></button><button onClick={() => handleDeleteResource(r.id)} className="p-2 bg-gray-50 rounded-full hover:bg-rose-50 text-gray-400 hover:text-rose-600 transition-colors"><Trash2 size={14}/></button></div>)}<div className={`w-12 h-12 rounded-2xl bg-${theme}-50 flex items-center justify-center mb-6`}>{r.type === 'ROOM' ? <Monitor className={`text-${theme}-600`} /> : <Coffee className="text-cyan-600" />}</div><div className="mb-4"><h5 className="text-lg font-bold mb-1">{r.name}</h5><p className="text-xs text-gray-400 flex items-center space-x-1"><MapPin size={10}/> <span>{r.location} · {r.capacity}人</span></p></div><div className="flex justify-between items-center mt-auto pt-6 border-t border-gray-50"><StatusBadge status={r.status} theme={theme} /><button onClick={() => { setSelectedResource(r); setShowBookingModal(true); }} className={`text-xs font-bold text-${theme}-600 hover:underline transition-all`}>立即申请</button></div></div>))}</div></div>
          )}

          {view === 'WORKFLOW' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in duration-500">
              <div className="flex justify-between items-center mb-8"><div><h3 className="text-2xl font-black">流程引擎配置</h3><p className="text-sm text-gray-400 mt-1">灵活定义全司资源预约的审批阶梯。</p></div><button onClick={addWorkflowNode} className={`flex items-center space-x-2 bg-${theme}-600 text-white px-5 py-3 rounded-2xl font-bold shadow-lg transition-all`}><Plus size={20}/> <span>添加步骤</span></button></div>
              <div className="space-y-4">{workflow.map((node, index) => (<div key={node.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center space-x-6 group relative"><div className="flex flex-col space-y-1 opacity-40 hover:opacity-100 transition-opacity"><button onClick={() => moveWorkflowNode(index, 'UP')} disabled={index === 0} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 disabled:opacity-20"><ChevronUp size={18}/></button><button onClick={() => moveWorkflowNode(index, 'DOWN')} disabled={index === workflow.length - 1} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 disabled:opacity-20"><ChevronDown size={18}/></button></div><div className={`w-14 h-14 bg-${theme}-50 rounded-2xl flex items-center justify-center text-${theme}-600 font-bold text-xl shadow-inner`}>{index + 1}</div><div className="flex-1 grid grid-cols-2 gap-6"><div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1">节点名称</label><input value={node.name} onChange={e => updateWorkflowNode(node.id, { name: e.target.value })} className="w-full bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-100 rounded-xl p-3 text-sm font-bold outline-none transition-all"/></div><div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1">审批权限</label><select value={node.approverRole} onChange={e => updateWorkflowNode(node.id, { approverRole: e.target.value as Role })} className="w-full bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-100 rounded-xl p-3 text-sm font-bold outline-none transition-all"><option value="SYSTEM_ADMIN">系统管理员</option><option value="APPROVAL_ADMIN">审批负责人</option><option value="EMPLOYEE">全员权限</option></select></div></div><button onClick={() => removeWorkflowNode(node.id)} className="p-3 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-2xl transition-all"><Trash2 size={22}/></button></div>))}</div>
            </div>
          )}
        </div>
      </main>

      {/* 模态框组 */}
      {showResourceModal && (<div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4"><div className="bg-white p-10 rounded-[2.5rem] w-full max-w-md shadow-2xl animate-in fade-in duration-300"><h2 className="text-2xl font-bold mb-6">{editingResource ? '编辑资源详情' : '注册新资源'}</h2><div className="space-y-5"><input placeholder="资源名称" value={editingResource?.name || ''} onChange={e => setEditingResource(prev => ({ ...prev!, name: e.target.value }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" /><div className="grid grid-cols-2 gap-4"><select value={editingResource?.type || 'ROOM'} onChange={e => setEditingResource(prev => ({ ...prev!, type: e.target.value as ResourceType }))} className="w-full p-4 bg-gray-50 border rounded-2xl outline-none font-bold"><option value="ROOM">会议室</option><option value="DESK">工位</option></select><input type="number" placeholder="容纳人数" value={editingResource?.capacity || ''} onChange={e => setEditingResource(prev => ({ ...prev!, capacity: parseInt(e.target.value) }))} className="w-full p-4 bg-gray-50 border rounded-2xl outline-none" /></div><input placeholder="物理位置" value={editingResource?.location || ''} onChange={e => setEditingResource(prev => ({ ...prev!, location: e.target.value }))} className="w-full p-4 bg-gray-50 border rounded-2xl outline-none" /></div><div className="mt-10 flex space-x-4"><button onClick={() => setShowResourceModal(false)} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => handleSaveResource(editingResource || {})} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl`}>保存</button></div></div></div>)}
      {showBookingModal && selectedResource && (<BookingFormModal resource={selectedResource} theme={theme} onClose={() => setShowBookingModal(false)} onConfirm={handleBooking} availableResources={resources.filter(r => r.status === 'AVAILABLE')}/>)}
      {showThemeModal && (<div className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in" onClick={() => setShowThemeModal(false)}><div className="bg-white p-8 rounded-[2rem] shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}><h3 className="text-xl font-bold mb-6">切换视觉风格</h3><div className="grid grid-cols-3 gap-4">{THEMES.map(t => (<button key={t.id} onClick={() => { setTheme(t.id); setShowThemeModal(false); }} className={`flex flex-col items-center p-3 rounded-2xl border-2 transition-all ${theme === t.id ? 'border-gray-800 bg-gray-50' : 'border-transparent hover:bg-gray-50'}`}><div className={`w-8 h-8 rounded-full mb-2 ${t.color}`}></div><span className="text-[10px] font-bold text-gray-600">{t.name}</span></button>))}</div></div></div>)}
      {showUserModal && <UserModal user={editingUser} departments={departments} onClose={() => { setShowUserModal(false); setEditingUser(null); }} onSave={handleSaveUser} theme={theme} currentOperator={currentUser}/>}
    </div>
  );
};

const BookingFormModal = ({ resource, theme, onClose, onConfirm, availableResources }: any) => {
  const [purpose, setPurpose] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [loadingAI, setLoadingAI] = useState(false);
  const [recommendation, setRecommendation] = useState('');
  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4"><div className="bg-white p-10 rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in"><h2 className="text-2xl font-bold mb-2">预约申请</h2><p className="text-gray-400 text-sm mb-6 flex items-center space-x-2">{resource.type === 'ROOM' ? <Monitor size={14}/> : <Coffee size={14}/>}<span>申请对象: <span className={`text-${theme}-600 font-bold`}>{resource.name}</span></span></p><div className="space-y-5"><div className="grid grid-cols-3 gap-4"><div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">日期</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full p-3 bg-gray-50 border-none rounded-xl font-bold outline-none" /></div><div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">开始</label><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full p-3 bg-gray-50 border-none rounded-xl font-bold outline-none" /></div><div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">结束</label><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full p-3 bg-gray-50 border-none rounded-xl font-bold outline-none" /></div></div><div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">用途说明</label><textarea value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="描述您的预约意图..." className="w-full p-4 bg-gray-50 border-none rounded-2xl h-24 outline-none text-sm"/></div><div className={`p-4 bg-${theme}-50/50 rounded-2xl border border-${theme}-100`}><button onClick={async () => { setLoadingAI(true); const rec = await getSmartRecommendation(purpose, resource.capacity || 1, availableResources); setRecommendation(rec); setLoadingAI(false); }} className={`text-xs text-${theme}-600 font-bold mb-1 flex items-center space-x-1 underline decoration-dotted`}><Zap size={12}/> <span>AI 智能评估建议</span></button><p className={`text-[11px] text-${theme}-700 min-h-[20px] leading-relaxed italic`}>{loadingAI ? '分析中...' : recommendation || '输入用途后可点击上方获取 AI 建议。'}</p></div></div><div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onConfirm(resource.id, purpose, `${date}T${startTime}`, `${date}T${endTime}`)} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg`}>提交申请</button></div></div></div>
  );
};

export default App;
