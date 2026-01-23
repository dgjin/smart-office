
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
  Trash
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, ApprovalRecord, Notification } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW } from './constants';
import { getSmartRecommendation } from './services/geminiService';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V6';

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS' | 'WORKFLOW'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [highlightedResourceId, setHighlightedResourceId] = useState<string | null>(null);
  const [expandedResourceId, setExpandedResourceId] = useState<string | null>(null);
  
  // 状态加载
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
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved).notifications || []) : [];
  });

  // 搜索与通知UI状态
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNotifOpen, setIsNotifOpen] = useState(false);

  // 模态框状态
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ users, resources, bookings, workflow, notifications }));
  }, [users, resources, bookings, workflow, notifications]);

  // 高亮滚动逻辑
  useEffect(() => {
    if (highlightedResourceId && view === 'RESOURCES') {
      const timer = setTimeout(() => {
        const element = document.getElementById(`resource-card-${highlightedResourceId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        const clearTimer = setTimeout(() => setHighlightedResourceId(null), 5000);
        return () => clearTimeout(clearTimer);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [highlightedResourceId, view]);

  // 角色判定
  const isSystemAdmin = currentUser?.role.includes('SYSTEM_ADMIN');
  const canManageSystem = isSystemAdmin;

  // 通知助手
  const addNotification = (notif: Omit<Notification, 'id' | 'timestamp' | 'isRead'>) => {
    const newNotif: Notification = {
      ...notif,
      id: 'n-' + Date.now() + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      isRead: false
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  // 审批逻辑
  const handleApprove = (bookingId: string, status: 'APPROVED' | 'REJECTED') => {
    setBookings(prev => prev.map(b => {
      if (b.id === bookingId) {
        const history: ApprovalRecord = {
          nodeName: workflow[b.currentNodeIndex]?.name || '未知阶段',
          approverName: currentUser?.name || '未知',
          status,
          timestamp: new Date().toISOString()
        };
        const newHistory = [...b.approvalHistory, history];
        const resName = resources.find(r => r.id === b.resourceId)?.name || '未知资源';

        if (status === 'REJECTED') {
          setResources(res => res.map(r => r.id === b.resourceId ? { ...r, status: 'AVAILABLE' } : r));
          addNotification({
            userId: b.userId,
            title: '预订申请被驳回',
            content: `您对 [${resName}] 的预订申请在 [${workflow[b.currentNodeIndex]?.name}] 节点被驳回。`,
            type: 'WARNING',
            linkView: 'BOOKINGS'
          });
          return { ...b, status: 'REJECTED', approvalHistory: newHistory };
        } else {
          const isLastNode = b.currentNodeIndex === workflow.length - 1;
          if (isLastNode) {
            setResources(res => res.map(r => r.id === b.resourceId ? { ...r, status: 'OCCUPIED' } : r));
            addNotification({
              userId: b.userId,
              title: '预订申请已核准',
              content: `恭喜！您对 [${resName}] 的预订申请已通过最终审批。`,
              type: 'SUCCESS',
              linkView: 'BOOKINGS'
            });
            return { ...b, status: 'APPROVED', approvalHistory: newHistory };
          } else {
            // 推送给下一个节点的审批人
            const nextNode = workflow[b.currentNodeIndex + 1];
            users.filter(u => u.role.includes(nextNode.approverRole)).forEach(approver => {
              addNotification({
                userId: approver.id,
                title: '待办审批提醒',
                content: `${currentUser?.name} 已批准 [${resName}] 申请，现在轮到您在 [${nextNode.name}] 阶段审批。`,
                type: 'INFO',
                linkView: 'BOOKINGS'
              });
            });
            return { ...b, currentNodeIndex: b.currentNodeIndex + 1, approvalHistory: newHistory };
          }
        }
      }
      return b;
    }));
  };

  const handleSaveUser = (userData: Partial<User>) => {
    if (!canManageSystem) return alert('无权限进行此操作');
    if (editingUser) {
      setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, ...userData } as User : u));
    } else {
      const newUser: User = { id: 'u-' + Date.now(), name: userData.name || '', email: userData.email || '', department: userData.department || '', role: userData.role || ['EMPLOYEE'] };
      setUsers(prev => [...prev, newUser]);
    }
    setShowUserModal(false);
    setEditingUser(null);
  };

  const handleSaveResource = (resourceData: Partial<Resource>) => {
    if (!canManageSystem) return alert('无权限进行此操作');
    if (editingResource) {
      setResources(prev => prev.map(r => r.id === editingResource.id ? { ...r, ...resourceData } as Resource : r));
    } else {
      const newRes: Resource = { id: 'r-' + Date.now(), name: resourceData.name || '新资源', type: resourceData.type || 'ROOM', capacity: resourceData.capacity, location: resourceData.location || '未知', features: resourceData.features || [], status: 'AVAILABLE' };
      setResources(prev => [...prev, newRes]);
    }
    setShowResourceModal(false);
    setEditingResource(null);
  };

  const handleDeleteUser = (userId: string) => {
    if (!canManageSystem) return alert('无权限进行此操作');
    if (currentUser?.id === userId) return alert('不能移除当前登录用户');
    if (window.confirm('确定要从系统中移除该成员吗？')) {
      setUsers(prev => prev.filter(u => u.id !== userId));
    }
  };

  const getResourceSchedule = (resourceId: string) => {
    const today = new Date().toISOString().split('T')[0];
    return bookings
      .filter(b => b.resourceId === resourceId && (b.status === 'APPROVED' || b.status === 'PENDING') && b.startTime.startsWith(today))
      .map(b => {
        const start = new Date(b.startTime).getHours();
        const end = new Date(b.endTime).getHours();
        return { start, end };
      });
  };

  const stats = useMemo(() => [
    { label: '空闲会议室', value: resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length, color: 'text-emerald-600' },
    { label: '空闲工位', value: resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length, color: 'text-cyan-600', isDesk: true },
    { label: '待我审批', value: bookings.filter(b => b.status === 'PENDING' && currentUser?.role.includes(workflow[b.currentNodeIndex]?.approverRole)).length, color: 'text-amber-600' },
    { label: '正在占用', value: resources.filter(r => r.status === 'OCCUPIED').length, color: 'text-rose-600' },
    { label: '未读消息', value: notifications.filter(n => n.userId === currentUser?.id && !n.isRead).length, color: 'text-indigo-600' },
  ], [resources, bookings, users, workflow, currentUser, notifications]);

  // 搜索逻辑增强：支持搜索预订申请
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return { resources: [], users: [], bookings: [] };
    const q = searchQuery.toLowerCase();
    
    const filteredBookings = bookings.filter(b => {
      const resName = resources.find(r => r.id === b.resourceId)?.name.toLowerCase() || '';
      return b.purpose.toLowerCase().includes(q) || resName.includes(q);
    });

    return {
      resources: resources.filter(r => r.name.toLowerCase().includes(q) || r.location.toLowerCase().includes(q)),
      users: users.filter(u => u.name.toLowerCase().includes(q) || u.department.toLowerCase().includes(q)),
      bookings: filteredBookings
    };
  }, [searchQuery, resources, users, bookings]);

  const SidebarItem = ({ icon: Icon, label, id, active }: any) => (
    <button onClick={() => setView(id)} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'}`}>
      <Icon size={20} /> <span className="font-medium">{label}</span>
    </button>
  );

  const RoleBadge: React.FC<{ role: Role }> = ({ role }) => {
    const styles: Record<Role, string> = { SYSTEM_ADMIN: 'bg-indigo-100 text-indigo-700 border-indigo-200', APPROVAL_ADMIN: 'bg-amber-100 text-amber-700 border-amber-200', EMPLOYEE: 'bg-gray-100 text-gray-600 border-gray-200' };
    const labels: Record<Role, string> = { SYSTEM_ADMIN: '系统管理员', APPROVAL_ADMIN: '审批管理员', EMPLOYEE: '普通员工' };
    return <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[role]}`}>{labels[role]}</span>;
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-indigo-600 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in duration-300">
          <div className="flex justify-center mb-6"><div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-200"><Cpu className="text-white" size={32} /></div></div>
          <h1 className="text-2xl font-bold text-center mb-2">智慧办公系统</h1>
          <p className="text-gray-400 text-center mb-8">请选择身份登录</p>
          <div className="space-y-3">
            {users.map(user => (
              <button key={user.id} onClick={() => setCurrentUser(user)} className="w-full p-4 border border-gray-100 rounded-2xl hover:bg-indigo-50 flex items-center justify-between group transition-all">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center font-bold text-indigo-600">{user.name[0]}</div>
                  <div className="text-left">
                    <p className="font-bold text-gray-800">{user.name}</p>
                    <div className="flex flex-wrap gap-1 mt-1">{user.role.map(r => <RoleBadge key={r} role={r} />)}</div>
                  </div>
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
      {/* 侧边栏 */}
      <aside className="w-64 bg-white border-r hidden md:flex flex-col p-6 sticky top-0 h-screen">
        <div className="flex items-center space-x-3 mb-10 px-2"><div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-100"><Cpu className="text-white" size={18} /></div><span className="text-xl font-bold tracking-tight">智慧办公</span></div>
        <nav className="flex-1 space-y-2">
          <SidebarItem icon={LayoutDashboard} label="首页仪表盘" id="DASHBOARD" active={view === 'DASHBOARD'} />
          <SidebarItem icon={MapPin} label="资源管理" id="RESOURCES" active={view === 'RESOURCES'} />
          <SidebarItem icon={Calendar} label="申请记录" id="BOOKINGS" active={view === 'BOOKINGS'} />
          {canManageSystem && (
            <>
              <div className="pt-4 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">系统管理</div>
              <SidebarItem icon={GitMerge} label="审批流配置" id="WORKFLOW" active={view === 'WORKFLOW'} />
              <SidebarItem icon={Users} label="员工管理" id="USERS" active={view === 'USERS'} />
            </>
          )}
        </nav>
        <div className="mt-auto pt-6 border-t flex flex-col space-y-3">
           <div className="flex items-center justify-between">
             <div className="flex items-center space-x-3">
               <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center text-sm font-bold text-indigo-600 border border-indigo-200">{currentUser.name[0]}</div>
               <div className="min-w-0"><p className="text-sm font-bold truncate text-gray-800">{currentUser.name}</p><p className="text-[9px] text-gray-400 font-medium uppercase truncate max-w-[80px]">{currentUser.department}</p></div>
             </div>
             <button onClick={() => setCurrentUser(null)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><LogOut size={18} /></button>
           </div>
           <div className="flex flex-wrap gap-1">{currentUser.role.map(r => <RoleBadge key={r} role={r} />)}</div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto relative">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b px-8 flex items-center justify-between sticky top-0 z-40">
           <h2 className="text-lg font-bold text-gray-800">
             {view === 'DASHBOARD' && '概览仪表盘'} {view === 'RESOURCES' && '空间资源库'} {view === 'BOOKINGS' && '预订处理中心'} {view === 'WORKFLOW' && '审批流程引擎'} {view === 'USERS' && '成员权限管理'}
           </h2>
           <div className="flex items-center space-x-3">
             <button onClick={() => setIsSearchOpen(true)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors"><Search size={20}/></button>
             <div className="relative">
               <button onClick={() => setIsNotifOpen(!isNotifOpen)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors relative">
                 <Bell size={20}/>
                 {notifications.some(n => n.userId === currentUser.id && !n.isRead) && (
                   <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
                 )}
               </button>
               {/* 通知面板 */}
               {isNotifOpen && (
                 <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                   <div className="p-4 bg-indigo-600 text-white flex justify-between items-center">
                     <span className="font-bold text-sm">通知中心</span>
                     <div className="flex space-x-2">
                       <button onClick={() => setNotifications(prev => prev.map(n => n.userId === currentUser.id ? {...n, isRead: true} : n))} className="text-[10px] font-bold hover:underline opacity-80">标记已读</button>
                       <button onClick={() => setNotifications(prev => prev.filter(n => n.userId !== currentUser.id))} className="text-[10px] font-bold hover:underline opacity-80">清空</button>
                     </div>
                   </div>
                   <div className="max-h-96 overflow-y-auto custom-scrollbar">
                     {notifications.filter(n => n.userId === currentUser.id).length > 0 ? (
                       notifications.filter(n => n.userId === currentUser.id).map(n => (
                         <div 
                           key={n.id} 
                           onClick={() => {
                             setNotifications(prev => prev.map(item => item.id === n.id ? {...item, isRead: true} : item));
                             if (n.linkView) setView(n.linkView);
                             setIsNotifOpen(false);
                           }}
                           className={`p-4 border-b border-gray-50 cursor-pointer transition-colors ${n.isRead ? 'bg-white' : 'bg-indigo-50/50'}`}
                         >
                           <div className="flex items-start space-x-3">
                             <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.type === 'SUCCESS' ? 'bg-emerald-500' : n.type === 'WARNING' ? 'bg-amber-500' : 'bg-indigo-500'}`}></div>
                             <div className="flex-1 min-w-0">
                               <p className="text-xs font-bold text-gray-800">{n.title}</p>
                               <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{n.content}</p>
                               <p className="text-[9px] text-gray-300 mt-2 font-medium">{new Date(n.timestamp).toLocaleString()}</p>
                             </div>
                           </div>
                         </div>
                       ))
                     ) : (
                       <div className="py-12 text-center">
                         <MessageSquare className="mx-auto text-gray-200 mb-2" size={32} />
                         <p className="text-xs text-gray-400">暂无任何消息</p>
                       </div>
                     )}
                   </div>
                 </div>
               )}
             </div>
           </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {view === 'DASHBOARD' && (
            <div className="space-y-8 animate-in fade-in">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
                 {stats.map((s, i) => (
                   <div key={i} className={`bg-white p-6 rounded-3xl border border-gray-100 flex flex-col ${s.isDesk ? 'lg:col-span-2' : ''}`}>
                     <p className="text-xs text-gray-400 font-bold uppercase mb-4">{s.label}</p>
                     <p className={`text-4xl font-black ${s.color}`}>{s.value}</p>
                     {s.isDesk && (
                       <div className="mt-4 border-t border-dashed pt-4 flex-1 overflow-auto custom-scrollbar max-h-40">
                         <div className="space-y-2">
                           {resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').slice(0, 5).map(desk => (
                             <button key={desk.id} onClick={() => { setHighlightedResourceId(desk.id); setView('RESOURCES'); }} className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-indigo-50 rounded-xl transition-all border border-transparent hover:border-indigo-100">
                               <span className="text-xs font-bold text-gray-700">{desk.name}</span>
                               <span className="text-[10px] text-indigo-400 font-bold">{desk.location}</span>
                             </button>
                           ))}
                         </div>
                       </div>
                     )}
                   </div>
                 ))}
               </div>
               
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-gray-100">
                    <h3 className="font-bold text-xl mb-6 flex items-center"><Clock size={20} className="mr-3 text-indigo-600" /> 待处理审批任务</h3>
                    <div className="space-y-4">
                      {bookings.filter(b => b.status === 'PENDING' && currentUser.role.includes(workflow[b.currentNodeIndex]?.approverRole)).length > 0 ? (
                        bookings.filter(b => b.status === 'PENDING' && currentUser.role.includes(workflow[b.currentNodeIndex]?.approverRole)).map(b => (
                          <div key={b.id} className="flex items-center justify-between p-5 bg-gray-50 rounded-2xl border border-gray-100 hover:border-indigo-200 transition-colors">
                            <div className="flex items-center space-x-4">
                              <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm text-indigo-600 font-bold border border-gray-100">{users.find(u => u.id === b.userId)?.name[0]}</div>
                              <div>
                                <p className="text-sm font-bold text-gray-800">{users.find(u => u.id === b.userId)?.name} 申请 {resources.find(r => r.id === b.resourceId)?.name}</p>
                                <p className="text-xs text-gray-400 flex items-center mt-1"><GitMerge size={12} className="mr-1.5" /> 审批阶段: <span className="font-bold text-indigo-500 ml-1">{workflow[b.currentNodeIndex]?.name}</span></p>
                              </div>
                            </div>
                            <button onClick={() => setView('BOOKINGS')} className="px-5 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all">立即处理</button>
                          </div>
                        ))
                      ) : (
                        <div className="py-12 text-center text-gray-300 italic">目前没有需要您审批的任务</div>
                      )}
                    </div>
                  </div>
                  <div className="bg-white p-8 rounded-3xl border border-gray-100">
                    <h3 className="font-bold text-xl mb-6 flex items-center"><GitMerge size={20} className="mr-3 text-indigo-600" /> 审批链路预览</h3>
                    <div className="space-y-6">
                       {workflow.map((node, i) => (
                         <div key={node.id} className="flex items-center space-x-4 relative">
                           <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xs font-bold z-10 shadow-md">{i + 1}</div>
                           <div className="flex-1 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                              <p className="text-xs font-bold text-indigo-700">{node.name}</p>
                              <div className="mt-1"><RoleBadge role={node.approverRole} /></div>
                           </div>
                           {i < workflow.length - 1 && <div className="absolute left-[18px] top-10 w-0.5 h-6 bg-indigo-100"></div>}
                         </div>
                       ))}
                    </div>
                  </div>
               </div>
            </div>
          )}

          {view === 'WORKFLOW' && canManageSystem && (
            <div className="bg-white p-10 rounded-3xl border border-gray-100 animate-in fade-in shadow-sm">
              <div className="flex justify-between items-center mb-10">
                <div>
                  <h3 className="text-2xl font-bold">审批流程设计器</h3>
                  <p className="text-sm text-gray-400 mt-1">您可以自定义每一个审批环节的名称和负责角色</p>
                </div>
                <button 
                  onClick={() => { const nw = [...workflow]; nw.push({id: 'n-'+Date.now(), name: '新审批阶段', approverRole: 'APPROVAL_ADMIN'}); setWorkflow(nw); }} 
                  className="flex items-center space-x-2 bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-95"
                >
                  <Plus size={20} /> <span>增加审批阶段</span>
                </button>
              </div>
              <div className="space-y-6">
                {workflow.map((node, index) => (
                  <div key={node.id} className="flex items-center p-6 bg-gray-50 rounded-3xl border border-gray-100 group hover:bg-white hover:border-indigo-200 transition-all">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center font-bold text-indigo-600 mr-6 shadow-sm border border-gray-100">{index + 1}</div>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 tracking-widest">阶段名称</label>
                        <input 
                          value={node.name} 
                          onChange={e => { const w = [...workflow]; w[index].name = e.target.value; setWorkflow(w); }} 
                          className="w-full bg-transparent font-bold text-gray-800 outline-none border-b-2 border-transparent focus:border-indigo-600 pb-1 transition-all" 
                          placeholder="例如：行政审核"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 tracking-widest">负责人角色</label>
                        <select 
                          value={node.approverRole} 
                          onChange={e => { const w = [...workflow]; w[index].approverRole = e.target.value as Role; setWorkflow(w); }} 
                          className="w-full bg-transparent font-bold text-indigo-600 outline-none cursor-pointer"
                        >
                          <option value="SYSTEM_ADMIN">系统管理员 (SYSTEM_ADMIN)</option>
                          <option value="APPROVAL_ADMIN">审批管理员 (APPROVAL_ADMIN)</option>
                          <option value="EMPLOYEE">普通员工 (EMPLOYEE)</option>
                        </select>
                      </div>
                    </div>
                    {workflow.length > 1 && (
                      <button 
                        onClick={() => setWorkflow(workflow.filter(n => n.id !== node.id))} 
                        className="opacity-0 group-hover:opacity-100 p-3 text-rose-500 hover:bg-rose-50 rounded-2xl transition-all ml-6"
                      >
                        <Trash2 size={20} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'USERS' && canManageSystem && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center mb-4"><h3 className="text-xl font-bold">成员权限中枢</h3><button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className="flex items-center space-x-2 bg-indigo-600 text-white px-6 py-3 rounded-2xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-95"><UserPlus size={20} /> <span>录入新成员</span></button></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {users.map(user => (
                  <div key={user.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col">
                    <div className="flex items-center space-x-4 mb-6">
                      <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 font-bold text-xl border border-indigo-200">{user.name[0]}</div>
                      <div className="flex-1"><h4 className="font-bold text-gray-800 text-lg">{user.name}</h4><p className="text-xs text-indigo-400 font-bold uppercase tracking-wider">{user.department}</p></div>
                    </div>
                    <div className="flex-1 space-y-4"><div><p className="text-[10px] font-bold text-gray-300 uppercase mb-2">已分配角色</p><div className="flex flex-wrap gap-1.5">{user.role.map(r => <RoleBadge key={r} role={r} />)}</div></div><div className="text-xs text-gray-500 bg-gray-50 p-3 rounded-xl border border-gray-100"><p className="flex justify-between"><span>邮箱地址:</span> <span className="font-medium text-gray-700">{user.email}</span></p></div></div>
                    <div className="flex space-x-3 pt-6 mt-6 border-t border-gray-50"><button onClick={() => { setEditingUser(user); setShowUserModal(true); }} className="flex-1 py-3 bg-gray-50 text-indigo-600 rounded-xl hover:bg-indigo-50 text-xs font-bold flex items-center justify-center transition-colors"><Edit2 size={14} className="mr-2"/>编辑</button><button onClick={() => handleDeleteUser(user.id)} className="flex-1 py-3 bg-gray-50 text-rose-600 rounded-xl hover:bg-rose-50 text-xs font-bold flex items-center justify-center transition-colors"><Trash2 size={14} className="mr-2"/>移除</button></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'RESOURCES' && (
            <div className="space-y-6">
               <div className="flex justify-between items-center mb-2"><div><h3 className="text-xl font-bold text-gray-800">空间资源概览</h3><p className="text-sm text-gray-400">查看并预订全公司的会议室与工位</p></div>{canManageSystem && (<button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className="flex items-center space-x-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 shadow-md transition-all active:scale-95"><Plus size={18} /> <span>新增空间资源</span></button>)}</div>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in">
                  {resources.map(res => {
                    const isExpanded = expandedResourceId === res.id;
                    const schedule = getResourceSchedule(res.id);
                    return (
                      <div key={res.id} id={`resource-card-${res.id}`} className={`bg-white rounded-[2.5rem] overflow-hidden shadow-sm border transition-all duration-500 group relative ${highlightedResourceId === res.id ? 'ring-4 ring-indigo-500 border-indigo-500 scale-105 z-20' : 'border-gray-100 hover:shadow-md'} ${isExpanded ? 'md:col-span-2' : ''}`}>
                        <div onClick={() => setExpandedResourceId(isExpanded ? null : res.id)} className={`h-32 flex items-center justify-center relative cursor-pointer ${highlightedResourceId === res.id ? 'bg-indigo-100' : 'bg-indigo-50'} group-hover:bg-indigo-100/50 transition-colors`}>
                           {res.type === 'ROOM' ? <Monitor className="text-indigo-600" size={36} /> : <Coffee className="text-cyan-600" size={36} />}
                           <div className="absolute top-5 right-5"><StatusBadge status={res.status} /></div>
                           <div className="absolute bottom-5 right-5 text-gray-400 group-hover:text-indigo-600 transition-colors">{isExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}</div>
                           {canManageSystem && (<div className="absolute top-5 left-5 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-2"><button onClick={(e) => { e.stopPropagation(); setEditingResource(res); setShowResourceModal(true); }} className="p-2.5 bg-white/90 backdrop-blur-sm rounded-xl text-indigo-600 hover:bg-white shadow-sm transition-all"><Edit2 size={14}/></button><button onClick={(e) => { e.stopPropagation(); setResources(prev => prev.filter(r => r.id !== res.id)); }} className="p-2.5 bg-white/90 backdrop-blur-sm rounded-xl text-rose-600 hover:bg-white shadow-sm transition-all"><Trash2 size={14}/></button></div>)}
                        </div>
                        <div className="p-8">
                           <div className="flex justify-between items-start mb-2"><h4 className="font-bold text-gray-800 text-xl">{res.name}</h4><p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">{res.type === 'ROOM' ? 'MEETING ROOM' : 'WORKSPACE'}</p></div>
                           <p className="text-sm text-gray-400 flex items-center mb-6 font-medium"><MapPin size={14} className="mr-2 text-indigo-400" /> {res.location} • 可容纳 {res.capacity}人</p>
                           <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isExpanded ? 'max-h-[600px] opacity-100 mb-8' : 'max-h-0 opacity-0'}`}><div className="space-y-8 pt-6 border-t border-gray-100"><div><h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center"><Layers size={14} className="mr-2 text-indigo-500" /> 已配备特征 & 功能</h5><div className="flex flex-wrap gap-2.5">{res.features.map((f, idx) => (<span key={idx} className="px-4 py-2 bg-indigo-50/50 text-indigo-700 text-[10px] font-bold rounded-xl border border-indigo-100/50">{f}</span>))}</div></div><div><h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center"><Zap size={14} className="mr-2 text-amber-500" /> 今日预订分布示意</h5><div className="flex items-center space-x-1 h-10 bg-gray-50 rounded-2xl p-1.5 relative border border-gray-100">{[9,10,11,12,13,14,15,16,17,18].map((h, i) => { const isBusy = schedule.some(s => h >= s.start && h < s.end); return (<div key={i} title={`${h}:00`} className={`flex-1 h-full rounded-lg transition-all ${isBusy ? 'bg-indigo-400 shadow-inner' : 'bg-white border border-gray-100'}`} />);})}</div></div></div></div>
                           <button disabled={res.status !== 'AVAILABLE'} onClick={(e) => { e.stopPropagation(); setSelectedResource(res); setShowBookingModal(true); }} className={`w-full py-4 rounded-2xl text-sm font-bold transition-all active:scale-[0.98] ${res.status === 'AVAILABLE' ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-100' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>{res.status === 'AVAILABLE' ? '立即发起预订申请' : '当前资源不可用'}</button>
                        </div>
                      </div>
                    );
                  })}
               </div>
            </div>
          )}

          {view === 'BOOKINGS' && (
            <div className="bg-white rounded-[2.5rem] border border-gray-100 overflow-hidden animate-in fade-in shadow-sm">
               <div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-gray-50/80 border-b"><tr><th className="px-8 py-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">申请详情 / 资源</th><th className="px-8 py-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">审批全链路</th><th className="px-8 py-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">快捷操作</th></tr></thead><tbody className="divide-y divide-gray-50">{bookings.length > 0 ? bookings.map(b => { const res = resources.find(r => r.id === b.resourceId); const user = users.find(u => u.id === b.userId); const isMyTurn = b.status === 'PENDING' && currentUser.role.includes(workflow[b.currentNodeIndex]?.approverRole); return (<tr key={b.id} className="hover:bg-indigo-50/30 transition-colors"><td className="px-8 py-7"><div className="flex items-center space-x-3 mb-1.5"><span className="font-bold text-gray-800 text-base">{res?.name}</span><span className="text-[9px] px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-lg font-black uppercase tracking-tighter">{res?.type === 'ROOM' ? 'ROOM' : 'DESK'}</span></div><p className="text-xs text-gray-400 font-medium">申请人: <span className="text-gray-600">{user?.name}</span> • <span className="text-gray-400">{new Date(b.startTime).toLocaleDateString()}</span></p></td><td className="px-8 py-7"><div className="flex items-center space-x-1.5 mb-2.5">{workflow.map((_, i) => (<div key={i} className={`h-2 flex-1 rounded-full shadow-sm transition-all duration-700 ${i < b.currentNodeIndex || b.status === 'APPROVED' ? 'bg-emerald-500' : i === b.currentNodeIndex && b.status === 'PENDING' ? 'bg-amber-400 animate-pulse' : b.status === 'REJECTED' && i === b.currentNodeIndex ? 'bg-rose-500' : 'bg-gray-100'}`}></div>))}</div><div className="flex justify-between items-center"><StatusBadge status={b.status} />{b.status === 'PENDING' && <span className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">等待: {workflow[b.currentNodeIndex]?.name}</span>}</div></td><td className="px-8 py-7"><div className="flex justify-center space-x-3">{isMyTurn ? (<><button onClick={() => handleApprove(b.id, 'APPROVED')} title="通过申请" className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-500 hover:text-white transition-all shadow-sm hover:shadow-emerald-100 active:scale-90"><CheckCircle size={20} /></button><button onClick={() => handleApprove(b.id, 'REJECTED')} title="拒绝申请" className="p-3 bg-rose-50 text-rose-600 rounded-2xl hover:bg-rose-500 hover:text-white transition-all shadow-sm hover:shadow-rose-100 active:scale-90"><XCircle size={20} /></button></>) : (<span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest py-3 font-mono">WAITING_OTHERS</span>)}</div></td></tr>);}) : (<tr><td colSpan={3} className="py-24 text-center text-gray-300 italic">暂无历史申请记录</td></tr>)}</tbody></table></div>
            </div>
          )}
        </div>
      </main>

      {/* 搜索遮罩层 */}
      {isSearchOpen && (
        <div className="fixed inset-0 z-[100] bg-white/90 backdrop-blur-xl animate-in fade-in duration-300 flex flex-col items-center">
          <div className="w-full max-w-2xl px-6 pt-24">
            <div className="relative mb-12 group">
              <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-indigo-600" size={24} />
              <input 
                autoFocus
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索资源、员工或申请理由..." 
                className="w-full h-16 bg-white border-2 border-indigo-100 rounded-3xl pl-16 pr-16 text-xl font-medium outline-none focus:border-indigo-600 shadow-2xl shadow-indigo-100/50 transition-all"
              />
              <button onClick={() => {setIsSearchOpen(false); setSearchQuery('');}} className="absolute right-6 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-rose-500 transition-colors"><X size={24} /></button>
            </div>

            <div className="space-y-10 overflow-y-auto max-h-[65vh] pr-4 custom-scrollbar pb-10">
              {searchQuery.trim() ? (
                <>
                  {searchResults.resources.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 flex items-center"><MapPin size={14} className="mr-2"/> 办公资源</p>
                      <div className="grid grid-cols-1 gap-3">
                        {searchResults.resources.map(res => (
                          <button 
                            key={res.id} 
                            onClick={() => { setView('RESOURCES'); setHighlightedResourceId(res.id); setIsSearchOpen(false); setSearchQuery(''); }}
                            className="w-full flex items-center justify-between p-4 bg-gray-50/50 hover:bg-indigo-600 hover:text-white rounded-2xl transition-all group border border-gray-100"
                          >
                            <div className="flex items-center space-x-4">
                              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:bg-indigo-500 transition-colors">
                                {res.type === 'ROOM' ? <Monitor className="text-indigo-600 group-hover:text-white" size={20} /> : <Coffee className="text-cyan-600 group-hover:text-white" size={20} />}
                              </div>
                              <div className="text-left"><p className="text-sm font-bold">{res.name}</p><p className="text-[10px] opacity-60 font-medium">{res.location}</p></div>
                            </div>
                            <ChevronRight size={18} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchResults.bookings.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 flex items-center"><Calendar size={14} className="mr-2"/> 预订申请</p>
                      <div className="grid grid-cols-1 gap-3">
                        {searchResults.bookings.map(b => (
                          <button 
                            key={b.id} 
                            onClick={() => { setView('BOOKINGS'); setIsSearchOpen(false); setSearchQuery(''); }}
                            className="w-full flex items-center justify-between p-4 bg-gray-50/50 hover:bg-indigo-600 hover:text-white rounded-2xl transition-all group border border-gray-100"
                          >
                            <div className="flex items-center space-x-4">
                              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:bg-indigo-500 transition-colors font-bold text-indigo-600">
                                {users.find(u => u.id === b.userId)?.name[0]}
                              </div>
                              <div className="text-left">
                                <p className="text-sm font-bold line-clamp-1">{b.purpose}</p>
                                <p className="text-[10px] opacity-60 font-medium">{resources.find(r => r.id === b.resourceId)?.name} • {new Date(b.startTime).toLocaleDateString()}</p>
                              </div>
                            </div>
                            <ChevronRight size={18} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchResults.users.length > 0 && (
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 flex items-center"><Users size={14} className="mr-2"/> 成员员工</p>
                      <div className="grid grid-cols-1 gap-3">
                        {searchResults.users.map(u => (
                          <button 
                            key={u.id}
                            disabled={!canManageSystem}
                            onClick={() => { if (canManageSystem) { setView('USERS'); setIsSearchOpen(false); setSearchQuery(''); } }}
                            className="w-full flex items-center justify-between p-4 bg-gray-50/50 hover:bg-indigo-600 hover:text-white rounded-2xl transition-all group disabled:cursor-default border border-gray-100"
                          >
                            <div className="flex items-center space-x-4">
                              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:bg-indigo-500 transition-colors font-bold text-indigo-600">{u.name[0]}</div>
                              <div className="text-left"><p className="text-sm font-bold">{u.name}</p><p className="text-[10px] opacity-60 font-medium">{u.department}</p></div>
                            </div>
                            {canManageSystem && <ChevronRight size={18} />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {searchResults.resources.length === 0 && searchResults.users.length === 0 && searchResults.bookings.length === 0 && (
                    <div className="py-20 text-center"><p className="text-gray-400 font-medium italic">未找到匹配项</p></div>
                  )}
                </>
              ) : (
                <div className="py-20 text-center text-gray-300">
                  <Search className="mx-auto mb-4 opacity-10" size={64} />
                  <p className="text-sm font-medium">输入资源名称、位置或申请理由进行全局检索</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showUserModal && (<UserModal user={editingUser} onClose={() => setShowUserModal(false)} onSave={handleSaveUser} />)}
      {showBookingModal && selectedResource && (
        <BookingModal 
          resource={selectedResource} 
          onClose={() => setShowBookingModal(false)} 
          onConfirm={(id, pur, start, end) => {
            const newBooking: Booking = { id: 'b-' + Date.now(), userId: currentUser.id, resourceId: id, type: selectedResource.type, startTime: start, endTime: end, status: 'PENDING', purpose: pur, createdAt: new Date().toISOString(), currentNodeIndex: 0, approvalHistory: [] };
            setBookings(prev => [...prev, newBooking]);
            setResources(prev => prev.map(r => r.id === id ? { ...r, status: 'PENDING' } : r));
            
            // 发送给第一阶段审批人
            const firstNode = workflow[0];
            if (firstNode) {
              users.filter(u => u.role.includes(firstNode.approverRole)).forEach(approver => {
                addNotification({
                  userId: approver.id,
                  title: '收到新资源申请',
                  content: `${currentUser.name} 申请预订 [${selectedResource.name}]，等待您进行 [${firstNode.name}]。`,
                  type: 'INFO',
                  linkView: 'BOOKINGS'
                });
              });
            }

            setShowBookingModal(false);
          }} 
          availableResources={resources.filter(r => r.status === 'AVAILABLE')} 
        />
      )}
      {showResourceModal && (<ResourceModal resource={editingResource} onClose={() => setShowResourceModal(false)} onSave={handleSaveResource} />)}
    </div>
  );
};

// --- 子组件定义 ---

const StatusBadge = ({ status }: { status: string }) => {
  const styles: any = { AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100', PENDING: 'bg-amber-50 text-amber-600 border-amber-100', OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100', APPROVED: 'bg-indigo-50 text-indigo-600 border-indigo-100', REJECTED: 'bg-rose-50 text-rose-600 border-rose-100', COMPLETED: 'bg-gray-100 text-gray-400 border-gray-200' };
  const labels: any = { AVAILABLE: '空闲中', PENDING: '待处理', APPROVED: '已通过', REJECTED: '已驳回', OCCUPIED: '已占用', COMPLETED: '已结束' };
  return <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border shadow-sm ${styles[status] || styles.PENDING}`}>{labels[status] || status}</span>;
};

const UserModal = ({ user, onClose, onSave }: any) => {
  const [formData, setFormData] = useState<Partial<User>>(user || { name: '', email: '', department: '', role: ['EMPLOYEE'] });
  const toggleRole = (role: Role) => { const currentRoles = formData.role || []; if (currentRoles.includes(role)) { if (currentRoles.length === 1) return; setFormData({ ...formData, role: currentRoles.filter(r => r !== role) }); } else { setFormData({ ...formData, role: [...currentRoles, role] }); } };
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl">
        <h2 className="text-2xl font-bold mb-2">{user ? '修改成员复合身份' : '录入新成员资料'}</h2>
        <div className="space-y-6 mt-8">
          <div className="grid grid-cols-2 gap-4"><input value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} placeholder="姓名" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" /><input value={formData.department} onChange={e=>setFormData({...formData, department: e.target.value})} placeholder="部门" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" /></div>
          <input value={formData.email} onChange={e=>setFormData({...formData, email: e.target.value})} placeholder="登录邮箱" className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" />
          <div className="space-y-2.5">
            {['EMPLOYEE', 'APPROVAL_ADMIN', 'SYSTEM_ADMIN'].map(rid => {
              const isSelected = formData.role?.includes(rid as Role);
              return (<button key={rid} onClick={() => toggleRole(rid as Role)} className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${isSelected ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-gray-50 border-gray-100'}`}><div className="flex items-center space-x-3"><div className={`w-5 h-5 rounded-md border flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white'}`}>{isSelected && <Check size={14} />}</div><span className="text-sm font-bold">{rid === 'SYSTEM_ADMIN' ? '系统管理员' : rid === 'APPROVAL_ADMIN' ? '审批管理员' : '普通员工'}</span></div></button>);
            })}
          </div>
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">取消</button><button onClick={() => onSave(formData)} className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all">确认保存</button></div>
      </div>
    </div>
  );
};

const ResourceModal = ({ resource, onClose, onSave }: any) => {
  const [formData, setFormData] = useState<Partial<Resource>>(resource || { name: '', type: 'ROOM', capacity: 4, location: '', features: [] });
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl">
        <h2 className="text-2xl font-bold mb-8">{resource ? '编辑资源详情' : '注册新空间资源'}</h2>
        <div className="space-y-5"><input value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} placeholder="资源名称" className="w-full p-4 bg-gray-50 border rounded-2xl outline-none" /><div className="grid grid-cols-2 gap-4"><select value={formData.type} onChange={e=>setFormData({...formData, type: e.target.value as any})} className="w-full p-4 bg-gray-50 border rounded-2xl"><option value="ROOM">会议室 (ROOM)</option><option value="DESK">办公工位 (DESK)</option></select><input type="number" value={formData.capacity || ''} onChange={e=>setFormData({...formData, capacity: parseInt(e.target.value)})} placeholder="标准容纳人数" className="w-full p-4 bg-gray-50 border rounded-2xl" /></div><input value={formData.location} onChange={e=>setFormData({...formData, location: e.target.value})} placeholder="物理位置" className="w-full p-4 bg-gray-50 border rounded-2xl" /></div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">返回</button><button onClick={() => onSave(formData)} className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all">确认保存</button></div>
      </div>
    </div>
  );
};

const BookingModal = ({ resource, onClose, onConfirm, availableResources }: any) => {
  const [purpose, setPurpose] = useState('');
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(() => { if (resource.type === 'DESK') { const nextMonth = new Date(); nextMonth.setMonth(now.getMonth() + 1); return nextMonth.toISOString().split('T')[0]; } return today; });
  const [startTime, setStartTime] = useState(() => resource.type === 'ROOM' ? `${(now.getHours() + 1).toString().padStart(2, '0')}:00` : "09:00");
  const [endTime, setEndTime] = useState(() => resource.type === 'ROOM' ? `${(now.getHours() + 3).toString().padStart(2, '0')}:00` : "18:00");
  const [recommendation, setRecommendation] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl">
        <h2 className="text-2xl font-bold mb-2">资源预订申请</h2>
        <p className="text-gray-400 text-sm mb-8">正在预订: <span className="text-indigo-600 font-bold">{resource.name}</span></p>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] font-bold text-gray-400 mb-1.5 block ml-1 uppercase">起始日期</label><input type="date" value={startDate} min={today} onChange={e => setStartDate(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" /></div><div><label className="text-[10px] font-bold text-gray-400 mb-1.5 block ml-1 uppercase">结束日期</label><input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" /></div></div>
          <div className="grid grid-cols-2 gap-4"><div className="relative"><label className="text-[10px] font-bold text-gray-400 mb-1.5 block ml-1 uppercase">起始时间</label><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" /></div><div className="relative"><label className="text-[10px] font-bold text-gray-400 mb-1.5 block ml-1 uppercase">结束时间</label><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none" /></div></div>
          <textarea value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="简单说明您的申请理由..." className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl h-24 resize-none outline-none focus:ring-2 focus:ring-indigo-500" />
          <div className="p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
             <div className="flex justify-between items-center mb-1.5"><span className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest">Gemini 智能建议</span><button onClick={async () => { setLoadingAI(true); setRecommendation(await getSmartRecommendation(purpose, 1, availableResources)); setLoadingAI(false); }} className="text-[10px] text-indigo-600 underline font-black">获取评估</button></div>
             <p className="text-xs text-indigo-700 italic min-h-[1.25rem] leading-relaxed">{loadingAI ? 'AI 正在分析可用资源...' : (recommendation || '填写理由后点击获取建议')}</p>
          </div>
        </div>
        <div className="mt-10 flex space-x-4"><button onClick={onClose} className="flex-1 py-4 font-bold text-gray-400">放弃</button><button onClick={() => onConfirm(resource.id, purpose, `${startDate}T${startTime}`, `${endDate}T${endTime}`)} disabled={!purpose} className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all">提交申请</button></div>
      </div>
    </div>
  );
};

export default App;
