
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
  ChevronLeft
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, ApprovalRecord, Notification, ResourceStatus, Department } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS } from './constants';
import { getSmartRecommendation } from './services/geminiService';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V11';
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

const UserModal = ({ user, departments, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState<Partial<User>>(user || { name: '', email: '', department: departments[0]?.name || '', role: ['EMPLOYEE'] });
  const toggleRole = (role: Role) => { 
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
        <div className="space-y-6 mt-8">
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
            <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">角色权限</label>
            <div className="space-y-2.5">
              {['EMPLOYEE', 'APPROVAL_ADMIN', 'SYSTEM_ADMIN'].map(rid => {
                const isSelected = formData.role?.includes(rid as Role);
                return (
                  <button key={rid} onClick={() => toggleRole(rid as Role)} className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${isSelected ? `bg-${theme}-50 border-${theme}-200 shadow-sm` : 'bg-gray-50 border-gray-100'}`}>
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

// 组织架构树递归组件
const DepartmentTreeNode = ({ department, departments, onAdd, onDelete, onRename, level = 0, theme }: any) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const children = departments.filter((d: any) => d.parentId === department.id);
  const hasChildren = children.length > 0;

  return (
    <div className="animate-in fade-in slide-in-from-left-2 duration-300">
      <div 
        className={`flex items-center group py-2.5 px-4 rounded-2xl transition-all ${level === 0 ? 'bg-white border border-gray-100 shadow-sm mb-2' : 'hover:bg-gray-50/80'}`}
        style={{ marginLeft: `${level > 0 ? 32 : 0}px` }}
      >
        <div className="flex items-center flex-1 space-x-3">
          {hasChildren ? (
            <button onClick={() => setIsExpanded(!isExpanded)} className={`p-1 hover:bg-gray-200 rounded text-gray-400 transition-colors`}>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : <div className="w-6 flex justify-center text-gray-300 opacity-40"><CornerDownRight size={12} /></div>}
          
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${level === 0 ? `bg-${theme}-100 text-${theme}-600` : 'bg-gray-100 text-gray-400'}`}>
            {level === 0 ? <Building2 size={16} /> : <FolderTree size={16} />}
          </div>
          
          <input 
            value={department.name} 
            onChange={(e) => onRename(department.id, e.target.value)}
            placeholder="部门名称"
            className={`bg-transparent font-bold text-gray-700 outline-none border-b-2 border-transparent focus:border-${theme}-600 pb-0.5 transition-all text-sm flex-1`}
          />
        </div>

        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onAdd(department.id)} 
            className={`p-2 text-${theme}-600 hover:bg-${theme}-50 rounded-xl`}
            title="添加下级部门"
          >
            <Plus size={16} />
          </button>
          {level > 0 && (
            <button 
              onClick={() => onDelete(department.id)} 
              className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
              title="删除该部门"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
      {isExpanded && hasChildren && (
        <div className={`ml-4 ${level === 0 ? '' : 'border-l border-dashed border-gray-200'}`}>
          {children.map((child: any) => (
            <DepartmentTreeNode 
              key={child.id} 
              department={child} 
              departments={departments} 
              onAdd={onAdd} 
              onDelete={onDelete} 
              onRename={onRename} 
              level={level + 1}
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
    
    const dayBookings = bookings.filter(b => 
      b.resourceId === resourceId && 
      (b.startTime.startsWith(dateStr) || b.endTime.startsWith(dateStr)) &&
      ['APPROVED', 'PENDING'].includes(b.status)
    );

    if (dayBookings.length === 0) return null;
    const hasApproved = dayBookings.some(b => b.status === 'APPROVED');
    return hasApproved ? 'APPROVED' : 'PENDING';
  };

  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));

  const groupedResources = useMemo(() => {
    return {
      ROOM: resources.filter(r => r.type === 'ROOM'),
      DESK: resources.filter(r => r.type === 'DESK')
    };
  }, [resources]);

  return (
    <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm overflow-hidden animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <h4 className="font-bold flex items-center space-x-2 text-lg">
          <PieChart className={`text-${theme}-600`} size={20}/> 
          <span>全司资源月度排期看板</span>
        </h4>
        <div className="flex items-center bg-gray-50 p-1 rounded-2xl border border-gray-100">
          <button onClick={prevMonth} className="p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all text-gray-400 hover:text-gray-800"><ChevronLeft size={18}/></button>
          <span className="px-6 text-sm font-black text-gray-700 min-w-[120px] text-center">{monthLabel}</span>
          <button onClick={nextMonth} className="p-2 hover:bg-white hover:shadow-sm rounded-xl transition-all text-gray-400 hover:text-gray-800"><ChevronRight size={18}/></button>
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar pb-4">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-white text-left p-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest min-w-[180px] border-b">资源名称</th>
              {daysInMonth.map(day => (
                <th key={day} className="p-3 text-center border-b min-w-[36px]">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-gray-400">{day}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['ROOM', 'DESK'] as ResourceType[]).map(type => (
              <React.Fragment key={type}>
                <tr className="bg-gray-50/50">
                  <td colSpan={daysInMonth.length + 1} className="sticky left-0 z-10 px-4 py-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {type === 'ROOM' ? '—— 会议室资源 ——' : '—— 办公工位资源 ——'}
                  </td>
                </tr>
                {groupedResources[type].map(res => (
                  <tr key={res.id} className="hover:bg-gray-50 group">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 transition-colors p-4 border-b">
                      <div className="flex items-center space-x-2">
                        {type === 'ROOM' ? <Monitor size={12} className={`text-${theme}-600`}/> : <Coffee size={12} className="text-cyan-600"/>}
                        <span className="text-xs font-bold text-gray-700">{res.name}</span>
                      </div>
                    </td>
                    {daysInMonth.map(day => {
                      const status = getStatusForDay(res.id, day);
                      return (
                        <td key={day} className="p-1 border-b text-center relative">
                          <div 
                            className={`w-full h-8 rounded-lg transition-all duration-300 ${
                              status === 'APPROVED' ? `bg-${theme}-600 shadow-sm` : 
                              status === 'PENDING' ? `bg-${theme}-200 animate-pulse` : 
                              'bg-gray-50/50 group-hover:bg-gray-100'
                            }`}
                            title={`${res.name} - ${monthLabel}${day}日: ${status === 'APPROVED' ? '已预约' : status === 'PENDING' ? '待审批' : '空闲'}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex items-center space-x-8 text-[10px] font-bold text-gray-400 px-4">
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full bg-${theme}-600`}/>
          <span>已确认预订</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full bg-${theme}-200`}/>
          <span>待审批申请</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-gray-100"/>
          <span>全天候空闲</span>
        </div>
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

  // --- 逻辑计算 ---
  const todayStr = new Date().toISOString().split('T')[0];
  const sortedTodayBookings = useMemo(() => {
    return bookings
      .filter(b => b.startTime.startsWith(todayStr))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [bookings, todayStr]);

  const occupancyRate = useMemo(() => {
    const total = resources.length;
    if (total === 0) return 0;
    const busy = resources.filter(r => 
      bookings.some(b => 
        b.resourceId === r.id && 
        (b.status === 'APPROVED' || b.status === 'PENDING') && 
        new Date(b.startTime) <= new Date() && 
        new Date(b.endTime) > new Date()
      )
    ).length;
    return Math.round((busy / total) * 100);
  }, [resources, bookings]);

  // --- 处理器 ---
  const handleSaveUser = (data: Partial<User>) => {
    if (editingUser) {
      setUsers(users.map(u => u.id === editingUser.id ? { ...u, ...data } as User : u));
    } else {
      setUsers([...users, { id: 'u-' + Date.now(), ...data } as User]);
    }
    setShowUserModal(false);
    setEditingUser(null);
  };

  const handleDeleteUser = (id: string) => {
    if (id === currentUser?.id) return alert('不能删除自己');
    if (confirm('确定移除该成员吗？')) setUsers(users.filter(u => u.id !== id));
  };

  const handleSaveResource = (data: Partial<Resource>) => {
    if (editingResource) {
      setResources(resources.map(r => r.id === editingResource.id ? { ...r, ...data } as Resource : r));
    } else {
      setResources([...resources, { id: 'r-' + Date.now(), status: 'AVAILABLE', features: [], ...data } as Resource]);
    }
    setShowResourceModal(false);
    setEditingResource(null);
  };

  const handleDeleteResource = (id: string) => {
    if (confirm('确定删除该资源吗？')) setResources(resources.filter(r => r.id !== id));
  };

  const handleBooking = (resourceId: string, purpose: string, startTime: string, endTime: string) => {
    const resource = resources.find(r => r.id === resourceId);
    if (!resource || !currentUser) return;

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
      approvalHistory: []
    };

    setBookings([newBooking, ...bookings]);
    setShowBookingModal(false);
    setSelectedResource(null);

    const newNotif: Notification = {
      id: `nt-${Date.now()}`,
      userId: currentUser.id,
      title: '申请提交成功',
      content: `您已成功提交 ${resource.name} 的预约申请，请等待审批。`,
      timestamp: new Date().toISOString(),
      isRead: false,
      type: 'SUCCESS',
      linkView: 'BOOKINGS'
    };
    setNotifications([newNotif, ...notifications]);
  };

  const handleApprove = (bookingId: string, status: 'APPROVED' | 'REJECTED') => {
    setBookings(bookings.map(b => {
      if (b.id !== bookingId) return b;
      const history: ApprovalRecord = {
        nodeName: workflow[b.currentNodeIndex]?.name || '核准',
        approverName: currentUser?.name || '管理员',
        status,
        timestamp: new Date().toISOString()
      };
      if (status === 'REJECTED') return { ...b, status: 'REJECTED', approvalHistory: [...b.approvalHistory, history] };
      const isLast = b.currentNodeIndex === workflow.length - 1;
      return isLast 
        ? { ...b, status: 'APPROVED', approvalHistory: [...b.approvalHistory, history] }
        : { ...b, currentNodeIndex: b.currentNodeIndex + 1, approvalHistory: [...b.approvalHistory, history] };
    }));
  };

  const addWorkflowNode = () => {
    setWorkflow([...workflow, { id: 'n-' + Date.now(), name: '新审批节点', approverRole: 'APPROVAL_ADMIN' }]);
  };

  const removeWorkflowNode = (id: string) => {
    if (workflow.length === 1) return alert('流程至少需要一个节点');
    setWorkflow(workflow.filter(n => n.id !== id));
  };

  const moveWorkflowNode = (index: number, direction: 'UP' | 'DOWN') => {
    const newWorkflow = [...workflow];
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= workflow.length) return;
    [newWorkflow[index], newWorkflow[targetIndex]] = [newWorkflow[targetIndex], newWorkflow[index]];
    setWorkflow(newWorkflow);
  };

  const updateWorkflowNode = (id: string, updates: Partial<ApprovalNode>) => {
    setWorkflow(workflow.map(n => n.id === id ? { ...n, ...updates } : n));
  };

  const addDepartment = (parentId?: string) => {
    setDepartments([...departments, { id: 'dpt-' + Date.now(), name: '新子部门', parentId }]);
  };

  const deleteDepartment = (id: string) => {
    const hasChildren = departments.some(d => d.parentId === id);
    const hasUsers = users.some(u => u.department === departments.find(d => d.id === id)?.name);
    if (hasChildren) return alert('该部门下有子部门，请先删除或移出子部门');
    if (hasUsers) return alert('该部门下仍有成员，无法删除');
    if (confirm('确定删除该部门吗？')) {
      setDepartments(departments.filter(d => d.id !== id));
    }
  };

  const renameDepartment = (id: string, newName: string) => {
    setDepartments(departments.map(d => d.id === id ? { ...d, name: newName } : d));
  };

  if (!currentUser) {
    return (
      <div className={`min-h-screen bg-${theme}-600 flex items-center justify-center p-6`}>
        <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-full max-w-md animate-in zoom-in duration-300">
          <div className="flex justify-center mb-6"><div className={`w-16 h-16 bg-${theme}-600 rounded-2xl flex items-center justify-center text-white shadow-xl`}><Cpu size={32}/></div></div>
          <h1 className="text-2xl font-black text-center mb-2">SmartOffice 登录</h1>
          <p className="text-gray-400 text-center text-sm mb-8">请选择身份以进入系统</p>
          <div className="space-y-3">
            {users.map(u => (
              <button key={u.id} onClick={() => setCurrentUser(u)} className={`w-full p-4 border border-gray-100 rounded-2xl hover:bg-${theme}-50 transition-all flex items-center justify-between group`}>
                <div className="flex items-center space-x-4 text-left">
                  <div className={`w-10 h-10 bg-${theme}-100 rounded-full flex items-center justify-center font-bold text-${theme}-600`}>{u.name[0]}</div>
                  <div><p className="font-bold text-gray-800 text-sm">{u.name}</p><p className="text-[10px] text-gray-400">{u.department}</p></div>
                </div>
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
        <div className="flex items-center space-x-3 mb-10 px-2">
          <div className={`w-8 h-8 bg-${theme}-600 rounded-lg flex items-center justify-center text-white shadow-lg`}><Cpu size={18}/></div>
          <span className="text-lg font-black tracking-tight">SmartOffice</span>
        </div>
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
        <div className="mt-auto pt-6 border-t flex flex-col space-y-4">
           <button onClick={() => setShowThemeModal(true)} className="flex items-center space-x-3 px-2 text-gray-500 hover:text-gray-800 transition-colors">
              <Palette size={18} /> <span className="text-sm font-medium">视觉风格</span>
           </button>
           <div className="flex items-center justify-between bg-gray-50 p-3 rounded-2xl">
             <div className="flex items-center space-x-2 truncate">
               <div className={`w-8 h-8 bg-${theme}-600 rounded-full flex items-center justify-center text-white font-bold text-xs`}>{currentUser.name[0]}</div>
               <div className="truncate"><p className="text-xs font-bold truncate">{currentUser.name}</p></div>
             </div>
             <button onClick={() => setCurrentUser(null)} className="text-gray-400 hover:text-rose-500"><LogOut size={16}/></button>
           </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b px-8 flex items-center justify-between sticky top-0 z-40">
           <h2 className="text-lg font-bold">
             {view === 'DASHBOARD' && '概览仪表盘'} {view === 'RESOURCES' && '空间资源库'} {view === 'BOOKINGS' && '我的申请'} {view === 'USERS' && '成员角色管理'} {view === 'WORKFLOW' && '流程引擎配置'} {view === 'DEPARTMENTS' && '集团架构树'}
           </h2>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'DASHBOARD' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: '空闲会议室', value: resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length, icon: Monitor, color: 'text-indigo-600' },
                  { label: '可用工位', value: resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length, icon: Coffee, color: 'text-cyan-600' },
                  { label: '待我审批', value: bookings.filter(b => b.status === 'PENDING' && currentUser.role.includes(workflow[b.currentNodeIndex]?.approverRole)).length, icon: FileText, color: 'text-amber-600' },
                  { label: '全司占用率', value: `${occupancyRate}%`, icon: Activity, color: `text-${theme}-600` },
                ].map((s, i) => (
                  <div key={i} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm flex items-center space-x-4">
                    <div className={`w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center ${s.color}`}><s.icon size={20}/></div>
                    <div><p className="text-[10px] text-gray-400 font-bold uppercase">{s.label}</p><p className="text-xl font-black">{s.value}</p></div>
                  </div>
                ))}
              </div>

              {/* 今日排期时间轴 */}
              <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm">
                <div className="flex justify-between items-center mb-10">
                  <h4 className="font-bold flex items-center space-x-2 text-lg"><Calendar className={`text-${theme}-600`} size={20}/> <span>今日空间占用排期</span></h4>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-3 py-1 rounded-full">{todayStr}</span>
                </div>
                
                <div className="relative ml-4 border-l-2 border-dashed border-gray-100 pl-10 space-y-12">
                  {sortedTodayBookings.length > 0 ? sortedTodayBookings.map(b => (
                    <div key={b.id} className="relative group">
                      <div className={`absolute -left-[49px] top-1.5 w-6 h-6 rounded-full border-4 border-white shadow-md z-10 flex items-center justify-center transition-all ${b.status === 'APPROVED' ? `bg-${theme}-600` : b.status === 'REJECTED' ? 'bg-rose-500' : 'bg-amber-400'}`}>
                         {b.status === 'APPROVED' ? <Check size={12} className="text-white"/> : b.status === 'PENDING' ? <Clock size={12} className="text-white"/> : <X size={12} className="text-white"/>}
                      </div>
                      <div className="bg-gray-50/50 p-6 rounded-[2rem] border border-transparent hover:border-gray-200 hover:bg-white hover:shadow-xl transition-all duration-300">
                         <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                            <div className="flex items-center space-x-4">
                               <div className="text-center min-w-[60px]">
                                  <p className="text-lg font-black text-gray-800 leading-none">{new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                  <p className="text-[10px] text-gray-400 mt-1 uppercase">Start</p>
                               </div>
                               <div className={`h-8 w-1 bg-${theme}-100 rounded-full opacity-50`}></div>
                               <div>
                                  <h5 className="font-bold text-gray-800 text-sm group-hover:text-indigo-600 transition-colors">{b.purpose}</h5>
                                  <p className="text-[10px] text-gray-400 flex items-center space-x-1 mt-0.5">{b.type === 'ROOM' ? <Monitor size={10}/> : <Coffee size={10}/>} <span>{b.type === 'ROOM' ? '会议室预订' : '工位申请'}</span></p>
                               </div>
                            </div>
                            <StatusBadge status={b.status} theme={theme} />
                         </div>
                         <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                            <div className="flex items-center space-x-2"><MapPin size={14} className="text-gray-300"/><div><p className="text-[9px] text-gray-400 uppercase font-bold tracking-tight">资源名称</p><p className="text-[11px] font-bold text-gray-700">{resources.find(r => r.id === b.resourceId)?.name || '未知'}</p></div></div>
                            <div className="flex items-center space-x-2"><Users size={14} className="text-gray-300"/><div><p className="text-[9px] text-gray-400 uppercase font-bold tracking-tight">申请人</p><p className="text-[11px] font-bold text-gray-700">{users.find(u => u.id === b.userId)?.name}</p></div></div>
                            <div className="flex items-center space-x-2 hidden md:flex"><Clock size={14} className="text-gray-300"/><div><p className="text-[9px] text-gray-400 uppercase font-bold tracking-tight">结束时间</p><p className="text-[11px] font-bold text-gray-700">{new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div></div>
                         </div>
                      </div>
                    </div>
                  )) : (
                    <div className="py-20 text-center border-2 border-dashed border-gray-100 rounded-[2rem]"><p className="text-gray-300 italic text-sm">今日排期暂无资源占用</p></div>
                  )}
                </div>
              </div>

              {/* 新增：月度占用全景表 */}
              <MonthlyUsageTable resources={resources} bookings={bookings} theme={theme} />
            </div>
          )}

          {view === 'DEPARTMENTS' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-bottom-8 fade-in duration-500">
               <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-black">集团架构配置</h3>
                  <p className="text-sm text-gray-400 mt-1">按层级维护组织部门，该结构将同步至成员管理与审批流。</p>
                </div>
                <button onClick={() => addDepartment()} className={`flex items-center space-x-2 bg-${theme}-600 text-white px-5 py-3 rounded-2xl font-bold shadow-lg shadow-${theme}-100 transition-all`}><Plus size={20}/> <span>添加一级部门</span></button>
              </div>
              <div className="bg-white/50 p-8 rounded-[3rem] border border-gray-100 shadow-sm backdrop-blur-sm">
                 {departments.filter(d => !d.parentId).map(rootDept => (
                    <DepartmentTreeNode key={rootDept.id} department={rootDept} departments={departments} onAdd={addDepartment} onDelete={deleteDepartment} onRename={renameDepartment} theme={theme}/>
                 ))}
                 {departments.filter(d => !d.parentId).length === 0 && (
                   <div className="py-20 text-center text-gray-400 italic">暂无组织架构，点击右上方按钮开始创建</div>
                 )}
              </div>
            </div>
          )}

          {view === 'WORKFLOW' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in slide-in-from-bottom-8 fade-in duration-500">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-2xl font-black">流程引擎配置</h3>
                  <p className="text-sm text-gray-400 mt-1">灵活定义全司资源预约的审批阶梯与责任角色。</p>
                </div>
                <button onClick={addWorkflowNode} className={`flex items-center space-x-2 bg-${theme}-600 text-white px-5 py-3 rounded-2xl font-bold shadow-lg shadow-${theme}-100 transition-all`}><Plus size={20}/> <span>添加步骤</span></button>
              </div>
              <div className="space-y-4">
                {workflow.map((node, index) => (
                  <div key={node.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center space-x-6 group relative">
                    <div className="flex flex-col space-y-1 opacity-40 hover:opacity-100 transition-opacity">
                      <button onClick={() => moveWorkflowNode(index, 'UP')} disabled={index === 0} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 disabled:opacity-20"><ChevronUp size={18}/></button>
                      <button onClick={() => moveWorkflowNode(index, 'DOWN')} disabled={index === workflow.length - 1} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 disabled:opacity-20"><ChevronDown size={18}/></button>
                    </div>
                    <div className={`w-14 h-14 bg-${theme}-50 rounded-2xl flex items-center justify-center text-${theme}-600 font-bold text-xl shadow-inner`}>{index + 1}</div>
                    <div className="flex-1 grid grid-cols-2 gap-6">
                      <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1">节点名称</label><input value={node.name} onChange={e => updateWorkflowNode(node.id, { name: e.target.value })} className="w-full bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-100 rounded-xl p-3 text-sm font-bold outline-none transition-all"/></div>
                      <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase ml-1">审批权限</label><select value={node.approverRole} onChange={e => updateWorkflowNode(node.id, { approverRole: e.target.value as Role })} className="w-full bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-100 rounded-xl p-3 text-sm font-bold outline-none transition-all"><option value="SYSTEM_ADMIN">系统管理员</option><option value="APPROVAL_ADMIN">审批负责人</option><option value="EMPLOYEE">全员权限</option></select></div>
                    </div>
                    <button onClick={() => removeWorkflowNode(node.id)} className="p-3 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-2xl transition-all"><Trash2 size={22}/></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center">
                 <div><h3 className="text-xl font-bold">成员中枢</h3><p className="text-sm text-gray-400">管理公司成员及其系统角色。部门选项同步自架构树。</p></div>
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

          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center">
                <div><h3 className="text-xl font-bold">物理资源</h3><p className="text-sm text-gray-400">管理全司的会议室与工位资源。</p></div>
                {currentUser.role.includes('SYSTEM_ADMIN') && <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className={`bg-${theme}-600 text-white p-3 rounded-xl shadow-lg`}><Plus size={20}/></button>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {resources.map(r => (
                  <div key={r.id} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-md transition-all group relative flex flex-col h-full">
                    {currentUser.role.includes('SYSTEM_ADMIN') && (
                      <div className="absolute top-6 right-6 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className={`p-2 bg-gray-50 rounded-full hover:bg-${theme}-50 text-gray-400 hover:text-${theme}-600 transition-colors`}><Edit2 size={14}/></button>
                        <button onClick={() => handleDeleteResource(r.id)} className="p-2 bg-gray-50 rounded-full hover:bg-rose-50 text-gray-400 hover:text-rose-600 transition-colors"><Trash2 size={14}/></button>
                      </div>
                    )}
                    <div className={`w-12 h-12 rounded-2xl bg-${theme}-50 flex items-center justify-center mb-6`}>{r.type === 'ROOM' ? <Monitor className={`text-${theme}-600`} /> : <Coffee className="text-cyan-600" />}</div>
                    <div className="mb-4"><h5 className="text-lg font-bold mb-1">{r.name}</h5><p className="text-xs text-gray-400 flex items-center space-x-1"><MapPin size={10}/> <span>{r.location} · {r.capacity}人</span></p></div>
                    <div className="flex justify-between items-center mt-auto pt-6 border-t border-gray-50">
                      <StatusBadge status={r.status} theme={theme} />
                      <button onClick={() => { setSelectedResource(r); setShowBookingModal(true); }} className={`text-xs font-bold text-${theme}-600 hover:underline transition-all`}>立即申请</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'BOOKINGS' && (
            <div className="bg-white rounded-[2.5rem] border border-gray-100 overflow-hidden shadow-sm animate-in fade-in">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr><th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">申请单内容</th><th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest">预约时段</th><th className="px-8 py-5 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">状态 / 操作</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {bookings.map(b => (
                    <tr key={b.id} className="hover:bg-gray-50/30 transition-colors">
                      <td className="px-8 py-6"><p className="font-bold text-gray-800">{resources.find(r => r.id === b.resourceId)?.name || '未知资源'}</p><p className="text-[10px] text-gray-400 mt-1 truncate max-w-xs">{b.purpose}</p></td>
                      <td className="px-8 py-6"><p className="text-[11px] font-bold text-gray-600">{new Date(b.startTime).toLocaleString()}</p><p className="text-[10px] text-gray-400">至 {new Date(b.endTime).toLocaleTimeString()}</p></td>
                      <td className="px-8 py-6 flex justify-center">{b.status === 'PENDING' && currentUser.role.includes(workflow[b.currentNodeIndex]?.approverRole) ? (
                        <div className="flex space-x-2">
                           <button onClick={() => handleApprove(b.id, 'APPROVED')} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all"><CheckCircle size={18}/></button>
                           <button onClick={() => handleApprove(b.id, 'REJECTED')} className="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-600 hover:text-white transition-all"><XCircle size={18}/></button>
                        </div>
                      ) : <StatusBadge status={b.status} theme={theme} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {showResourceModal && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white p-10 rounded-[2.5rem] w-full max-w-md shadow-2xl animate-in fade-in duration-300">
            <h2 className="text-2xl font-bold mb-6">{editingResource ? '编辑资源详情' : '注册新资源'}</h2>
            <div className="space-y-5">
              <input placeholder="资源名称" value={editingResource?.name || ''} onChange={e => setEditingResource(prev => ({ ...prev!, name: e.target.value }))} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" />
              <div className="grid grid-cols-2 gap-4">
                <select value={editingResource?.type || 'ROOM'} onChange={e => setEditingResource(prev => ({ ...prev!, type: e.target.value as ResourceType }))} className="w-full p-4 bg-gray-50 border rounded-2xl outline-none font-bold">
                  <option value="ROOM">会议室</option><option value="DESK">工位</option>
                </select>
                <input type="number" placeholder="容纳人数" value={editingResource?.capacity || ''} onChange={e => setEditingResource(prev => ({ ...prev!, capacity: parseInt(e.target.value) }))} className="w-full p-4 bg-gray-50 border rounded-2xl outline-none" />
              </div>
              <input placeholder="物理位置" value={editingResource?.location || ''} onChange={e => setEditingResource(prev => ({ ...prev!, location: e.target.value }))} className="w-full p-4 bg-gray-50 border rounded-2xl outline-none" />
            </div>
            <div className="mt-10 flex space-x-4">
              <button onClick={() => setShowResourceModal(false)} className="flex-1 py-4 font-bold text-gray-400">取消</button>
              <button onClick={() => handleSaveResource(editingResource || {})} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl`}>保存</button>
            </div>
          </div>
        </div>
      )}

      {showBookingModal && selectedResource && (
        <BookingFormModal 
          resource={selectedResource} 
          theme={theme} 
          onClose={() => setShowBookingModal(false)} 
          onConfirm={handleBooking}
          availableResources={resources.filter(r => r.status === 'AVAILABLE')}
        />
      )}

      {showThemeModal && (
        <div className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in" onClick={() => setShowThemeModal(false)}>
           <div className="bg-white p-8 rounded-[2rem] shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-bold mb-6">切换视觉风格</h3>
              <div className="grid grid-cols-3 gap-4">
                 {THEMES.map(t => (
                   <button key={t.id} onClick={() => { setTheme(t.id); setShowThemeModal(false); }} className={`flex flex-col items-center p-3 rounded-2xl border-2 transition-all ${theme === t.id ? 'border-gray-800 bg-gray-50' : 'border-transparent hover:bg-gray-50'}`}>
                      <div className={`w-8 h-8 rounded-full mb-2 ${t.color}`}></div>
                      <span className="text-[10px] font-bold text-gray-600">{t.name}</span>
                   </button>
                 ))}
              </div>
           </div>
        </div>
      )}
      
      {showUserModal && <UserModal user={editingUser} departments={departments} onClose={() => { setShowUserModal(false); setEditingUser(null); }} onSave={handleSaveUser} theme={theme} />}
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
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in duration-300">
        <h2 className="text-2xl font-bold mb-2">预约申请</h2>
        <p className="text-gray-400 text-sm mb-6 flex items-center space-x-2">
          {resource.type === 'ROOM' ? <Monitor size={14}/> : <Coffee size={14}/>}
          <span>申请对象: <span className={`text-${theme}-600 font-bold`}>{resource.name}</span></span>
        </p>
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
             <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">日期</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full p-3 bg-gray-50 border-none rounded-xl font-bold outline-none" /></div>
             <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">开始</label><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full p-3 bg-gray-50 border-none rounded-xl font-bold outline-none" /></div>
             <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">结束</label><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full p-3 bg-gray-50 border-none rounded-xl font-bold outline-none" /></div>
          </div>
          <div className="space-y-1"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">用途说明</label><textarea value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="描述您的预约意图..." className="w-full p-4 bg-gray-50 border-none rounded-2xl h-24 outline-none text-sm"/></div>
          <div className={`p-4 bg-${theme}-50/50 rounded-2xl border border-${theme}-100`}>
             <button onClick={async () => { setLoadingAI(true); const rec = await getSmartRecommendation(purpose, resource.capacity || 1, availableResources); setRecommendation(rec); setLoadingAI(false); }} className={`text-xs text-${theme}-600 font-bold mb-1 flex items-center space-x-1 underline decoration-dotted`}><Zap size={12}/> <span>AI 智能评估建议</span></button>
             <p className={`text-[11px] text-${theme}-700 min-h-[20px] leading-relaxed italic`}>{loadingAI ? '分析中...' : recommendation || '输入用途后可点击上方获取 AI 建议。'}</p>
          </div>
        </div>
        <div className="mt-10 flex space-x-4">
          <button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button>
          <button onClick={() => onConfirm(resource.id, purpose, `${date}T${startTime}`, `${date}T${endTime}`)} className={`flex-1 py-4 bg-${theme}-600 text-white font-bold rounded-2xl shadow-lg`}>提交申请</button>
        </div>
      </div>
    </div>
  );
};

export default App;
