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
  Home, ClipboardList, Settings, User, Wifi, WifiOff, ArrowUp, ArrowDown,
  Sparkles
} from 'lucide-react';
import { User as UserType, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, Department, RoleDefinition, ResourceStatus, Notification } from './types';
import { INITIAL_USERS, INITIAL_RESOURCES, INITIAL_BOOKINGS, DEFAULT_WORKFLOW, INITIAL_DEPARTMENTS, INITIAL_ROLES } from './constants.tsx';
import { getSmartRecommendation } from './services/geminiService';
import { DataCenter } from './components/mobile/management';
import {
  getUsers, getResources, getBookings, getRoles, getDepartments, getWorkflow,
  createBooking, updateBooking, createResource, updateResource, deleteResource,
  createUser, updateUser, deleteUser, createRole, updateRole, deleteRole,
  createDepartment, updateDepartment, deleteDepartment, updateWorkflow as updateWorkflowDB,
  batchImportUsers, batchImportResources, batchImportDepartments,
  exportAllData, restoreAllData, subscribeToBookings, subscribeToResources,
  testConnection,
} from './services/supabaseService';
import { PERMISSIONS, NAV_PERMISSIONS, MENU_PERMISSIONS } from './permissions';
import { usePermissions } from './hooks/usePermissions';

// Import refactored components
import {
  UserManagement,
  RoleManagement,
  DepartmentManagement,
  WorkflowManagement,
  ResourceManagement,
  RecommendationConfigView,
} from './components/mobile/management';
import {
  MobileAdminPage,
  StatusBadge,
  BottomNav,
  NoPermissionView,
} from './components/mobile/common';
import AuthView from './components/mobile/views/AuthView';
import ProfileView from './components/mobile/views/ProfileView';
import ProfileEditView from './components/mobile/views/ProfileEditView';
import MeetingServiceView from './components/mobile/views/MeetingServiceView';
import {
  RoomBookingFormModal,
  DeskBookingFormModal,
  RoomRecommendationList,
  SmartRecommendationDialog,
} from './components/mobile/modals';

const STORAGE_KEY = 'SMART_OFFICE_DATA_V35';
const THEME_KEY = 'SMART_OFFICE_THEME';

// 离线缓存键
const OFFLINE_CACHE_KEY = 'SMART_OFFICE_OFFLINE_CACHE';

// --- Theme Config ---
const THEMES = [
  { id: 'finance', name: '金融黑', color: 'bg-slate-900', text: 'text-slate-100', border: 'border-slate-600', bg: 'bg-slate-900', lightColor: '#F59E0B', accent: '#8B5CF6' },
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-600', text: 'text-indigo-600', border: 'border-indigo-100', bg: 'bg-indigo-50', lightColor: '#4F46E5' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-100', bg: 'bg-emerald-50', lightColor: '#059669' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-600', text: 'text-orange-600', border: 'border-orange-100', bg: 'bg-orange-50', lightColor: '#EA580C' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-600', text: 'text-rose-600', border: 'border-rose-100', bg: 'bg-rose-50', lightColor: '#E11D48' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-600', text: 'text-purple-600', border: 'border-purple-100', bg: 'bg-purple-50', lightColor: '#7C3AED' },
];

// Get theme colors helper
const getThemeColors = (theme: string) => {
  const themeConfig = THEMES.find(t => t.id === theme) || THEMES[0];
  return {
    primary: themeConfig.color,
    text: themeConfig.text,
    border: themeConfig.border,
    bg: themeConfig.bg,
    lightColor: themeConfig.lightColor,
    accent: themeConfig.accent,
    isDark: theme === 'finance'
  };
};

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

const RoleTag = ({ roleId, roles, theme }: any) => {
  const role = roles.find((r: any) => r.id === roleId);
  if (!role) return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-400">未知</span>;
  return <span className={`px-2 py-0.5 rounded text-[9px] font-bold bg-${role.color}-100 text-${role.color}-700 border border-${role.color}-200`}>{role.name}</span>;
};

// --- Mobile Stat Card ---
const MobileStatCard = ({ title, value, icon: Icon, color, onClick, isDark = false }: any) => {
  const darkBg = isDark ? 'bg-[#1E293B] border-[#334155]' : 'bg-white border-gray-100';
  const darkText = isDark ? 'text-white' : 'text-gray-800';
  const darkSubtext = isDark ? 'text-white/60' : 'text-gray-400';
  
  return (
    <button onClick={onClick} className={`${darkBg} p-4 rounded-2xl border shadow-sm flex items-center space-x-3 active:scale-[0.98] transition-transform`}>
      <div className={`w-10 h-10 rounded-xl ${isDark ? `bg-${color}-500/10 text-${color}-500` : `bg-${color}-50 text-${color}-600`} flex items-center justify-center`}>
        <Icon size={20} />
      </div>
      <div>
        <p className={`text-[10px] font-bold ${darkSubtext} uppercase`}>{title}</p>
        <h3 className={`text-lg font-black ${darkText}`}>{value}</h3>
      </div>
    </button>
  );
};

// --- Mobile Resource Card ---
const MobileResourceCard = ({ resource, theme, onBook, onViewCalendar }: any) => {
  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-100';
  const darkText = isFinanceTheme ? 'text-slate-100' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-slate-400' : 'text-gray-400';
  const darkSecondary = isFinanceTheme ? 'bg-slate-700 text-slate-200' : 'bg-gray-100 text-gray-600';
  const typeColor = resource.type === 'ROOM' 
    ? (isFinanceTheme ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-50 text-indigo-600')
    : (isFinanceTheme ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600');
  
  return (
    <div className={`${darkBg} p-4 rounded-2xl border shadow-sm`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-xl ${typeColor} flex items-center justify-center`}>
            {resource.type === 'ROOM' ? <Monitor size={20} /> : <Coffee size={20} />}
          </div>
          <div>
            <h4 className={`font-bold ${darkText} text-sm`}>{resource.name}</h4>
            <p className={`text-[10px] ${darkSubtext}`}>{resource.location}</p>
          </div>
        </div>
        <StatusBadge status={resource.status} theme={theme} />
      </div>
      <div className={`flex items-center justify-between text-[10px] ${darkSubtext} mb-3`}>
        <span>容量: {resource.capacity || 1}人</span>
        <span>{resource.features?.slice(0, 2).join(' · ') || '标准配置'}</span>
      </div>
      <div className="flex space-x-2">
        <button onClick={() => onBook(resource)} className={`flex-1 py-2.5 ${isFinanceTheme ? 'bg-amber-500 text-slate-900' : `bg-${theme}-600 text-white`} rounded-xl font-bold text-xs shadow-md active:scale-[0.98] transition-transform`}>
          立即预约
        </button>
        {resource.type === 'DESK' && (
          <button onClick={() => onViewCalendar(resource)} className={`px-4 py-2.5 ${darkSecondary} rounded-xl font-bold text-xs active:scale-[0.98] transition-transform`}>
            <CalendarDays size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

// --- Mobile Booking Card ---
const MobileBookingCard = ({ booking, resource, theme, onCancel, expanded, onToggle }: any) => {
  const isExpanded = expanded;
  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-100';
  const darkBorder = isFinanceTheme ? 'border-slate-600' : 'border-gray-50';
  const darkText = isFinanceTheme ? 'text-slate-100' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-slate-400' : 'text-gray-400';
  const darkSecondary = isFinanceTheme ? 'text-slate-300' : 'text-gray-700';
  const darkIcon = isFinanceTheme ? 'text-slate-400' : 'text-gray-300';
  const typeColor = booking.type === 'ROOM' 
    ? (isFinanceTheme ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-50 text-indigo-600')
    : (isFinanceTheme ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600');
  const cancelBtn = isFinanceTheme ? 'bg-slate-700 text-rose-400 border-slate-500' : 'bg-rose-50 text-rose-600 border border-rose-100';
  
  const tagColors = {
    amber: isFinanceTheme ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600',
    indigo: isFinanceTheme ? 'bg-violet-500/20 text-violet-400' : 'bg-indigo-50 text-indigo-600',
    emerald: isFinanceTheme ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600',
    rose: isFinanceTheme ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-50 text-rose-600'
  };
  
  return (
    <div className={`${darkBg} rounded-2xl border transition-all duration-300 overflow-hidden ${isExpanded ? 'shadow-lg' : 'shadow-sm'}`}>
      <div onClick={onToggle} className={`p-4 cursor-pointer flex items-center justify-between active:bg-opacity-90 transition-colors`}>
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-xl ${typeColor} flex items-center justify-center`}>
            {booking.type === 'ROOM' ? <Monitor size={18} /> : <Briefcase size={18} />}
          </div>
          <div>
            <h4 className={`font-bold ${darkText} text-sm line-clamp-1`}>{booking.purpose}</h4>
            <div className="flex items-center space-x-2 mt-0.5">
              <span className={`text-[10px] font-medium ${darkSubtext}`}>{resource?.name || '未知资源'}</span>
              <span className={`text-[10px] ${darkIcon}`}>·</span>
              <span className={`text-[10px] font-medium ${darkSubtext}`}>{booking.startTime.split('T')[0]}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <StatusBadge status={booking.status} theme={theme} />
          <ChevronDown size={16} className={`${darkIcon} transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>
      {isExpanded && (
        <div className={`px-4 pb-4 pt-2 border-t ${darkBorder} animate-in slide-in-from-top-2 fade-in`}>
          <div className="space-y-2.5 mb-4">
            <div className="flex items-center justify-between text-xs">
              <span className={darkSubtext}>时间段</span>
              <span className={`font-bold ${darkSecondary}`}>{booking.startTime.replace('T', ' ').slice(0, 16)} - {booking.endTime.split('T')[1].slice(0, 5)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={darkSubtext}>参与人数</span>
              <span className={`font-bold ${darkSecondary}`}>{booking.participants || 1} 人</span>
            </div>
            {booking.hasLeader && (
              <div className="flex items-center justify-between text-xs">
                <span className={darkSubtext}>领导参会</span>
                <span className="font-bold text-amber-500">{booking.leaderDetails || '是'}</span>
              </div>
            )}
            {booking.isVideoConference && (
              <div className="flex items-center justify-between text-xs">
                <span className={darkSubtext}>视频会议</span>
                <span className="font-bold text-indigo-500">已开启</span>
              </div>
            )}
            {booking.needsTeaService && (
              <div className="flex items-center justify-between text-xs">
                <span className={darkSubtext}>茶水服务</span>
                <span className="font-bold text-emerald-500">已预约</span>
              </div>
            )}
            {booking.needsNameCard && (
              <div className="flex items-center justify-between text-xs">
                <span className={darkSubtext}>需要桌牌</span>
                <span className="font-bold text-rose-500">{booking.nameCardDetails || '是'}</span>
              </div>
            )}
            {(booking.hasLeader || booking.isVideoConference || booking.needsTeaService || booking.needsNameCard) && (
              <div className="pt-2 border-t border-[#334155]">
                <div className="flex flex-wrap gap-1.5">
                  {booking.hasLeader && (
                    <span className={`px-2 py-0.5 ${tagColors.amber} rounded text-[10px] font-medium`}>领导参会</span>
                  )}
                  {booking.isVideoConference && (
                    <span className={`px-2 py-0.5 ${tagColors.indigo} rounded text-[10px] font-medium`}>视频会议</span>
                  )}
                  {booking.needsTeaService && (
                    <span className={`px-2 py-0.5 ${tagColors.emerald} rounded text-[10px] font-medium`}>茶水服务</span>
                  )}
                  {booking.needsNameCard && (
                    <span className={`px-2 py-0.5 ${tagColors.rose} rounded text-[10px] font-medium`}>桌牌</span>
                  )}
                </div>
              </div>
            )}
          </div>
          {['PENDING', 'APPROVED'].includes(booking.status) && (
            <button onClick={(e) => { e.stopPropagation(); onCancel(booking.id); }} className={`w-full py-2.5 ${cancelBtn} rounded-xl font-bold text-xs border active:scale-[0.98] transition-transform`}>
              撤销申请
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// --- Mobile Approval Card ---
const MobileApprovalCard = ({ booking, resource, user, workflow, theme, onApprove, onReject }: any) => {
  const isFinanceTheme = theme === 'finance';
  const darkBg = isFinanceTheme ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-100';
  const darkText = isFinanceTheme ? 'text-slate-100' : 'text-gray-800';
  const darkSubtext = isFinanceTheme ? 'text-slate-400' : 'text-gray-400';
  const darkUserBg = isFinanceTheme ? 'bg-slate-700 text-amber-400' : `bg-${theme}-100 text-${theme}-600`;
  const darkRejectBtn = isFinanceTheme ? 'border-slate-500 text-slate-400' : 'border border-gray-200 text-gray-500';
  const darkApproveBtn = isFinanceTheme ? 'bg-violet-500' : `bg-${theme}-600`;
  
  return (
    <div className={`${darkBg} p-4 rounded-2xl border shadow-sm`}>
      <div className="flex items-start space-x-3 mb-3">
        <div className={`w-10 h-10 rounded-full ${darkUserBg} flex items-center justify-center font-bold text-sm shrink-0`}>
          {user?.name?.[0] || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`font-bold ${darkText} text-sm line-clamp-1`}>{user?.name} 申请 {resource?.name}</h4>
          <p className={`text-[10px] ${darkSubtext} mt-0.5`}>{booking.startTime.replace('T', ' ')} 至 {booking.endTime.replace('T', ' ')}</p>
        </div>
      </div>
      <div className="flex space-x-2">
        <button onClick={() => onReject('不符合规定')} className={`flex-1 py-2.5 border ${darkRejectBtn} rounded-xl font-bold text-xs active:scale-[0.98] transition-transform`}>驳回</button>
        <button onClick={onApprove} className={`flex-1 py-2.5 ${darkApproveBtn} text-white rounded-xl font-bold text-xs shadow-md active:scale-[0.98] transition-transform`}>通过</button>
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
    <div className="fixed inset-0 z-[300] bg-black flex flex-col" style={{ maxWidth: '448px', margin: '0 auto' }}>
      <div className="absolute top-0 left-0 right-0 z-10 p-4 flex items-center justify-between">
        <button onClick={onClose} className="p-2 bg-black/50 backdrop-blur rounded-full text-white"><ChevronLeft size={24} /></button>
        <span className="text-white font-bold">扫码签到</span>
        <div className="w-10" />
      </div>
      <div className="flex-1 flex items-center justify-center relative">
        <div className="relative w-64 h-64">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
          <div className={`absolute left-0 right-0 h-0.5 bg-${theme}-500 shadow-[0_0_15px_rgba(16,185,129,0.8)]`} style={{ animation: 'scan 2s ease-in-out infinite' }} />
        </div>
        <p className="absolute bottom-32 text-white/70 text-sm">将二维码放入框内即可自动扫描</p>
      </div>
      <div className="p-6 pb-safe">
        <button onClick={simulateScan} disabled={scanning} className={`w-full py-4 bg-${theme}-600 text-white rounded-xl font-bold shadow-lg disabled:opacity-50 flex items-center justify-center space-x-2`}>
          {scanning ? <RefreshCw size={20} className="animate-spin" /> : <QrCode size={20} />}
          <span>{scanning ? '扫描中...' : '模拟扫描'}</span>
        </button>
      </div>
      <style>{`@keyframes scan { 0% { top: 0%; } 50% { top: 100%; } 100% { top: 0%; } }`}</style>
    </div>
  );
};

// --- Main Mobile App Component ---
const AppMobile: React.FC = () => {
  const [activeTab, setActiveTab] = useState('DASHBOARD');
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'finance');
  
  const { hasPermission } = usePermissions(currentUser?.role || []);
  
  const [isOnline, setIsOnline] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  
  // Get theme colors
  const themeColors = getThemeColors(theme);
  const isDarkTheme = themeColors.isDark;

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
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [recommendationParams, setRecommendationParams] = useState<{
    resourceType: 'ROOM' | 'DESK';
    date: string;
    startTime: string;
    endTime: string;
    participants: number;
    requiredFeatures: string[];
  } | null>(null);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [expandedBookingIds, setExpandedBookingIds] = useState<Set<string>>(new Set());
  const [bookingConflict, setBookingConflict] = useState<any>(null);

  // 从 Supabase 加载初始数据
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        setSaveStatus('saving');
        
        console.log('正在连接 Supabase...');
        console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
        
        // 首先测试连接
        const isConnected = await testConnection();
        console.log('连接测试结果:', isConnected);
        
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

        // 如果数据库中没有用户数据，初始化默认数据
        if (usersData.length === 0) {
          console.log('数据库为空，初始化默认数据...');
          // 使用默认数据并保存到数据库
          for (const user of INITIAL_USERS) {
            try {
              await createUser(user);
            } catch (e) {
              console.error('创建用户失败:', e);
            }
          }
          for (const resource of INITIAL_RESOURCES) {
            try {
              await createResource(resource);
            } catch (e) {
              console.error('创建资源失败:', e);
            }
          }
          // 重新加载数据
          const [newUsers, newResources] = await Promise.all([
            getUsers(),
            getResources(),
          ]);
          setUsers(newUsers);
          setResources(newResources);
        } else {
          setUsers(usersData);
          setResources(resourcesData);
        }
        
        setBookings(bookingsData);
        setRoles(rolesData.length > 0 ? rolesData : INITIAL_ROLES);
        setDepartments(departmentsData.length > 0 ? departmentsData : INITIAL_DEPARTMENTS);
        setWorkflow(workflowData.length > 0 ? workflowData : DEFAULT_WORKFLOW);
        
        setIsOnline(true);
        setSaveStatus('saved');
      } catch (error: any) {
        console.error('从 Supabase 加载数据失败:', error);
        console.error('错误详情:', error.message, error.stack);
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
        addNotification('离线模式', `无法连接到服务器: ${error.message || '未知错误'}`, 'WARNING');
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

  const filteredResources = useMemo(() => {
    let filtered = resources;
    
    if (activeTab === 'MEETING_ROOMS') {
      filtered = resources.filter(r => r.type === 'ROOM');
    } else if (activeTab === 'WORKSTATIONS') {
      filtered = resources.filter(r => r.type === 'DESK');
    }
    
    return filtered.filter(r => 
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      r.location.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [resources, activeTab, searchQuery]);

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

  const handleBooking = async (data: any) => {
    const { resourceId, purpose, startTime, endTime, participants, hasLeader, leaderDetails, isVideoConference, needsTeaService } = data;
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
      hasLeader,
      leaderDetails,
      isVideoConference,
      needsTeaService
    };

    try {
      setSaveStatus('saving');
      const createdBooking = await createBooking(newBooking);
      setBookings(prev => [createdBooking, ...prev]);
      setShowBookingModal(false);
      
      const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      
      const timeInfo = `${formatDate(startTime)} - ${formatDate(endTime)}`;
      const statusInfo = workflow.length === 0 ? '已自动通过' : `需经 ${workflow.length} 级审批`;
      
      addNotification(
        "🎉 预约申请已提交", 
        `📍 ${resource.name}\n🕐 ${timeInfo}\n📋 ${purpose}\n✨ ${statusInfo}`, 
        "SUCCESS"
      );
      setSaveStatus('saved');
    } catch (error) {
      console.error('创建预约失败:', error);
      addNotification("❌ 预约失败", "网络错误，请稍后重试", "WARNING");
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
      
      const resource = resources.find(r => r.id === booking.resourceId);
      const applicant = users.find(u => u.id === booking.userId);
      const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      
      if (isLast) {
        addNotification(
          "✅ 审批完成", 
          `您已通过 ${applicant?.name || '用户'} 的预约申请\n📍 ${resource?.name || '资源'}\n🕐 ${formatDate(booking.startTime)}`, 
          "SUCCESS"
        );
      } else {
        const nextNode = workflow[booking.currentNodeIndex + 1];
        const nextRole = roles.find(r => r.id === nextNode?.approverRole);
        const nextApprovers = users.filter(u => u.role?.includes(nextNode?.approverRole));
        
        addNotification(
          "✅ 预审通过", 
          `已通过 ${applicant?.name || '用户'} 的预约申请\n📍 ${resource?.name || '资源'}\n🕐 ${formatDate(booking.startTime)}\n👉 下一审批: ${nextNode?.name || '未知'} (${nextRole?.name || '未知角色'})`, 
          "SUCCESS"
        );
      }
      setSaveStatus('saved');
    } catch (error) {
      console.error('审批失败:', error);
      addNotification("❌ 审批失败", "网络错误，请稍后重试", "WARNING");
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
      
      const resource = resources.find(r => r.id === booking.resourceId);
      const applicant = users.find(u => u.id === booking.userId);
      const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      
      addNotification(
        "❌ 申请已驳回", 
        `您已驳回 ${applicant?.name || '用户'} 的预约申请\n📍 ${resource?.name || '资源'}\n🕐 ${formatDate(booking.startTime)}\n📝 原因: ${comment || '无'}`, 
        "WARNING"
      );
      setSaveStatus('saved');
    } catch (error) {
      console.error('驳回失败:', error);
      addNotification("❌ 操作失败", "网络错误，请稍后重试", "WARNING");
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

  if (!currentUser) return <AuthView onLogin={setCurrentUser} theme={theme} isLoading={isLoading} />;

  return (
    <div className={`min-h-screen ${themeColors.bg} relative font-['IBM_Plex_Sans']`}>
      {/* Network Status Bar */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[1001] bg-amber-500 text-white px-4 py-2 flex items-center justify-center text-xs font-bold" style={{ maxWidth: '448px', margin: '0 auto' }}>
          <WifiOff size={14} className="mr-2" />
          离线模式 - 数据将在恢复连接后同步
        </div>
      )}

      {/* Toast Notifications */}
      <div className={`fixed left-4 right-4 z-[1000] space-y-2 pointer-events-none ${!isOnline ? 'top-10' : 'top-4'}`} style={{ maxWidth: '416px', margin: '0 auto', left: '16px', right: '16px' }}>
        {notifications.map(n => (
          <div key={n.id} className="w-full p-4 bg-white rounded-2xl shadow-lg border border-gray-100 flex items-start space-x-3 animate-in slide-in-from-top-4 fade-in pointer-events-auto">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.type === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600' : n.type === 'WARNING' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
              {n.type === 'SUCCESS' ? <CheckCircle size={16}/> : n.type === 'WARNING' ? <AlertTriangle size={16}/> : <Info size={16}/>}
            </div>
            <div className="flex-1 min-w-0">
              <h5 className="text-sm font-bold text-gray-800">{n.title}</h5>
              <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">{n.content}</p>
            </div>
            <button onClick={() => setNotifications(prev => prev.filter(item => item.id !== n.id))} className="text-gray-300 hover:text-gray-500 shrink-0"><X size={14}/></button>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <main className="pb-20">
        {activeTab === 'DASHBOARD' && (
          <div className="animate-in fade-in font-['IBM_Plex_Sans']">
            {/* Header */}
            <div className={`${themeColors.primary} ${themeColors.text} p-4 pb-6`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <ShieldCheck size={24} />
                  <span className="text-lg font-black italic">SmartOffice</span>
                </div>
                <div className="flex items-center space-x-3">
                  <button onClick={() => setShowQRScanner(true)} className="p-2 bg-white/10 rounded-full">
                    <QrCode size={18} />
                  </button>
                  <button className="p-2 bg-white/10 rounded-full relative">
                    <Bell size={18} />
                    {pendingCount > 0 && (
                      <span className={`absolute -top-0.5 -right-0.5 w-4 h-4 ${themeColors.accent} text-white text-[10px] font-bold rounded-full flex items-center justify-center`}>
                        {pendingCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center font-bold">
                  {currentUser.name[0]}
                </div>
                <div>
                  <p className="font-bold">{currentUser.name}</p>
                  <p className="text-xs text-white/70">{currentUser.department}</p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="px-4 mt-4">
              <div className="grid grid-cols-3 gap-3">
                <button 
                  onClick={() => {
                    setShowRecommendation(true);
                  }}
                  className="bg-violet-500 text-white p-4 rounded-2xl shadow-lg active:scale-[0.98] transition-transform text-left"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Sparkles size={20} />
                  </div>
                  <p className="font-bold text-sm">智能推荐</p>
                </button>
                <button 
                  onClick={() => setActiveTab('MEETING_ROOMS')}
                  className="bg-amber-500 text-slate-900 p-4 rounded-2xl shadow-lg active:scale-[0.98] transition-transform text-left"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Monitor size={20} />
                    <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{stats.availableRooms}</span>
                  </div>
                  <p className="font-bold text-sm">会议室</p>
                </button>
                <button 
                  onClick={() => setActiveTab('WORKSTATIONS')}
                  className="bg-yellow-500 text-slate-900 p-4 rounded-2xl shadow-lg active:scale-[0.98] transition-transform text-left"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Coffee size={20} />
                    <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{stats.availableDesks}</span>
                  </div>
                  <p className="font-bold text-sm">工位</p>
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="px-4 mt-4">
              <div className="grid grid-cols-3 gap-3">
                <MobileStatCard title="资源总量" value={stats.totalResources} icon={MapPin} color={isDarkTheme ? 'amber' : theme} isDark={isDarkTheme} />
                <MobileStatCard title="活跃预约" value={stats.activeBookings} icon={Activity} color={isDarkTheme ? 'emerald' : 'emerald'} isDark={isDarkTheme} />
                <MobileStatCard title="待审批" value={pendingCount} icon={ShieldCheck} color={isDarkTheme ? 'purple' : 'amber'} onClick={() => setActiveTab('APPROVAL_CENTER')} isDark={isDarkTheme} />
              </div>
            </div>

            {/* Recent Bookings Preview */}
            <div className="px-4 mt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className={`font-bold ${themeColors.text}`}>最近预约</h3>
                <button onClick={() => setActiveTab('BOOKINGS')} className={`${themeColors.lightColor} text-xs font-bold`}>
                  查看全部
                </button>
              </div>
              {myBookings.slice(0, 3).map(booking => (
                <div key={booking.id} className={`${themeColors.bg} p-3 rounded-xl border ${themeColors.border} mb-2 flex items-center justify-between`}>
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 rounded-lg ${booking.type === 'ROOM' ? (theme === 'finance' ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-50 text-indigo-600') : (theme === 'finance' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600')} flex items-center justify-center`}>
                      {booking.type === 'ROOM' ? <Monitor size={14} /> : <Briefcase size={14} />}
                    </div>
                    <div>
                      <p className={`font-bold text-sm ${themeColors.text} line-clamp-1`}>{booking.purpose}</p>
                      <p className={`text-[10px] ${theme === 'finance' ? 'text-slate-400' : 'text-gray-400'}`}>{booking.startTime.split('T')[0]}</p>
                    </div>
                  </div>
                  <StatusBadge status={booking.status} theme={theme} />
                </div>
              ))}
              {myBookings.length === 0 && (
                <div className={`text-center py-8 ${themeColors.text} text-sm opacity-70`}>
                  暂无预约记录
                </div>
              )}
            </div>
          </div>
        )}

        {(activeTab === 'MEETING_ROOMS' || activeTab === 'WORKSTATIONS') && (
          <div className="animate-in fade-in min-h-screen">
            {/* Header */}
            <div className={`sticky top-0 z-10 border-b ${themeColors.border} p-4`} style={{ backgroundColor: '#1E293B' }}>
              <div className="flex items-center space-x-3">
                <button onClick={() => setActiveTab('DASHBOARD')} className="p-2 -ml-2 text-white/60">
                  <ChevronLeft size={24} />
                </button>
                <h1 className="text-lg font-bold text-white">
                  {activeTab === 'MEETING_ROOMS' ? '会议室预订' : '工位申请'}
                </h1>
              </div>
              <div className="mt-3 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`搜索${activeTab === 'MEETING_ROOMS' ? '会议室' : '工位'}名称或位置...`}
                  className="w-full pl-10 pr-4 py-2.5 bg-[#334155] border border-[#475569] rounded-xl outline-none text-sm text-white placeholder-white/40"
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
                  onBook={() => {
                    setSelectedResource(resource);
                    setShowBookingModal(true);
                  }}
                  onViewCalendar={() => {}}
                />
              ))}
              {filteredResources.length === 0 && (
                <div className="text-center py-12 text-white/50">
                  <Search size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="text-sm">未找到匹配的资源</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'BOOKINGS' && (
          <div className="animate-in fade-in min-h-screen">
            {/* Header */}
            <div className={`sticky top-0 z-10 border-b ${themeColors.border} p-4`} style={{ backgroundColor: '#1E293B' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <button onClick={() => setActiveTab('DASHBOARD')} className="p-2 -ml-2 text-white/60">
                    <ChevronLeft size={24} />
                  </button>
                  <h1 className="text-lg font-bold text-white">我的申请</h1>
                </div>
                <span className="text-xs font-bold text-white/70 bg-[#334155] px-3 py-1 rounded-full">
                  {myBookings.length} 条
                </span>
              </div>
            </div>

            {/* Bookings List */}
            <div className="p-4 space-y-3">
              {myBookings.length === 0 ? (
                <div className="text-center py-16 text-white/50">
                  <History size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="text-sm">暂无预约申请记录</p>
                  <button 
                    onClick={() => setActiveTab('MEETING_ROOMS')}
                    className={`mt-4 px-6 py-2 ${themeColors.accent} text-white rounded-xl font-bold text-sm`}
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
          hasPermission(PERMISSIONS.VIEW_APPROVAL_CENTER) ? (
          <div className="animate-in fade-in min-h-screen">
            {/* Header */}
            <div className={`sticky top-0 z-10 border-b ${themeColors.border} p-4`} style={{ backgroundColor: '#1E293B' }}>
              <div className="flex items-center space-x-3">
                <button onClick={() => setActiveTab('DASHBOARD')} className="p-2 -ml-2 text-white/60">
                  <ChevronLeft size={24} />
                </button>
                <div>
                  <h1 className="text-lg font-bold text-white">审批工作台</h1>
                  <p className="text-xs text-white/70">{pendingCount} 项待处理</p>
                </div>
              </div>
            </div>

            {/* Approval List */}
            <div className="p-4 space-y-3">
              {bookings.filter(b => canApprove(b)).length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-20 h-20 bg-[#334155] rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle size={40} className="text-white/30" />
                  </div>
                  <p className="text-white/70 font-bold">所有任务已处理完毕</p>
                  <p className="text-xs text-white/50 mt-1">保持高效！</p>
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
          ) : <NoPermissionView theme={theme} />
        )}

        {activeTab === 'USERS' && (
          hasPermission(PERMISSIONS.MANAGE_USERS) ? (
            <UserManagement
              users={users}
              departments={departments}
              roles={roles}
              theme={theme}
              onBack={() => setActiveTab('PROFILE')}
              onUpdate={setUsers}
            />
          ) : <NoPermissionView theme={theme} />
        )}

        {activeTab === 'ROLES' && (
          hasPermission(PERMISSIONS.MANAGE_ROLES) ? (
            <RoleManagement
              roles={roles}
              theme={theme}
              onBack={() => setActiveTab('PROFILE')}
              onUpdate={setRoles}
            />
          ) : <NoPermissionView theme={theme} />
        )}

        {activeTab === 'DEPARTMENTS' && (
          hasPermission(PERMISSIONS.MANAGE_DEPARTMENTS) ? (
            <DepartmentManagement
              departments={departments}
              theme={theme}
              onBack={() => setActiveTab('PROFILE')}
              onUpdate={setDepartments}
            />
          ) : <NoPermissionView theme={theme} />
        )}

        {activeTab === 'RESOURCES_MANAGE' && (
          hasPermission(PERMISSIONS.MANAGE_RESOURCES) ? (
            <ResourceManagement
              resources={resources}
              theme={theme}
              onBack={() => setActiveTab('PROFILE')}
              onUpdate={setResources}
            />
          ) : <NoPermissionView theme={theme} />
        )}

        {activeTab === 'RECOMMENDATION_CONFIG' && (
          hasPermission(PERMISSIONS.CONFIGURE_RECOMMENDATION) ? (
            <RecommendationConfigView
              theme={theme}
              onBack={() => setActiveTab('PROFILE')}
            />
          ) : <NoPermissionView theme={theme} />
        )}

        {activeTab === 'WORKFLOW_CONFIG' && (
          hasPermission(PERMISSIONS.CONFIG_WORKFLOW) ? (
            <WorkflowManagement
              workflow={workflow}
              roles={roles}
              theme={theme}
              onBack={() => setActiveTab('PROFILE')}
              onUpdate={setWorkflow}
            />
          ) : <NoPermissionView theme={theme} />
        )}

        {activeTab === 'DATA_CENTER' && (
          hasPermission(PERMISSIONS.ACCESS_DATA_CENTER) ? (
          <DataCenter
            users={users}
            resources={resources}
            bookings={bookings}
            departments={departments}
            theme={theme}
            onBack={() => setActiveTab('PROFILE')}
          />
          ) : <NoPermissionView theme={theme} />
        )}

        {activeTab === 'PROFILE' && (
          <ProfileView
            currentUser={currentUser}
            users={users}
            roles={roles}
            theme={theme}
            onLogout={() => setCurrentUser(null)}
            onViewChange={setActiveTab}
            onThemeChange={setTheme}
          />
        )}

        {activeTab === 'PROFILE_EDIT' && (
          <ProfileEditView
            currentUser={currentUser}
            departments={departments.map(d => d.name)}
            theme={theme}
            onBack={() => setActiveTab('PROFILE')}
            onUpdate={(updatedUser) => {
              setCurrentUser(updatedUser);
              setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
            }}
          />
        )}

        {activeTab === 'MEETING_SERVICE' && (
          hasPermission(PERMISSIONS.VIEW_MEETING_SERVICE) ? (
            <MeetingServiceView
              bookings={bookings}
              resources={resources}
              users={users}
              theme={theme}
            />
          ) : <NoPermissionView theme={theme} />
        )}
      </main>

      {/* Bottom Navigation */}
      <BottomNav 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        theme={theme}
        pendingCount={pendingCount}
        userRoles={currentUser?.role || []}
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
        selectedResource.type === 'DESK' ? (
          <DeskBookingFormModal
            resource={selectedResource}
            bookings={bookings}
            theme={theme}
            onClose={() => setShowBookingModal(false)}
            onConfirm={handleBooking}
          />
        ) : (
          <RoomBookingFormModal
            resource={selectedResource}
            bookings={bookings}
            theme={theme}
            onClose={() => setShowBookingModal(false)}
            onConfirm={handleBooking}
          />
        )
      )}

      {showRecommendation && currentUser && (
        <SmartRecommendationDialog
          resources={resources}
          userBookings={bookings}
          theme={theme}
          onSelect={(resource) => {
            setSelectedResource(resource);
            setShowBookingModal(true);
          }}
          onClose={() => setShowRecommendation(false)}
        />
      )}

      {bookingConflict && (
        <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4" style={{ maxWidth: '448px', margin: '0 auto' }}>
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
