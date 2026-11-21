import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Users, MapPin, Calendar, CheckCircle, XCircle, LayoutDashboard, Plus, LogOut, 
  Cpu, Monitor, Coffee, Edit2, Trash2, UserPlus, RefreshCw,
  Clock, GitMerge, ChevronRight, ArrowRight, ChevronDown, ChevronUp,
  ShieldCheck, Check, X, Building2,
  PieChart, ChevronLeft, Timer, Briefcase, Shield, FolderTree,
  UserCircle, AlertTriangle, Download, Upload, Database,
  Info, MoreHorizontal, Activity, ArrowRightCircle, MessageSquare, Send,
  CalendarDays, History, Square, CheckSquare, Search, FileText, FileUp,
  Lock, Smartphone, Mail, Key, Minus, Layers, PlayCircle, QrCode, Eye, Lightbulb, Bell, Filter,
  Save, RotateCcw, Phone, Ban, Video, CupSoda, Crown, Cloud, CloudOff, ArrowUpRight,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, ApprovalDelegate, AuditEvent, Department, RoleDefinition, ResourceStatus, Notification, WorkOrder, RoomFeature } from './types';
import { formatDate, formatTime, migrateBookings, pad2, toLocalDateString, toLocalDateTimeString, toLocalTimeString } from './utils/dateTime';
import { findAvailableRooms, findBookingConflicts, findNextAvailableSlot, getDailyOccurrenceCount, getLongTermMaxEndDate, hasBookingConflict, isActiveBooking, isResourceAcceptingBookings, resourceSupportsFeature, validateBookingResource } from './utils/bookingRules';
import { validateBookingDraft } from './utils/bookingDraft';
import { filterResources } from './utils/resourceSearch';
import { getApprovalGroups, getBookingWorkflow } from './utils/approval';
import { generateReport } from './utils/reports';
import { generateBookingIcs } from './utils/calendar';
import ChatDock, { type AgentAction } from './components/ChatDock';
import BuildingExplorer, { BUILDINGS, getFloorNumbers, parseBuilding, parseFloor, type BuildingId } from './components/BuildingExplorer';

type AppView = 'DASHBOARD' | 'RESOURCES' | 'USERS' | 'BOOKINGS' | 'ROLES' | 'DEPARTMENTS' | 'APPROVAL_CENTER' | 'WORK_ORDERS' | 'REPORTS' | 'WORKFLOW_CONFIG' | 'DATA_CENTER';
type NavItem = { id: AppView; label: string; shortLabel: string; icon: React.ElementType; badge?: number };

// --- Theme Config ---
const THEMES = [
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-600', text: 'text-indigo-600', border: 'border-indigo-100', bg: 'bg-indigo-50' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-100', bg: 'bg-emerald-50' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-600', text: 'text-orange-600', border: 'border-orange-100', bg: 'bg-orange-50' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-600', text: 'text-rose-600', border: 'border-rose-100', bg: 'bg-rose-50' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-600', text: 'text-purple-600', border: 'border-purple-100', bg: 'bg-purple-50' },
];

const ROOM_FEATURES: Array<{ id: RoomFeature; label: string }> = [
  { id: 'VIDEO', label: '视频会议系统' },
  { id: 'DISPLAY', label: '投屏显示器' },
  { id: 'WHITEBOARD', label: '白板' }
];

const BOOKING_ERROR_MESSAGES: Record<string, string> = {
  RESOURCE_NOT_FOUND: '会议室信息已不存在，请刷新后重试。',
  RESOURCE_MAINTENANCE: '该会议室正在维护，请选择其他会议室。',
  RESOURCE_UNAVAILABLE: '该会议室暂未开放预约，请选择其他会议室。',
  INVALID_TIME_RANGE: '预约时间无效，请重新选择。',
  INVALID_PARTICIPANTS: '参与人数无效，请重新填写。',
  CAPACITY_EXCEEDED: '参与人数超过会议室当前容量，请减少人数或更换会议室。',
  REQUIRED_FEATURE_UNAVAILABLE: '会议室当前设备不满足预约要求，请调整设备需求或更换会议室。',
  ACTIVE_BOOKINGS_REQUIRE_REVIEW: '仍有未结束的有效预约，请先取消或改期后再切换维护状态。'
};

const downloadBookingIcs = (booking: Booking, resource: Resource, users: User[]) => {
  const ics = generateBookingIcs(booking, resource, users, new Date());
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
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

const ToastNotification = ({ notification, onClose }: { notification: Notification; onClose: () => void }) => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div role="status" className="studio-toast backdrop-blur-md flex items-start space-x-3 animate-in slide-in-from-right-8 fade-in pointer-events-auto">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${notification.type === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600' : notification.type === 'WARNING' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
        {notification.type === 'SUCCESS' ? <CheckCircle size={18}/> : notification.type === 'WARNING' ? <AlertTriangle size={18}/> : <Info size={18}/>}
      </div>
      <div className="flex-1">
        <h5 className="text-sm font-black text-gray-800">{notification.title}</h5>
        <p className="text-xs text-gray-500 font-medium mt-0.5">{notification.content}</p>
      </div>
      <button onClick={onClose} aria-label="关闭提醒" className="text-gray-500 hover:text-gray-500"><X size={14}/></button>
    </div>
  );
};

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
  return <span className={`status-badge status-${String(status).toLowerCase()} ${styles[status] || styles.PENDING}`}>{labels[status] || status}</span>;
};

const RoleTag = ({ roleId, roles, theme }: any) => {
  const role = roles.find((r: any) => r.id === roleId);
  if (!role) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">未知</span>;
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold bg-${role.color}-100 text-${role.color}-700 border border-${role.color}-200`}>{role.name}</span>;
};

const SidebarItem = ({ icon: Icon, label, id, active, onClick, badge }: any) => (
  <button type="button" onClick={() => onClick(id)} className="studio-nav-item" data-active={active} aria-current={active ? 'page' : undefined} aria-label={label} title={label}>
    <Icon size={17} strokeWidth={1.7} />
    <span>{label}</span>
    {badge > 0 && <span className="studio-nav-count">{badge}</span>}
  </button>
);

const MobileMoreSheet = ({ items, currentView, onSelect, onClose, theme, onThemeChange, currentUser, isOnline, saveStatus, onLogout }: {
  items: NavItem[];
  currentView: AppView;
  onSelect: (id: AppView) => void;
  onClose: () => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  currentUser: User;
  isOnline: boolean;
  saveStatus: 'saved' | 'saving' | 'error';
  onLogout: () => void;
}) => {
  const sheetRef = useModalA11y(onClose);
  return (
    <div className="mobile-more-layer lg:hidden fixed inset-0 z-[120]">
      <button type="button" className="mobile-more-backdrop" aria-label="关闭更多功能" onClick={onClose} />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="更多功能" className="mobile-more-sheet">
        <div className="mobile-more-handle" aria-hidden="true" />
        <header className="mobile-more-head">
          <div><span>WORKSPACE / MENU</span><h2>更多功能</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭更多功能"><X size={18} /></button>
        </header>
        {items.length > 0 && (
          <nav aria-label="更多功能导航" className="mobile-more-grid">
            {items.map(item => (
              <button key={item.id} type="button" data-active={currentView === item.id} aria-current={currentView === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)}>
                <item.icon size={20} strokeWidth={1.6} />
                <span>{item.label}</span>
                {(item.badge || 0) > 0 && <strong>{item.badge}</strong>}
              </button>
            ))}
          </nav>
        )}
        <section className="mobile-more-section" aria-labelledby="mobile-theme-title">
          <div className="mobile-more-section-title"><span id="mobile-theme-title">界面主题</span><small>THEME</small></div>
          <div className="mobile-theme-grid">
            {THEMES.map(item => (
              <button key={item.id} type="button" data-active={theme === item.id} aria-pressed={theme === item.id} onClick={() => onThemeChange(item.id)}>
                <i className={item.color} aria-hidden="true" /><span>{item.name}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="mobile-account-card" aria-label="当前账户">
          <div className="studio-user-avatar">{currentUser.name[0]}</div>
          <div><strong>{currentUser.name}</strong><span>{currentUser.department} · {saveStatus === 'saving' ? '正在同步' : isOnline && saveStatus !== 'error' ? 'MySQL 已同步' : '连接异常，更改未保存'}</span></div>
          <button type="button" onClick={onLogout}><LogOut size={16} />退出登录</button>
        </section>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, trend, color, onClick }: any) => (
  <button onClick={onClick} className="studio-stat" data-tone={color}>
    <div className="studio-stat-label"><span>{title}</span><Icon size={17} strokeWidth={1.6}/></div>
    <h3>{value}</h3>
    <p>{trend || 'REALTIME · 实时数据'}</p>
  </button>
);

const SCHEDULE_RANGES = [
  { id: 'TODAY', label: '今日', code: 'DAY', description: '08:00—20:00 时间轨 · 点击会议查看详情' },
  { id: 'WEEK', label: '本周', code: '7 DAYS', description: '未来 7 天申请概况 · 点击日期查看详情' },
  { id: 'MONTH', label: '本月', code: '30 DAYS', description: '未来 30 天申请概况 · 点击日期查看详情' }
] as const;
type ScheduleRange = typeof SCHEDULE_RANGES[number]['id'];

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
          {bookings.map((b: Booking) => <button key={b.id} onClick={async () => { if (await onCheckIn(b.id)) onClose(); }} className={`w-full p-4 rounded-2xl bg-${theme}-50 border border-${theme}-100 text-left hover:bg-${theme}-100 transition-colors`}>
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

const LoginView = ({ onLogin }: any) => {
  const [options, setOptions] = useState<{ oidc: boolean; development: boolean; users: User[] }>({ oidc: false, development: false, users: [] });
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/auth/options')
      .then(res => res.ok ? res.json() : Promise.reject(new Error(String(res.status))))
      .then(setOptions)
      .catch(() => setError('认证服务暂时不可用，请稍后重试。'))
      .finally(() => setOptionsLoaded(true));
  }, []);
  const devLogin = async (userId: string) => {
    setError('');
    try {
      const res = await fetch(`/api/auth/dev?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'DEV_AUTH_FAILED');
      onLogin(data.actor);
    } catch {
      setError('开发身份登录失败，请确认服务已启用开发认证。');
    }
  };
  return (
    <div className="login-shell" data-theme="indigo">
      <section className="login-editorial" aria-label="SmartOffice 品牌介绍">
        <div className="login-brand">
          <div className="login-brand-mark"><Cpu size={22} strokeWidth={1.5}/></div>
          <div><div className="login-brand-name">SmartOffice</div><div className="login-brand-meta">WORKPLACE, WELL COMPOSED.</div></div>
        </div>
        <div className="login-hero">
          <div className="login-kicker">THE DAILY OFFICE JOURNAL · 2026</div>
          <h1>让每一次相聚，<br/><em>恰到好处。</em></h1>
          <p>从一间会议室，到一天的工作节奏。<br/>把空间、时间与协作，写进同一页议程。</p>
        </div>
        <div className="login-steps">
          <div className="login-step"><span>01 / RESERVE</span><strong>找到合适的空间</strong></div>
          <div className="login-step"><span>02 / COORDINATE</span><strong>让流程自然发生</strong></div>
          <div className="login-step"><span>03 / MEET</span><strong>专注真正重要的事</strong></div>
        </div>
      </section>
      <main className="login-access">
        <div className="login-access-inner">
          <header className="login-access-heading">
            <div className="login-date"><span>THE OFFICE DESK / 成员入口</span><span>{new Date().getFullYear()}</span></div>
            <h2>今天，从这里开始。</h2>
            <p className="login-access-intro">使用企业统一身份认证进入今日办公议程。</p>
          </header>
          <div className="login-accounts">
            {options.oidc && <button onClick={() => { window.location.assign('/api/auth/login?returnTo=%2F'); }} className="login-account">
              <span className="login-account-index">SSO</span>
              <span className="login-account-avatar"><Key size={20}/></span>
              <span><strong className="login-account-name">企业统一身份登录</strong><small className="login-account-role">Authorization Code · PKCE</small></span>
              <ArrowUpRight size={19} strokeWidth={1.5}/>
            </button>}
            {options.development && options.users.map((user, index) => (
              <button key={user.id} onClick={() => void devLogin(user.id)} className="login-account">
                <span className="login-account-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="login-account-avatar">{user.name[0]}</span>
                <span><strong className="login-account-name">{user.name}</strong><small className="login-account-role">开发身份 · {user.department}</small></span>
                <ArrowUpRight size={19} strokeWidth={1.5}/>
              </button>
            ))}
            {!optionsLoaded && !error && <p className="text-sm text-gray-500">正在检查认证配置…</p>}
            {optionsLoaded && !options.oidc && !options.development && !error && <p role="alert" className="text-sm font-bold text-amber-600">未配置可用的认证方式，请联系管理员检查 OIDC 或开发认证配置。</p>}
            {error && <p role="alert" className="text-sm font-bold text-rose-600">{error}</p>}
          </div>
          <footer className="login-footnote flex justify-between gap-4"><span>SMARTOFFICE®</span><span>企业身份认证 · MySQL 会话</span></footer>
        </div>
      </main>
    </div>
  );
};

const TodayResourceUsage = ({ resources, bookings, users, theme, onBookingClick }: any) => {
  const hours = Array.from({ length: 13 }, (_, i) => i + 8); // 8:00 - 20:00
  return (
    <div className="studio-timeline overflow-x-auto">
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

const ResourceUsageGrid = ({ days, resources, bookings, onDayClick, theme }: any) => {
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
    <div className="studio-usage-grid flex flex-col">
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
  const effectiveWorkflow = getBookingWorkflow(booking, workflow);
  return (
    <div className="flex items-center justify-between relative mt-4">
      <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-100 -z-10"></div>
      {effectiveWorkflow.map((node: ApprovalNode, idx: number) => {
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

const ApprovalTaskCard = ({ booking, seriesBookings = [booking], workflow, users, resources, theme, onApprove, onReject, selected, onToggleSelect, busy = false, disabled = false, actionError = '' }: any) => {
  const user = users.find((u: any) => u.id === booking.userId);
  const resource = resources.find((r: any) => r.id === booking.resourceId);
  const currentNode = getBookingWorkflow(booking, workflow)[booking.currentNodeIndex];
  const isLongTerm = booking.seriesKind === 'LONG_TERM';
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const controlsDisabled = disabled || busy;
  const reject = () => {
    if (!comment.trim()) { setError('驳回时必须填写具体原因'); return; }
    onReject(comment.trim());
  };
  return (
    <div aria-busy={busy} className={`bg-white p-6 rounded-[2rem] border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 ${selected ? `border-${theme}-300 ring-2 ring-${theme}-50` : 'border-gray-100'}`}>
      <button disabled={controlsDisabled} onClick={onToggleSelect} aria-label={`选择${user?.name}的申请`} className={`self-start md:self-center disabled:cursor-not-allowed disabled:opacity-40 ${selected ? `text-${theme}-600` : 'text-gray-200 hover:text-gray-500'}`}>{selected ? <CheckSquare size={20}/> : <Square size={20}/>}</button>
      <div className="flex items-center space-x-4 flex-1">
        <div className={`w-12 h-12 rounded-2xl bg-${theme}-50 flex items-center justify-center text-${theme}-600 font-bold text-xs shrink-0`}>{user?.name[0]}</div>
        <div>
           <div className="flex flex-wrap items-center gap-2">
             <h4 className="font-bold text-gray-800 text-lg">{user?.name} 申请 {resource?.name}</h4>
             {isLongTerm && <span className="shrink-0 whitespace-nowrap bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md text-[11px] font-black border border-indigo-100">{booking.renewalOfSeriesId ? '长期续期' : '长期预订'}</span>}
             {(booking.hasLeader || booking.isVideoConference || booking.needsTeaService) && <span className="shrink-0 whitespace-nowrap bg-rose-50 text-rose-600 px-2 py-0.5 rounded-md text-[11px] font-black border border-rose-100">特殊需求</span>}
           </div>
           <p className="text-xs text-gray-500 font-medium">{isLongTerm ? `${toLocalDateString(booking.startTime)} 至 ${booking.seriesEndDate} · 每天 ${toLocalTimeString(booking.startTime)} - ${toLocalTimeString(booking.endTime)} · ${seriesBookings.length} 个会议日` : `${toLocalDateTimeString(booking.startTime)} 至 ${toLocalDateTimeString(booking.endTime)}`} · {booking.purpose}</p>
           <p className="mt-1 text-[11px] font-bold text-gray-500">当前节点：{currentNode?.name || '待审批'}{booking.workflowVersion ? ` · 流程 V${booking.workflowVersion}` : ''}</p>

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
        <textarea id={`comment-${booking.id}`} disabled={controlsDisabled} value={comment} onChange={e => { setComment(e.target.value); setError(''); }} placeholder="审批附言（通过可选，驳回必填）" className="w-full p-3 rounded-xl bg-gray-50 border border-gray-100 text-xs outline-none focus:ring-2 ring-indigo-100 resize-none disabled:opacity-60" rows={2}/>
        {(error || actionError) && <p role="alert" className="text-[11px] font-bold text-rose-600">{error || actionError}</p>}
        <div className="flex space-x-3">
          <button disabled={controlsDisabled} onClick={reject} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-bold text-xs hover:bg-gray-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50">{busy ? '处理中…' : '驳回'}</button>
          <button disabled={controlsDisabled} onClick={() => onApprove(comment.trim())} className={`flex-1 px-4 py-2.5 rounded-xl bg-${theme}-600 text-white font-bold text-xs shadow-lg hover:shadow-xl transition-all disabled:cursor-not-allowed disabled:opacity-50`}>{busy ? '处理中…' : '通过审批'}</button>
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
  const initialBuildingId: BuildingId = resource?.type === 'DESK' ? 'MAIN' : parseBuilding(resource?.location || '');
  const [formData, setFormData] = useState({
    name: resource?.name || '',
    type: resource?.type || 'ROOM',
    capacity: resource?.capacity ?? 4,
    status: resource?.status || 'AVAILABLE',
    campus: resource?.campus || '',
    features: resource?.features || []
  });
  const [newFeature, setNewFeature] = useState('');
  const [saving, setSaving] = useState(false);
  const [buildingId, setBuildingId] = useState<BuildingId>(initialBuildingId);
  const [floor, setFloor] = useState<number | null>(() => resource?.type === 'DESK' ? null : parseFloor(resource?.location || '', BUILDINGS[initialBuildingId].totalFloors));
  const [locationDetail, setLocationDetail] = useState(() => resource?.type === 'DESK' ? '' : (resource?.location || '')
    .replace(/(?:1|一|2|二)\s*号楼|主楼|配楼/gi, '')
    .replace(/\d{1,2}\s*(?:层|F\b)/i, '')
    .replace(/^[\s·,，\-—/]+|[\s·,，\-—/]+$/g, ''));
  const [deskLocation, setDeskLocation] = useState(resource?.type === 'DESK' ? resource.location : '');
  const [formError, setFormError] = useState('');
  const building = BUILDINGS[buildingId];
  const locationPreview = `${building.name} ${floor ? `${floor}层` : '待选择楼层'}${locationDetail ? ` · ${locationDetail}` : ''}`;

  const toggleFeature = (feature: typeof ROOM_FEATURES[number]) => {
    const enabled = resourceSupportsFeature({ features: formData.features }, feature.id);
    setFormData({
      ...formData,
      features: enabled
        ? formData.features.filter((label: string) => label.trim() && !resourceSupportsFeature({ features: [label] }, feature.id))
        : [...formData.features, feature.label]
    });
    setFormError('');
  };
  const addCustomFeature = () => {
    const label = newFeature.trim();
    if (!label || formData.features.includes(label)) return;
    setFormData({ ...formData, features: [...formData.features, label] });
    setNewFeature('');
  };

  const handleSave = async () => {
    const name = formData.name.trim();
    if (!name) {
      setFormError('请填写资源名称');
      return;
    }
    if (!Number.isInteger(formData.capacity) || formData.capacity < (formData.type === 'ROOM' ? 1 : 0)) {
      setFormError(formData.type === 'ROOM' ? '会议室容量必须为大于 0 的整数' : '工位容量不能小于 0');
      return;
    }
    if (formData.type === 'ROOM' && !floor) {
      setFormError('请选择会议室所在楼层，以便在 3D 图中展示');
      return;
    }
    const location = formData.type === 'ROOM'
      ? `${building.name} ${floor}层${locationDetail.trim() ? ` · ${locationDetail.trim()}` : ''}`
      : deskLocation.trim();
    if (!location) {
      setFormError('请填写工位位置');
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...formData, name, location, campus: formData.campus.trim() || undefined });
    } catch (error: any) {
      setFormError(error?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full max-h-[90dvh] overflow-y-auto shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6">{resource ? '编辑资源' : '新增资源'}</h3>
        <div className="space-y-4">
          <input aria-label="资源名称" value={formData.name} onChange={e => { setFormData({...formData, name: e.target.value}); setFormError(''); }} placeholder="资源名称" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <div className="flex space-x-2">
            <button type="button" aria-pressed={formData.type === 'ROOM'} onClick={() => { setFormData({...formData, type: 'ROOM'}); setFormError(''); }} className={`flex-1 p-3 rounded-xl border ${formData.type === 'ROOM' ? `bg-${theme}-50 border-${theme}-200 text-${theme}-600` : 'bg-gray-50 border-gray-100 text-gray-500'}`}>会议室</button>
            <button type="button" aria-pressed={formData.type === 'DESK'} onClick={() => { setFormData({...formData, type: 'DESK'}); setFormError(''); }} className={`flex-1 p-3 rounded-xl border ${formData.type === 'DESK' ? `bg-${theme}-50 border-${theme}-200 text-${theme}-600` : 'bg-gray-50 border-gray-100 text-gray-500'}`}>工位</button>
          </div>
          <input aria-label="资源容量" type="number" min={formData.type === 'ROOM' ? 1 : 0} value={Number.isNaN(formData.capacity) ? '' : formData.capacity} onChange={e => setFormData({...formData, capacity: parseInt(e.target.value)})} placeholder="容量" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <label className="block">
            <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">所属园区</span>
            <input aria-label="资源所属园区" value={formData.campus} onChange={e => setFormData({ ...formData, campus: e.target.value })} placeholder="如：总部园区（用于审批范围）" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">预约服务状态</span>
            <select aria-label="资源服务状态" value={formData.status} onChange={e => { setFormData({ ...formData, status: e.target.value }); setFormError(''); }} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 text-sm font-bold">
              <option value="AVAILABLE">空闲 · 开放预约</option>
              <option value="OCCUPIED">当前占用 · 允许预约未来空档</option>
              <option value="MAINTENANCE">维护中 · 暂停新预约</option>
              <option value="PENDING">待开放 · 暂停新预约</option>
            </select>
          </label>
          {formData.type === 'ROOM' && <div className="p-3 bg-gray-50 rounded-xl space-y-3">
            <div><p className="text-xs text-gray-600 font-black">会议室设备与功能</p><p className="text-[11px] text-gray-500 mt-1">预订时会同步展示并校验设备要求。</p></div>
            <div className="grid grid-cols-3 gap-2">
              {ROOM_FEATURES.map(feature => {
                const enabled = resourceSupportsFeature({ features: formData.features }, feature.id);
                return <button key={feature.id} type="button" aria-pressed={enabled} onClick={() => toggleFeature(feature)} className={`px-2 py-2 rounded-lg border text-[11px] font-bold ${enabled ? `bg-${theme}-600 text-white border-${theme}-600` : 'bg-white text-gray-500 border-gray-200'}`}>{feature.label}</button>;
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.features.filter((label: string) => !ROOM_FEATURES.some(feature => resourceSupportsFeature({ features: [label] }, feature.id))).map((label: string) => <span key={label} className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-lg text-[11px] font-bold text-gray-600">{label}<button type="button" aria-label={`移除${label}`} onClick={() => setFormData({ ...formData, features: formData.features.filter((item: string) => item !== label) })}><X size={12}/></button></span>)}
            </div>
            <div className="flex gap-2">
              <input aria-label="自定义设备功能" value={newFeature} onChange={e => setNewFeature(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomFeature(); } }} placeholder="其他设备，如电话会议" className="flex-1 min-w-0 p-2.5 bg-white rounded-lg border border-gray-100 text-xs" />
              <button type="button" onClick={addCustomFeature} disabled={!newFeature.trim()} className="px-3 rounded-lg bg-white border border-gray-200 text-xs font-bold disabled:opacity-40">添加</button>
            </div>
          </div>}
          {formData.type === 'ROOM' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">楼栋</span>
                  <select aria-label="资源楼栋" value={buildingId} onChange={e => { setBuildingId(e.target.value as BuildingId); setFloor(null); setFormError(''); }} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100">
                    {Object.values(BUILDINGS).map(item => <option key={item.id} value={item.id}>{item.name} · {item.kind}</option>)}
                  </select>
                </label>
                <label>
                  <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">楼层</span>
                  <select aria-label="资源楼层" value={floor || ''} onChange={e => { setFloor(Number(e.target.value)); setFormError(''); }} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <option value="">请选择楼层</option>
                    {getFloorNumbers(building.totalFloors).reverse().map(item => <option key={item} value={item}>{item} 层</option>)}
                  </select>
                </label>
              </div>
              <input aria-label="位置补充" value={locationDetail} onChange={e => setLocationDetail(e.target.value)} placeholder="位置补充（选填，如：东侧 / 101室）" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
              <p className="px-3 py-2 bg-gray-50 text-[11px] text-gray-500 rounded-xl">3D 联动位置 · {locationPreview}</p>
            </>
          ) : (
            <label className="block">
              <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">工位位置</span>
              <input aria-label="工位位置" value={deskLocation} onChange={e => { setDeskLocation(e.target.value); setFormError(''); }} placeholder="如：A办公区" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
            </label>
          )}
          {formError && <p role="alert" className="text-xs text-rose-600">{formError}</p>}
        </div>
        <div className="flex space-x-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button type="button" onClick={handleSave} disabled={saving} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold disabled:opacity-60`}>{saving ? '保存中…' : '保存'}</button>
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

const WorkflowModal = ({ node, roles, departments, onClose, onSave, theme }: any) => {
  const [formData, setFormData] = useState({
    name: node?.name || '',
    approverRole: node?.approverRole || roles[0]?.id || '',
    departmentIds: node?.departmentIds || [],
    campuses: (node?.campuses || []).join('，')
  });
  const toggleDepartment = (id: string) => setFormData((current: any) => ({
    ...current,
    departmentIds: current.departmentIds.includes(id)
      ? current.departmentIds.filter((item: string) => item !== id)
      : [...current.departmentIds, id]
  }));

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full max-h-[90dvh] overflow-y-auto shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6">{node ? '编辑节点' : '新增审批节点'}</h3>
        <div className="space-y-4">
          <input aria-label="审批节点名称" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="节点名称（如：行政初审）" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <div>
            <label className="text-xs text-gray-500 font-bold ml-1 mb-1 block">审批负责人角色</label>
            <select aria-label="审批负责人角色" value={formData.approverRole} onChange={e => setFormData({...formData, approverRole: e.target.value})} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100">
              {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <fieldset>
            <legend className="text-xs text-gray-500 font-bold ml-1 mb-2">申请部门范围</legend>
            <p className="mb-2 text-[11px] text-gray-500">不选择表示全部部门；选择父部门时包含其子孙部门。</p>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto rounded-xl bg-gray-50 p-3">
              {departments.map((department: Department) => <label key={department.id} className="flex items-center gap-2 text-xs font-bold text-gray-600"><input type="checkbox" checked={formData.departmentIds.includes(department.id)} onChange={() => toggleDepartment(department.id)} />{department.name}</label>)}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">资源园区范围</span>
            <input aria-label="审批资源园区范围" value={formData.campuses} onChange={e => setFormData({ ...formData, campuses: e.target.value })} placeholder="留空表示全部园区；多个园区用逗号分隔" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          </label>
        </div>
        <div className="flex space-x-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button onClick={() => onSave({ ...formData, campuses: formData.campuses.split(/[,，]/).map((item: string) => item.trim()).filter(Boolean) })} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}>保存并发布新版本</button>
        </div>
      </div>
    </div>
  );
};

const ApprovalDelegateModal = ({ users, onClose, onSave, theme }: any) => {
  const inputDateTime = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const [formData, setFormData] = useState({
    delegatorId: users[0]?.id || '',
    delegateId: users[1]?.id || '',
    startsAt: inputDateTime(new Date()),
    endsAt: inputDateTime(new Date(Date.now() + 86400000))
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!formData.delegatorId || !formData.delegateId || formData.delegatorId === formData.delegateId) {
      setError('委托人与代理人必须不同');
      return;
    }
    if (new Date(formData.endsAt) <= new Date(formData.startsAt)) {
      setError('代理结束时间必须晚于开始时间');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...formData,
        startsAt: new Date(formData.startsAt).toISOString(),
        endsAt: new Date(formData.endsAt).toISOString()
      });
    } catch (reason: any) {
      const messages: Record<string, string> = {
        DELEGATION_OVERLAP: '同一委托人的代理时间段不能重叠',
        DELEGATION_EXPIRED: '代理结束时间已过，请重新选择',
        DELEGATION_USER_NOT_FOUND: '委托人或代理人不存在，请刷新后重试'
      };
      setError(messages[reason?.message] || reason?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl">新增代理审批</h3>
        <p className="mt-2 text-xs text-gray-500">代理人仅在有效期内继承委托人的节点权限，不能审批委托人本人的申请。</p>
        <div className="mt-6 space-y-4">
          <label className="block text-xs font-bold text-gray-500">委托人<select aria-label="代理审批委托人" value={formData.delegatorId} onChange={e => setFormData({ ...formData, delegatorId: e.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100">{users.map((user: User) => <option key={user.id} value={user.id}>{user.name} · {user.department}</option>)}</select></label>
          <label className="block text-xs font-bold text-gray-500">代理人<select aria-label="代理审批代理人" value={formData.delegateId} onChange={e => setFormData({ ...formData, delegateId: e.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100">{users.map((user: User) => <option key={user.id} value={user.id}>{user.name} · {user.department}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-gray-500">开始时间<input aria-label="代理开始时间" type="datetime-local" value={formData.startsAt} onChange={e => setFormData({ ...formData, startsAt: e.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100" /></label>
            <label className="text-xs font-bold text-gray-500">结束时间<input aria-label="代理结束时间" type="datetime-local" value={formData.endsAt} onChange={e => setFormData({ ...formData, endsAt: e.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100" /></label>
          </div>
          {error && <p role="alert" className="text-xs font-bold text-rose-600">{error}</p>}
        </div>
        <div className="flex space-x-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button onClick={() => void save()} disabled={saving || users.length < 2} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold disabled:opacity-50`}>{saving ? '保存中…' : '创建代理'}</button>
        </div>
      </div>
    </div>
  );
};

type ResourceFinderCriteria = {
  date: string;
  start: string;
  end: string;
  participants: number;
  requirements: { video: boolean; display: boolean; whiteboard: boolean };
};

const createResourceFinderCriteria = (): ResourceFinderCriteria => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    date: formatDate(tomorrow),
    start: '10:00',
    end: '11:00',
    participants: 2,
    requirements: { video: false, display: false, whiteboard: false }
  };
};

const ResourceFinder = ({ matches, criteria, onCriteriaChange, theme, onBook }: any) => {
  const { date, start, end, participants, requirements } = criteria as ResourceFinderCriteria;
  const startDate = new Date(`${date}T${start}`);
  const endDate = new Date(`${date}T${end}`);
  const validTime = endDate > startDate;
  const updateCriteria = (patch: Partial<ResourceFinderCriteria>) => onCriteriaChange({ ...criteria, ...patch });
  const toggle = (key: keyof ResourceFinderCriteria['requirements']) => updateCriteria({
    requirements: { ...requirements, [key]: !requirements[key] }
  });

  return (
    <section className="studio-panel p-6 space-y-5" aria-label="按条件找会议室">
      <div className="flex items-center justify-between">
        <div><h4 className="font-black text-gray-800">按条件找会议室</h4><p className="text-xs text-gray-500 mt-1">实时排除容量不足、设备不符和时段冲突的会议室</p></div>
        <Search size={20} className={`text-${theme}-600`}/>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="text-xs font-bold text-gray-500">日期<input aria-label="查找日期" type="date" min={formatDate(new Date())} value={date} onChange={e => updateCriteria({ date: e.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-indigo-100"/></label>
        <label className="text-xs font-bold text-gray-500">开始<input aria-label="查找开始时间" type="time" step="1800" min="08:00" max="19:30" value={start} onChange={e => updateCriteria({ start: e.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-indigo-100"/></label>
        <label className="text-xs font-bold text-gray-500">结束<input aria-label="查找结束时间" type="time" step="1800" min="08:30" max="20:00" value={end} onChange={e => updateCriteria({ end: e.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-indigo-100"/></label>
        <label className="text-xs font-bold text-gray-500">人数<input aria-label="查找人数" type="number" min="1" value={participants} onChange={e => updateCriteria({ participants: Math.max(1, parseInt(e.target.value) || 1) })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 ring-indigo-100"/></label>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="设备条件">
        {([['video', '视频会议'], ['display', '投屏显示器'], ['whiteboard', '白板']] as const).map(([key, label]) => (
          <button key={key} aria-pressed={requirements[key]} onClick={() => toggle(key)} className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${requirements[key] ? `bg-${theme}-600 text-white border-${theme}-600` : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>{label}</button>
        ))}
      </div>
      {!validTime ? <p className="text-xs font-bold text-rose-500">结束时间必须晚于开始时间</p> : (
        <div className="space-y-2">
          <p role="status" aria-live="polite" className="text-xs font-black text-gray-500">找到 {matches.length} 间可用会议室，空间导航已同步</p>
          {matches.map((r: Resource) => (
            <div key={r.id} className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100">
              <div className="min-w-0"><p className="font-bold text-sm text-gray-800 truncate">{r.name}</p><p className="text-[11px] text-gray-500 mt-1 truncate">{r.location} · {r.capacity} 人 · {r.features.join('、') || '无特殊设备'}</p></div>
              <button onClick={() => onBook(r, { start: startDate.toISOString(), end: endDate.toISOString(), participants, extras: { isVideoConference: requirements.video, requiredFeatures: [...requirements.video ? ['VIDEO'] : [], ...requirements.display ? ['DISPLAY'] : [], ...requirements.whiteboard ? ['WHITEBOARD'] : []] } })} className={`shrink-0 px-4 py-2 rounded-xl bg-${theme}-600 text-white text-xs font-black`}>按此条件预约</button>
            </div>
          ))}
          {matches.length === 0 && <p className="p-6 text-center text-xs font-bold text-gray-500 border border-dashed rounded-2xl">暂无满足条件的会议室，请调整时间、人数或设备要求</p>}
        </div>
      )}
    </section>
  );
};

const BookingFormModal = ({ resource, theme, initialDate, initialValues, onClose, onConfirm, availableUsers = [], currentUserId, bookings = [] }: any) => {
  const modalRef = useModalA11y(onClose);
  const isRoom = resource.type === 'ROOM';
  const videoSupported = resourceSupportsFeature(resource, 'VIDEO');
  const initialDateObj = initialValues?.start ? new Date(initialValues.start) : initialDate ? new Date(initialDate) : new Date();
  
  const [selectedDate, setSelectedDate] = useState(initialDateObj);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{start: string | null, end: string | null}>({ 
    start: initialValues?.start ? formatTime(new Date(initialValues.start)) : isRoom ? null : '09:00', 
    end: initialValues?.end ? formatTime(new Date(initialValues.end)) : isRoom ? null : '18:00' 
  });
  const [deskEndDate, setDeskEndDate] = useState(initialDateObj);
  
  const [purpose, setPurpose] = useState(initialValues?.purpose || '');
  const [participants, setParticipants] = useState(initialValues?.participants || resource.capacity || 1);
  const [formError, setFormError] = useState<string | null>(null);

  // New state variables for additional requirements
  const [hasLeader, setHasLeader] = useState(initialValues?.extras?.hasLeader || false);
  const [leaderDetails, setLeaderDetails] = useState(initialValues?.extras?.leaderDetails || '');
  const [isVideoConference, setIsVideoConference] = useState(initialValues?.extras?.isVideoConference || false);
  const [requiredFeatures, setRequiredFeatures] = useState<RoomFeature[]>(initialValues?.extras?.requiredFeatures || initialValues?.requiredFeatures || []);
  const [needsTeaService, setNeedsTeaService] = useState(initialValues?.extras?.needsTeaService || false);
  const [attendeeIds, setAttendeeIds] = useState<string[]>(initialValues?.extras?.attendeeIds || []);
  const [repeatFrequency, setRepeatFrequency] = useState<'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY'>(initialValues?.recurrence?.frequency || 'NONE');
  const [repeatCount, setRepeatCount] = useState(initialValues?.recurrence?.count || 4);
  const [longTermEndDate, setLongTermEndDate] = useState(() => initialValues?.seriesEndDate ? new Date(`${initialValues.seriesEndDate}T12:00:00`) : getLongTermMaxEndDate(initialDateObj));
  const isRenewal = !!initialValues?.renewalOfSeriesId;
  const longTermMaxEndDate = getLongTermMaxEndDate(selectedDate);
  const longTermDays = getDailyOccurrenceCount(selectedDate, longTermEndDate);

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

    const requestedFeatures = [...new Set<RoomFeature>([...requiredFeatures, ...(isVideoConference ? ['VIDEO' as const] : [])])];
    const resourceError = validateBookingResource(resource, { startTime: finalStart, endTime: finalEnd, participants, requiredFeatures: requestedFeatures, isVideoConference });
    if (resourceError) {
      setFormError(BOOKING_ERROR_MESSAGES[resourceError]);
      return;
    }

    let recurrence;
    if (repeatFrequency === 'DAILY') {
        if (longTermDays < 1) {
            setFormError('长期预订截止日期不能早于开始日期');
            return;
        }
        if (longTermEndDate > longTermMaxEndDate) {
            setFormError(`单期长期预订最长一个月，请选择 ${formatDate(longTermMaxEndDate)} 或更早的截止日期`);
            return;
        }
        recurrence = { frequency: 'DAILY', count: longTermDays };
    } else if (repeatFrequency !== 'NONE') {
        recurrence = { frequency: repeatFrequency, count: repeatCount };
    }

    onConfirm(resource.id, purpose, finalStart, finalEnd, participants, {
        hasLeader,
        leaderDetails: hasLeader ? leaderDetails : undefined,
        isVideoConference,
        needsTeaService,
        requiredFeatures: requestedFeatures,
        attendeeIds,
        recurrence,
        seriesKind: repeatFrequency === 'DAILY' ? 'LONG_TERM' : undefined,
        seriesEndDate: repeatFrequency === 'DAILY' ? formatDate(longTermEndDate) : undefined,
        renewalOfSeriesId: initialValues?.renewalOfSeriesId,
        rootSeriesId: initialValues?.rootSeriesId
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
            <span>{initialValues?.id ? '修改预约' : isRenewal ? '长期预订续期' : '预约'} {resource.name}</span>
        </h3>
        <div className="mb-5 p-3 rounded-2xl bg-gray-50 border border-gray-100 space-y-2" aria-label="会议室当前配置">
          <div className="flex items-center justify-between gap-3"><span className="text-[11px] font-bold text-gray-500">{resource.location} · 最多 {resource.capacity || 0} 人</span><StatusBadge status={resource.status} theme={theme}/></div>
          <div className="flex flex-wrap gap-1.5">
            {(resource.features || []).map((feature: string) => <span key={feature} className="px-2 py-1 bg-white rounded-lg text-[10px] font-bold text-gray-600 border border-gray-100">{feature}</span>)}
            {!resource.features?.length && <span className="text-[11px] text-gray-500">未配置特殊设备</span>}
          </div>
          {!isResourceAcceptingBookings(resource) && <p role="alert" className="text-[11px] font-bold text-rose-600">当前状态暂停新预约，请返回选择其他会议室。</p>}
        </div>
        
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">申请用途</label>
            <input
              aria-label="申请用途"
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              placeholder="会议主题或办公内容..."
              className="w-full bg-gray-50 p-4 rounded-2xl border-none outline-none font-bold shadow-inner focus:ring-2 ring-indigo-100 transition-all text-sm"
            />
          </div>

          {/* Date Picker - Horizontal Scroll */}
          <div className="space-y-2">
             <div className="flex items-center justify-between">
               <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">{isRenewal ? '续期开始日期（自动衔接）' : '选择日期'}</label>
               <input aria-label="自定义预约日期" type="date" min={formatDate(new Date())} value={formatDate(selectedDate)} disabled={isRenewal} onChange={e => { if (!e.target.value) return; const nextDate = new Date(`${e.target.value}T12:00`); setSelectedDate(nextDate); setLongTermEndDate(getLongTermMaxEndDate(nextDate)); setSelectedTimeRange({ start: null, end: null }); }} className="text-xs font-bold text-gray-500 bg-gray-50 rounded-lg px-2 py-1 outline-none disabled:opacity-60"/>
             </div>
             <div className="flex space-x-3 overflow-x-auto pb-2 custom-scrollbar">
                {dateOptions.map((d) => {
                    const isSelected = formatDate(d) === formatDate(selectedDate);
                    const isToday = formatDate(d) === formatDate(new Date());
                    const dayName = ['日','一','二','三','四','五','六'][d.getDay()];
                    return (
                        <button 
                            key={formatDate(d)}
                            onClick={() => { if (isRenewal) return; setSelectedDate(d); setLongTermEndDate(getLongTermMaxEndDate(d)); setSelectedTimeRange({start:null,end:null}); }}
                            aria-pressed={isSelected}
                            disabled={isRenewal}
                            className={`flex flex-col items-center justify-center w-14 h-20 rounded-2xl border-2 transition-all shrink-0 disabled:cursor-default ${isSelected ? `bg-${theme}-600 border-${theme}-600 text-white shadow-lg scale-105` : 'bg-white border-gray-100 text-gray-500 hover:border-gray-200 hover:bg-gray-50'}`}
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
            <input aria-label="参与人数" type="number" min="1" max={resource.capacity || undefined} value={Number.isNaN(participants) ? '' : participants} onChange={e => setParticipants(parseInt(e.target.value))} className="w-full bg-gray-50 p-4 rounded-2xl border-none outline-none font-bold shadow-inner text-sm" />
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">参会人（可选）</label>
            <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded-2xl">
              {availableUsers.filter((u: User) => u.id !== currentUserId).map((u: User) => <label key={u.id} className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer"><input type="checkbox" checked={attendeeIds.includes(u.id)} onChange={() => setAttendeeIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])} className="accent-indigo-600"/><span>{u.name}<small className="block text-gray-500 font-medium">{u.department}</small></span></label>)}
            </div>
          </div>

          {isRoom && !initialValues?.id && <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">预订方式</label>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="重复频率" value={repeatFrequency} disabled={isRenewal} onChange={e => { const frequency = e.target.value as any; setRepeatFrequency(frequency); setFormError(null); if (frequency === 'DAILY') setLongTermEndDate(getLongTermMaxEndDate(selectedDate)); }} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none disabled:opacity-60"><option value="NONE">单次预约</option><option value="DAILY">长期预订 · 每天</option><option value="WEEKLY">每周重复</option><option value="BIWEEKLY">隔周重复</option></select>
              {repeatFrequency === 'DAILY' ? (
                <input aria-label="长期预订截止日期" type="date" min={formatDate(selectedDate)} max={formatDate(longTermMaxEndDate)} value={formatDate(longTermEndDate)} onChange={e => { if (e.target.value) setLongTermEndDate(new Date(`${e.target.value}T12:00:00`)); setFormError(null); }} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none" />
              ) : (
                <select aria-label="重复次数" value={repeatCount} disabled={repeatFrequency === 'NONE'} onChange={e => setRepeatCount(Number(e.target.value))} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none disabled:opacity-50">{[2, 3, 4, 6, 8, 12].map(n => <option key={n} value={n}>共 {n} 次</option>)}</select>
              )}
            </div>
            {repeatFrequency === 'DAILY' ? (
              <div className={`p-3 rounded-xl bg-${theme}-50 text-[11px] leading-relaxed text-gray-600`}>
                <p><strong>本期 {longTermDays} 天</strong> · {formatDate(selectedDate)} 至 {formatDate(longTermEndDate)}，每天 {selectedTimeRange.start || '--:--'} - {selectedTimeRange.end || '--:--'}。</p>
                <p className="mt-1">单期最长一个日历月；到期可续期，审批通过后衔接使用。逐次检测冲突，冲突日期可跳过。</p>
              </div>
            ) : repeatFrequency !== 'NONE' && <p className="text-[11px] text-gray-500">提交后逐次检测冲突，冲突单次可跳过或改期</p>}
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
                    type="button"
                    aria-label="视频会议"
                    aria-pressed={isVideoConference}
                    disabled={!videoSupported && !isVideoConference}
                    title={!videoSupported ? '当前会议室未配置视频会议设备' : undefined}
                    onClick={() => { const enabled = !isVideoConference; setIsVideoConference(enabled); setRequiredFeatures(prev => enabled ? [...new Set<RoomFeature>([...prev, 'VIDEO'])] : prev.filter(feature => feature !== 'VIDEO')); }}
                    className={`w-10 h-6 rounded-full p-1 transition-all disabled:opacity-40 ${isVideoConference ? `bg-${theme}-600` : 'bg-gray-200'}`}
                >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${isVideoConference ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </button>
             </div>
             {!videoSupported && <p className="-mt-2 text-[11px] text-gray-500">当前会议室未配置视频会议设备。</p>}

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
            <p role="alert" className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">{formError}</p>
          )}

          <div className="flex space-x-3 mt-6 pt-4 border-t border-gray-100">
            <button onClick={onClose} className="flex-1 py-3 rounded-2xl bg-gray-50 font-bold text-gray-500 hover:bg-gray-100 transition-colors">取消</button>
            <button 
              onClick={handleSubmit} 
              className={`flex-1 py-4 bg-${theme}-600 text-white rounded-2xl font-black shadow-lg shadow-${theme}-100 hover:scale-[1.02] active:scale-95 transition-all`}
            >
              {initialValues?.id ? '保存修改' : isRenewal ? '提交续期审批' : '确认预约'}
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
  const isLongTerm = plan.extras?.seriesKind === 'LONG_TERM';
  return <div ref={modalRef} role="dialog" aria-modal="true" aria-label={isLongTerm ? '长期预订冲突处理' : '周期会议冲突处理'} className="fixed inset-0 z-[1100] bg-black/60 flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <h3 className="text-xl font-black text-gray-800">{isLongTerm ? '长期预订冲突处理' : '周期会议冲突处理'}</h3>
      <p className="text-xs text-gray-500 mt-2">共 {plan.occurrences.length} 次，{unresolved.length} 次待处理。可逐次跳过{isLongTerm ? '，长期预订改期请调整本期日期后重新提交' : '或自动改期'}。</p>
      <div className="space-y-3 my-6">
        {plan.occurrences.map((o: any, index: number) => <div key={`${o.start}-${index}`} className={`p-4 rounded-2xl border ${o.skip ? 'bg-gray-50 border-gray-100 opacity-50' : o.conflicts?.length ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div><p className="text-sm font-black text-gray-700">第 {index + 1} 次 · {toLocalDateTimeString(o.start)} - {toLocalTimeString(o.end)}</p><p className="text-[11px] text-gray-500 mt-1">{o.skip ? '已跳过' : o.conflicts?.length ? `与 ${o.conflicts.length} 项预约冲突` : '时段可用'}</p></div>
            {!o.skip && o.conflicts?.length > 0 && <div className="flex gap-2"><button onClick={() => onSkip(index)} className="px-3 py-2 rounded-xl bg-white text-gray-600 text-xs font-bold border">跳过此次</button>{!isLongTerm && <button onClick={() => onReschedule(index)} className={`px-3 py-2 rounded-xl bg-${theme}-600 text-white text-xs font-bold`}>自动改期</button>}</div>}
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
                 <div className="pt-2 border-t border-gray-100"><span className="block mb-2">设备与功能</span><div className="flex flex-wrap gap-1.5">{(data.features || []).map((feature: string) => <span key={feature} className="px-2 py-1 bg-white border border-gray-100 rounded-lg text-[11px] font-bold">{feature}</span>)}{!data.features?.length && <span className="text-xs text-gray-500">未配置特殊设备</span>}</div></div>
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
  const [view, setView] = useState<AppView>('DASHBOARD');
  const [scheduleRange, setScheduleRange] = useState<ScheduleRange>('TODAY');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState('indigo');
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workflow, setWorkflow] = useState<ApprovalNode[]>([]);
  const [approvalDelegates, setApprovalDelegates] = useState<ApprovalDelegate[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const preferencesSnapshotRef = useRef('');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    for (const key of ['SMART_OFFICE_DATA_V35', 'SMART_OFFICE_THEME', 'SMART_OFFICE_NOTIFICATIONS', 'SMART_OFFICE_REMINDERS']) {
      localStorage.removeItem(key);
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.actor) setCurrentUser(data.actor); })
      .finally(() => setAuthLoading(false));
  }, []);

  const applyWorkspace = (data: any) => {
    if (!data) return;
    setRoles(data.roles || []);
    setUsers(data.users || []);
    setResources(data.resources || []);
    setBookings(migrateBookings(data.bookings || []));
    setDepartments(data.departments || []);
    setWorkflow(data.workflow || []);
    setApprovalDelegates(data.approvalDelegates || []);
    setWorkOrders(data.workOrders || []);
  };

  const loadWorkspace = async () => {
    try {
      const res = await fetch('/api/workspace');
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) setCurrentUser(null);
        throw new Error(data.error || String(res.status));
      }
      applyWorkspace(data);
      setIsOnline(true);
      setSaveStatus('saved');
      setWorkspaceLoaded(true);
      return data;
    } catch {
      setIsOnline(false);
      setSaveStatus('error');
      return null;
    }
  };

  const apiRequest = async (path: string, method: string, body: any = {}) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(path, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.detail || result.error || '操作失败，请刷新后重试。');
      if (result.workspace) applyWorkspace(result.workspace);
      setSaveStatus('saved');
      setIsOnline(true);
      return result;
    } catch (error) {
      setSaveStatus('error');
      throw error;
    }
  };

  useEffect(() => {
    setWorkspaceLoaded(false);
    setPreferencesLoaded(false);
    if (currentUser) void loadWorkspace();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser) return;
    fetch('/api/preferences')
      .then(res => res.ok ? res.json() : Promise.reject(new Error(String(res.status))))
      .then(preferences => {
        setTheme(preferences.theme);
        setSidebarCollapsed(preferences.sidebarCollapsed);
        preferencesSnapshotRef.current = JSON.stringify({ theme: preferences.theme, sidebarCollapsed: preferences.sidebarCollapsed });
        setPreferencesLoaded(true);
      })
      .catch(() => setSaveStatus('error'));
  }, [currentUser?.id]);

  useEffect(() => {
    if (!preferencesLoaded || !currentUser) return;
    const preferences = { theme, sidebarCollapsed };
    const serialized = JSON.stringify(preferences);
    if (serialized === preferencesSnapshotRef.current) return;
    const timer = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        const res = await fetch('/api/preferences', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: serialized
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || String(res.status));
        preferencesSnapshotRef.current = JSON.stringify(result);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [preferencesLoaded, currentUser?.id, theme, sidebarCollapsed]);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [notificationActionError, setNotificationActionError] = useState('');
  useEffect(() => { setShowNotificationPanel(false); }, [view]);
  const [searchQuery, setSearchQuery] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState<'ALL' | ResourceType>('ALL');
  const [resourceStatusFilter, setResourceStatusFilter] = useState<'ALL' | ResourceStatus>('ALL');
  const [resourceBuildingFilter, setResourceBuildingFilter] = useState<'ALL' | BuildingId>('ALL');
  const [resourceMinCapacity, setResourceMinCapacity] = useState(0);
  const [reportRange, setReportRange] = useState<'7' | '30' | '90' | 'ALL'>('30');
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [spatialFocus, setSpatialFocus] = useState<{ location: string; token: number | string } | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [editingWorkflowNode, setEditingWorkflowNode] = useState<ApprovalNode | null>(null);
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [viewDetail, setViewDetail] = useState<{ type: 'USER' | 'RESOURCE', data: any } | null>(null);
  const [showAgent, setShowAgent] = useState(false);
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
  const [resourceFinderCriteria, setResourceFinderCriteria] = useState<ResourceFinderCriteria>(createResourceFinderCriteria);
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
  const [pendingApprovalActions, setPendingApprovalActions] = useState<Record<string, boolean>>({});
  const [approvalActionErrors, setApprovalActionErrors] = useState<Record<string, string>>({});
  const approvalActionLocks = useRef(new Set<string>());
  const ITEMS_PER_PAGE = 5;

  // Computed days for dashboard views
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000)), []);
  const monthDays = useMemo(() => Array.from({ length: 30 }, (_, i) => new Date(Date.now() + i * 86400000)), []);

  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    if (currentUser) void fetch('/api/notifications', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] })
    }).catch(() => {});
  };

  const markAllNotificationsRead = async () => {
    if (!currentUser || isMarkingAllRead) return;
    const ids = notifications.filter(n => !n.isRead && (n.userId === currentUser.id || n.userId === 'sys')).map(n => n.id);
    if (!ids.length) return;
    setIsMarkingAllRead(true);
    setNotificationActionError('');
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (!res.ok) throw new Error(String(res.status));
      setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, isRead: true } : n));
    } catch {
      setNotificationActionError('全部已读保存失败，请检查连接后重试。');
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const addNotification = (title: string, content: string, type: 'INFO' | 'SUCCESS' | 'WARNING' = 'INFO', userId?: string, id?: string) => {
    const newNotif: Notification = { id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, userId: userId || currentUser?.id || 'sys', title, content, timestamp: new Date().toISOString(), isRead: false, type };
    if (newNotif.userId === currentUser?.id || newNotif.userId === 'sys') setNotifications(prev => prev.some(n => n.id === newNotif.id) ? prev : [newNotif, ...prev].slice(0, 50));
  };

  useEffect(() => {
    setShowNotificationPanel(false);
    setNotificationActionError('');
    if (!currentUser) return;
    fetch('/api/notifications')
      .then(res => res.ok ? res.json() : Promise.reject(new Error(String(res.status))))
      .then(data => setNotifications(data.notifications || []))
      .catch(() => {});
  }, [currentUser?.id]);

  const myNotifications = currentUser ? notifications.filter(n => n.userId === currentUser.id || n.userId === 'sys') : notifications;
  const unreadCount = myNotifications.filter(n => !n.isRead).length;
  const approvalGroups = currentUser ? getApprovalGroups(bookings, workflow, currentUser, {
    users, resources, departments, delegates: approvalDelegates
  }) : [];
  const pendingCount = approvalGroups.length;
  const isApprovalActionPending = Object.keys(pendingApprovalActions).length > 0;
  const canAccessApproval = !!currentUser && (
    approvalGroups.length > 0
    || workflow.some(node => currentUser.role.includes(node.approverRole))
    || approvalDelegates.some(item => item.delegateId === currentUser.id && Date.parse(item.startsAt) <= Date.now() && Date.now() < Date.parse(item.endsAt))
  );
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

  const nextBooking = useMemo(() => {
    if (!currentUser) return null;
    const now = Date.now();
    return bookings
      .filter(b => b.status === 'APPROVED' && new Date(b.endTime).getTime() >= now && (b.userId === currentUser.id || (b.attendeeIds || []).includes(currentUser.id)))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0] || null;
  }, [bookings, currentUser]);
  const nextBookingResource = nextBooking ? resources.find(r => r.id === nextBooking.resourceId) : null;
  const activeSchedule = SCHEDULE_RANGES.find(range => range.id === scheduleRange)!;

  const openScheduleDay = (resourceId: string | null, date: Date) => {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);
    setDayDetail({
      resource: resourceId ? resources.find(r => r.id === resourceId) : { name: '全公司资源概览' },
      date,
      bookings: bookings.filter(b => b.status === 'APPROVED' && (!resourceId || b.resourceId === resourceId) && new Date(b.startTime) < dayEnd && new Date(b.endTime) > dayStart)
    });
  };

  const handleScheduleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = SCHEDULE_RANGES.findIndex(range => range.id === scheduleRange);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SCHEDULE_RANGES.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + SCHEDULE_RANGES.length) % SCHEDULE_RANGES.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = SCHEDULE_RANGES.length - 1;
    else return;
    event.preventDefault();
    const nextRange = SCHEDULE_RANGES[nextIndex].id;
    setScheduleRange(nextRange);
    document.getElementById(`schedule-tab-${nextRange}`)?.focus();
  };

  const reportData = useMemo(() => {
    const now = Date.now();
    const bookingEnds = bookings.map(b => new Date(b.endedEarlyAt || b.endTime).getTime()).filter(Number.isFinite);
    const end = new Date(reportRange === 'ALL' && bookingEnds.length ? Math.max(now, ...bookingEnds) : now);
    const earliest = bookings.length ? Math.min(...bookings.map(b => new Date(b.startTime).getTime()).filter(Number.isFinite)) : end.getTime();
    const start = new Date(reportRange === 'ALL' ? earliest : end.getTime() - (Number(reportRange) - 1) * 86400000);
    start.setHours(0, 0, 0, 0);
    return generateReport(bookings, resources, users, { start, end });
  }, [bookings, resources, users, reportRange]);

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
  const filteredResources = useMemo(() => filterResources(resources, searchQuery, {
    type: resourceTypeFilter,
    status: resourceStatusFilter,
    minCapacity: resourceMinCapacity
  }).filter(resource => resourceBuildingFilter === 'ALL' || parseBuilding(resource.location) === resourceBuildingFilter), [resources, searchQuery, resourceTypeFilter, resourceStatusFilter, resourceMinCapacity, resourceBuildingFilter]);
  const resourceFinderResults = useMemo(() => findAvailableRooms(filteredResources, bookings, {
    startTime: `${resourceFinderCriteria.date}T${resourceFinderCriteria.start}`,
    endTime: `${resourceFinderCriteria.date}T${resourceFinderCriteria.end}`,
    participants: resourceFinderCriteria.participants,
    requiredFeatures: [
      ...resourceFinderCriteria.requirements.video ? ['VIDEO' as const] : [],
      ...resourceFinderCriteria.requirements.display ? ['DISPLAY' as const] : [],
      ...resourceFinderCriteria.requirements.whiteboard ? ['WHITEBOARD' as const] : []
    ]
  }), [filteredResources, bookings, resourceFinderCriteria]);
  const finderStartDate = new Date(`${resourceFinderCriteria.date}T${resourceFinderCriteria.start}`);
  const finderEndDate = new Date(`${resourceFinderCriteria.date}T${resourceFinderCriteria.end}`);
  const finderFeatureLabels = [
    resourceFinderCriteria.requirements.video && '视频会议',
    resourceFinderCriteria.requirements.display && '投屏显示器',
    resourceFinderCriteria.requirements.whiteboard && '白板'
  ].filter(Boolean).join('、');
  const resourceFinderContext = `${finderEndDate > finderStartDate ? '' : '时间条件无效 · '}${resourceFinderCriteria.date} ${resourceFinderCriteria.start}–${resourceFinderCriteria.end} · ${resourceFinderCriteria.participants} 人${finderFeatureLabels ? ` · ${finderFeatureLabels}` : ''}`;
  const resourceFinderFocus = useMemo(() => {
    const firstMatch = resourceFinderResults[0];
    if (!firstMatch) return null;
    return {
      location: firstMatch.location,
      token: `${JSON.stringify(resourceFinderCriteria)}:${firstMatch.id}`
    };
  }, [resourceFinderResults, resourceFinderCriteria]);
  const spatialResources = showResourceFinder ? resourceFinderResults : filteredResources;
  const activeSpatialFocus = showResourceFinder ? resourceFinderFocus : spatialFocus;
  const hasResourceFilters = !!searchQuery.trim() || resourceTypeFilter !== 'ALL' || resourceStatusFilter !== 'ALL' || resourceBuildingFilter !== 'ALL' || resourceMinCapacity > 0;
  const resetResourceFilters = () => {
    setSearchQuery('');
    setResourceTypeFilter('ALL');
    setResourceStatusFilter('ALL');
    setResourceBuildingFilter('ALL');
    setResourceMinCapacity(0);
  };

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

  const handleSaveResource = async (data: any) => {
    if (!isOnline) throw new Error('预约服务未连接，暂时无法保存会议室配置。');
    const resourceId = editingResource?.id || `r-${Date.now()}`;
    const payload: Resource = { ...editingResource, ...data, id: resourceId };
    let res: Response;
    try {
      res = await fetch(editingResource ? `/api/resources/${editingResource.id}` : '/api/resources', {
        method: editingResource ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: payload })
      });
    } catch {
      throw new Error('无法连接预约服务，配置未保存，请稍后重试。');
    }
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      const impactCount = Array.isArray(result.conflicts) ? result.conflicts.length : 0;
      const messages: Record<string, string> = {
        ACTIVE_BOOKINGS_REQUIRE_REVIEW: `当前有 ${impactCount} 条未结束的有效预约，请先取消或改期后再切换维护状态。`,
        CAPACITY_EXCEEDED: `有 ${impactCount} 条有效预约超过新容量，请先调整相关预约。`,
        REQUIRED_FEATURE_UNAVAILABLE: `有 ${impactCount} 条有效预约仍依赖即将移除的设备，请先调整相关预约。`,
        INVALID_RESOURCE: '会议室配置不完整，请检查名称、容量、状态和设备信息。'
      };
      throw new Error(messages[result.error] || '保存失败，请刷新后重试。');
    }
    const saved = result.resource || payload;
    if (result.workspace) applyWorkspace(result.workspace);
    else setResources(prev => editingResource ? prev.map(resource => resource.id === editingResource.id ? saved : resource) : [...prev, saved]);
    if (saved.type === 'ROOM') setSpatialFocus({ location: saved.location, token: Date.now() });
    setShowResourceModal(false);
    setEditingResource(null);
    addNotification('配置已同步', saved.type === 'ROOM' ? `会议室设备、容量与服务状态已同步至预约服务，3D 视图已定位至${saved.location}。` : '资源配置已同步至预约服务。', 'SUCCESS');
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
      recurrenceIndex: o.occurrenceIndex ?? index,
      seriesKind: plan.extras.seriesKind,
      seriesEndDate: plan.extras.seriesEndDate,
      renewalOfSeriesId: plan.extras.renewalOfSeriesId,
      rootSeriesId: plan.extras.rootSeriesId
    }));
    if (!isOnline) {
      addNotification('预约未保存', '预约服务未连接，请恢复连接后再提交。', 'WARNING');
      return;
    }
    try {
      const res = await fetch('/api/bookings/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookings: newBookings }) });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        if (result.workspace) applyWorkspace(result.workspace);
      }
      if (!res.ok) {
        if (result.error === 'CONFLICT') {
          const conflictsByIndex = new Map((result.conflicts || []).map((c: any) => [c.index, c.conflicts]));
          setRecurringPlan({ ...plan, occurrences: occurrences.map((o, index) => ({ ...o, conflicts: conflictsByIndex.get(index) || [] })) });
        } else {
          const messages: Record<string, string> = {
            ...BOOKING_ERROR_MESSAGES,
            LONG_TERM_LIMIT_EXCEEDED: '单期长期预订不能超过一个日历月，请缩短截止日期。',
            RENEWAL_EXISTS: '本期已有审批中或已核准的续期，请勿重复提交。',
            INVALID_RENEWAL_START: '续期必须晚于当前周期，请重新发起。',
            INVALID_RENEWAL: '续期信息已变化，请重新打开续期表单。',
            INVALID_LONG_TERM_SERIES: '长期预订数据不完整，请重新提交。'
          };
          addNotification('无法提交系列预约', messages[result.error] || '预约信息未通过校验，请调整后重试。', 'WARNING');
        }
        return;
      }
    } catch {
      addNotification('预约未保存', '无法连接预约服务，请检查网络后重试。', 'WARNING');
      return;
    }
    setRecurringPlan(null);
    setShowBookingModal(false);
    setBookingPrefill(null);
    const isLongTerm = plan.extras.seriesKind === 'LONG_TERM';
    const isRenewal = !!plan.extras.renewalOfSeriesId;
    addNotification(isRenewal ? '续期申请已提交' : isLongTerm ? '长期预订已创建' : '周期会议已创建', `已创建 ${newBookings.length} 次「${plan.purpose}」预约${isLongTerm ? `，本期至 ${plan.extras.seriesEndDate}` : ''}。`, 'SUCCESS');
    (plan.extras?.attendeeIds || []).forEach((id: string) => addNotification(isLongTerm ? '长期会议邀请' : '周期会议邀请', `${currentUser.name} 邀请您参加 ${newBookings.length} 次「${plan.purpose}」。`, 'INFO', id));
    const firstRole = workflow[0]?.approverRole;
    if (firstRole) users.filter(u => u.role.includes(firstRole)).forEach(u => addNotification(isRenewal ? '长期预订续期待审批' : isLongTerm ? '长期预订待审批' : '周期会议待审批', `${currentUser.name} 提交了 ${newBookings.length} 次「${plan.purpose}」。`, 'INFO', u.id));
  };

  const prepareRecurringBooking = (resource: Resource, purpose: string, start: Date, end: Date, participants: number | undefined, extras: any, latestBookings: Booking[]) => {
    const intervalDays = extras.recurrence.frequency === 'DAILY' ? 1 : extras.recurrence.frequency === 'BIWEEKLY' ? 14 : 7;
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
    const resourceError = validateBookingResource(resource, { startTime: start.toISOString(), endTime: end.toISOString(), participants, requiredFeatures: extras?.requiredFeatures, isVideoConference: extras?.isVideoConference });
    if (resourceError) {
      addNotification('无法提交预约', BOOKING_ERROR_MESSAGES[resourceError], 'WARNING');
      return;
    }

    const latestBookings = bookings.filter(b => b.id !== editingBooking?.id);

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

    if (!isOnline) {
      addNotification('预约未保存', '预约服务未连接，请恢复连接后再提交。', 'WARNING');
      return;
    }
    try {
      const res = await fetch(editingBooking ? `/api/bookings/${editingBooking.id}` : '/api/bookings', {
        method: editingBooking ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking: newBooking })
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        if (result.workspace) applyWorkspace(result.workspace);
      }
      if (!res.ok) {
        if (result.error === 'CONFLICT') openConflict('CONFLICT');
        else addNotification('预约未保存', BOOKING_ERROR_MESSAGES[result.error] || '预约服务暂时不可用，请稍后重试。', 'WARNING');
        return;
      }
    } catch {
      addNotification('预约未保存', '无法连接预约服务，请检查网络后重试。', 'WARNING');
      return;
    }

    setShowBookingModal(false);
    setCalendarDateForBooking(null);
    setBookingPrefill(null);
    setEditingBooking(null);
    addNotification(editingBooking ? "预约已修改" : "预约申请已提交", editingBooking ? `资源 ${resource.name} 的预约已更新，并重新进入审批流程。` : `资源 ${resource.name} 的预约已进入审批流程。`, "SUCCESS");
    (extras?.attendeeIds || []).filter((id: string) => id !== currentUser.id).forEach((id: string) => addNotification('会议邀请', `${currentUser.name} 邀请您参加「${purpose}」，时间：${toLocalDateTimeString(newBooking.startTime)}。`, 'INFO', id));
    const firstRole = workflow[0]?.approverRole;
    if (firstRole) users.filter(u => u.id !== currentUser.id && u.role.includes(firstRole)).forEach(u => addNotification('新预约待审批', `${currentUser.name} 提交了「${purpose}」，资源：${resource.name}，时间：${toLocalDateTimeString(newBooking.startTime)}。`, 'INFO', u.id));
  };

  const handleRenewLongTerm = (booking: Booking) => {
    if (!currentUser || booking.userId !== currentUser.id || booking.seriesKind !== 'LONG_TERM' || !booking.seriesId) return;
    const resource = resources.find(item => item.id === booking.resourceId);
    if (!resource) return;
    if (!isResourceAcceptingBookings(resource)) {
      addNotification('暂不能续期', '会议室当前维护或待开放，请恢复预约服务后再续期。', 'WARNING');
      return;
    }
    if (bookings.some(item => item.renewalOfSeriesId === booking.seriesId && isActiveBooking(item))) {
      addNotification('续期已存在', '本期已有审批中或已核准的续期，无需重复提交。', 'INFO');
      return;
    }
    const seriesBookings = bookings.filter(item => item.seriesId === booking.seriesId);
    if (seriesBookings.some(item => item.status === 'PENDING')) {
      addNotification('暂不能续期', '请等待当前长期预订完成审批后再申请续期。', 'WARNING');
      return;
    }
    const periodEnd = booking.seriesEndDate || formatDate(new Date(Math.max(...seriesBookings.map(item => new Date(item.startTime).getTime()))));
    const nextDate = new Date(`${periodEnd}T12:00:00`);
    nextDate.setDate(nextDate.getDate() + 1);
    const originalStart = new Date(booking.startTime);
    const originalEnd = new Date(booking.endTime);
    const nextStart = new Date(nextDate);
    nextStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
    const nextEnd = new Date(nextDate);
    nextEnd.setHours(originalEnd.getHours(), originalEnd.getMinutes(), 0, 0);
    const seriesEndDate = formatDate(getLongTermMaxEndDate(nextStart));
    setEditingBooking(null);
    setSelectedResource(resource);
    setCalendarDateForBooking(null);
    setBookingPrefill({
      purpose: booking.purpose,
      start: nextStart.toISOString(),
      end: nextEnd.toISOString(),
      participants: booking.participants,
      recurrence: { frequency: 'DAILY', count: getDailyOccurrenceCount(nextStart, new Date(`${seriesEndDate}T12:00:00`)) },
      seriesEndDate,
      renewalOfSeriesId: booking.seriesId,
      rootSeriesId: booking.rootSeriesId || booking.seriesId,
      extras: {
        hasLeader: booking.hasLeader,
        leaderDetails: booking.leaderDetails,
        isVideoConference: booking.isVideoConference,
        needsTeaService: booking.needsTeaService,
        requiredFeatures: booking.requiredFeatures || [],
        attendeeIds: booking.attendeeIds || []
      }
    });
    setShowBookingModal(true);
  };

  const handleCancelBooking = async (id: string) => {
    if (!confirm("确定要撤销此项预约申请吗？撤销后该时段资源将立即释放。")) return;
    try {
      await handleAgentAction({ type: 'PROPOSE_CANCEL', bookingId: id, summary: '取消预约' });
    } catch {}
  };

  const handleCheckIn = async (id: string) => {
    try {
      await handleAgentAction({ type: 'PROPOSE_CHECK_IN', bookingId: id, summary: '会议签到' });
      return true;
    } catch {
      return false;
    }
  };

  const handleEndEarly = async (id: string) => {
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(id)}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '当前不可提前结束');
      if (result.workspace) applyWorkspace(result.workspace);
      addNotification('会议已提前结束', result.message || '剩余时段已释放。', 'SUCCESS');
    } catch (err: any) {
      addNotification('操作未完成', err?.message || '请刷新后重试。', 'WARNING');
    }
  };

  const handleCompleteWorkOrder = async (id: string) => {
    try {
      await handleAgentAction({ type: 'PROPOSE_WORK_ORDER', workOrderId: id, summary: '完成服务工单' });
    } catch {}
  };

  const runApprovalAction = async (key: string, booking: Booking, targets: Booking[], decision: 'APPROVE' | 'REJECT', comment?: string) => {
    if (approvalActionLocks.current.size > 0) return;
    approvalActionLocks.current.add(key);
    setPendingApprovalActions(prev => ({ ...prev, [key]: true }));
    setApprovalActionErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      await handleAgentAction({
        type: 'PROPOSE_APPROVAL',
        bookingId: booking.id,
        bookingIds: targets.map(item => item.id),
        decision,
        comment,
        summary: `${decision === 'REJECT' ? '驳回' : '通过'}「${booking.purpose}」`
      });
      setSelectedApprovalIds(prev => key === 'BULK' ? [] : prev.filter(id => id !== booking.id));
    } catch (err: any) {
      setApprovalActionErrors(prev => ({ ...prev, [key]: err?.message || '审批未完成，请刷新后重试。' }));
    } finally {
      approvalActionLocks.current.delete(key);
      setPendingApprovalActions(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleApprove = (booking: Booking, comment?: string) => {
    const targets = booking.seriesKind === 'LONG_TERM' && booking.seriesId
      ? bookings.filter(item => item.seriesId === booking.seriesId && item.status === 'PENDING' && item.currentNodeIndex === booking.currentNodeIndex)
      : [booking];
    return runApprovalAction(booking.id, booking, targets, 'APPROVE', comment);
  };

  const handleBulkApprove = () => {
    const selected = approvalGroups.filter(group => selectedApprovalIds.includes(group.booking.id));
    if (!selected.length) return;
    const targets = selected.flatMap(group => group.seriesBookings);
    return runApprovalAction('BULK', selected[0].booking, targets, 'APPROVE', '批量通过');
  };

  const handleReject = (booking: Booking, comment: string) => {
    const targets = booking.seriesKind === 'LONG_TERM' && booking.seriesId
      ? bookings.filter(item => item.seriesId === booking.seriesId && item.status === 'PENDING' && item.currentNodeIndex === booking.currentNodeIndex)
      : [booking];
    return runApprovalAction(booking.id, booking, targets, 'REJECT', comment);
  };

  // --- Agent Actions ---
  const handleAgentAction = async (action: AgentAction) => {
    if (action.type === 'PROPOSE_BOOKING' && action.draft?.resourceId) {
      const resource = resources.find(r => r.id === action.draft!.resourceId);
      if (!resource) {
        const message = '提案中的资源已不存在，请重新发起预订。';
        addNotification('资源已变更', message, 'WARNING');
        throw new Error(message);
      }
      const draftError = validateBookingDraft(action.draft, resources, bookings);
      if (draftError) {
        addNotification('草案需要修订', draftError, 'WARNING');
        throw new Error(draftError);
      }
      setEditingBooking(null);
      setCalendarDateForBooking(null);
      setSelectedResource(resource);
      setBookingPrefill({
        purpose: action.draft.purpose,
        start: action.draft.startTime,
        end: action.draft.endTime,
        participants: action.draft.participants,
        recurrence: action.draft.recurrence,
        extras: {
          hasLeader: Boolean(action.draft.hasLeader),
          leaderDetails: action.draft.leaderDetails || '',
          isVideoConference: Boolean(action.draft.isVideoConference),
          requiredFeatures: action.draft.requiredFeatures || [],
          needsTeaService: Boolean(action.draft.needsTeaService),
          attendeeIds: action.draft.attendeeIds || []
        }
      });
      setShowBookingModal(true);
      return;
    }

    if (action.type === 'NAVIGATE' && action.view) {
      setView(action.view as any);
      return;
    }

    if (['PROPOSE_CANCEL', 'PROPOSE_APPROVAL', 'PROPOSE_CHECK_IN', 'PROPOSE_WORK_ORDER'].includes(action.type)) {
      try {
        const res = await fetch('/api/agent/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.detail || result.error || '操作失败');
        if (result.workspace) applyWorkspace(result.workspace);
        if (result.notifications) setNotifications(result.notifications);
        addNotification('操作成功', result.message || '待办已处理。', 'SUCCESS');
      } catch (err: any) {
        addNotification('操作未完成', err?.message || '请刷新后重试。', 'WARNING');
        throw err;
      }
    }
  };

  const adminError = (error: any) => {
    const code = error?.message || '';
    const messages: Record<string, string> = {
      DEPARTMENT_HAS_CHILDREN: '请先删除或移动子部门。',
      DEPARTMENT_HAS_USERS: '该部门仍有成员，请先调整成员部门。',
      USER_HAS_ACTIVE_BOOKINGS: '该成员仍有有效预约，请先取消或改期。',
      CANNOT_DELETE_SELF: '不能注销当前登录成员。',
      USER_HAS_DELEGATIONS: '该成员仍有关联代理，请先撤销代理关系。',
      DEPARTMENT_USED_BY_WORKFLOW: '该部门仍被当前或历史审批流程引用，不能删除。',
      DELEGATION_OVERLAP: '同一委托人的代理时间段不能重叠。',
      DUPLICATE_EMAIL: '电子邮箱已存在，请检查后重试。',
      DEPARTMENT_NOT_FOUND: '所选部门不存在，请刷新后重试。',
      INVALID_USER_ROLE: '请选择有效角色。'
    };
    addNotification('操作未完成', messages[code] || code || '请刷新后重试。', 'WARNING');
  };

  const handleSaveDepartment = async (data: { name: string, parentId?: string }) => {
    try {
      const department = { ...editingDepartment, ...data, parentId: editingDepartment ? editingDepartment.parentId : data.parentId, id: editingDepartment?.id || `dpt-${Date.now()}` };
      await apiRequest(editingDepartment ? `/api/departments/${editingDepartment.id}` : '/api/departments', editingDepartment ? 'PUT' : 'POST', { department });
      addNotification(editingDepartment ? '部门更新成功' : '部门创建成功', `已保存部门 ${data.name}。`, 'SUCCESS');
      setShowDepartmentModal(false);
      setEditingDepartment(null);
      setDepartmentParentId(null);
    } catch (error) { adminError(error); }
  };

  const handleDeleteDepartment = async (id: string) => {
    if (!confirm('确定要删除该部门吗？此操作无法撤销。')) return;
    try {
      await apiRequest(`/api/departments/${id}`, 'DELETE');
      addNotification('删除成功', '部门已移除。', 'SUCCESS');
    } catch (error) { adminError(error); }
  };

  const handleSaveUser = async (data: any) => {
    try {
      const user = { ...editingUser, ...data, id: editingUser?.id || `u-${Date.now()}` };
      await apiRequest(editingUser ? `/api/users/${editingUser.id}` : '/api/users', editingUser ? 'PUT' : 'POST', { user });
      setShowUserModal(false);
      setEditingUser(null);
      addNotification('操作成功', '成员信息已更新。', 'SUCCESS');
    } catch (error) { adminError(error); }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm('确定注销该成员吗？')) return;
    try {
      await apiRequest(`/api/users/${id}`, 'DELETE');
      addNotification('成员已注销', '成员信息已从组织目录移除。', 'SUCCESS');
    } catch (error) { adminError(error); }
  };

  const handleSaveRole = async (data: any) => {
    try {
      const role = { ...editingRole, ...data, id: editingRole?.id || `rl-${Date.now()}` };
      await apiRequest(editingRole ? `/api/roles/${editingRole.id}` : '/api/roles', editingRole ? 'PUT' : 'POST', { role });
      setShowRoleModal(false);
      setEditingRole(null);
      addNotification('操作成功', '角色集已更新。', 'SUCCESS');
    } catch (error) { adminError(error); }
  };

  const handleSaveWorkflow = async (next: ApprovalNode[], successMessage = '审批链路配置已生效。') => {
    try {
      await apiRequest('/api/workflow', 'PUT', { workflow: next });
      setShowWorkflowModal(false);
      setEditingWorkflowNode(null);
      addNotification('流程已更新', successMessage, 'SUCCESS');
    } catch (error) { adminError(error); }
  };

  const handleSaveDelegate = async (delegate: Partial<ApprovalDelegate>) => {
    await apiRequest('/api/approval-delegates', 'POST', { delegate });
    setShowDelegateModal(false);
    addNotification('代理已创建', '代理人可在有效期内处理委托人权限范围内的申请。', 'SUCCESS');
  };

  const handleDeleteDelegate = async (id: string) => {
    if (!confirm('确定撤销这条代理关系吗？撤销后立即失效。')) return;
    try {
      await apiRequest(`/api/approval-delegates/${id}`, 'DELETE');
      addNotification('代理已撤销', '对应审批权限已立即收回。', 'SUCCESS');
    } catch (error) { adminError(error); }
  };

  const loadAuditEvents = async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const res = await fetch('/api/audit?limit=200');
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || '审计记录读取失败');
      setAuditEvents(result.events || []);
    } catch (error: any) {
      setAuditError(error?.message || '审计记录读取失败，请稍后重试。');
    } finally {
      setAuditLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (!res.ok) throw new Error(String(res.status));
      setShowMobileMenu(false);
      setShowAgent(false);
      setWorkspaceLoaded(false);
      setPreferencesLoaded(false);
      setNotifications([]);
      setCurrentUser(null);
    } catch {
      addNotification('退出失败', '会话撤销请求未送达，请检查连接后重试。', 'WARNING');
    }
  };

  useEffect(() => {
    if (view === 'DATA_CENTER' && currentUser?.role.includes('SYSTEM_ADMIN')) void loadAuditEvents();
  }, [view, currentUser?.id]);

  if (authLoading) return <div className="min-h-screen grid place-items-center bg-gray-50 text-sm font-bold text-gray-500">正在验证企业会话…</div>;
  if (!currentUser) return <LoginView onLogin={setCurrentUser} />;

  const normalizedAuditQuery = auditQuery.trim().toLowerCase();
  const filteredAuditEvents = auditEvents.filter(event => !normalizedAuditQuery || [
    event.action, event.entityType, event.entityId, event.actorId,
    users.find(user => user.id === event.actorId)?.name
  ].some(value => String(value || '').toLowerCase().includes(normalizedAuditQuery)));

  const workflowNavItems: NavItem[] = [
    ...(canAccessApproval ? [{ id: 'APPROVAL_CENTER', label: '审批工作台', shortLabel: '审批', icon: ShieldCheck, badge: pendingCount } as NavItem] : []),
    ...(canAccessWorkOrders ? [{ id: 'WORK_ORDERS', label: '服务工单', shortLabel: '工单', icon: Coffee, badge: openWorkOrderCount } as NavItem] : [])
  ];
  const adminNavItems: NavItem[] = currentUser.role.includes('SYSTEM_ADMIN') ? [
    { id: 'WORKFLOW_CONFIG', label: '流程配置', shortLabel: '流程', icon: GitMerge },
    { id: 'DEPARTMENTS', label: '部门管理', shortLabel: '部门', icon: Building2 },
    { id: 'ROLES', label: '角色管理', shortLabel: '角色', icon: Shield },
    { id: 'USERS', label: '成员中心', shortLabel: '成员', icon: Users },
    { id: 'REPORTS', label: '运营报表', shortLabel: '报表', icon: PieChart },
    { id: 'DATA_CENTER', label: '数据中心', shortLabel: '数据', icon: Database }
  ] : [];
  const primaryWorkflowItem = canAccessApproval ? workflowNavItems.find(item => item.id === 'APPROVAL_CENTER') : workflowNavItems.find(item => item.id === 'WORK_ORDERS');
  const mobilePrimaryItems: NavItem[] = [
    { id: 'DASHBOARD', label: '数据全景看板', shortLabel: '看板', icon: LayoutDashboard },
    { id: 'RESOURCES', label: '空间资源库', shortLabel: '资源', icon: MapPin },
    { id: 'BOOKINGS', label: '我的申请', shortLabel: '申请', icon: Calendar },
    ...(primaryWorkflowItem ? [primaryWorkflowItem] : [])
  ];
  const mobileMoreItems = [
    ...workflowNavItems.filter(item => !mobilePrimaryItems.some(primary => primary.id === item.id)),
    ...adminNavItems
  ];
  const isMoreView = mobileMoreItems.some(item => item.id === view);
  const isAdminView = adminNavItems.some(item => item.id === view);

  return (
    <div className="studio-app min-h-screen flex overflow-hidden" data-theme={theme} data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}>
      {/* Toast Notifications */}
      <div className="fixed top-6 right-6 z-[1000] space-y-3 pointer-events-none">
        {myNotifications.filter(n => !n.isRead).slice(0, 3).map(n => (
          <React.Fragment key={n.id}><ToastNotification notification={n} onClose={() => markNotificationRead(n.id)} /></React.Fragment>
        ))}
      </div>

      <aside className="studio-sidebar w-[268px] hidden lg:flex flex-col p-6 shrink-0">
        <div className="studio-brand shrink-0">
          <div className="studio-brand-mark"><Cpu size={21} strokeWidth={1.5}/></div>
          <div><div className="studio-brand-name">SmartOffice</div><div className="studio-brand-sub">THE OFFICE JOURNAL</div></div>
          <button
            type="button"
            className="studio-sidebar-toggle"
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!sidebarCollapsed}
            aria-controls="studio-sidebar-navigation"
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            onClick={() => setSidebarCollapsed(value => !value)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav id="studio-sidebar-navigation" aria-label="桌面主导航" className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
          <SidebarItem icon={LayoutDashboard} label="数据全景看板" id="DASHBOARD" active={view === 'DASHBOARD'} onClick={setView} />
          <SidebarItem icon={MapPin} label="空间资源库" id="RESOURCES" active={view === 'RESOURCES'} onClick={setView} />
          <SidebarItem icon={Calendar} label="我的申请" id="BOOKINGS" active={view === 'BOOKINGS'} onClick={setView} />
          {(workflowNavItems.length > 0 || adminNavItems.length > 0) && <div className="studio-nav-label">流程与中心</div>}
          {workflowNavItems.map(item => <SidebarItem key={item.id} icon={item.icon} label={item.label} id={item.id} active={view === item.id} onClick={setView} badge={item.badge} />)}
          {adminNavItems.length > 0 && (
            <div className="studio-nav-group">
              <button type="button" className="studio-nav-item studio-nav-group-toggle" data-active={isAdminView} aria-label="系统管理" title="系统管理" aria-expanded={showAdminMenu} aria-controls="desktop-admin-menu" onClick={() => setShowAdminMenu(value => !value)}>
                <FolderTree size={17} strokeWidth={1.7} /><span>系统管理</span><ChevronDown size={14} className={showAdminMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showAdminMenu && <div id="desktop-admin-menu" className="studio-nav-children">{adminNavItems.map(item => <SidebarItem key={item.id} icon={item.icon} label={item.label} id={item.id} active={view === item.id} onClick={setView} />)}</div>}
            </div>
          )}
        </nav>

        <div className="studio-sidebar-themes mt-4 pt-4 border-t shrink-0">
          <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest mb-3 px-2">系统主题风格</p>
          <div className="flex items-center justify-around px-2">
            {THEMES.map(t => (
              <button key={t.id} onClick={() => setTheme(t.id)} title={t.name} className={`w-6 h-6 rounded-full ${t.color} border-2 transition-all ${theme === t.id ? 'border-gray-900 scale-125 shadow-md' : 'border-transparent hover:scale-110'}`} />
            ))}
          </div>
        </div>

        <div className="studio-sidebar-account mt-6 pt-6 border-t shrink-0">
          <div className={`flex items-center justify-between px-2 py-2 rounded-xl bg-gray-50 mb-4 ${!isOnline ? 'bg-rose-50' : ''}`}>
             <div className="flex items-center space-x-2">
               {isOnline ? <Cloud size={14} className="text-emerald-500"/> : <CloudOff size={14} className="text-rose-500"/>}
               <span className={`text-[11px] font-bold ${isOnline ? 'text-emerald-600' : 'text-rose-600'}`}>
                 {saveStatus === 'saving' ? '正在同步...' : (isOnline && saveStatus !== 'error' ? '已同步至 MySQL' : '连接异常，更改未保存')}
               </span>
             </div>
             {saveStatus === 'saving' && <RefreshCw size={12} className="text-gray-500 animate-spin"/>}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 truncate">
              <div className="studio-user-avatar">{currentUser.name[0]}</div>
              <p className="text-xs font-bold truncate">{currentUser.name}</p>
            </div>
            <button onClick={handleLogout} aria-label="退出登录" title="退出登录" className="text-gray-500 hover:text-rose-500 transition-colors"><LogOut size={16}/></button>
          </div>
        </div>
      </aside>

      <nav aria-label="移动端主导航" className="studio-mobile-nav lg:hidden fixed bottom-3 left-3 right-3 z-[80] backdrop-blur-lg">
        {mobilePrimaryItems.map(item => (
          <button key={item.id} type="button" onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined}>
            <item.icon size={18} strokeWidth={1.7} /><span>{item.shortLabel}</span>
            {(item.badge || 0) > 0 && <strong className="studio-mobile-badge">{item.badge}</strong>}
          </button>
        ))}
        <button type="button" data-active={isMoreView} aria-expanded={showMobileMenu} aria-controls="mobile-more-menu" onClick={() => setShowMobileMenu(true)}>
          <MoreHorizontal size={19} strokeWidth={1.7} /><span>更多</span>
        </button>
      </nav>

      {showMobileMenu && <div id="mobile-more-menu"><MobileMoreSheet items={mobileMoreItems} currentView={view} onSelect={id => { setView(id); setShowMobileMenu(false); }} onClose={() => setShowMobileMenu(false)} theme={theme} onThemeChange={setTheme} currentUser={currentUser} isOnline={isOnline} saveStatus={saveStatus} onLogout={handleLogout} /></div>}

      <main className="studio-main flex-1 min-w-0 overflow-auto relative pb-32">
        <header className="studio-topbar backdrop-blur-md flex items-center justify-between gap-3 sticky top-0 z-40">
          <div className="flex items-center gap-6 flex-1 max-w-2xl">
            <div className="shrink-0"><span className="studio-page-kicker">SMARTOFFICE / WORKSPACE</span><h2 className="studio-page-title">
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
            </h2></div>
            {(view === 'RESOURCES' || view === 'USERS') && (
              <div className="relative flex-1 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-indigo-500 transition-colors" size={16}/>
                <input 
                  type="search"
                  aria-label={view === 'RESOURCES' ? '搜索空间资源' : '搜索成员'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={view === 'RESOURCES' ? "搜索名称、楼栋楼层、设备、容量或状态..." : "搜索姓名、邮箱或部门..."}
                  className="studio-search w-full pl-10 pr-10 py-2 outline-none text-sm transition-all font-medium"
                />
                {searchQuery && <button type="button" aria-label="清空搜索" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"><X size={15}/></button>}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-4">
             <button className="studio-secondary !min-h-9 !px-3" onClick={() => setShowQRScanner(true)}>
               <QrCode size={14}/>
               <span>扫码签到</span>
             </button>
             <div className="relative">
               <button onClick={() => setShowNotificationPanel(v => !v)} className="studio-icon-button" aria-label="通知中心" aria-expanded={showNotificationPanel}>
                 <Bell size={20}/>
                 {unreadCount > 0 && (
                   <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{unreadCount > 99 ? '99+' : unreadCount}</span>
                 )}
               </button>
               {showNotificationPanel && (
                 <div className="studio-notification-panel absolute right-0 top-12 w-96 max-w-[90vw] z-50 overflow-hidden">
                   <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                     <h4 className="font-black text-sm text-gray-800">通知中心</h4>
                     <button disabled={!unreadCount || isMarkingAllRead} onClick={() => void markAllNotificationsRead()} className="text-[11px] font-bold text-indigo-500 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">{isMarkingAllRead ? '保存中…' : '全部已读'}</button>
                   </div>
                   {notificationActionError && <p role="alert" className="border-b border-rose-100 bg-rose-50 px-5 py-2 text-[11px] font-bold text-rose-600">{notificationActionError}</p>}
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

        <div className="studio-content">
          {view === 'DASHBOARD' && (
            <div className="space-y-6 animate-in fade-in">
              <section className="agenda-hero" aria-label="今日办公议程">
                <div className="agenda-date">
                  <span className="agenda-date-year">{new Date().getFullYear()} / {pad2(new Date().getMonth() + 1)}</span>
                  <span className="agenda-date-day">{pad2(new Date().getDate())}</span>
                  <span className="agenda-date-week">{new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}<br/>TODAY'S EDITION</span>
                </div>
                <div className="agenda-intro">
                  <p className="agenda-eyebrow">YOUR DAY, BEAUTIFULLY ORGANIZED.</p>
                  <h1>{currentUser.name}，<br/>今天也<em>从容相见。</em></h1>
                  <p>空间已经就绪，时间各有归处。从这里安排会议、协调资源，让每一次协作都有清晰的开场。</p>
                  <div className="agenda-actions">
                    <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className="studio-primary"><Monitor size={16}/> 预订会议室 <ArrowUpRight size={15}/></button>
                    <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className="studio-secondary"><Coffee size={16}/> 申请工位</button>
                  </div>
                </div>
                <button className="agenda-next text-left" onClick={() => nextBooking ? setDayDetail({ resource: nextBookingResource, date: new Date(nextBooking.startTime), bookings: [nextBooking] }) : setView('BOOKINGS')}>
                  <span className="agenda-next-label">NEXT UP / 下一场</span>
                  <span className="agenda-next-time">{nextBooking ? `${toLocalTimeString(nextBooking.startTime)} — ${toLocalTimeString(nextBooking.endTime)}` : '— : —'}</span>
                  <span className="agenda-next-title">{nextBooking?.purpose || '议程留白，专注当下'}</span>
                  <span className="agenda-next-meta">{nextBooking ? <>{nextBookingResource?.name || '会议空间'}<br/>{nextBookingResource?.location}</> : '暂无已核准的后续会议'}</span>
                  <span className="agenda-next-foot">{nextBooking ? 'VIEW DETAILS →' : `${stats.availableRooms} 间会议室 · ${stats.availableDesks} 个工位可用`}</span>
                </button>
              </section>

              <div className="studio-stat-grid">
                <StatCard title="资源资产总量" value={stats.totalResources} icon={MapPin} trend={`${stats.availableRooms + stats.availableDesks} 个空间可用`} color={theme} onClick={() => setView('RESOURCES')} />
                <StatCard title="活跃核准单" value={stats.activeBookings} icon={Activity} trend="空间预约 · 实时统计" color="emerald" onClick={() => setView('BOOKINGS')} />
                {canAccessApproval ? <StatCard title="待处理任务" value={pendingCount} icon={ShieldCheck} trend={pendingCount ? '等待你的处理' : '今日任务已清零'} color="amber" onClick={() => setView('APPROVAL_CENTER')} /> : <StatCard title="我的进行中申请" value={bookings.filter(b => b.userId === currentUser.id && b.status === 'PENDING').length} icon={Activity} trend="个人申请 · 流程跟进" color="amber" onClick={() => setView('BOOKINGS')} />}
              </div>

              <section className="studio-panel studio-schedule-card" aria-label="资源占用日程">
                <div className="studio-schedule-head">
                  <div>
                    <span className="studio-panel-kicker">RESOURCE SCHEDULE / {activeSchedule.code}</span>
                    <h3 className="studio-panel-title">资源占用日程</h3>
                    <p>{activeSchedule.description}</p>
                  </div>
                  <div className="studio-schedule-tabs" role="tablist" aria-label="切换资源日程范围" onKeyDown={handleScheduleTabKeyDown}>
                    {SCHEDULE_RANGES.map(range => (
                      <button
                        key={range.id}
                        id={`schedule-tab-${range.id}`}
                        role="tab"
                        aria-selected={scheduleRange === range.id}
                        aria-controls="schedule-panel"
                        tabIndex={scheduleRange === range.id ? 0 : -1}
                        className="studio-schedule-tab"
                        onClick={() => setScheduleRange(range.id)}
                      >
                        <span>{range.label}</span><small>{range.code}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div key={scheduleRange} id="schedule-panel" className="studio-schedule-panel" role="tabpanel" aria-labelledby={`schedule-tab-${scheduleRange}`}>
                  {scheduleRange === 'TODAY' ? (
                    <TodayResourceUsage resources={resources} bookings={bookings} users={users} theme={theme} onBookingClick={(detail: any) => setDayDetail(detail)} />
                  ) : (
                    <ResourceUsageGrid days={scheduleRange === 'WEEK' ? weekDays : monthDays} resources={resources} bookings={bookings} theme={theme} onDayClick={openScheduleDay} />
                  )}
                </div>
                <div className="studio-schedule-foot"><span>{resources.length} SPACES · REALTIME</span><span>ONLY ONE VIEW, THE FULL PICTURE.</span></div>
              </section>
            </div>
          )}

          {/* ... existing views ... */}
          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="studio-page-head">
                <div><span className="studio-page-kicker">SPACE DIRECTORY / 资源目录</span><h3>空间资产</h3><p>查看及预约全公司物理空间资源。</p></div>
                <div className="studio-page-actions">
                  <button onClick={() => setShowResourceFinder(prev => !prev)} aria-expanded={showResourceFinder} className="studio-secondary"><Search size={16}/> <span>按条件找会议室</span></button>
                  {currentUser.role.includes('SYSTEM_ADMIN') && <><button onClick={() => setShowImportModal('RESOURCES')} className="studio-secondary"><Upload size={16}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className="studio-primary"><Plus size={16}/> <span>新增资源</span></button></>}
                </div>
              </div>
              <section className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3" aria-label="资源组合筛选">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-xs font-black text-gray-600"><Filter size={14}/>组合筛选</span>
                  <span role="status" className="text-[11px] font-bold text-gray-500">显示 {filteredResources.length} / {resources.length} 个资源</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <select aria-label="筛选楼栋" value={resourceBuildingFilter} onChange={e => setResourceBuildingFilter(e.target.value as any)} className="p-2.5 bg-gray-50 rounded-xl text-xs font-bold outline-none"><option value="ALL">全部楼栋</option>{Object.values(BUILDINGS).map(item => <option key={item.id} value={item.id}>{item.name} · {item.kind}</option>)}</select>
                  <select aria-label="筛选资源类型" value={resourceTypeFilter} onChange={e => setResourceTypeFilter(e.target.value as any)} className="p-2.5 bg-gray-50 rounded-xl text-xs font-bold outline-none"><option value="ALL">全部类型</option><option value="ROOM">会议室</option><option value="DESK">工位</option></select>
                  <select aria-label="筛选资源状态" value={resourceStatusFilter} onChange={e => setResourceStatusFilter(e.target.value as any)} className="p-2.5 bg-gray-50 rounded-xl text-xs font-bold outline-none"><option value="ALL">全部状态</option><option value="AVAILABLE">空闲</option><option value="OCCUPIED">占用</option><option value="MAINTENANCE">维护中</option></select>
                  <select aria-label="筛选最少容量" value={resourceMinCapacity} onChange={e => setResourceMinCapacity(Number(e.target.value))} className="p-2.5 bg-gray-50 rounded-xl text-xs font-bold outline-none">{[0, 2, 4, 8, 12, 20].map(value => <option key={value} value={value}>{value ? `至少 ${value} 人` : '不限人数'}</option>)}</select>
                  <button type="button" onClick={resetResourceFilters} disabled={!hasResourceFilters} className="p-2.5 rounded-xl border border-gray-100 text-xs font-bold text-gray-500 hover:bg-gray-50 disabled:opacity-40">重置筛选</button>
                </div>
              </section>
              {showResourceFinder && <ResourceFinder matches={resourceFinderResults} criteria={resourceFinderCriteria} onCriteriaChange={setResourceFinderCriteria} theme={theme} onBook={(resource: Resource, prefill: any) => { setSelectedResource(resource); setEditingBooking(null); setBookingPrefill(prefill); setCalendarDateForBooking(null); setShowBookingModal(true); }} />}
              <BuildingExplorer
                resources={spatialResources}
                bookings={bookings}
                focusLocation={activeSpatialFocus}
                resultContext={showResourceFinder ? {
                  label: resourceFinderContext,
                  matchCount: resourceFinderResults.length,
                  totalRoomCount: filteredResources.filter(resource => resource.type === 'ROOM').length
                } : null}
                onDetails={(resource) => setViewDetail({ type: 'RESOURCE', data: resource })}
                onCalendar={setShowResourceCalendar}
                onBook={(resource) => { setSelectedResource(resource); setEditingBooking(null); setBookingPrefill(null); setCalendarDateForBooking(null); setShowBookingModal(true); }}
              />
              <div className="studio-table-shell">
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
                        <td className="px-6 py-4 font-bold text-gray-800"><p>{r.name}</p>{r.type === 'ROOM' && <p className="mt-1 max-w-56 truncate text-[10px] font-medium text-gray-500">{r.features.join(' · ') || '未配置特殊设备'}</p>}</td>
                        <td className="px-6 py-4 text-xs font-medium text-gray-500"><p>{r.location}</p>{r.campus && <p className="mt-1 text-[10px] font-bold text-indigo-500">{r.campus}</p>}</td>
                        <td className="px-6 py-4 text-xs text-gray-500 font-bold">{r.type === 'ROOM' ? '会议室' : '工位'} / {r.capacity || 0}人</td>
                        <td className="px-6 py-4"><StatusBadge status={r.status} theme={theme} /></td>
                        <td className="px-6 py-4 text-right space-x-1">
                          <button onClick={() => setViewDetail({ type: 'RESOURCE', data: r })} className="p-2 text-gray-500 hover:text-indigo-600 transition-colors" title="详情"><Info size={16}/></button>
                          <button onClick={() => setShowResourceCalendar(r)} className="p-2 text-gray-500 hover:text-emerald-600 transition-colors" title="排期日历" aria-label={`查看${r.name}排期`}><CalendarDays size={16}/></button>
                          <button disabled={!isResourceAcceptingBookings(r)} title={!isResourceAcceptingBookings(r) ? '当前状态暂停新预约' : undefined} onClick={() => { setSelectedResource(r); setEditingBooking(null); setBookingPrefill(null); setCalendarDateForBooking(null); setShowBookingModal(true); }} className={`px-4 py-1.5 bg-${theme}-600 text-white rounded-lg text-[11px] font-black shadow-md hover:translate-y-[-1px] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0`}>{isResourceAcceptingBookings(r) ? '预约' : r.status === 'MAINTENANCE' ? '维护中' : '待开放'}</button>
                          {currentUser.role.includes('SYSTEM_ADMIN') && <button aria-label={`编辑${r.name}`} title="编辑资源" onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className="p-2 text-gray-200 hover:text-indigo-600 transition-colors"><Edit2 size={16}/></button>}
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
              <div className="studio-page-head">
                <div><span className="studio-page-kicker">PEOPLE DIRECTORY / 成员目录</span><h3>成员名录</h3><p>管理企业员工信息及其系统角色。</p></div>
                <div className="studio-page-actions">
                  <button onClick={() => setShowImportModal('USERS')} className="studio-secondary"><Upload size={16}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className="studio-primary"><UserPlus size={16}/> <span>录入成员</span></button>
                </div>
              </div>
              <div className="studio-table-shell">
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
                          <button onClick={() => void handleDeleteUser(u.id)} className="p-2 text-gray-200 hover:text-rose-500 transition-colors"><Trash2 size={16}/></button>
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
              <div className="studio-page-head">
                <div>
                  <span className="studio-page-kicker">APPROVAL DESK / 流程处理</span><h3>审批工作台</h3>
                  <p className="text-sm text-gray-500 mt-2 flex items-center space-x-2">
                    <ShieldCheck size={14} className={`text-${theme}-600`}/>
                    <span>当前共 <strong className={`text-${theme}-600`}>{pendingCount}</strong> 项待处理申请</span>
                  </p>
                </div>
                <div className="studio-page-actions">
                  <button disabled={isApprovalActionPending || !approvalGroups.length} onClick={() => setSelectedApprovalIds(selectedApprovalIds.length === approvalGroups.length ? [] : approvalGroups.map(group => group.booking.id))} className="studio-secondary disabled:cursor-not-allowed disabled:opacity-40">{selectedApprovalIds.length === approvalGroups.length && approvalGroups.length ? '取消全选' : '全选'}</button>
                  <button onClick={handleBulkApprove} disabled={!selectedApprovalIds.length || isApprovalActionPending} className="studio-primary disabled:cursor-not-allowed disabled:opacity-40">{pendingApprovalActions.BULK ? '批量处理中…' : `批量通过${selectedApprovalIds.length ? ` (${selectedApprovalIds.length})` : ''}`}</button>
                </div>
              </div>
              {approvalActionErrors.BULK && <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-rose-600">{approvalActionErrors.BULK}</p>}
              <div className="grid grid-cols-1 gap-6">
                {approvalGroups.map(({ booking, seriesBookings }) => (
                  <ApprovalTaskCard
                    key={booking.id}
                    booking={booking}
                    seriesBookings={seriesBookings}
                    workflow={workflow}
                    users={users}
                    resources={resources}
                    theme={theme}
                    selected={selectedApprovalIds.includes(booking.id)}
                    busy={Boolean(pendingApprovalActions[booking.id] || pendingApprovalActions.BULK)}
                    disabled={isApprovalActionPending}
                    actionError={approvalActionErrors[booking.id]}
                    onToggleSelect={() => setSelectedApprovalIds(prev => prev.includes(booking.id) ? prev.filter(id => id !== booking.id) : [...prev, booking.id])}
                    onApprove={(comment?: string) => handleApprove(booking, comment)}
                    onReject={(c: string) => handleReject(booking, c)}
                  />
                ))}
                {approvalGroups.length === 0 && (
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
                 <div className="studio-page-head">
                     <div><span className="studio-page-kicker">MY REQUESTS / 申请档案</span><h3>我的申请动态</h3></div>
                     <span className="studio-secondary !cursor-default">
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
                               const longTermSeries = b.seriesKind === 'LONG_TERM' && b.seriesId ? bookings.filter(item => item.seriesId === b.seriesId) : [];
                               const activeRenewal = b.seriesId && bookings.some(item => item.renewalOfSeriesId === b.seriesId && isActiveBooking(item));
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
                                                       <span className="text-[11px] font-medium text-gray-500">{b.seriesKind === 'LONG_TERM' && b.seriesEndDate ? `${toLocalDateString(b.startTime)} 至 ${b.seriesEndDate}` : toLocalDateString(b.startTime)}</span>
                                                   </div>
                                               </div>
                                           </div>
                                           
                                           <div className="flex items-center space-x-4">
                                               {b.userId !== currentUser.id && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">受邀会议</span>}
                                               {b.checkedInAt && <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">已签到 {toLocalTimeString(b.checkedInAt)}</span>}
                                               {b.noShow && <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-lg">未签到</span>}
                                               {b.seriesKind === 'LONG_TERM' && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">{b.renewalOfSeriesId ? '续期' : '长期预订'} · {longTermSeries.length} 天</span>}
                                               <StatusBadge status={b.status} theme={theme} />
                                               <div className={`p-2 rounded-full transition-transform duration-300 ${isExpanded ? 'rotate-180 bg-gray-100 text-gray-600' : 'text-gray-500'}`}>
                                                   <ChevronDown size={16}/>
                                               </div>
                                           </div>
                                       </div>

                                       {/* Expanded Content */}
                                       {isExpanded && (
                                           <div className="px-6 pb-8 pt-2 border-t border-gray-50 animate-in slide-in-from-top-2 fade-in">
                                               {b.seriesKind === 'LONG_TERM' && <div className="mb-5 p-4 rounded-2xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-700"><strong>{b.renewalOfSeriesId ? '续期申请' : '长期预订'} · 每天 {toLocalTimeString(b.startTime)} - {toLocalTimeString(b.endTime)}</strong><p className="mt-1">本期至 {b.seriesEndDate}，共 {longTermSeries.length} 个有效会议日。续期审批只影响新周期，当前周期保持不变。</p></div>}
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
                                                 {b.seriesKind === 'LONG_TERM' && b.recurrenceIndex === 0 && b.status === 'APPROVED' && b.userId === currentUser.id && <button onClick={() => handleRenewLongTerm(b)} disabled={!!activeRenewal} className="flex items-center space-x-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-5 py-2.5 rounded-xl border border-indigo-100 disabled:opacity-50"><RefreshCw size={14}/><span>{activeRenewal ? '续期已提交' : '申请续期'}</span></button>}
                                                 {(b.status === 'APPROVED' || b.status === 'CANCELLED') && resource && <button onClick={() => downloadBookingIcs(b, resource, users)} className="flex items-center space-x-2 text-xs font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-5 py-2.5 rounded-xl border border-emerald-100"><Download size={14}/><span>下载 ICS 日历</span></button>}
                                                 {checkableBookings.some(item => item.id === b.id) && <button onClick={() => setShowQRScanner(true)} className={`flex items-center space-x-2 text-xs font-bold text-${theme}-600 bg-${theme}-50 hover:bg-${theme}-100 px-5 py-2.5 rounded-xl border border-${theme}-100`}><CheckCircle size={14}/><span>会议签到</span></button>}
                                                 {b.status === 'APPROVED' && b.checkedInAt && b.userId === currentUser.id && Date.now() >= new Date(b.startTime).getTime() && Date.now() < new Date(b.endTime).getTime() && <button onClick={() => handleEndEarly(b.id)} className="flex items-center space-x-2 text-xs font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 px-5 py-2.5 rounded-xl border border-amber-100"><LogOut size={14}/><span>提前结束并释放</span></button>}
                                                 {['PENDING', 'APPROVED'].includes(b.status) && b.userId === currentUser.id && <>
                                                        <button onClick={(e) => { e.stopPropagation(); if (!resource) return; setEditingBooking(b); setSelectedResource(resource); setCalendarDateForBooking(null); setBookingPrefill({ id: b.id, purpose: b.purpose, start: b.startTime, end: b.endTime, participants: b.participants, extras: { hasLeader: b.hasLeader, leaderDetails: b.leaderDetails, isVideoConference: b.isVideoConference, needsTeaService: b.needsTeaService, requiredFeatures: b.requiredFeatures || [], attendeeIds: b.attendeeIds || [] } }); setShowBookingModal(true); }} className="flex items-center space-x-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-5 py-2.5 rounded-xl transition-all border border-indigo-100"><Edit2 size={14}/><span>修改预约</span></button>
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
             <div className="space-y-8 animate-in fade-in max-w-5xl">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">审批流程引擎</h3><p className="text-sm text-gray-500 mt-1">每次保存发布新版本；在途申请仍按提交时冻结的流程审批。</p></div><button onClick={() => { setEditingWorkflowNode(null); setShowWorkflowModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增节点</span></button></div>
               <div className="space-y-4">
                 {workflow.map((node, index) => (
                   <div key={node.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-gray-200 transition-all">
                     <div className="flex items-center space-x-6">
                       <div className={`w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-black text-${theme}-600 border border-gray-100 shadow-inner`}>{index + 1}</div>
                       <div><h5 className="font-bold text-gray-800">{node.name}</h5><p className="text-xs text-gray-500 mt-1 font-medium">负责角色：{roles.find(r => r.id === node.approverRole)?.name}</p><p className="mt-1 text-[11px] font-medium text-gray-500">部门：{node.departmentIds?.length ? node.departmentIds.map(id => departments.find(department => department.id === id)?.name || id).join('、') : '全部'} · 园区：{node.campuses?.length ? node.campuses.join('、') : '全部'}</p></div>
                     </div>
                     <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-all">
                       <button onClick={() => { const nw = [...workflow]; if(index > 0) { [nw[index], nw[index-1]] = [nw[index-1], nw[index]]; void handleSaveWorkflow(nw); } }} disabled={index === 0} className="p-2 text-gray-500 hover:text-indigo-600 disabled:opacity-30"><ChevronUp size={16}/></button>
                       <button onClick={() => { const nw = [...workflow]; if(index < nw.length-1) { [nw[index], nw[index+1]] = [nw[index+1], nw[index]]; void handleSaveWorkflow(nw); } }} disabled={index === workflow.length-1} className="p-2 text-gray-500 hover:text-indigo-600 disabled:opacity-30"><ChevronDown size={16}/></button>
                       <button onClick={() => { setEditingWorkflowNode(node); setShowWorkflowModal(true); }} className="p-2 text-gray-500 hover:text-indigo-600"><Edit2 size={16}/></button>
                       <button onClick={() => void handleSaveWorkflow(workflow.filter(n => n.id !== node.id), '审批节点已删除。')} className="p-2 text-gray-500 hover:text-rose-500"><Trash2 size={16}/></button>
                     </div>
                   </div>
                 ))}
                 {workflow.length === 0 && <div className="p-20 text-center bg-white rounded-3xl border border-dashed text-gray-500 font-bold">暂无审批节点，流程将默认免审通过。</div>}
               </div>
               <section className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm" aria-labelledby="delegation-title">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                   <div><h4 id="delegation-title" className="font-black text-gray-800">代理审批</h4><p className="mt-1 text-xs text-gray-500">代理继承委托人在当前节点的角色与范围，过期后自动失效，自审限制始终有效。</p></div>
                   <button onClick={() => setShowDelegateModal(true)} className="studio-secondary shrink-0"><Plus size={15}/>新增代理</button>
                 </div>
                 <div className="mt-5 space-y-3">
                   {approvalDelegates.map(delegate => {
                     const active = Date.parse(delegate.startsAt) <= Date.now() && Date.now() < Date.parse(delegate.endsAt);
                     return <div key={delegate.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl bg-gray-50 p-4">
                       <div><p className="text-sm font-black text-gray-800">{users.find(user => user.id === delegate.delegatorId)?.name || delegate.delegatorId} <span className="mx-1 text-gray-500">→</span> {users.find(user => user.id === delegate.delegateId)?.name || delegate.delegateId}</p><p className="mt-1 text-[11px] text-gray-500">{toLocalDateTimeString(delegate.startsAt)} 至 {toLocalDateTimeString(delegate.endsAt)}</p></div>
                       <div className="flex items-center gap-3"><span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${active ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>{active ? '生效中' : '未生效 / 已过期'}</span><button onClick={() => void handleDeleteDelegate(delegate.id)} className="p-2 text-gray-500 hover:text-rose-500" aria-label={`撤销${users.find(user => user.id === delegate.delegateId)?.name || '成员'}的代理`}><Trash2 size={15}/></button></div>
                     </div>;
                   })}
                   {approvalDelegates.length === 0 && <p className="rounded-2xl border border-dashed border-gray-200 py-8 text-center text-xs font-bold text-gray-500">暂无代理审批关系</p>}
                 </div>
               </section>
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
              <div className="studio-table-shell">
                <table className="w-full text-left min-w-[900px]">
                  <thead><tr className="bg-gray-50 text-[11px] font-black text-gray-500 uppercase">{['维度', '名称', '预约数', '使用小时', '使用率', '取消率', 'No-show率', '驳回率', '平均审批'].map(label => <th key={label} className="px-5 py-4">{label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-50">{reportData.rows.map(row => <tr key={`${row.dimension}-${row.id}`} className="text-xs text-gray-600"><td className="px-5 py-4"><span className={`px-2 py-1 rounded-lg font-bold ${row.dimension === 'RESOURCE' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>{row.dimension === 'RESOURCE' ? '资源' : '部门'}</span></td><td className="px-5 py-4 font-black text-gray-800">{row.name}</td><td className="px-5 py-4">{row.bookingCount}</td><td className="px-5 py-4">{row.usageHours}</td><td className="px-5 py-4 font-bold">{row.utilization}%</td><td className="px-5 py-4">{row.cancellationRate}%</td><td className="px-5 py-4">{row.noShowRate}%</td><td className="px-5 py-4">{row.rejectionRate}%</td><td className="px-5 py-4">{row.averageApprovalHours} 小时</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          {view === 'DATA_CENTER' && (
             <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">数据中心</h3><p className="text-sm text-gray-500 mt-1">系统数据的备份、恢复与操作审计。</p></div></div>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:border-gray-200 transition-all">
                    <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-6"><Download size={32}/></div>
                    <h4 className="font-black text-xl text-gray-800">全量备份</h4>
                    <p className="text-gray-500 text-xs mt-2 mb-8 px-4 h-8">导出包含用户、资源、预约记录在内的所有数据为 JSON 文件。</p>
                    <button onClick={async () => {
                      try {
                        const res = await fetch('/api/backup');
                        const backup = await res.json();
                        if (!res.ok) throw new Error(backup.error || '备份失败');
                        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `smart-office-backup-${formatDate(new Date())}.json`;
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                        URL.revokeObjectURL(url);
                        addNotification('备份成功', '服务端一致性备份已导出，包含服务工单。', 'SUCCESS');
                      } catch (error: any) { addNotification('备份失败', error?.message || '请稍后重试。', 'WARNING'); }
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
                         reader.onload = async (event) => {
                           try {
                             const imported = JSON.parse(event.target?.result as string);
                             if (!confirm('恢复将替换当前组织、资源、预约和工单数据，确定继续吗？')) return;
                             await apiRequest('/api/backup/restore', 'POST', imported);
                             addNotification('恢复成功', '备份已通过服务端一致性校验并替换写入 MySQL。', 'SUCCESS');
                           } catch(err: any) { alert(err?.message || "文件格式错误或保存失败"); }
                         };
                         reader.readAsText(file);
                       };
                       input.click();
                    }} className="w-full py-3 bg-white border-2 border-emerald-100 text-emerald-600 rounded-xl font-bold hover:bg-emerald-50 transition-all">导入备份</button>
                 </div>

                 <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:border-gray-200 transition-all">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-600 mb-6"><Trash2 size={32}/></div>
                    <h4 className="font-black text-xl text-gray-800">重新加载</h4>
                    <p className="text-gray-500 text-xs mt-2 mb-8 px-4 h-8">放弃页面内存状态，从 MySQL 重新读取。</p>
                    <button onClick={() => window.location.reload()} className="w-full py-3 bg-rose-50 text-rose-600 rounded-xl font-bold hover:bg-rose-100 transition-all">从 MySQL 重新加载</button>
                 </div>
               </div>
               <section className="studio-panel p-6" aria-labelledby="audit-title">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                   <div><h4 id="audit-title" className="font-black text-gray-800">操作审计</h4><p className="mt-1 text-xs text-gray-500">关键写入与业务操作同事务记录；最多查询最近 200 条。</p></div>
                   <div className="flex gap-2"><input aria-label="筛选审计记录" type="search" value={auditQuery} onChange={e => setAuditQuery(e.target.value)} placeholder="操作、对象或操作人" className="studio-search min-w-0 px-3 py-2 text-xs"/><button onClick={() => void loadAuditEvents()} disabled={auditLoading} className="studio-secondary shrink-0"><RefreshCw size={14} className={auditLoading ? 'animate-spin' : ''}/>刷新</button></div>
                 </div>
                 {auditError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-600">{auditError}</p>}
                 <div className="studio-table-shell mt-5">
                   <table className="w-full min-w-[820px] text-left">
                     <thead><tr className="bg-gray-50 text-[11px] font-black text-gray-500">{['时间', '操作', '对象', '操作人', '摘要'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
                     <tbody className="divide-y divide-gray-50">{filteredAuditEvents.map(event => <tr key={event.id} className="text-xs text-gray-600"><td className="px-4 py-3 whitespace-nowrap">{toLocalDateTimeString(event.createdAt)}</td><td className="px-4 py-3 font-black text-gray-800">{event.action}</td><td className="px-4 py-3">{event.entityType} / {event.entityId}</td><td className="px-4 py-3">{users.find(user => user.id === event.actorId)?.name || event.actorId || '系统'}</td><td className="max-w-72 px-4 py-3"><code className="break-all text-[10px] text-gray-500">{Object.keys(event.details || {}).length ? JSON.stringify(event.details) : '—'}</code></td></tr>)}</tbody>
                   </table>
                   {!auditLoading && filteredAuditEvents.length === 0 && <p className="py-12 text-center text-xs font-bold text-gray-500">{auditQuery ? '没有匹配的审计记录' : '暂无审计记录'}</p>}
                 </div>
               </section>
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
          onImport={async (data: any) => {
            try {
              if (!Array.isArray(data) || !data.length) throw new Error('未解析到有效数据。');
              await apiRequest(`/api/imports/${showImportModal}`, 'POST', { items: data });
              addNotification('导入成功', `已成功导入 ${data.length} 条数据并写入 MySQL。`, 'SUCCESS');
              setShowImportModal(null);
            } catch (err: any) {
              addNotification('导入失败', err?.message || '请刷新后重试。', 'WARNING');
            }
          }} 
        />
      )}

      {showResourceCalendar && (
        <ResourceCalendarModal resource={showResourceCalendar} bookings={bookings} users={users} theme={theme} onClose={() => setShowResourceCalendar(null)} onSelectDate={(date: string) => {
          if (!isResourceAcceptingBookings(showResourceCalendar)) {
            addNotification('暂不可预约', '会议室当前维护或待开放，请选择其他会议室。', 'WARNING');
            return;
          }
          setCalendarDateForBooking(date);
          setEditingBooking(null);
          setBookingPrefill(null);
          setSelectedResource(showResourceCalendar);
          setShowResourceCalendar(null);
          setShowBookingModal(true);
        }} />
      )}

      {viewDetail && (
        <DetailViewModal viewDetail={viewDetail} theme={theme} roles={roles} users={users} bookings={bookings} onClose={() => setViewDetail(null)} />
      )}

      {showUserModal && <UserModal user={editingUser} departments={departments} roles={roles} onClose={() => setShowUserModal(false)} onSave={handleSaveUser} theme={theme} />}
      {showResourceModal && <ResourceModal resource={editingResource} onClose={() => setShowResourceModal(false)} onSave={handleSaveResource} theme={theme} />}
      {showRoleModal && <RoleModal role={editingRole} onClose={() => setShowRoleModal(false)} onSave={handleSaveRole} theme={theme} />}
      {showWorkflowModal && <WorkflowModal node={editingWorkflowNode} roles={roles} departments={departments} onClose={() => setShowWorkflowModal(false)} onSave={(data: any) => {
        const next = editingWorkflowNode
          ? workflow.map(node => node.id === editingWorkflowNode.id ? { ...node, ...data } : node)
          : [...workflow, { id: `wf-${Date.now()}`, ...data }];
        void handleSaveWorkflow(next);
      }} theme={theme} />}
      {showDelegateModal && <ApprovalDelegateModal users={users} onClose={() => setShowDelegateModal(false)} onSave={handleSaveDelegate} theme={theme} />}
      
      {showBookingModal && selectedResource && (<BookingFormModal resource={selectedResource} theme={theme} initialDate={calendarDateForBooking} initialValues={bookingPrefill} onClose={() => { setShowBookingModal(false); setCalendarDateForBooking(null); setBookingPrefill(null); setEditingBooking(null); }} onConfirm={handleBooking} availableUsers={users} currentUserId={currentUser.id} bookings={bookings} />)}

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

      {!showMobileMenu && <button
        onClick={() => setShowAgent(true)}
        aria-label="打开智能助手"
        className="studio-agent-launcher fixed right-4 bottom-24 lg:bottom-6 z-[90] flex items-center gap-3 p-3 lg:px-4 lg:py-3 transition-all active:scale-[0.97]"
      >
        <MessageSquare size={18} />
        <span className="hidden lg:block text-left"><span className="block text-[12.5px] font-semibold">智办助手</span><small className="block mt-0.5">ASK YOUR OFFICE</small></span>
      </button>}

      <ChatDock
        open={showAgent}
        onClose={() => setShowAgent(false)}
        userId={currentUser.id}
        userName={currentUser.name}
        theme={theme}
        resources={resources}
        bookings={bookings}
        users={users}
        onAction={handleAgentAction}
        onNavigate={(view) => setView(view as any)}
      />
    </div>
  );
};

export default App;