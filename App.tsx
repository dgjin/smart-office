
import React, { useState, useEffect, useMemo } from 'react';
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
  Clock
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS } from './constants';
import { getSmartRecommendation } from './services/geminiService';

// 本地存储键名
const STORAGE_KEY = 'SMART_OFFICE_DATA_V1';

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // 初始化状态时尝试从本地存储加载
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

  // 当数据变化时同步到本地存储
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ users, resources, bookings }));
  }, [users, resources, bookings]);

  // 核心：自动释放逻辑
  // 每一分钟检查一次是否有已批准的申请已过期
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      let hasExpired = false;

      const expiredBookingIds: string[] = [];
      const updatedBookings = bookings.map(b => {
        if (b.status === 'APPROVED' && new Date(b.endTime) <= now) {
          hasExpired = true;
          expiredBookingIds.push(b.resourceId);
          return { ...b, status: 'COMPLETED' as BookingStatus };
        }
        return b;
      });

      if (hasExpired) {
        setBookings(updatedBookings);
        // 同时释放关联的资源
        setResources(prevRes => prevRes.map(r => {
          if (expiredBookingIds.includes(r.id)) {
            return { ...r, status: 'AVAILABLE' };
          }
          return r;
        }));
      }
    }, 15000); // 15秒检查一次，提升实时感

    return () => clearInterval(interval);
  }, [bookings]);
  
  // 状态控制：模态框
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [resourceFilter, setResourceFilter] = useState<'ALL' | ResourceType>('ALL');

  // 计算仪表盘统计数据
  const stats = useMemo(() => {
    return [
      { 
        label: '空闲会议室', 
        value: resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length, 
        color: 'text-emerald-600', 
        bg: 'bg-emerald-50' 
      },
      { 
        label: '空闲工位', 
        value: resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length, 
        color: 'text-cyan-600', 
        bg: 'bg-cyan-50' 
      },
      { 
        label: '已占用资源', 
        value: resources.filter(r => r.status === 'OCCUPIED').length, 
        color: 'text-rose-600', 
        bg: 'bg-rose-50' 
      },
      { 
        label: '待审批申请', 
        value: bookings.filter(b => b.status === 'PENDING').length, 
        color: 'text-amber-600', 
        bg: 'bg-amber-50' 
      },
      { 
        label: '员工总数', 
        value: users.length, 
        color: 'text-indigo-600', 
        bg: 'bg-indigo-50' 
      },
    ];
  }, [resources, bookings, users]);

  // 重置数据功能
  const resetSystem = () => {
    if (confirm('确定要重置系统到初始状态吗？所有新增数据都将丢失。')) {
      setUsers(INITIAL_USERS);
      setResources(INITIAL_RESOURCES);
      setBookings(INITIAL_BOOKINGS);
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in duration-300">
          <h1 className="text-3xl font-bold text-center mb-2 text-gray-800 tracking-tight">智慧办公</h1>
          <p className="text-gray-500 text-center mb-8">请选择您的账号进入系统</p>
          <div className="space-y-4">
            {users.map(user => (
              <button
                key={user.id}
                onClick={() => setCurrentUser(user)}
                className="w-full flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-indigo-50 hover:border-indigo-200 transition-all group"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold group-hover:bg-indigo-200">
                    {user.name[0]}
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-gray-800">{user.name}</p>
                    <p className="text-xs text-gray-400">{user.role === 'ADMIN' ? '管理员' : '员工'} • {user.department}</p>
                  </div>
                </div>
                <div className="text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Plus size={20} />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const handleBooking = (resourceId: string, purpose: string, startTime: string, endTime: string) => {
    const newBooking: Booking = {
      id: 'b-' + Date.now(),
      userId: currentUser.id,
      resourceId,
      type: resources.find(r => r.id === resourceId)?.type || 'ROOM',
      startTime,
      endTime,
      status: 'PENDING',
      purpose,
      createdAt: new Date().toISOString(),
    };
    
    setBookings(prev => [...prev, newBooking]);
    setResources(prev => prev.map(r => r.id === resourceId ? { ...r, status: 'PENDING' } : r));
    setShowBookingModal(false);
  };

  const updateBookingStatus = (bookingId: string, status: BookingStatus) => {
    setBookings(prev => prev.map(b => {
      if (b.id === bookingId) {
        setResources(resPrev => resPrev.map(r => {
          if (r.id === b.resourceId) {
            if (status === 'APPROVED') return { ...r, status: 'OCCUPIED' };
            if (status === 'COMPLETED' || status === 'REJECTED' || status === 'CANCELLED') return { ...r, status: 'AVAILABLE' };
          }
          return r;
        }));
        return { ...b, status };
      }
      return b;
    }));
  };

  const handleSaveResource = (resourceData: Partial<Resource>) => {
    if (editingResource) {
      setResources(prev => prev.map(r => r.id === editingResource.id ? { ...r, ...resourceData } as Resource : r));
    } else {
      const newRes: Resource = {
        id: 'r-' + Date.now(),
        name: resourceData.name || '新资源',
        type: resourceData.type || 'ROOM',
        capacity: resourceData.capacity,
        location: resourceData.location || '未知',
        features: resourceData.features || [],
        status: 'AVAILABLE'
      };
      setResources(prev => [...prev, newRes]);
      setResourceFilter('ALL');
    }
    setShowResourceModal(false);
    setEditingResource(null);
  };

  const handleDeleteResource = (id: string) => {
    if (confirm('确认删除？相关申请记录也将不可见。')) {
      setResources(prev => prev.filter(r => r.id !== id));
      setBookings(prev => prev.filter(b => b.resourceId !== id));
    }
  };

  const handleSaveUser = (userData: Partial<User>) => {
    if (editingUser) {
      setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, ...userData } as User : u));
    } else {
      const newUser: User = {
        id: 'u-' + Date.now(),
        name: userData.name || '',
        email: userData.email || '',
        department: userData.department || '',
        role: userData.role || 'EMPLOYEE',
      };
      setUsers(prev => [...prev, newUser]);
    }
    setShowUserModal(false);
    setEditingUser(null);
  };

  const SidebarItem = ({ icon: Icon, label, id, active }: any) => (
    <button
      onClick={() => setView(id)}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
        active 
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' 
          : 'text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'
      }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </button>
  );

  const filteredResources = resources.filter(r => 
    resourceFilter === 'ALL' ? true : r.type === resourceFilter
  );

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* 侧边栏 */}
      <aside className="w-64 bg-white border-r hidden md:flex flex-col p-6 sticky top-0 h-screen">
        <div className="flex items-center space-x-2 mb-10">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Cpu className="text-white" size={18} />
          </div>
          <span className="text-xl font-bold tracking-tight">智慧办公系统</span>
        </div>
        
        <nav className="flex-1 space-y-2">
          <SidebarItem icon={LayoutDashboard} label="首页仪表盘" id="DASHBOARD" active={view === 'DASHBOARD'} />
          <SidebarItem icon={MapPin} label="资源管理" id="RESOURCES" active={view === 'RESOURCES'} />
          <SidebarItem icon={Calendar} label="申请记录" id="BOOKINGS" active={view === 'BOOKINGS'} />
          {currentUser.role === 'ADMIN' && (
            <SidebarItem icon={Users} label="员工管理" id="USERS" active={view === 'USERS'} />
          )}
        </nav>

        <div className="mt-auto border-t pt-6">
          <div className="flex items-center space-x-3 mb-4 p-2">
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold">
              {currentUser.name[0]}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-bold text-gray-800 truncate">{currentUser.name}</p>
              <p className="text-xs text-gray-500 truncate">{currentUser.department}</p>
            </div>
            <button onClick={() => setCurrentUser(null)} title="退出登录" className="text-gray-400 hover:text-red-500 transition-colors">
              <LogOut size={18} />
            </button>
          </div>
          {currentUser.role === 'ADMIN' && (
             <button onClick={resetSystem} className="w-full flex items-center justify-center space-x-2 py-2 text-xs text-gray-400 hover:text-rose-500 transition-colors">
               <RefreshCw size={12} />
               <span>重置系统数据</span>
             </button>
          )}
        </div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 glass-effect border-b sticky top-0 z-10 flex items-center justify-between px-8">
          <h2 className="text-lg font-bold text-gray-800">
            {view === 'DASHBOARD' && '工作空间概览'}
            {view === 'RESOURCES' && '资源库管理'}
            {view === 'BOOKINGS' && '我的申请记录'}
            {view === 'USERS' && '员工管理'}
          </h2>
          <div className="flex items-center space-x-4">
            <button className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"><Search size={20} /></button>
            <button className="p-2 text-gray-400 hover:text-indigo-600 transition-colors relative">
              <Bell size={20} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto w-full">
          {view === 'DASHBOARD' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
                {stats.map((stat, i) => (
                  <div key={i} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm transition-all hover:shadow-md">
                    <p className="text-sm font-medium text-gray-500 mb-2">{stat.label}</p>
                    <div className="flex items-center space-x-3">
                      <span className={`text-4xl font-bold ${stat.color}`}>{stat.value}</span>
                      <div className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${stat.bg} ${stat.color}`}>实时</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-gray-800">最近空闲资源</h3>
                    <button onClick={() => setView('RESOURCES')} className="text-indigo-600 text-sm font-bold hover:underline">查看全部</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {resources.filter(r => r.status === 'AVAILABLE').slice(0, 4).map(res => (
                      <div key={res.id} className="bg-white p-4 rounded-xl border border-gray-100 flex items-center justify-between group hover:border-indigo-200 transition-all shadow-sm">
                        <div className="flex items-center space-x-4">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${res.type === 'ROOM' ? 'bg-indigo-50 text-indigo-600' : 'bg-cyan-50 text-cyan-600'}`}>
                            {res.type === 'ROOM' ? <Monitor size={20} /> : <Coffee size={20} />}
                          </div>
                          <div>
                            <p className="font-bold text-gray-800 text-sm">{res.name}</p>
                            <p className="text-xs text-gray-400">{res.location}</p>
                          </div>
                        </div>
                        <StatusBadge status={res.status} />
                      </div>
                    ))}
                    {resources.filter(r => r.status === 'AVAILABLE').length === 0 && (
                      <div className="col-span-2 p-10 bg-gray-50 border border-dashed rounded-xl text-center text-gray-400">目前没有任何可用资源</div>
                    )}
                  </div>
                </div>
                
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
                    <Cpu className="text-indigo-600 mr-2" size={20} /> 状态汇总
                  </h3>
                  <div className="space-y-4 mb-6">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500">总体资源利用率</span>
                      <span className="font-bold text-gray-800">{Math.round((resources.filter(r => r.status === 'OCCUPIED').length / resources.length) * 100 || 0)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                      <div className="bg-indigo-600 h-full transition-all duration-1000" style={{ width: `${(resources.filter(r => r.status === 'OCCUPIED').length / resources.length) * 100 || 0}%` }}></div>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed italic">
                      系统会在申请时间结束后自动释放资源。
                    </p>
                  </div>
                  <button 
                    onClick={() => setView('BOOKINGS')}
                    className="mt-auto w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95"
                  >
                    处理待审批申请
                  </button>
                </div>
              </div>
            </div>
          )}

          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                <div className="flex space-x-2 bg-white p-1 rounded-xl border border-gray-100 shadow-sm">
                   {[
                     { id: 'ALL', label: '全部' },
                     { id: 'ROOM', label: '会议室' },
                     { id: 'DESK', label: '工位' }
                   ].map(tab => (
                     <button 
                       key={tab.id}
                       onClick={() => setResourceFilter(tab.id as any)}
                       className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                         resourceFilter === tab.id 
                           ? 'bg-indigo-600 text-white shadow-md' 
                           : 'text-gray-500 hover:bg-gray-50'
                       }`}
                     >
                       {tab.label}
                     </button>
                   ))}
                </div>
                {currentUser.role === 'ADMIN' && (
                  <button 
                    onClick={() => { setEditingResource(null); setShowResourceModal(true); }}
                    className="flex items-center space-x-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 active:scale-95"
                  >
                    <Plus size={18} /> <span>添加资源</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredResources.map(res => (
                  <ResourceCard 
                    key={res.id} 
                    resource={res} 
                    isAdmin={currentUser.role === 'ADMIN'}
                    onBook={() => {
                      setSelectedResource(res);
                      setShowBookingModal(true);
                    }}
                    onEdit={() => {
                      setEditingResource(res);
                      setShowResourceModal(true);
                    }}
                    onDelete={() => handleDeleteResource(res.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {view === 'BOOKINGS' && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-in fade-in duration-300">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">申请资源</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">申请人</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">用途</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">使用时间段</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">状态</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-400 font-medium italic">暂无任何预订申请记录</td>
                      </tr>
                    ) : (
                      bookings.map(booking => {
                        const res = resources.find(r => r.id === booking.resourceId);
                        const user = users.find(u => u.id === booking.userId);
                        return (
                          <tr key={booking.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-bold text-gray-800 text-sm">{res?.name || '已删除资源'}</div>
                              <div className="text-xs text-gray-400">{res?.type === 'ROOM' ? '会议室' : '工位'}</div>
                            </td>
                            <td className="px-6 py-4 font-medium text-gray-700">{user?.name || '已删除账号'}</td>
                            <td className="px-6 py-4 text-gray-500 text-sm max-w-xs truncate">{booking.purpose}</td>
                            <td className="px-6 py-4 text-gray-500 text-xs">
                              <div>开始: {new Date(booking.startTime).toLocaleString()}</div>
                              <div>结束: {new Date(booking.endTime).toLocaleString()}</div>
                            </td>
                            <td className="px-6 py-4"><StatusBadge status={booking.status} /></td>
                            <td className="px-6 py-4">
                              <div className="flex justify-center space-x-2">
                                {currentUser.role === 'ADMIN' && booking.status === 'PENDING' && (
                                  <>
                                    <button onClick={() => updateBookingStatus(booking.id, 'APPROVED')} title="通过" className="p-1.5 text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-all">
                                      <CheckCircle size={18} />
                                    </button>
                                    <button onClick={() => updateBookingStatus(booking.id, 'REJECTED')} title="拒绝" className="p-1.5 text-rose-600 bg-rose-50 rounded-lg hover:bg-rose-100 transition-all">
                                      <XCircle size={18} />
                                    </button>
                                  </>
                                )}
                                {(currentUser.role === 'ADMIN' || currentUser.id === booking.userId) && booking.status === 'APPROVED' && (
                                  <button onClick={() => updateBookingStatus(booking.id, 'COMPLETED')} className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors">
                                    提前释放
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm text-gray-500">员工账号信息管理及权限配置。</p>
                <button 
                  onClick={() => { setEditingUser(null); setShowUserModal(true); }}
                  className="flex items-center space-x-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100"
                >
                  <UserPlus size={18} /> <span>新增员工</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.map(user => (
                  <div key={user.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col hover:shadow-md transition-all group relative">
                    <div className="flex items-center space-x-4 mb-4">
                      <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold text-lg">
                        {user.name[0]}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex items-center space-x-2">
                          <h4 className="font-bold text-gray-800 truncate">{user.name}</h4>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
                            {user.role === 'ADMIN' ? '管理员' : '员工'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 truncate">{user.department}</p>
                      </div>
                    </div>
                    <div className="mt-auto flex border-t pt-4 space-x-2">
                      <button onClick={() => { setEditingUser(user); setShowUserModal(true); }} className="flex-1 flex items-center justify-center space-x-1 py-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors text-sm font-medium">
                        <Edit2 size={14} /> <span>编辑</span>
                      </button>
                      <button onClick={() => setUsers(prev => prev.filter(u => u.id !== user.id))} className="flex-1 flex items-center justify-center space-x-1 py-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors text-sm font-medium">
                        <Trash2 size={14} /> <span>删除</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 模态框 */}
      {showBookingModal && selectedResource && (
        <BookingModal 
          resource={selectedResource} 
          onClose={() => setShowBookingModal(false)}
          onConfirm={handleBooking}
          availableResources={resources.filter(r => r.status === 'AVAILABLE')}
        />
      )}

      {showUserModal && (
        <UserModal 
          user={editingUser} 
          onClose={() => { setShowUserModal(false); setEditingUser(null); }}
          onSave={handleSaveUser}
        />
      )}

      {showResourceModal && (
        <ResourceModal 
          resource={editingResource} 
          onClose={() => { setShowResourceModal(false); setEditingResource(null); }}
          onSave={handleSaveResource}
        />
      )}
    </div>
  );
};

// --- 子组件 ---

const StatusBadge = ({ status }: { status: string }) => {
  const styles: any = {
    AVAILABLE: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100',
    OCCUPIED: 'bg-rose-50 text-rose-600 border-rose-100',
    MAINTENANCE: 'bg-gray-50 text-gray-400 border-gray-200',
    APPROVED: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    REJECTED: 'bg-red-50 text-red-600 border-red-100',
    COMPLETED: 'bg-gray-50 text-gray-400 border-gray-200',
  };
  const labels: any = {
    AVAILABLE: '空闲',
    PENDING: '审批中',
    OCCUPIED: '占用中',
    MAINTENANCE: '维护',
    APPROVED: '获批',
    REJECTED: '驳回',
    COMPLETED: '已毕',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${styles[status] || styles.PENDING}`}>
      {labels[status] || '处理'}
    </span>
  );
};

const ResourceCard = ({ resource, isAdmin, onBook, onEdit, onDelete }: any) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-all group">
    <div className="h-28 bg-indigo-50 flex items-center justify-center relative">
       <div className={`w-14 h-14 rounded-full flex items-center justify-center ${resource.type === 'ROOM' ? 'bg-indigo-600' : 'bg-cyan-600'} text-white shadow-md transition-transform group-hover:scale-105`}>
          {resource.type === 'ROOM' ? <Monitor size={28} /> : <Coffee size={28} />}
       </div>
       <div className="absolute top-3 right-3"><StatusBadge status={resource.status} /></div>
       {isAdmin && (
         <div className="absolute top-3 left-3 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onEdit} className="p-1.5 bg-white text-indigo-600 rounded-lg shadow-sm border hover:bg-indigo-50 transition-colors"><Edit2 size={12} /></button>
            <button onClick={onDelete} className="p-1.5 bg-white text-rose-600 rounded-lg shadow-sm border hover:bg-rose-50 transition-colors"><Trash2 size={12} /></button>
         </div>
       )}
    </div>
    <div className="p-5 flex-1 flex flex-col">
      <h3 className="font-bold text-gray-800 mb-1">{resource.name}</h3>
      <p className="text-xs text-gray-400 mb-4 flex items-center"><MapPin size={12} className="mr-1" /> {resource.location} {resource.capacity ? ` • ${resource.capacity}人` : ''}</p>
      <button 
        disabled={resource.status !== 'AVAILABLE'}
        onClick={onBook}
        className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
          resource.status === 'AVAILABLE' 
            ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-100' 
            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
        }`}
      >
        {resource.status === 'AVAILABLE' ? '申请使用' : '正在占用'}
      </button>
    </div>
  </div>
);

const ResourceModal = ({ resource, onClose, onSave }: any) => {
  const [formData, setFormData] = useState<Partial<Resource>>(resource || { name: '', type: 'ROOM', capacity: 4, location: '', features: [] });
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 shadow-2xl p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">{resource ? '编辑资源' : '新增资源'}</h2>
        <div className="space-y-4">
          <input value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} placeholder="名称" className="w-full p-4 bg-gray-50 border rounded-2xl outline-none" />
          <div className="grid grid-cols-2 gap-4">
            <select value={formData.type} onChange={e=>setFormData({...formData, type: e.target.value as any})} className="w-full p-4 bg-gray-50 border rounded-2xl">
              <option value="ROOM">会议室</option>
              <option value="DESK">工位</option>
            </select>
            <input type="number" value={formData.capacity || ''} onChange={e=>setFormData({...formData, capacity: parseInt(e.target.value)})} placeholder="容量" className="w-full p-4 bg-gray-50 border rounded-2xl" />
          </div>
          <input value={formData.location} onChange={e=>setFormData({...formData, location: e.target.value})} placeholder="位置" className="w-full p-4 bg-gray-50 border rounded-2xl" />
        </div>
        <div className="mt-8 flex space-x-4">
          <button onClick={onClose} className="flex-1 py-4 font-bold text-gray-500">取消</button>
          <button onClick={()=>onSave(formData)} className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl">保存</button>
        </div>
      </div>
    </div>
  );
};

const UserModal = ({ user, onClose, onSave }: any) => {
  const [formData, setFormData] = useState<Partial<User>>(user || { name: '', email: '', department: '', role: 'EMPLOYEE' });
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 shadow-2xl p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">{user ? '编辑员工' : '新增员工'}</h2>
        <div className="space-y-4">
          <input value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} placeholder="姓名" className="w-full p-4 bg-gray-50 border rounded-2xl" />
          <input value={formData.email} onChange={e=>setFormData({...formData, email: e.target.value})} placeholder="邮箱" className="w-full p-4 bg-gray-50 border rounded-2xl" />
          <input value={formData.department} onChange={e=>setFormData({...formData, department: e.target.value})} placeholder="部门" className="w-full p-4 bg-gray-50 border rounded-2xl" />
          <select value={formData.role} onChange={e=>setFormData({...formData, role: e.target.value as any})} className="w-full p-4 bg-gray-50 border rounded-2xl">
             <option value="EMPLOYEE">员工</option>
             <option value="ADMIN">管理员</option>
          </select>
        </div>
        <div className="mt-8 flex space-x-4">
          <button onClick={onClose} className="flex-1 py-4 font-bold text-gray-500">取消</button>
          <button onClick={()=>onSave(formData)} className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl">保存</button>
        </div>
      </div>
    </div>
  );
};

const BookingModal = ({ resource, onClose, onConfirm, availableResources }: any) => {
  const [purpose, setPurpose] = useState('');
  
  // 默认设置为今天
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  
  // 默认设置为当前时间
  const now = new Date();
  const currentHour = now.getHours().toString().padStart(2, '0');
  const currentMin = now.getMinutes().toString().padStart(2, '0');
  const [startTime, setStartTime] = useState(`${currentHour}:${currentMin}`);
  
  // 默认一小时后
  const endHour = (now.getHours() + 1).toString().padStart(2, '0');
  const [endTime, setEndTime] = useState(`${endHour}:${currentMin}`);

  const [recommendation, setRecommendation] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);

  const fetchAIHelp = async () => {
    if (!purpose) return;
    setLoadingAI(true);
    const rec = await getSmartRecommendation(purpose, 1, availableResources);
    setRecommendation(rec);
    setLoadingAI(false);
  };

  const handleConfirm = () => {
    if (!purpose || !date || !startTime || !endTime) return;
    
    // 合并日期和时间
    const startISO = new Date(`${date}T${startTime}`).toISOString();
    const endISO = new Date(`${date}T${endTime}`).toISOString();

    if (new Date(endISO) <= new Date(startISO)) {
      alert('结束时间必须晚于开始时间');
      return;
    }

    onConfirm(resource.id, purpose, startISO, endISO);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 shadow-2xl p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">申请使用</h2>
        <p className="text-gray-400 text-sm mb-6">资源: {resource.name}</p>
        
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">开会/使用日期</label>
            <input 
              type="date" 
              value={date} 
              min={today}
              onChange={e => setDate(e.target.value)} 
              className="w-full p-4 bg-gray-50 border rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500" 
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">开始时间</label>
              <div className="relative">
                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  type="time" 
                  value={startTime} 
                  onChange={e => setStartTime(e.target.value)} 
                  className="w-full p-4 pl-12 bg-gray-50 border rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500" 
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">结束时间</label>
              <div className="relative">
                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  type="time" 
                  value={endTime} 
                  onChange={e => setEndTime(e.target.value)} 
                  className="w-full p-4 pl-12 bg-gray-50 border rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500" 
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">申请用途</label>
            <textarea 
              value={purpose} 
              onChange={e=>setPurpose(e.target.value)} 
              placeholder="请描述您的用途..." 
              className="w-full p-4 bg-gray-50 border rounded-2xl h-24 resize-none outline-none focus:ring-2 focus:ring-indigo-500" 
            />
          </div>

          <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
             <div className="flex justify-between mb-1">
               <span className="text-xs font-bold text-indigo-700 uppercase">AI 建议</span>
               {!recommendation && <button onClick={fetchAIHelp} className="text-[10px] text-indigo-600 underline font-bold">智能评估</button>}
             </div>
             <p className="text-xs text-indigo-700 leading-relaxed min-h-[1rem]">{loadingAI ? '分析需求中...' : (recommendation || '填写用途后可获取智能推荐建议')}</p>
          </div>
        </div>

        <div className="mt-8 flex space-x-4">
          <button onClick={onClose} className="flex-1 py-4 font-bold text-gray-500">取消</button>
          <button 
            onClick={handleConfirm} 
            disabled={!purpose} 
            className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl disabled:bg-gray-200 active:scale-95 transition-all shadow-lg shadow-indigo-100"
          >
            提交申请
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
