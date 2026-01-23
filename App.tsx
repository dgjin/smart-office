
import React, { useState } from 'react';
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
  UserPlus
} from 'lucide-react';
import { User, Resource, Booking, Role, AppState, BookingStatus } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS } from './constants';
import { getSmartRecommendation } from './services/geminiService';

const App: React.FC = () => {
  const [view, setView] = useState<'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS'>('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [resources, setResources] = useState<Resource[]>(INITIAL_RESOURCES);
  const [bookings, setBookings] = useState<Booking[]>(INITIAL_BOOKINGS);
  
  // 状态控制：申请模态框
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  
  // 状态控制：员工编辑模态框
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // 登录模拟
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
                    <p className="text-xs text-gray-400">{user.role === 'ADMIN' ? '管理员' : '普通员工'} • {user.department}</p>
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

  // --- 资源预订逻辑 ---
  const handleBooking = (resourceId: string, purpose: string, participants: number) => {
    const newBooking: Booking = {
      id: Math.random().toString(36).substr(2, 9),
      userId: currentUser.id,
      resourceId,
      type: resources.find(r => r.id === resourceId)?.type || 'ROOM',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(), 
      status: 'PENDING',
      purpose,
      createdAt: new Date().toISOString(),
    };
    
    setBookings([...bookings, newBooking]);
    setResources(prev => prev.map(r => r.id === resourceId ? { ...r, status: 'PENDING' } : r));
    setShowBookingModal(false);
  };

  const updateBookingStatus = (bookingId: string, status: BookingStatus) => {
    setBookings(prev => prev.map(b => {
      if (b.id === bookingId) {
        const resId = b.resourceId;
        setResources(resPrev => resPrev.map(r => {
          if (r.id === resId) {
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

  // --- 员工管理逻辑 ---
  const handleSaveUser = (userData: Partial<User>) => {
    if (editingUser) {
      // 修改
      setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, ...userData } as User : u));
    } else {
      // 新增
      const newUser: User = {
        id: Math.random().toString(36).substr(2, 9),
        name: userData.name || '',
        email: userData.email || '',
        department: userData.department || '',
        role: userData.role || 'EMPLOYEE',
      };
      setUsers([...users, newUser]);
    }
    setShowUserModal(false);
    setEditingUser(null);
  };

  const handleDeleteUser = (id: string) => {
    if (confirm('确认要删除该员工信息吗？相关申请记录将保留但可能无法关联。')) {
      setUsers(users.filter(u => u.id !== id));
      // 如果删除了当前登录用户，退出登录
      if (currentUser.id === id) setCurrentUser(null);
    }
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
          <div className="flex items-center space-x-3 mb-6 p-2">
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
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 glass-effect border-b sticky top-0 z-10 flex items-center justify-between px-8">
          <h2 className="text-lg font-bold text-gray-800">
            {view === 'DASHBOARD' && '工作空间概览'}
            {view === 'RESOURCES' && '会议室与工位预订'}
            {view === 'BOOKINGS' && '我的申请记录'}
            {view === 'USERS' && '员工管理'}
          </h2>
          <div className="flex items-center space-x-4">
            <button className="p-2 text-gray-400 hover:text-indigo-600 transition-colors">
              <Search size={20} />
            </button>
            <button className="p-2 text-gray-400 hover:text-indigo-600 transition-colors relative">
              <Bell size={20} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto w-full">
          {view === 'DASHBOARD' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* 统计卡片 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: '空闲会议室', value: resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                  { label: '使用中工位', value: resources.filter(r => r.type === 'DESK' && r.status === 'OCCUPIED').length, color: 'text-rose-600', bg: 'bg-rose-50' },
                  { label: '待审批申请', value: bookings.filter(b => b.status === 'PENDING').length, color: 'text-amber-600', bg: 'bg-amber-50' },
                  { label: '员工总数', value: users.length, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                ].map((stat, i) => (
                  <div key={i} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                    <p className="text-sm font-medium text-gray-500 mb-2">{stat.label}</p>
                    <div className="flex items-center space-x-3">
                      <span className={`text-3xl font-bold ${stat.color}`}>{stat.value}</span>
                      <div className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${stat.bg} ${stat.color}`}>实时</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* 快速入口 */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <h3 className="text-xl font-bold text-gray-800">常用资源状态</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {resources.filter(r => r.status === 'AVAILABLE').slice(0, 4).map(res => (
                      <div key={res.id} className="bg-white p-4 rounded-xl border border-gray-100 flex items-center justify-between group hover:border-indigo-200 transition-colors">
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
                  </div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
                    <Cpu className="text-indigo-600 mr-2" size={20} /> AI 管理辅助
                  </h3>
                  <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                    AI 正在为您实时监控办公区使用率。当前峰值时段为 10:00 - 11:30。
                  </p>
                  <button 
                    onClick={() => setView('RESOURCES')}
                    className="mt-auto w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100"
                  >
                    查看资源占用图表
                  </button>
                </div>
              </div>
            </div>
          )}

          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex justify-between items-center mb-4">
                <div className="flex space-x-2">
                   <button className="px-4 py-2 bg-white border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">全部</button>
                   <button className="px-4 py-2 bg-white border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">会议室</button>
                   <button className="px-4 py-2 bg-white border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">工位</button>
                </div>
                {currentUser.role === 'ADMIN' && (
                  <button className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100">
                    <Plus size={18} /> <span>添加资源</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {resources.map(res => (
                  <ResourceCard 
                    key={res.id} 
                    resource={res} 
                    isAdmin={currentUser.role === 'ADMIN'}
                    onBook={() => {
                      setSelectedResource(res);
                      setShowBookingModal(true);
                    }}
                    onDelete={() => setResources(resources.filter(r => r.id !== res.id))}
                  />
                ))}
              </div>
            </div>
          )}

          {view === 'BOOKINGS' && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-in fade-in duration-300">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">申请资源</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">申请人</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">用途</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">状态</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">申请时间</th>
                    <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bookings.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400 font-medium">暂无任何预订记录</td>
                    </tr>
                  ) : (
                    bookings.map(booking => {
                      const res = resources.find(r => r.id === booking.resourceId);
                      const user = users.find(u => u.id === booking.userId);
                      return (
                        <tr key={booking.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-bold text-gray-800 text-sm">{res?.name || '未知资源'}</div>
                            <div className="text-xs text-gray-400">{res?.type === 'ROOM' ? '会议室' : '工位'}</div>
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-700">{user?.name || '已删人员'}</td>
                          <td className="px-6 py-4 text-gray-500 text-sm max-w-xs truncate">{booking.purpose}</td>
                          <td className="px-6 py-4"><StatusBadge status={booking.status} /></td>
                          <td className="px-6 py-4 text-gray-500 text-xs">{new Date(booking.startTime).toLocaleString()}</td>
                          <td className="px-6 py-4">
                            <div className="flex justify-center space-x-2">
                              {currentUser.role === 'ADMIN' && booking.status === 'PENDING' && (
                                <>
                                  <button onClick={() => updateBookingStatus(booking.id, 'APPROVED')} title="通过申请" className="p-1.5 text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors">
                                    <CheckCircle size={18} />
                                  </button>
                                  <button onClick={() => updateBookingStatus(booking.id, 'REJECTED')} title="驳回申请" className="p-1.5 text-rose-600 bg-rose-50 rounded-lg hover:bg-rose-100 transition-colors">
                                    <XCircle size={18} />
                                  </button>
                                </>
                              )}
                              {(currentUser.role === 'ADMIN' || currentUser.id === booking.userId) && booking.status === 'APPROVED' && (
                                <button onClick={() => updateBookingStatus(booking.id, 'COMPLETED')} className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-200 transition-colors">
                                  释放资源
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
          )}

          {view === 'USERS' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm text-gray-500">管理员可新增、编辑或删除企业员工账号。</p>
                <button 
                  onClick={() => { setEditingUser(null); setShowUserModal(true); }}
                  className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100"
                >
                  <UserPlus size={18} /> <span>新增员工</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.map(user => (
                  <div key={user.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col hover:shadow-md transition-all group">
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
                    <div className="space-y-1 mb-6">
                      <p className="text-xs text-gray-400">电子邮箱: {user.email}</p>
                      <p className="text-xs text-gray-400">账号 ID: {user.id}</p>
                    </div>
                    <div className="mt-auto flex border-t pt-4 space-x-2">
                      <button 
                        onClick={() => { setEditingUser(user); setShowUserModal(true); }}
                        className="flex-1 flex items-center justify-center space-x-1 py-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors text-sm font-medium"
                      >
                        <Edit2 size={14} /> <span>编辑</span>
                      </button>
                      <button 
                        onClick={() => handleDeleteUser(user.id)}
                        className="flex-1 flex items-center justify-center space-x-1 py-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors text-sm font-medium"
                      >
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

      {/* 资源申请弹窗 */}
      {showBookingModal && selectedResource && (
        <BookingModal 
          resource={selectedResource} 
          onClose={() => setShowBookingModal(false)}
          onConfirm={handleBooking}
          availableResources={resources.filter(r => r.status === 'AVAILABLE')}
        />
      )}

      {/* 员工编辑/新增弹窗 */}
      {showUserModal && (
        <UserModal 
          user={editingUser} 
          onClose={() => { setShowUserModal(false); setEditingUser(null); }}
          onSave={handleSaveUser}
        />
      )}
    </div>
  );
};

// --- 组件定义 ---

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
    AVAILABLE: '可预订',
    PENDING: '待审批',
    OCCUPIED: '使用中',
    MAINTENANCE: '维护中',
    APPROVED: '已批准',
    REJECTED: '已驳回',
    COMPLETED: '已结束',
  };
  return (
    <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${styles[status] || styles.PENDING}`}>
      {labels[status] || '处理中'}
    </span>
  );
};

const ResourceCard = ({ resource, isAdmin, onBook, onDelete }: any) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-all">
    <div className="h-32 bg-indigo-50 flex items-center justify-center relative">
       <div className={`w-16 h-16 rounded-full flex items-center justify-center ${resource.type === 'ROOM' ? 'bg-indigo-600' : 'bg-cyan-600'} text-white shadow-lg`}>
          {resource.type === 'ROOM' ? <Monitor size={32} /> : <Coffee size={32} />}
       </div>
       <div className="absolute top-4 right-4">
          <StatusBadge status={resource.status} />
       </div>
    </div>
    <div className="p-6 flex-1 flex flex-col">
      <h3 className="font-bold text-gray-800 text-lg mb-1">{resource.name}</h3>
      <p className="text-sm text-gray-400 mb-4 flex items-center">
        <MapPin size={14} className="mr-1" /> {resource.location} 
        {resource.capacity && ` • 容纳: ${resource.capacity}人`}
      </p>
      
      <div className="flex flex-wrap gap-2 mb-6">
        {resource.features.map((f: string, i: number) => (
          <span key={i} className="px-2 py-0.5 bg-gray-50 text-gray-500 rounded text-[10px] font-medium border border-gray-100">
            {f}
          </span>
        ))}
      </div>

      <div className="flex space-x-3 mt-auto">
        <button 
          disabled={resource.status !== 'AVAILABLE'}
          onClick={onBook}
          className={`flex-1 py-2 rounded-xl font-bold transition-all ${
            resource.status === 'AVAILABLE' 
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-100' 
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {resource.status === 'AVAILABLE' ? '立即申请' : '当前不可用'}
        </button>
        {isAdmin && (
          <button onClick={() => { if(confirm('确认删除该资源？')) onDelete(); }} className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors">
            <Trash2 size={20} />
          </button>
        )}
      </div>
    </div>
  </div>
);

const BookingModal = ({ resource, onClose, onConfirm, availableResources }: any) => {
  const [purpose, setPurpose] = useState('');
  const [participants, setParticipants] = useState(1);
  const [recommendation, setRecommendation] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);

  const fetchAIHelp = async () => {
    if (!purpose) return;
    setLoadingAI(true);
    const rec = await getSmartRecommendation(purpose, participants, availableResources);
    setRecommendation(rec);
    setLoadingAI(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 shadow-2xl">
        <div className="p-8">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">申请资源使用</h2>
              <p className="text-sm text-gray-400">正在申请: {resource.name}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <XCircle size={24} className="text-gray-400" />
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">申请用途</label>
              <textarea 
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="例如：周例会、客户对接、代码审查..."
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all h-24 resize-none"
              />
            </div>
            {resource.type === 'ROOM' && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">参与人数</label>
                <input 
                  type="number"
                  min="1"
                  value={participants}
                  onChange={(e) => setParticipants(parseInt(e.target.value))}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
            )}

            <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Cpu size={16} className="text-indigo-600" />
                  <span className="text-xs font-bold text-indigo-700 uppercase">AI 建议</span>
                </div>
                {!recommendation && !loadingAI && (
                  <button onClick={fetchAIHelp} className="text-[10px] font-bold text-indigo-600 hover:underline">智能评估</button>
                )}
              </div>
              <p className="text-xs text-indigo-700 leading-relaxed">
                {loadingAI ? "正在分析匹配度..." : (recommendation || "填写用途后点击“智能评估”查看该资源是否符合您的需求。")}
              </p>
            </div>
          </div>

          <div className="mt-8 flex space-x-4">
            <button onClick={onClose} className="flex-1 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-2xl transition-all">取消</button>
            <button 
              disabled={!purpose}
              onClick={() => onConfirm(resource.id, purpose, participants)}
              className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 disabled:bg-gray-200 disabled:shadow-none transition-all"
            >
              提交申请
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- 员工管理模态框 ---
const UserModal = ({ user, onClose, onSave }: { user: User | null, onClose: () => void, onSave: (data: Partial<User>) => void }) => {
  const [formData, setFormData] = useState<Partial<User>>(user || {
    name: '',
    email: '',
    department: '',
    role: 'EMPLOYEE' as Role
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 shadow-2xl">
        <div className="p-8">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">{user ? '修改员工信息' : '新增员工账号'}</h2>
              <p className="text-sm text-gray-400">{user ? `正在编辑: ${user.name}` : '请填写新员工的基本信息'}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <XCircle size={24} className="text-gray-400" />
            </button>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">员工姓名</label>
                <input 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="姓名"
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">所属部门</label>
                <input 
                  value={formData.department}
                  onChange={(e) => setFormData({...formData, department: e.target.value})}
                  placeholder="例如：研发部"
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">电子邮箱</label>
              <input 
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="name@company.com"
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">系统权限</label>
              <select 
                value={formData.role}
                onChange={(e) => setFormData({...formData, role: e.target.value as Role})}
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all appearance-none"
              >
                <option value="EMPLOYEE">普通员工 (只能申请资源)</option>
                <option value="ADMIN">管理员 (可审批及管理员工/资源)</option>
              </select>
            </div>
          </div>

          <div className="mt-8 flex space-x-4">
            <button onClick={onClose} className="flex-1 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-2xl transition-all">取消</button>
            <button 
              disabled={!formData.name || !formData.email}
              onClick={() => onSave(formData)}
              className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 disabled:bg-gray-200 disabled:shadow-none transition-all"
            >
              保存信息
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
