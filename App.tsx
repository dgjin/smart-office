import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  PanelLeftClose, PanelLeftOpen, LockOpen, CircleHelp, MonitorPlay, DoorOpen
} from 'lucide-react';
import { User, Resource, Booking, Role, BookingStatus, ResourceType, ApprovalNode, ApprovalRule, ApprovalDelegate, AuditEvent, Department, RoleDefinition, ResourceStatus, Notification, WorkOrder, RoomFeature, ResourceImportReport, BookingRuleSettings, MeetingType, ConfidentialityChoice, BookingServiceRequirement, AuditoriumSetup, ApprovalRuleSetVersion, ConfidentialWhitelistEntry, ConfidentialityAuthorization, ConfidentialAuthorizationTarget, ServiceCatalogItem, ServiceArea, ServiceShift, ServiceInspection, CheckInEvent, BookingUsageFact, UsageAppeal, DashboardSnapshot, DoorDevice, OperationalException, WorkflowVersion } from './types';
import { formatDate, formatTime, migrateBookings, pad2, toLocalDateString, toLocalDateTimeString, toLocalTimeString } from './utils/dateTime';
import { BOOKING_DISPLAY_STATUS_LABELS, findAttendeeOverlaps, findAvailableRooms, findBookingConflicts, findNextAvailableSlot, getBookingDisplayStatus, getDailyOccurrenceCount, getLongTermMaxEndDate, hasBookingConflict, isActiveBooking, isResourceAcceptingBookings, isValidBookingPurpose, resourceSupportsFeature, splitBookingByNaturalDay, validateBookingResource } from './utils/bookingRules';
import { validateBookingDraft } from './utils/bookingDraft';
import { formatUserError } from './utils/userErrors';
import { filterResources } from './utils/resourceSearch';
import { getApprovalGroups, getBookingWorkflow } from './utils/approval';
import { getResourceBuilding, getResourceFloor, getRoomCategory } from './utils/resourceDomain';
import { addLocalDays, bookingEffectiveEnd, calculateResourceOccupancy, countsTowardOccupancy, localDateKey, resourceOpenMinutes, startOfLocalDay } from './utils/dashboard';
import { parseCheckInQr } from './utils/checkInQr';
import { type AgentAction } from './components/ChatDock';
import { canUseHelpTopic, getHelpTopic, type SystemView } from './helpCatalog';
import { canViewMonitoring } from './utils/monitoringAccess';
import ServiceOperations, { BookingUsageActions } from './components/ServiceOperations';
import ExceptionCenter from './components/ExceptionCenter';
import DeviceManagement from './components/DeviceManagement';
import BuildingExplorer, { BUILDINGS, getFloorNumbers, type BuildingId } from './components/BuildingExplorer';
import { DEFAULT_RULE_SETTINGS, SERVICE_TYPE_LABELS } from './constants';

const ChatDock = React.lazy(() => import('./components/ChatDock'));
const HelpDrawer = React.lazy(() => import('./components/HelpDrawer'));
const OperationsReports = React.lazy(() => import('./components/OperationsReports'));
const MonitoringScreen = React.lazy(() => import('./components/MonitoringScreen'));

type AppView = SystemView;
const MONITORING_ROUTES: Partial<Record<AppView, string>> = {
  MONITORING_ROOMS: '/monitoring/meeting-rooms',
  MONITORING_OFFICES: '/monitoring/offices'
};
const monitoringViewFromHash = (hash: string): AppView | null => {
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  return (Object.entries(MONITORING_ROUTES).find(([, route]) => route === path)?.[0] as AppView | undefined) || null;
};
const syncMonitoringUrl = (target: AppView, replace = false) => {
  const route = MONITORING_ROUTES[target];
  if (!route && !monitoringViewFromHash(window.location.hash)) return;
  const url = `${window.location.pathname}${window.location.search}${route ? `#${route}` : ''}`;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
};
type Hq3dTarget = NonNullable<AgentAction['hq3d']>;
type Hq3dLocation = Hq3dTarget & { navigationId: number };
const buildHq3dSrc = (theme: string, target: Hq3dLocation | null) => {
  const params = new URLSearchParams({ theme: theme === 'coamc' ? 'coamc' : 'classic' });
  if (target) {
    params.set('buildingId', target.buildingId);
    if (target.floorNo) params.set('floorNo', String(target.floorNo));
    if (target.roomUid) params.set('roomUid', target.roomUid);
    params.set('navigationId', String(target.navigationId));
  }
  return `/hq3d.html?${params.toString()}`;
};
type NavItem = { id: AppView; label: string; shortLabel: string; icon: React.ElementType; badge?: number; href?: string };

// --- Theme Config ---
const THEMES = [
  { id: 'coamc', name: '东方蓝', color: 'bg-coamc-600', text: 'text-coamc-600', border: 'border-coamc-100', bg: 'bg-coamc-50' },
  { id: 'indigo', name: '商务蓝', color: 'bg-indigo-600', text: 'text-indigo-600', border: 'border-indigo-100', bg: 'bg-indigo-50' },
  { id: 'emerald', name: '翡翠绿', color: 'bg-emerald-600', text: 'text-emerald-600', border: 'border-emerald-100', bg: 'bg-emerald-50' },
  { id: 'orange', name: '活力橙', color: 'bg-orange-600', text: 'text-orange-600', border: 'border-orange-100', bg: 'bg-orange-50' },
  { id: 'rose', name: '胭脂红', color: 'bg-rose-600', text: 'text-rose-600', border: 'border-rose-100', bg: 'bg-rose-50' },
  { id: 'purple', name: '极光紫', color: 'bg-purple-600', text: 'text-purple-600', border: 'border-purple-100', bg: 'bg-purple-50' },
];

const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  NORMAL: '普通', IMPORTANT: '重要', CONFIDENTIAL: '涉密'
};

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
  INVALID_PARTICIPANTS: '参与人数必填，且必须为大于 0 的整数。',
  CAPACITY_EXCEEDED: '参与人数超过会议室当前容量，请减少人数或更换会议室。',
  REQUIRED_FEATURE_UNAVAILABLE: '会议室当前设备不满足预约要求，请调整设备需求或更换会议室。',
  ACTIVE_BOOKINGS_REQUIRE_REVIEW: '仍有未结束的有效预约，请先取消或改期后再切换维护状态。',
  INVALID_BOOKING_PURPOSE: '请填写 200 字以内且有明确主题的申请用途，不能只填写“会议”或“开会”。',
  MEETING_TYPE_REQUIRED: '请选择普通、重要或涉密会议类型。',
  CONFIDENTIALITY_CHOICE_REQUIRED: '请明确选择本会议是否涉密。',
  CONFIDENTIALITY_TYPE_MISMATCH: '会议类型与涉密选择不一致，涉密会议必须选择“涉密”。',
  CONTACT_SNAPSHOT_INCOMPLETE: '当前用户档案中的姓名、座机或手机不完整，请先联系管理员补齐。',
  INVALID_SERVICE_REQUIREMENTS: '服务需求格式不正确，请检查后重试。',
  SERVICE_DETAILS_REQUIRED: '选择其他服务后，请填写具体服务说明。',
  AUDITORIUM_SETUP_REQUIRED: '请完整填写礼堂座位布局和舞台需求。',
  INVALID_AUDITORIUM_REHEARSAL: '彩排时长应为 0 至 1440 分钟的整数。',
  INVALID_AUDITORIUM_NOTES: '礼堂备注不能超过 500 字。',
  BOOKING_START_IN_PAST: '预约开始时间已过，请重新选择。',
  RESOURCE_OUTSIDE_OPEN_HOURS: '预约时间超出资源开放时段，请调整后重试。',
  EXCLUSIVE_REQUEST_WINDOW_CLOSED: '专属会议室仅在会前配置时限内接受临时申请。',
  EXCLUSIVE_LEADER_REQUIRED: '专属会议室仅适用于公司领导参会的会议，请确认领导参会。',
  EXCLUSIVE_REQUEST_REASON_REQUIRED: '请填写 2 至 500 字的专属会议室临时申请理由。',
  REQUESTER_TIME_CONFLICT: '您在相同时段已有其他预约，请调整时间。',
  DEPARTMENT_DAILY_QUOTA_EXCEEDED: '部门在当前会议室当日净预约额度不足，请缩短时长、更换会议室或日期。',
  REQUESTER_DEPARTMENT_NOT_FOUND: '申请人部门档案不完整，请联系管理员维护。',
  MULTI_RESOURCE_BOOKING_NOT_SUPPORTED: '普通联合预约暂未开放，请按单个资源分别申请。',
  LONG_TERM_LIMIT_EXCEEDED: '单期长期预订超过当前规则上限，请缩短截止日期。',
  RENEWAL_EXISTS: '本期已有审批中或已核准的续期，请勿重复提交。',
  INVALID_RENEWAL_START: '续期必须晚于当前周期，请重新发起。',
  INVALID_RENEWAL: '续期信息已变化，请重新打开续期表单。',
  INVALID_LONG_TERM_SERIES: '长期预订数据不完整，请重新提交。',
  CONFIDENTIAL_WHITELIST_REQUIRED: '申请人及全部参会人都必须在涉密白名单内，请联系保密管理员处理。',
  CONFIDENTIAL_DECLASSIFY_DUAL_AUTHORIZATION_REQUIRED: '涉密降级需要两名不同授权人的有效授权。',
  CONFIDENTIAL_ATTENDEE_AUTHORIZATION_REQUIRED: '涉密参会范围变化需要一名授权人的有效授权。',
  INVALID_CONFIDENTIALITY_AUTHORIZATION: '授权记录无效、已使用或授权人不符合要求，请重新申请授权。',
  CONFIDENTIAL_EXPORT_FORBIDDEN: '当前账号无权导出该涉密会议日历。',
  CONFIDENTIAL_SELF_AUTHORIZATION: '申请人不能为自己的涉密变更授权。',
  CONFIDENTIAL_BOOKING_NOT_EDITABLE: '仅待审批的涉密申请可以创建变更授权。',
  DUPLICATE_CONFIDENTIAL_WHITELIST_USER: '该成员已在涉密白名单内。',
  CONFIDENTIAL_WHITELIST_NOT_FOUND: '白名单记录已变化，请刷新后重试。',
  INVALID_CONFIDENTIALITY_ACTION: '请选择有效的涉密变更类型。',
  CONFIDENTIAL_WHITELIST_REASON: '请填写白名单设置理由。',
  CONFIDENTIALITY_AUTHORIZATION_REASON: '请填写授权理由。',
  SERVICE_CATALOG_ITEM_NOT_FOUND: '服务目录项已变化，请刷新后重试。',
  SERVICE_NOT_AVAILABLE_FOR_RESOURCE: '所选服务不适用于当前资源，请调整服务需求。',
  SERVICE_FIELD_REQUIRED: '请完整填写服务必填字段。',
  INVALID_SERVICE_FIELD_VALUE: '服务字段格式不正确，请检查数字、选项和文字长度。',
  WORK_ORDER_FIELD_VALUES_REQUIRED: '请按冻结目录模板填写待定服务信息。',
  INVALID_WORK_ORDER_TRANSITION: '工单状态已变化，当前操作不可执行，请刷新后重试。',
  WORK_ORDER_REASON_REQUIRED: '请填写工单操作原因。',
  WORK_ORDER_EXECUTION_RESULT_REQUIRED: '请填写服务执行结果。',
  WORK_ORDER_NOT_CANCELLABLE: '该服务不可撤销，请登记异常并保留执行记录。',
  CANCELLATION_AUTHORIZATION_REQUIRED: '已进入取消授权时限，请联系审批负责人或系统管理员处理。',
  BOOKING_NOT_CHECKABLE: '当前预约状态不可签到，请刷新后核对。',
  BOOKING_ALREADY_CHECKED_IN: '该预约已签到，请勿重复操作。',
  CHECK_IN_EVENT_NOT_FOUND: '当前没有可纠错或撤销的签到事件。',
  CHECK_IN_CORRECTION_REASON_REQUIRED: '签到纠错或撤销必须由会务人员填写原因。',
  CHECK_IN_OUTSIDE_WINDOW: '签到时间不在允许窗口内，请核对会议时段。',
  INVALID_CHECK_IN_TIME: '签到时间无效，请重新填写。',
  CHECK_IN_SUBJECT_NOT_PARTICIPANT: '签到成员不在申请人或参会人范围内。',
  QR_CHECK_IN_REQUIRES_SELF: '二维码签到仅限本人操作，其他成员请由会务人员人工登记。',
  QR_CHECK_IN_SCHEDULE_STALE: '二维码对应已改期或恢复前的预约，请扫描最新二维码。',
  INVALID_QR_CHECK_IN: '二维码缺少有效的预约版本，请使用最新会议二维码。',
  INVALID_CHECK_IN_INPUT: '签到请求无效，请刷新后重试。',
  BOOKING_NOT_RELEASABLE: '当前预约状态不可释放，请刷新后核对。',
  RELEASE_REASON_REQUIRED: '请填写 500 字以内的释放原因。',
  BOOKING_NOT_COMPLETABLE: '当前会议不满足提前结束条件，请确认已签到且仍在会议时段内。',
  BOOKING_NOT_CONFIRMABLE: '仅已核准预约可以确认实际使用。',
  INVALID_USAGE_CONFIRMATION: '请选择正常使用或确认未使用。',
  USAGE_CONFIRMATION_NOTE_REQUIRED: '确认未使用时必须填写原因，说明不能超过 500 字。',
  BOOKING_NOT_APPEALABLE: '仅本人因未签到、确认未使用或人工异常释放的预约可以申诉，主动取消不可申诉。',
  INVALID_APPROVAL_RULE_SET: '规则集配置不完整，请检查默认流程和规则列表。',
  INVALID_APPROVAL_RULE: '规则配置无效，请检查条件、优先级和目标流程。',
  APPROVAL_RULE_SET_CHANGED: '规则集已由其他管理员更新，请刷新后重新修改。',
  APPROVAL_RULE_SET_UNCHANGED: '规则集没有变化，无需重复发布。',
  DUPLICATE_APPROVAL_RULE_ID: '规则标识重复，请修改后再发布。',
  DUPLICATE_APPROVAL_RULE_PRIORITY: '规则优先级不能重复，请调整后再发布。',
  USAGE_APPEAL_EXISTS: '该预约已有待处理申诉，请勿重复提交。',
  USAGE_APPEAL_REASON_REQUIRED: '请填写 2 至 1000 字的申诉理由。',
  USAGE_APPEAL_NOT_FOUND: '申诉不存在或已处理，请刷新后查看结果。',
  INVALID_USAGE_APPEAL_DECISION: '请选择恢复预约或驳回申诉。',
  USAGE_APPEAL_RESOLUTION_NOTE_REQUIRED: '请填写 1000 字以内的申诉处理意见。',
  BOOKING_RESTORE_WINDOW_CLOSED: '预约已结束或状态已变化，不能恢复。'
};

const downloadBookingIcs = async (booking: Booking) => {
  const response = await fetch(`/api/bookings/${encodeURIComponent(booking.id)}/ics`);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(formatUserError(result, '日历导出失败，请稍后重试。', BOOKING_ERROR_MESSAGES));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `booking-${booking.id.replace(/[^A-Za-z0-9_-]/g, '_')}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
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

const BookingStatusBadge = ({ booking, theme }: { booking: Booking; theme: string }) => {
  const status = getBookingDisplayStatus(booking);
  const styles: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-600 border-amber-100',
    UPCOMING: `bg-${theme}-50 text-${theme}-600 border-${theme}-100`,
    IN_PROGRESS: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    NO_SHOW: 'bg-rose-50 text-rose-600 border-rose-100',
    RELEASED: 'bg-gray-100 text-gray-500 border-gray-200',
    ENDED_EARLY: 'bg-amber-50 text-amber-600 border-amber-100',
    COMPLETED: 'bg-gray-100 text-gray-500 border-gray-200',
    CANCELLED: 'bg-gray-100 text-gray-500 border-gray-200',
    REJECTED: 'bg-rose-50 text-rose-600 border-rose-100'
  };
  return <span className={`status-badge status-${status.toLowerCase()} ${styles[status]}`}>{BOOKING_DISPLAY_STATUS_LABELS[status]}</span>;
};

const RoleTag = ({ roleId, roles, theme }: any) => {
  const role = roles.find((r: any) => r.id === roleId);
  if (!role) return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">未知</span>;
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold bg-${role.color}-100 text-${role.color}-700 border border-${role.color}-200`}>{role.name}</span>;
};

const SidebarItem = ({ icon: Icon, label, id, active, onClick, badge, href }: any) => {
  const content = <><Icon size={17} strokeWidth={1.7} /><span>{label}</span>{badge > 0 && <span className="studio-nav-count">{badge}</span>}</>;
  const shared = { className: 'studio-nav-item', 'data-active': active, 'aria-current': active ? 'page' as const : undefined, 'aria-label': label, title: label };
  return href
    ? <a {...shared} href={href} onClick={event => { event.preventDefault(); onClick(id); }}>{content}</a>
    : <button {...shared} type="button" onClick={() => onClick(id)}>{content}</button>;
};

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
  { id: 'TODAY', label: '今日', code: 'DAY', description: '全部资源 · 实际开放时段 · 点击非涉密会议查看详情' },
  { id: 'WEEK', label: '本周', code: '7 DAYS', description: '未来 7 天五档占用率与重点会议 · 点击日期查看详情' },
  { id: 'MONTH', label: '本月', code: '30 DAYS', description: '未来 30 天五档占用率 · 点击日期查看详情' }
] as const;
type ScheduleRange = typeof SCHEDULE_RANGES[number]['id'];

const QRScannerModal = ({ theme, bookings, resources, onClose, onCheckIn }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const modalRef = useModalA11y(onClose);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const bookingsRef = useRef(bookings);
  const onCheckInRef = useRef(onCheckIn);
  const onCloseRef = useRef(onClose);
  bookingsRef.current = bookings;
  onCheckInRef.current = onCheckIn;
  onCloseRef.current = onClose;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let active = true;
    let detecting = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startCamera = async () => {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setError('当前浏览器不支持实时二维码解码，请使用下方人工签到。');
        return;
      }
      try {
        const detector = new Detector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!active || !videoRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        setScanning(true);
        const detect = async () => {
          if (!active || detecting) return;
          detecting = true;
          try {
            const video = videoRef.current;
            if (video?.readyState >= 2) {
              const results = await detector.detect(video);
              const value = String(results[0]?.rawValue || '').trim();
              if (value) {
                const parsed = parseCheckInQr(value);
                const booking = parsed && bookingsRef.current.find((item: Booking) => item.id === parsed.bookingId);
                if (!parsed || !booking) {
                  setError('二维码未对应当前可签到会议，或缺少预约版本，请使用最新会议二维码。');
                } else if (parsed.scheduleVersion !== (booking.scheduleVersion || 1)) {
                  setError('二维码对应已改期或恢复前的预约，请扫描最新二维码。');
                } else if (!navigator.onLine) {
                  setError('当前离线，扫码签到不可用；未保存任何签到，请联网后重试。');
                } else {
                  const succeeded = await onCheckInRef.current(booking.id, 'QR', parsed.scheduleVersion);
                  if (succeeded) {
                    active = false;
                    setScanning(false);
                    onCloseRef.current();
                    return;
                  }
                  setError('服务端未完成签到，请检查签到窗口或改用下方人工签到。');
                }
              }
            }
          } catch {
            if (active) setError('二维码识别暂时失败，请调整距离或改用人工签到。');
          } finally {
            detecting = false;
            if (active) timer = setTimeout(detect, 250);
          }
        };
        void detect();
      } catch {
        setError('无法访问摄像头，请检查浏览器权限或使用下方人工签到。');
      }
    };
    void startCamera();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
    };
  }, []);

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="会议签到" className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-md p-6 md:p-8 shadow-2xl animate-in zoom-in overflow-y-auto max-h-[90vh] relative">
        <button onClick={onClose} aria-label="关闭签到" className="absolute top-6 right-6 p-2 bg-gray-100 rounded-xl text-gray-500 hover:text-rose-500 z-10"><X size={20}/></button>
        <div className="text-center mb-5">
          <h3 className="text-xl font-black text-gray-800">扫码或人工签到</h3>
          <p className="text-xs text-gray-500 font-medium mt-1">开始前 15 分钟开放；扫码结果仅用于定位预约，签到事实由服务端校验并保存</p>
        </div>
        <div className="relative aspect-video bg-gray-900 rounded-3xl overflow-hidden mb-5 border-4 border-gray-100 flex items-center justify-center">
          <video ref={videoRef} autoPlay playsInline muted aria-label="二维码扫描画面" className={`absolute inset-0 w-full h-full object-cover ${scanning ? '' : 'hidden'}`} />
          {scanning ? <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/80"><span className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/60 px-3 py-1 text-[10px] font-bold text-white">对准会议签到二维码</span></div> : <p role="status" className="p-6 text-center text-white text-xs font-bold">{error || '正在启动摄像头…'}</p>}
        </div>
        {error && scanning && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700">{error}</p>}
        <div className="space-y-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">人工签到</p>
          {bookings.map((b: Booking) => <button key={b.id} onClick={async () => { if (await onCheckIn(b.id, 'MANUAL')) onClose(); }} className={`w-full p-4 rounded-2xl bg-${theme}-50 border border-${theme}-100 text-left hover:bg-${theme}-100 transition-colors`}>
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm font-black text-gray-800">{b.purpose}</p><p className="text-[11px] text-gray-500 mt-1">{resources.find((r: Resource) => r.id === b.resourceId)?.name} · {toLocalDateTimeString(b.startTime)} - {toLocalTimeString(b.endTime)}</p></div>
              <span className={`shrink-0 px-3 py-2 rounded-xl bg-${theme}-600 text-white text-xs font-black`}>本人签到</span>
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

const TodayResourceUsage = ({ resources, bookings, users, onBookingClick }: any) => {
  const [zoom, setZoom] = useState<30 | 60>(60);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const dayStart = startOfLocalDay(now);
  const dayEnd = addLocalDays(dayStart, 1);
  const dailyBookings = bookings.filter((booking: Booking) => {
    const status = getBookingDisplayStatus(booking, now);
    return !['PENDING', 'REJECTED', 'CANCELLED'].includes(status)
      && Date.parse(booking.startTime) < dayEnd.getTime()
      && Date.parse(booking.actualEndTime || booking.releasedAt || booking.endTime) > dayStart.getTime();
  });
  const range = useMemo(() => {
    const open = resources.map((resource: Resource) => resourceOpenMinutes(resource));
    let start = Math.min(8 * 60, ...open.map((item: { start: number }) => item.start));
    let end = Math.max(20 * 60, ...open.map((item: { end: number }) => item.end));
    dailyBookings.forEach((booking: Booking) => {
      const bookingStart = new Date(booking.startTime);
      const bookingEnd = new Date(booking.actualEndTime || booking.releasedAt || booking.endTime);
      if (bookingStart < dayEnd && bookingEnd > dayStart) {
        start = Math.min(start, bookingStart < dayStart ? 0 : bookingStart.getHours() * 60 + bookingStart.getMinutes());
        end = Math.max(end, bookingEnd > dayEnd ? 1440 : bookingEnd.getHours() * 60 + bookingEnd.getMinutes());
      }
    });
    return { start: Math.floor(start / 30) * 30, end: Math.min(1440, Math.ceil(end / 30) * 30) };
  }, [resources, bookings, localDateKey(now)]);
  const totalMinutes = Math.max(30, range.end - range.start);
  const ticks = Array.from({ length: Math.floor(totalMinutes / zoom) + 1 }, (_, index) => range.start + index * zoom);
  const groups = useMemo(() => {
    const floorRank = (floor?: number) => floor === 16 ? 0 : floor === 19 ? 1 : floor === 20 ? 2 : 3;
    const sorted = [...resources].sort((a: Resource, b: Resource) => floorRank(a.floor) - floorRank(b.floor)
      || (a.floor ?? 999) - (b.floor ?? 999) || String(a.code || a.id).localeCompare(String(b.code || b.id), 'zh-CN', { numeric: true }));
    const result: Array<{ key: string; label: string; resources: Resource[] }> = [];
    sorted.forEach((resource: Resource) => {
      const primaryFloor = resource.floor === 16 || resource.floor === 19 || resource.floor === 20;
      const key = primaryFloor ? `floor:${resource.floor}` : 'other';
      const label = primaryFloor ? `${resource.floor}层` : '其他楼层';
      let group = result.find(item => item.key === key);
      if (!group) { group = { key, label, resources: [] }; result.push(group); }
      group.resources.push(resource);
    });
    return result;
  }, [resources]);
  const currentMinutes = (now.getTime() - dayStart.getTime()) / 60000;
  const nowLeft = (currentMinutes - range.start) / totalMinutes * 100;
  const canOpenDetails = (booking: Booking) => Boolean(booking.userId)
    && booking.meetingType !== 'CONFIDENTIAL' && booking.confidentialityChoice !== 'CONFIDENTIAL';
  return (
    <div className="studio-timeline overflow-x-auto" aria-label="当日全部资源时间轴">
      <div className="timeline-toolbar">
        <div className="timeline-legend" aria-label="时间轴状态图例">
          {[['in-progress', '使用中'], ['starting', '即将开始'], ['upcoming', '待开始'], ['completed', '已结束'], ['confidential', '涉密不可见'], ['exception', '释放或异常']].map(([status, label]) =>
            <span key={status}><i className={`timeline-legend-swatch timeline-status-${status}`}/>{label}</span>)}
        </div>
        <div className="timeline-zoom" role="group" aria-label="时间轴刻度">
          <button type="button" aria-pressed={zoom === 60} onClick={() => setZoom(60)}>小时</button>
          <button type="button" aria-pressed={zoom === 30} onClick={() => setZoom(30)}>半小时</button>
        </div>
      </div>
      <div className="min-w-[900px]">
        <div className="flex mb-4">
          <div className="w-44 shrink-0 p-2 text-xs font-black text-gray-500 uppercase tracking-widest">楼层 / 资源</div>
          <div className="flex-1 flex text-[10px] text-gray-500 font-bold relative">
            {ticks.map(minutes => <div key={minutes} className="flex-1 text-center border-l border-gray-100 first:border-l-0">{pad2(Math.floor(minutes / 60))}:{pad2(minutes % 60)}</div>)}
          </div>
        </div>
        {groups.map(group => <section key={group.key} className="timeline-floor-group" aria-label={`${group.label}会议室`}>
          <h4>{group.label}<span>{group.resources.length} 个空间</span></h4>
          <div className="space-y-2">
            {group.resources.map((resource: Resource) => {
              const resourceBookings = dailyBookings.filter((booking: Booking) => booking.resourceId === resource.id);
              return <div key={resource.id} className="flex items-center group">
                <div className="w-44 shrink-0 pr-4 text-xs font-bold text-gray-600" title={`${resource.code || resource.id} · ${resource.name}`}>
                  <div className="flex items-center gap-2"><i className={`timeline-resource-dot ${resource.type === 'ROOM' ? 'room' : 'desk'}`}/><span className="truncate">{resource.name}</span></div>
                  <small>{resource.code || resource.id}{resource.status !== 'AVAILABLE' ? ` · ${resource.status}` : ''}</small>
                </div>
                <div className="timeline-track flex-1">
                  <div className="absolute inset-0 flex" aria-hidden="true">{ticks.slice(0, -1).map(minutes => <div key={minutes} className="flex-1 border-l border-gray-100 first:border-l-0"/>)}</div>
                  {nowLeft >= 0 && nowLeft <= 100 && <span className="timeline-now" style={{ left: `${nowLeft}%` }} aria-label={`当前时刻 ${toLocalTimeString(now)}`}/>}
                  {resourceBookings.map((booking: Booking) => {
                    const displayStatus = getBookingDisplayStatus(booking, now);
                    const confidential = !canOpenDetails(booking);
                    const soon = displayStatus === 'UPCOMING' && Date.parse(booking.startTime) - now.getTime() <= 30 * 60000;
                    const status = confidential ? 'confidential' : ['NO_SHOW', 'RELEASED'].includes(displayStatus) ? 'exception'
                      : ['COMPLETED', 'ENDED_EARLY'].includes(displayStatus) ? 'completed' : soon ? 'starting' : displayStatus === 'IN_PROGRESS' ? 'in-progress' : 'upcoming';
                    const start = Math.max(range.start, (Date.parse(booking.startTime) - dayStart.getTime()) / 60000);
                    const end = Math.min(range.end, (Date.parse(booking.actualEndTime || booking.releasedAt || booking.endTime) - dayStart.getTime()) / 60000);
                    if (end <= start) return null;
                    const user = users?.find((item: User) => item.id === booking.userId);
                    const label = confidential ? '涉密会议 · 占用' : `${booking.purpose} · ${toLocalTimeString(booking.startTime)}—${toLocalTimeString(booking.endTime)}`;
                    return <button type="button" key={booking.id} disabled={confidential}
                      onClick={() => onBookingClick({ resource, date: dayStart, bookings: resourceBookings.filter(canOpenDetails) })}
                      className={`timeline-booking timeline-status-${status}`}
                      style={{ left: `${(start - range.start) / totalMinutes * 100}%`, width: `${(end - start) / totalMinutes * 100}%` }}
                      title={confidential ? '涉密会议，仅显示占用状态' : `${label}${user ? ` · ${user.department} · ${user.name}` : ''}`}
                      aria-label={confidential ? `${resource.name}，涉密会议，占用，详情不可见` : `${resource.name}，${label}`}>
                      {confidential && <Lock size={11} aria-hidden="true"/>}<span>{confidential ? '占用' : booking.purpose}</span><small>{toLocalTimeString(booking.startTime)}</small>
                    </button>;
                  })}
                </div>
              </div>;
            })}
          </div>
        </section>)}
      </div>
    </div>
  );
};

const occupancyLevel = (utilization: number) => utilization <= 0 ? 0 : utilization <= 25 ? 1 : utilization <= 50 ? 2 : utilization <= 75 ? 3 : 4;
const OCCUPANCY_LEVEL_LABELS = ['空闲 0%', '较低 1—25%', '中等 26—50%', '较高 51—75%', '紧张 76—100%'];

const ResourceUsageGrid = ({ days, resources, bookings, onDayClick }: any) => {
  const now = new Date();
  const trend = days.map((day: Date) => {
    const totals = resources.reduce((sum: { booked: number; available: number; important: number }, resource: Resource) => {
      const occupancy = calculateResourceOccupancy(resource, bookings, day, now);
      return { booked: sum.booked + occupancy.bookedMinutes, available: sum.available + occupancy.availableMinutes, important: sum.important + occupancy.importantBookingCount };
    }, { booked: 0, available: 0, important: 0 });
    return { day, utilization: totals.available ? Math.min(100, Math.round(totals.booked / totals.available * 1000) / 10) : 0, important: totals.important };
  });
  return (
    <div className="studio-usage-grid flex flex-col" aria-label={days.length === 7 ? '未来七日五档占用率矩阵' : '未来三十日五档占用率矩阵'}>
      {days.length === 7 && <div className="occupancy-trend" aria-label="七日占用率趋势">
        {trend.map(({ day, utilization, important }: { day: Date; utilization: number; important: number }) => <div key={localDateKey(day)} className="occupancy-trend-day">
          <span>{utilization}%</span>
          <div className="occupancy-trend-track"><i style={{ height: `${Math.max(4, utilization)}%` }}/></div>
          <strong>{day.getMonth() + 1}/{day.getDate()}</strong>
          <small>重点 {important}</small>
        </div>)}
      </div>}
      <div className="overflow-x-auto custom-scrollbar pb-2">
        <table className="border-collapse w-full" style={{ minWidth: Math.max(800, days.length * 86 + 180) }}>
          <thead><tr>
            <th className="sticky left-0 z-20 bg-white p-3 text-left text-xs font-black text-gray-500 uppercase tracking-widest border-b border-gray-100 min-w-[160px]">楼层 / 资源</th>
            {days.map((day: Date) => {
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              return <th key={localDateKey(day)} className={`p-2 text-[11px] font-bold text-gray-500 border-b border-gray-100 min-w-[72px] text-center ${isWeekend ? 'bg-slate-50 text-slate-400' : ''}`}>{day.getMonth() + 1}/{day.getDate()}</th>;
            })}
          </tr></thead>
          <tbody>{resources.map((resource: Resource) => <tr key={resource.id} className="group">
            <td className="sticky left-0 z-10 bg-white p-3 text-xs font-bold text-gray-700 border-b border-gray-50" title={`${resource.code || resource.id} · ${resource.name}`}>
              <div className="flex items-center gap-2"><i className={`timeline-resource-dot ${resource.type === 'ROOM' ? 'room' : 'desk'}`}/><span className="truncate max-w-[130px]">{resource.name}</span></div>
              <small className="occupancy-resource-meta">{resource.floor === undefined ? resource.location : `${resource.floor}层`} · {resource.code || resource.id}</small>
            </td>
            {days.map((day: Date) => {
              const occupancy = calculateResourceOccupancy(resource, bookings, day, now);
              const level = occupancyLevel(occupancy.utilization);
              const isWeekend = day.getDay() === 0 || day.getDay() === 6;
              return <td key={localDateKey(day)} className={`p-1 border-b border-gray-50 text-center ${isWeekend ? 'bg-slate-50' : ''}`}>
                <button type="button" onClick={() => onDayClick(resource.id, day)}
                  className={`occupancy-cell occupancy-level-${level}`}
                  title={`${resource.name} · ${localDateKey(day)} · 占用率 ${occupancy.utilization}% · 重点会议 ${occupancy.importantBookingCount} 场`}
                  aria-label={`${resource.name}，${localDateKey(day)}，占用率 ${occupancy.utilization}%，重点会议 ${occupancy.importantBookingCount} 场`}>
                  <span>{occupancy.utilization}%</span>{occupancy.importantBookingCount > 0 && <small>重点 {occupancy.importantBookingCount}</small>}
                </button>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="occupancy-legend" aria-label="五档占用率图例">
        {OCCUPANCY_LEVEL_LABELS.map((label, level) => <span key={label}><i className={`occupancy-level-${level}`}/>{label}</span>)}
      </div>
    </div>
  );
};

const ExecutiveDashboard = ({ executive, resources, bookings, exceptions, onDayClick, onOpenExceptions }: any) => {
  const now = new Date();
  const metrics = [
    ['会议室总数', executive.roomCount, '间', '启用状态会议室'],
    ['当前使用中', executive.currentInUse, '间', '当前进行中'],
    ['当前空闲', executive.currentIdle, '间', '当前无有效占用'],
    ['今日预约场次', executive.todayBookingCount, '场', '不含已取消'],
    ['今日占用率', executive.todayUtilization, '%', '预约时长 ÷ 开放时长'],
    ['本周平均占用率', executive.weekAverageUtilization, '%', '未来七日含今日'],
    ['今日爽约', executive.todayNoShowCount, '场', '已判定未签到'],
    ['超时未释放', executive.overdueReleaseCount, '间', '已超过释放阈值']
  ];
  const exclusiveResources = resources.filter((resource: Resource) => resource.type === 'ROOM' && resource.isExclusive)
    .sort((a: Resource, b: Resource) => (a.floor ?? 999) - (b.floor ?? 999) || String(a.code || a.id).localeCompare(String(b.code || b.id), 'zh-CN', { numeric: true }));
  const openExceptions = exceptions.filter((item: OperationalException) => item.status !== 'RESOLVED').slice(0, 4);
  return <section className="executive-dashboard" aria-label="公司办公室领导驾驶舱">
    <div className="executive-heading"><div><span>OFFICE LEADERSHIP / LIVE</span><h3>公司办公室领导驾驶舱</h3><p>同源预约事实 · 涉密仅计占用 · 指标更新于 {toLocalTimeString(now.toISOString())}</p></div><Crown size={28}/></div>
    <div className="executive-metric-grid">{metrics.map(([label, value, unit, detail]) => <article key={String(label)} className="executive-metric">
      <span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{detail}</p>
    </article>)}</div>
    <div className="executive-operational-grid">
      <section className="executive-exclusive" aria-label="领导层专属会议室专区">
        <header><div><span>EXCLUSIVE FLOORS / 16 · 19 · 20</span><h4>领导层专属会议室</h4></div><small>{exclusiveResources.length} 间</small></header>
        <div className="executive-room-grid">{exclusiveResources.length ? exclusiveResources.map((resource: Resource) => {
          const current = bookings.filter((booking: Booking) => booking.resourceId === resource.id
            && Date.parse(booking.startTime) <= now.getTime() && Date.parse(booking.actualEndTime || booking.endTime) > now.getTime()
            && ['IN_PROGRESS'].includes(getBookingDisplayStatus(booking, now)))[0];
          const next = bookings.filter((booking: Booking) => booking.resourceId === resource.id && getBookingDisplayStatus(booking, now) === 'UPCOMING')
            .sort((a: Booking, b: Booking) => Date.parse(a.startTime) - Date.parse(b.startTime))[0];
          return <button type="button" key={resource.id} onClick={() => onDayClick(resource.id, now)} className={`executive-room ${current ? 'occupied' : 'idle'}`}>
            <span>{resource.floor ? `${resource.floor}层` : resource.location} · {resource.code || resource.id}</span>
            <strong>{resource.name}</strong>
            <small>{current ? `使用中 · ${current.userId ? current.purpose : '涉密不可见'}` : next ? `空闲 · 下一场 ${toLocalTimeString(next.startTime)}` : '当前空闲 · 今日后续暂无预约'}</small>
          </button>;
        }) : <p className="executive-empty">当前台账未配置领导层专属会议室。</p>}</div>
      </section>
      <section className="executive-exceptions" aria-label="领导异常提醒区">
        <header><div><span>ATTENTION REQUIRED</span><h4>异常提醒</h4></div><button type="button" onClick={onOpenExceptions}>进入异常中心</button></header>
        {openExceptions.length ? <ul>{openExceptions.map((item: OperationalException) => <li key={item.id}><i className={item.severity === 'CRITICAL' ? 'critical' : ''}/><div><strong>{item.title}</strong><span>{item.status === 'ACKNOWLEDGED' ? '已认领' : '待处理'} · {toLocalDateTimeString(item.occurredAt)}</span></div></li>)}</ul>
          : <p className="executive-empty">当前没有待处理异常。</p>}
      </section>
    </div>
  </section>;
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
             {(booking.hasLeader || booking.isVideoConference || booking.needsTeaService || booking.serviceRequirements?.length > 0) && <span className="shrink-0 whitespace-nowrap bg-rose-50 text-rose-600 px-2 py-0.5 rounded-md text-[11px] font-black border border-rose-100">特殊需求</span>}
           </div>
           <p className="text-xs text-gray-500 font-medium">{isLongTerm ? `${toLocalDateString(booking.startTime)} 至 ${booking.seriesEndDate} · 每天 ${toLocalTimeString(booking.startTime)} - ${toLocalTimeString(booking.endTime)} · ${seriesBookings.length} 个会议日` : `${toLocalDateTimeString(booking.startTime)} 至 ${toLocalDateTimeString(booking.endTime)}`} · {booking.purpose}</p>
           <p className="mt-1 text-[11px] font-bold text-gray-500">当前节点：{currentNode?.name || '待审批'}{booking.workflowVersion ? ` · 流程 V${booking.workflowVersion}` : ''}{booking.approvalRuleSetVersion ? ` · 规则集 V${booking.approvalRuleSetVersion}` : ''}</p>
           {booking.approvalRuleExplanation?.length > 0 && <p className="mt-1 text-[11px] font-medium text-indigo-600">命中依据：{booking.approvalRuleExplanation.join('；')}</p>}

           {(booking.hasLeader || booking.isVideoConference || booking.needsTeaService) && (
             <div className="mt-2 flex flex-wrap gap-2">
               {booking.hasLeader && (
                 <div className="flex items-center space-x-1 text-[11px] text-gray-600 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                   <Crown size={12} className="text-amber-500"/>
                   <span className="font-bold">领导参会: {booking.leaderDetails}</span>
                 </div>
               )}
               {booking.isVideoConference && !booking.serviceRequirements?.some((item: BookingServiceRequirement) => item.type === 'VIDEO') && (
                 <div className="flex items-center space-x-1 text-[11px] text-gray-600 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                   <Video size={12} className="text-indigo-500"/>
                   <span className="font-bold">视频会议</span>
                 </div>
               )}
               {booking.needsTeaService && !booking.serviceRequirements?.some((item: BookingServiceRequirement) => item.type === 'TEA') && (
                 <div className="flex items-center space-x-1 text-[11px] text-gray-600 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                   <CupSoda size={12} className="text-emerald-500"/>
                   <span className="font-bold">茶水服务</span>
                 </div>
               )}
             </div>
           )}
           {booking.serviceRequirements?.length > 0 && <div className="mt-3 space-y-2" aria-label="结构化会务需求">
             {booking.serviceRequirements.map((requirement: BookingServiceRequirement) => {
               const snapshot = requirement.catalogSnapshot;
               const fields = snapshot?.fields || [];
               const values = requirement.fieldValues || {};
               return <section key={requirement.type} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
                 <p className="font-black text-gray-700">{snapshot?.name || SERVICE_TYPE_LABELS[requirement.type as keyof typeof SERVICE_TYPE_LABELS] || requirement.type}{snapshot ? ` · 目录 V${snapshot.catalogVersion}` : ''}</p>
                 <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                   {fields.filter((field: any) => values[field.key]).map((field: any) => <div key={field.key} className="flex gap-1"><dt className="shrink-0 text-gray-400">{field.label}：</dt><dd className="break-words font-bold">{values[field.key]}</dd></div>)}
                   {!fields.length && requirement.details && <div><dt className="inline text-gray-400">说明：</dt><dd className="inline font-bold">{requirement.details}</dd></div>}
                 </dl>
               </section>;
             })}
           </div>}
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
  <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="当日会议详情">
    <div className="bg-white rounded-3xl p-8 max-w-lg w-full relative animate-in zoom-in">
      <button onClick={onClose} aria-label="关闭当日会议详情" className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:text-gray-600"><X size={20}/></button>
      <h3 className="font-black text-xl mb-1 text-gray-800">{formatDate(detail.date)}</h3>
      <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mb-6">{detail.resource.name}</p>

      <div className="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
        {detail.bookings.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-gray-100 rounded-2xl">
            <p className="text-gray-500 text-sm font-bold">该日暂无有效占用记录</p>
          </div>
        ) : detail.bookings.map((b: Booking) => {
          const user = users.find((item: User) => item.id === b.userId);
          const resource = resources?.find((item: Resource) => item.id === b.resourceId);
          const contact = b.contactSnapshot;
          const contactNumbers = [contact?.landline || user?.landline, contact?.mobile || user?.mobile].filter(Boolean).join(' / ');
          const services: BookingServiceRequirement[] = [...(b.serviceRequirements || [])];
          if (b.isVideoConference && !services.some(item => item.type === 'VIDEO')) services.push({ type: 'VIDEO' });
          if (b.needsTeaService && !services.some(item => item.type === 'TEA')) services.push({ type: 'TEA' });
          return <article key={b.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
            <div className="flex justify-between items-start gap-3 mb-2">
              <div>
                <p className={`text-xs font-black text-${theme}-600 mb-0.5`}>{toLocalTimeString(b.startTime)} - {toLocalTimeString(bookingEffectiveEnd(b))}</p>
                {resource && <p className="text-[11px] text-gray-500 font-bold uppercase">{resource.name}</p>}
              </div>
              <BookingStatusBadge booking={b} theme={theme} />
            </div>
            <h4 className="mt-3 pt-3 border-t border-gray-200/50 text-sm font-black text-gray-800">{b.purpose}</h4>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              <div><dt className="text-gray-400">部门</dt><dd className="mt-0.5 font-bold text-gray-700">{user?.department || b.requesterDepartmentId || '未提供'}</dd></div>
              <div><dt className="text-gray-400">联系人</dt><dd className="mt-0.5 font-bold text-gray-700">{contact?.name || user?.name || '未提供'}</dd></div>
              <div><dt className="text-gray-400">联系方式</dt><dd className="mt-0.5 break-words font-bold text-gray-700">{contactNumbers || '未提供'}</dd></div>
              <div><dt className="text-gray-400">参会人数</dt><dd className="mt-0.5 font-bold text-gray-700">{b.participants === undefined ? '未提供' : `${b.participants} 人`}</dd></div>
            </dl>
            {b.hasLeader && <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center px-2 py-1 rounded text-[11px] font-bold bg-amber-50 text-amber-600 border border-amber-100"><Crown size={12} className="mr-1"/>领导{b.leaderDetails ? `：${b.leaderDetails}` : '参会'}</span>
            </div>}
            <section className="mt-3 pt-3 border-t border-gray-200/50" aria-label="会务服务摘要">
              <p className="text-[11px] font-black text-gray-600">会务服务</p>
              {services.length ? <div className="mt-2 space-y-2">{services.map(requirement => {
                const snapshot = requirement.catalogSnapshot;
                const fields = snapshot?.fields || [];
                const values = requirement.fieldValues || {};
                return <div key={requirement.type} className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-[11px] text-gray-600">
                  <p className="font-black text-gray-700">{snapshot?.name || SERVICE_TYPE_LABELS[requirement.type] || requirement.type}{snapshot ? ` · 目录 V${snapshot.catalogVersion}` : ''}</p>
                  {(fields.some(field => values[field.key]) || requirement.details) && <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    {fields.filter(field => values[field.key]).map(field => <div key={field.key} className="flex gap-1"><dt className="shrink-0 text-gray-400">{field.label}：</dt><dd className="break-words font-bold">{values[field.key]}</dd></div>)}
                    {!fields.length && requirement.details && <div><dt className="inline text-gray-400">说明：</dt><dd className="inline font-bold">{requirement.details}</dd></div>}
                  </dl>}
                </div>;
              })}</div> : <p className="mt-1 text-[11px] text-gray-400">无会务服务</p>}
            </section>
          </article>;
        })}
      </div>
    </div>
  </div>
);

const RESOURCE_IMPORT_ERROR_MESSAGES: Record<string, string> = {
  RESOURCE_CODE_REQUIRED: '缺少永久编码',
  RESOURCE_STRUCTURED_LOCATION_REQUIRED: '会议室必须提供可识别的楼栋和楼层',
  RESOURCE_CODE_ID_CONFLICT: '永久编码与资源 ID 分别指向不同资源',
  RESOURCE_CODE_IMMUTABLE: '已有资源的永久编码不可修改',
  INVALID_RESOURCE_CODE: '永久编码格式不正确',
  INVALID_RESOURCE_NAME: '资源名称缺失或过长',
  INVALID_RESOURCE_CAPACITY: '容量必须为正整数',
  INVALID_RESOURCE_BUILDING: '楼栋仅支持主楼或配楼',
  INVALID_RESOURCE_FLOOR: '楼层超出所选楼栋范围',
  INVALID_RESOURCE_LOCATION: '位置信息不完整',
  INVALID_RESOURCE_OPEN_HOURS: '开放时段必须成对填写且开始早于结束',
  INVALID_RESOURCE_EXCLUSIVE: '专属标识格式不正确',
  INVALID_RESOURCE_LEADER_LEVEL: '专属会议室必须填写适用领导层级',
  DUPLICATE_RESOURCE_ID: '资源 ID 重复',
  DUPLICATE_RESOURCE_CODE: '永久编码重复',
  DUPLICATE_RESOURCE_NAME: '资源名称与已有资源或其他行重复',
  ACTIVE_BOOKINGS_REQUIRE_REVIEW: '变更会影响未结束的有效预约',
  CAPACITY_EXCEEDED: '新容量低于已有有效预约人数',
  REQUIRED_FEATURE_UNAVAILABLE: '设备变更会影响已有有效预约'
};

const RESOURCE_FIELD_LABELS: Record<string, string> = {
  name: '名称', type: '类型', capacity: '容量', location: '位置', building: '楼栋', floor: '楼层',
  roomNumber: '房间号', roomCategory: '容量分类', campus: '公司', features: '设备', status: '状态',
  isExclusive: '专属', exclusiveLeaderLevel: '领导层级', openStart: '开放开始', openEnd: '开放结束',
  isPublic: '公共资源', notes: '备注'
};

const parseCsvRow = (line: string) => {
  const delimiter = line.includes('，') && !line.includes(',') ? '，' : ',';
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
    } else value += char;
  }
  values.push(value.trim());
  return values;
};

const BatchImportModal = ({ type, onClose, onImport, onPreflight, theme, existingDepartments = [], roles = [] }: any) => {
  const [text, setText] = useState('');
  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [report, setReport] = useState<ResourceImportReport | null>(null);
  const [busy, setBusy] = useState<'PREFLIGHT' | 'IMPORT' | null>(null);
  const [formError, setFormError] = useState('');
  
  const getTemplate = () => {
    if (type === 'USERS') return "姓名,邮箱,部门,角色(可选),办公电话(可选),移动电话(可选)\n张三,zhangsan@company.com,市场部,正式员工,010-88886666,13800000001";
    if (type === 'RESOURCES') return "永久编码,资源名称,类型(会议室/工位),容量,楼栋(主楼/配楼),楼层,房间号,位置补充(可选),容量分类(自动/礼堂),开放开始(可选),开放结束(可选),专属(是/否),适用领导层级(可选),公共资源(是/否),公司(可选),设备(竖线分隔),状态(可选),备注(可选)\nANNEX-02F-201,Gamma 演示厅,会议室,20,配楼,2,201,,自动,08:00,20:00,否,,是,总部公司,投屏显示器|视频会议系统,空闲,演示数据，请替换为实际台账";
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

  const parseItems = () => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    }

    const lines = trimmed.split(/\r?\n/).filter(line => line.trim());
    const data: any[] = [];
    const headerKeywords = ['名称', '姓名', '资源', '部门', 'name'];
    const hasHeader = headerKeywords.some(key => lines[0]?.toLowerCase().includes(key));
    const startIndex = hasHeader ? 1 : 0;

    if (type === 'DEPARTMENTS') {
      const deptMap = new Map();
      existingDepartments.forEach((d: any) => deptMap.set(d.name, d.id));
      for (let i = startIndex; i < lines.length; i++) {
        const parts = parseCsvRow(lines[i]);
        const name = parts[0]?.trim();
        const parentName = parts[1]?.trim();
        if (!name || deptMap.has(name)) continue;
        const newId = `dpt-imp-${Date.now()}-${i}`;
        const newDept = { id: newId, name, parentId: parentName ? deptMap.get(parentName) : undefined };
        data.push(newDept);
        deptMap.set(name, newId);
      }
    } else if (type === 'USERS') {
      for (let i = startIndex; i < lines.length; i++) {
        const parts = parseCsvRow(lines[i]);
        const name = parts[0]?.trim();
        if (!name) continue;
        const roleName = parts[3]?.trim();
        const foundRole = roles.find((r: any) => r.name === roleName);
        data.push({
          id: `u-imp-${Date.now()}-${i}`,
          name,
          email: parts[1]?.trim() || `${name}@company.com`,
          department: parts[2]?.trim() || '待分配',
          role: [foundRole?.id || 'EMPLOYEE'],
          landline: parts[4]?.trim(),
          mobile: parts[5]?.trim()
        });
      }
    } else if (type === 'RESOURCES') {
      for (let i = startIndex; i < lines.length; i++) {
        const parts = parseCsvRow(lines[i]);
        const code = parts[0]?.trim().toUpperCase();
        const name = parts[1]?.trim();
        if (!code && !name) continue;
        const typeText = parts[2]?.trim().toUpperCase() || '';
        const resourceType = typeText === 'ROOM' || typeText.includes('室') ? 'ROOM' : 'DESK';
        const buildingText = parts[4]?.trim() || '';
        const building = /配楼|2号楼|ANNEX/i.test(buildingText) ? 'ANNEX' : /主楼|1号楼|MAIN/i.test(buildingText) ? 'MAIN' : undefined;
        const floor = parts[5]?.trim() ? Number(parts[5]) : undefined;
        const roomNumber = parts[6]?.trim() || undefined;
        const locationDetail = parts[7]?.trim() || undefined;
        const exclusiveText = (parts[11] || '').trim().toUpperCase();
        const publicText = (parts[13] || '').trim().toUpperCase();
        const isExclusive = ['是', 'TRUE', '1', 'YES'].includes(exclusiveText);
        const statusText = (parts[16] || '').trim().toUpperCase();
        const statusLabels: Record<string, string> = { '空闲': 'AVAILABLE', '占用': 'OCCUPIED', '维护中': 'MAINTENANCE', '待开放': 'PENDING' };
        data.push({
          id: `r-${code.toLowerCase()}`,
          code,
          name,
          type: resourceType,
          capacity: parts[3]?.trim() ? Number(parts[3]) : 0,
          building: resourceType === 'ROOM' ? building : undefined,
          floor: resourceType === 'ROOM' ? floor : undefined,
          roomNumber: resourceType === 'ROOM' ? roomNumber : undefined,
          location: resourceType === 'ROOM'
            ? `${building ? BUILDINGS[building as BuildingId].name : buildingText} ${floor || ''}层${roomNumber ? ` · ${roomNumber}` : ''}${locationDetail ? ` · ${locationDetail}` : ''}`
            : locationDetail || roomNumber || '',
          roomCategory: parts[8]?.trim() === '礼堂' ? 'AUDITORIUM' : undefined,
          openStart: parts[9]?.trim() || undefined,
          openEnd: parts[10]?.trim() || undefined,
          isExclusive,
          exclusiveLeaderLevel: parts[12]?.trim() || undefined,
          isPublic: publicText ? ['是', 'TRUE', '1', 'YES'].includes(publicText) : !isExclusive,
          campus: parts[14]?.trim() || undefined,
          features: (parts[15] || '').split(/[|｜]/).map((feature: string) => feature.trim()).filter(Boolean),
          status: statusLabels[statusText] || (['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'PENDING'].includes(statusText) ? statusText : 'AVAILABLE'),
          notes: parts[17]?.trim() || undefined
        });
      }
    }
    return data;
  };

  const processData = async () => {
    setFormError('');
    setReport(null);
    try {
      const data = parseItems();
      if (!data.length) throw new Error('未解析到有效数据，请检查格式。');
      setParsedItems(data);
      if (type === 'RESOURCES') {
        setBusy('PREFLIGHT');
        setReport(await onPreflight(data));
      } else await onImport(data);
    } catch (error: any) {
      setFormError(formatUserError(error, '数据解析或预检失败，请检查格式。', BOOKING_ERROR_MESSAGES));
    } finally {
      setBusy(null);
    }
  };

  const confirmImport = async () => {
    if (!report || report.invalid || (!report.creates && !report.updates)) return;
    setBusy('IMPORT');
    setFormError('');
    try {
      await onImport(parsedItems);
    } catch (error: any) {
      setFormError(formatUserError(error, '正式导入失败，请刷新后重试。', BOOKING_ERROR_MESSAGES));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-[2rem] p-6 sm:p-8 ${report ? 'max-w-5xl' : 'max-w-lg'} w-full max-h-[92dvh] overflow-y-auto shadow-2xl animate-in zoom-in`}>
        <div className="flex justify-between items-center mb-6 gap-4">
          <div>
            <h3 className="font-black text-xl text-gray-800">批量导入 {type === 'USERS' ? '成员' : (type === 'RESOURCES' ? '资源台账' : '部门')}</h3>
            {type === 'RESOURCES' && <p className="text-xs text-gray-500 mt-1">永久编码用于识别已有资源；正式导入前会按最新数据再次检查。</p>}
          </div>
          <button onClick={handleDownloadTemplate} className={`shrink-0 text-xs font-bold text-${theme}-600 bg-${theme}-50 px-3 py-1.5 rounded-lg hover:bg-${theme}-100 transition-colors flex items-center space-x-1`}>
            <Download size={14}/> <span>下载模板</span>
          </button>
        </div>

        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-2 font-bold">请粘贴 CSV 文本或 JSON 数据：</p>
          <textarea
            aria-label="批量导入数据"
            className={`w-full ${report ? 'h-36' : 'h-64'} border border-gray-200 rounded-2xl p-4 text-xs font-mono mb-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all bg-gray-50/50`}
            placeholder={getTemplate()}
            value={text}
            onChange={event => { setText(event.target.value); setReport(null); setParsedItems([]); setFormError(''); }}
          />
          <p className="text-[11px] text-gray-500">支持带引号的 CSV、中文逗号与 JSON。资源 ID 由永久编码确定性生成，重复导入可识别新增、更新和不变行。</p>
        </div>

        {formError && <p role="alert" className="mb-4 rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 text-xs font-bold text-rose-600">{formError}</p>}

        {report && <section aria-label="资源台账预检报告" className="mb-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              ['新增', report.creates, 'text-emerald-600 bg-emerald-50'],
              ['更新', report.updates, 'text-indigo-600 bg-indigo-50'],
              ['不变', report.unchanged, 'text-gray-600 bg-gray-50'],
              ['错误', report.invalid, 'text-rose-600 bg-rose-50']
            ] as const).map(([label, value, className]) => <div key={label} className={`rounded-xl px-4 py-3 ${className}`}><strong className="block text-2xl">{value}</strong><span className="text-xs font-bold">{label}</span></div>)}
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[11px] text-gray-500">
            <span>共 {report.total} 行 · 快照版本 {report.revision ?? '事务内重检'}</span>
            <span>{report.invalid ? '存在错误，修正后需重新预检。' : report.creates + report.updates ? `可导入 ${report.creates + report.updates} 条变更。` : '没有需要写入的变更。'}</span>
          </div>
          <div className="max-h-72 overflow-auto rounded-xl border border-gray-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 sticky top-0"><tr><th className="px-3 py-2">行</th><th className="px-3 py-2">结果</th><th className="px-3 py-2">编码 / 资源</th><th className="px-3 py-2">差异或问题</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {report.items.map(item => <tr key={item.row} className={item.action === 'ERROR' ? 'bg-rose-50/40' : ''}>
                  <td className="px-3 py-3 align-top">{item.row}</td>
                  <td className="px-3 py-3 align-top font-bold">{{ CREATE: '新增', UPDATE: '更新', UNCHANGED: '不变', ERROR: '错误' }[item.action]}</td>
                  <td className="px-3 py-3 align-top"><span className="block font-mono font-bold text-gray-700">{item.resourceCode || '未提供编码'}</span><span className="text-gray-500">{item.resource?.name || '—'}</span></td>
                  <td className="px-3 py-3 align-top text-gray-600">
                    {item.issues.length ? item.issues.map(issue => <p key={`${issue.row}-${issue.code}`} className="text-rose-600">{RESOURCE_IMPORT_ERROR_MESSAGES[issue.code] || issue.code}</p>) : item.changedFields.length ? item.changedFields.map(field => RESOURCE_FIELD_LABELS[field] || field).join('、') : '无字段差异'}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-500 hover:bg-gray-200 transition-colors">取消</button>
          {type === 'RESOURCES' && report && <button type="button" disabled={!!busy} onClick={processData} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-600 disabled:opacity-50">{busy === 'PREFLIGHT' ? '预检中…' : '重新预检'}</button>}
          {(!report || type !== 'RESOURCES') && <button type="button" disabled={!!busy} onClick={processData} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold shadow-lg disabled:opacity-50`}>{busy === 'PREFLIGHT' ? '预检中…' : type === 'RESOURCES' ? '生成预检报告' : '确认导入'}</button>}
          {type === 'RESOURCES' && report && <button type="button" disabled={!!busy || report.invalid > 0 || report.creates + report.updates === 0} onClick={confirmImport} className={`flex-1 py-3 rounded-xl bg-${theme}-600 text-white font-bold shadow-lg disabled:opacity-40`}>{busy === 'IMPORT' ? '导入中…' : `确认导入 ${report.creates + report.updates} 条变更`}</button>}
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
                    {dayBookings.map((b: Booking) => <div key={b.id} title={b.purpose} className={`p-2 rounded-xl border text-[11px] font-bold ${b.status === 'APPROVED' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}><p>{toLocalTimeString(b.startTime)}-{toLocalTimeString(b.endTime)}</p><p className="mt-1 text-[10px] opacity-70">{BOOKING_DISPLAY_STATUS_LABELS[getBookingDisplayStatus(b)]}</p><p className="truncate mt-1 opacity-80">{b.purpose}</p></div>)}
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
    role: user?.role?.length ? [...user.role] : ['EMPLOYEE'],
    mobile: user?.mobile || '',
    landline: user?.landline || ''
  });
  const toggleRole = (roleId: string) => setFormData((current: any) => ({
    ...current,
    role: current.role.includes(roleId) ? current.role.filter((id: string) => id !== roleId) : [...current.role, roleId]
  }));

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[2rem] bg-white p-8 shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6">{user ? '编辑成员' : '录入新成员'}</h3>
        <div className="space-y-4">
          <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="姓名" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <input value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="电子邮箱" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <select value={formData.department} onChange={e => setFormData({...formData, department: e.target.value})} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100">
            {departments.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
          <fieldset className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <legend className="px-1 text-xs font-bold text-gray-600">成员角色（可多选）</legend>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((r: any) => <label key={r.id} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-bold text-gray-700"><input type="checkbox" checked={formData.role.includes(r.id)} onChange={() => toggleRole(r.id)} />{r.name}</label>)}
            </div>
          </fieldset>
          <input value={formData.mobile} onChange={e => setFormData({...formData, mobile: e.target.value})} placeholder="移动电话" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <input value={formData.landline} onChange={e => setFormData({...formData, landline: e.target.value})} placeholder="办公电话" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
        </div>
        <div className="flex space-x-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button disabled={!formData.role.length} onClick={() => onSave(formData)} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold disabled:opacity-40`}>保存</button>
        </div>
      </div>
    </div>
  );
};

const ResourceModal = ({ resource, onClose, onSave, theme }: any) => {
  const initialBuildingId: BuildingId = resource?.type === 'DESK' ? 'MAIN' : resource ? getResourceBuilding(resource) : 'MAIN';
  const [formData, setFormData] = useState({
    code: resource?.code || resource?.id?.toUpperCase() || '',
    name: resource?.name || '',
    type: resource?.type || 'ROOM',
    capacity: resource?.capacity ?? 4,
    roomCategory: resource?.roomCategory === 'AUDITORIUM' ? 'AUDITORIUM' : 'AUTO',
    status: resource?.status || 'AVAILABLE',
    campus: resource?.campus || '',
    features: resource?.features || [],
    isExclusive: resource?.isExclusive || false,
    exclusiveLeaderLevel: resource?.exclusiveLeaderLevel || '',
    openStart: resource?.openStart || '',
    openEnd: resource?.openEnd || '',
    isPublic: resource?.isPublic ?? true,
    notes: resource?.notes || ''
  });
  const [newFeature, setNewFeature] = useState('');
  const [saving, setSaving] = useState(false);
  const [buildingId, setBuildingId] = useState<BuildingId>(initialBuildingId);
  const [floor, setFloor] = useState<number | null>(() => resource?.type === 'DESK' ? null : resource ? getResourceFloor(resource) : null);
  const [locationDetail, setLocationDetail] = useState(() => resource?.type === 'DESK' ? '' : (resource?.location || '')
    .replace(/(?:1|一|2|二)\s*号楼|主楼|配楼/gi, '')
    .replace(/\d{1,2}\s*(?:层|F\b)/i, '')
    .replace(resource?.roomNumber || '', '')
    .replace(/^[\s·,，\-—/]+|[\s·,，\-—/]+$/g, ''));
  const [roomNumber, setRoomNumber] = useState(resource?.roomNumber || '');
  const [deskLocation, setDeskLocation] = useState(resource?.type === 'DESK' ? resource.location : '');
  const [formError, setFormError] = useState('');
  const building = BUILDINGS[buildingId];
  const locationPreview = `${building.name} ${floor ? `${floor}层` : '待选择楼层'}${roomNumber.trim() ? ` · ${roomNumber.trim()}` : ''}${locationDetail.trim() ? ` · ${locationDetail.trim()}` : ''}`;
  const categoryLabels = { SMALL: '小型', MEDIUM: '中型', LARGE: '大型', AUDITORIUM: '礼堂' } as const;
  const roomCategory = getRoomCategory(Number(formData.capacity) || 0, formData.roomCategory === 'AUDITORIUM');

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
    const code = formData.code.trim().toUpperCase();
    const name = formData.name.trim();
    if (!/^[A-Z0-9][A-Z0-9._-]{1,63}$/.test(code)) {
      setFormError('永久编码需为 2–64 位字母、数字、点、下划线或连字符');
      return;
    }
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
    if (formData.type === 'ROOM' && formData.isExclusive && !formData.exclusiveLeaderLevel.trim()) {
      setFormError('专属会议室必须填写适用领导层级');
      return;
    }
    if ((formData.openStart && !formData.openEnd) || (!formData.openStart && formData.openEnd) || (formData.openStart && formData.openStart >= formData.openEnd)) {
      setFormError('开放开始和结束时间必须同时填写，且开始时间早于结束时间');
      return;
    }
    const location = formData.type === 'ROOM'
      ? `${building.name} ${floor}层${roomNumber.trim() ? ` · ${roomNumber.trim()}` : ''}${locationDetail.trim() ? ` · ${locationDetail.trim()}` : ''}`
      : deskLocation.trim();
    if (!location) {
      setFormError('请填写工位位置');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...formData,
        code,
        name,
        location,
        building: formData.type === 'ROOM' ? buildingId : undefined,
        floor: formData.type === 'ROOM' ? floor : undefined,
        roomNumber: formData.type === 'ROOM' ? roomNumber.trim() || undefined : undefined,
        roomCategory: formData.type === 'ROOM' ? roomCategory : undefined,
        campus: formData.campus.trim() || undefined,
        isExclusive: formData.type === 'ROOM' && formData.isExclusive,
        exclusiveLeaderLevel: formData.type === 'ROOM' && formData.isExclusive ? formData.exclusiveLeaderLevel.trim() : undefined,
        openStart: formData.openStart || undefined,
        openEnd: formData.openEnd || undefined,
        notes: formData.notes.trim() || undefined
      });
    } catch (error: any) {
      setFormError(formatUserError(error, '保存失败，请稍后重试。', BOOKING_ERROR_MESSAGES));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="resource-modal-title" aria-describedby="resource-modal-description">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full max-h-[90dvh] overflow-y-auto shadow-2xl animate-in zoom-in">
        <h3 id="resource-modal-title" className="font-black text-xl">{resource?.type === 'ROOM' ? '编辑会议室' : resource ? '编辑资源' : '新增资源'}</h3>
        <p id="resource-modal-description" className="mt-2 mb-6 text-xs leading-5 text-gray-500">维护名称、容量、位置、设备、开放时段和预约状态，保存后同步至空间导航与预约服务。</p>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">永久编码{resource ? ' · 创建后不可修改' : ''}</span>
            <input aria-label="资源永久编码" value={formData.code} disabled={!!resource} onChange={e => { setFormData({...formData, code: e.target.value.toUpperCase()}); setFormError(''); }} placeholder="如：MAIN-10F-101" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 font-mono disabled:text-gray-500" />
          </label>
          <input aria-label="资源名称" value={formData.name} onChange={e => { setFormData({...formData, name: e.target.value}); setFormError(''); }} placeholder="资源名称" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <div className="flex space-x-2">
            <button type="button" aria-pressed={formData.type === 'ROOM'} onClick={() => { setFormData({...formData, type: 'ROOM'}); setFormError(''); }} className={`flex-1 p-3 rounded-xl border ${formData.type === 'ROOM' ? `bg-${theme}-50 border-${theme}-200 text-${theme}-600` : 'bg-gray-50 border-gray-100 text-gray-500'}`}>会议室</button>
            <button type="button" aria-pressed={formData.type === 'DESK'} onClick={() => { setFormData({...formData, type: 'DESK'}); setFormError(''); }} className={`flex-1 p-3 rounded-xl border ${formData.type === 'DESK' ? `bg-${theme}-50 border-${theme}-200 text-${theme}-600` : 'bg-gray-50 border-gray-100 text-gray-500'}`}>工位</button>
          </div>
          <div className={formData.type === 'ROOM' ? 'grid grid-cols-2 gap-3' : ''}>
            <input aria-label="资源容量" type="number" min={formData.type === 'ROOM' ? 1 : 0} value={Number.isNaN(formData.capacity) ? '' : formData.capacity} onChange={e => setFormData({...formData, capacity: parseInt(e.target.value)})} placeholder="容量" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
            {formData.type === 'ROOM' && <label>
              <span className="sr-only">容量分类</span>
              <select aria-label="资源容量分类" value={formData.roomCategory} onChange={e => setFormData({ ...formData, roomCategory: e.target.value })} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 text-sm">
                <option value="AUTO">自动分类 · {categoryLabels[roomCategory]}</option>
                <option value="AUDITORIUM">礼堂（独立分类）</option>
              </select>
            </label>}
          </div>
          <label className="block">
            <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">所属公司</span>
            <input aria-label="资源所属公司" value={formData.campus} onChange={e => setFormData({ ...formData, campus: e.target.value })} placeholder="如：总部公司（用于审批范围）" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          </label>
          {formData.type === 'ROOM' && <>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">开放开始</span><input aria-label="资源开放开始时间" type="time" value={formData.openStart} onChange={e => { setFormData({ ...formData, openStart: e.target.value }); setFormError(''); }} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" /></label>
              <label><span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">开放结束</span><input aria-label="资源开放结束时间" type="time" value={formData.openEnd} onChange={e => { setFormData({ ...formData, openEnd: e.target.value }); setFormError(''); }} className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs font-bold text-gray-600"><input type="checkbox" checked={formData.isExclusive} onChange={e => { const isExclusive = e.target.checked; setFormData({ ...formData, isExclusive, isPublic: isExclusive ? false : formData.isPublic }); setFormError(''); }} />专属会议室</label>
              <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs font-bold text-gray-600"><input type="checkbox" checked={formData.isPublic} onChange={e => setFormData({ ...formData, isPublic: e.target.checked })} />公共资源</label>
            </div>
            {formData.isExclusive && <input aria-label="专属会议室适用领导层级" value={formData.exclusiveLeaderLevel} onChange={e => { setFormData({ ...formData, exclusiveLeaderLevel: e.target.value }); setFormError(''); }} placeholder="适用领导层级（必填）" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />}
          </>}
          <label className="block">
            <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">备注</span>
            <textarea aria-label="资源备注" value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="资源使用与维护说明（选填）" className="w-full h-20 p-3 bg-gray-50 rounded-xl border border-gray-100 resize-none" />
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
              <div className="grid grid-cols-2 gap-3">
                <input aria-label="资源房间号" value={roomNumber} onChange={e => setRoomNumber(e.target.value)} placeholder="房间号，如 101" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
                <input aria-label="位置补充" value={locationDetail} onChange={e => setLocationDetail(e.target.value)} placeholder="位置补充，如东侧" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
              </div>
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
    color: role?.color || 'indigo',
    monitoringScopes: role?.monitoringScopes || []
  });
  const isSystemAdmin = role?.id === 'SYSTEM_ADMIN';
  const toggleMonitoringScope = (scope: 'MEETING_ROOMS' | 'OFFICES') => setFormData((current: any) => ({
    ...current,
    monitoringScopes: current.monitoringScopes.includes(scope)
      ? current.monitoringScopes.filter((item: string) => item !== scope)
      : [...current.monitoringScopes, scope]
  }));

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 max-w-md w-full max-h-[90dvh] overflow-y-auto shadow-2xl animate-in zoom-in">
        <h3 className="font-black text-xl mb-6">{role ? '编辑角色集' : '新增角色集'}</h3>
        <div className="space-y-4">
          <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="角色名称" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
          <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="职能描述" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 h-24" />
          <fieldset className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <legend className="px-1 text-xs font-black text-gray-700">监控大屏查看权限</legend>
            <p className="mb-3 text-[11px] leading-relaxed text-gray-500">两类监控分别授权；未授权角色不会看到入口，也不能访问对应接口。</p>
            <div className="space-y-2">
              {([['MEETING_ROOMS', '会议室监控', '查看会议室预约、签到与维护状态'], ['OFFICES', '办公室监控', '查看办公室分配台账与维护状态']] as const).map(([scope, label, detail]) => <label key={scope} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg bg-white px-3 py-2.5">
                <input type="checkbox" className="mt-1" checked={isSystemAdmin || formData.monitoringScopes.includes(scope)} disabled={isSystemAdmin} onChange={() => toggleMonitoringScope(scope)} />
                <span><strong className="block text-xs text-gray-700">{label}</strong><small className="mt-1 block text-[11px] text-gray-500">{isSystemAdmin ? '系统管理员始终允许查看' : detail}</small></span>
              </label>)}
            </div>
          </fieldset>
          <div className="flex space-x-2">
            {['indigo', 'emerald', 'amber', 'rose', 'purple'].map(c => (
              <button key={c} type="button" aria-label={`选择${c}角色颜色`} onClick={() => setFormData({...formData, color: c})} className={`w-8 h-8 rounded-full bg-${c}-500 ${formData.color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`} />
            ))}
          </div>
        </div>
        <div className="flex space-x-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-bold">取消</button>
          <button type="button" onClick={() => onSave(formData)} className={`flex-1 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}>保存</button>
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
            <span className="text-xs text-gray-500 font-bold ml-1 mb-1 block">资源公司范围</span>
            <input aria-label="审批资源公司范围" value={formData.campuses} onChange={e => setFormData({ ...formData, campuses: e.target.value })} placeholder="留空表示全部公司；多个公司用逗号分隔" className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100" />
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

const ApprovalRuleModal = ({ rule, rules, workflowVersions, defaultWorkflowVersion, onClose, onSave, theme }: {
  rule: ApprovalRule | null;
  rules: ApprovalRule[];
  workflowVersions: WorkflowVersion[];
  defaultWorkflowVersion: number;
  onClose: () => void;
  onSave: (rule: ApprovalRule) => void;
  theme: string;
}) => {
  const dialogRef = useModalA11y(onClose);
  const [form, setForm] = useState({
    id: rule?.id || `rule-${Date.now()}`,
    name: rule?.name || '',
    priority: String(rule?.priority ?? Math.max(0, ...rules.map(item => item.priority)) + 10),
    meetingTypes: rule?.conditions.meetingTypes || ['IMPORTANT'] as MeetingType[],
    exclusive: rule?.conditions.exclusive === undefined ? 'ANY' : rule.conditions.exclusive ? 'YES' : 'NO',
    heavyService: rule?.conditions.heavyService === undefined ? 'ANY' : rule.conditions.heavyService ? 'YES' : 'NO',
    continuousOverDays: rule?.conditions.continuousOverDays?.toString() || '',
    workflowVersion: rule?.workflowVersion || defaultWorkflowVersion
  });
  const [error, setError] = useState('');
  const meetingTypes: Array<{ id: MeetingType; label: string }> = [
    { id: 'NORMAL', label: '普通会议' }, { id: 'IMPORTANT', label: '重要会议' }, { id: 'CONFIDENTIAL', label: '涉密会议' }
  ];
  const save = () => {
    const priority = Number(form.priority);
    const continuousOverDays = form.continuousOverDays ? Number(form.continuousOverDays) : undefined;
    if (!form.id.trim() || !form.name.trim()) return setError('请填写规则标识和规则名称。');
    if (!Number.isSafeInteger(priority) || priority < 0 || priority > 1000000) return setError('优先级应为 0 至 1000000 的整数。');
    if (rules.some(item => item.id !== rule?.id && item.id === form.id.trim())) return setError('规则标识已存在，请重新填写。');
    if (rules.some(item => item.id !== rule?.id && item.priority === priority)) return setError('规则优先级不能重复。');
    if (continuousOverDays !== undefined && (!Number.isSafeInteger(continuousOverDays) || continuousOverDays < 1 || continuousOverDays > 366)) {
      return setError('连续天数应为 1 至 366 的整数。');
    }
    const conditions: ApprovalRule['conditions'] = {};
    if (form.meetingTypes.length) conditions.meetingTypes = form.meetingTypes;
    if (form.exclusive !== 'ANY') conditions.exclusive = form.exclusive === 'YES';
    if (form.heavyService !== 'ANY') conditions.heavyService = form.heavyService === 'YES';
    if (continuousOverDays !== undefined) conditions.continuousOverDays = continuousOverDays;
    if (!Object.keys(conditions).length) return setError('至少设置一项匹配条件，避免规则无条件覆盖全部申请。');
    onSave({ id: form.id.trim(), name: form.name.trim(), priority, conditions, workflowVersion: Number(form.workflowVersion) });
  };

  return <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="approval-rule-modal-title" className="bg-white rounded-[2rem] p-6 sm:p-8 max-w-2xl w-full max-h-[90dvh] overflow-y-auto shadow-2xl">
      <h3 id="approval-rule-modal-title" className="font-black text-xl">{rule ? '编辑动态规则' : '新增动态规则'}</h3>
      <p className="mt-2 text-xs text-gray-500">同一规则内的条件需同时满足；保存后先进入草稿，点击“发布新版本”才会生效。</p>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="text-xs font-bold text-gray-500">规则标识<input aria-label="规则标识" value={form.id} disabled={!!rule} onChange={event => setForm({ ...form, id: event.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100 disabled:text-gray-500" /></label>
        <label className="text-xs font-bold text-gray-500">规则名称<input aria-label="规则名称" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：重要会议强化审批" className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100" /></label>
        <label className="text-xs font-bold text-gray-500">优先级<input aria-label="规则优先级" type="number" min="0" max="1000000" step="1" value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100" /></label>
        <label className="text-xs font-bold text-gray-500">目标审批流程<select aria-label="规则目标审批流程" value={form.workflowVersion} onChange={event => setForm({ ...form, workflowVersion: Number(event.target.value) })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100">{[...workflowVersions].sort((a, b) => b.version - a.version).map(version => <option key={version.version} value={version.version}>V{version.version} · {version.nodes.map(node => node.name).join(' → ') || '空流程'}</option>)}</select></label>
      </div>
      <fieldset className="mt-5 rounded-2xl bg-gray-50 p-4">
        <legend className="px-1 text-xs font-black text-gray-600">会议类型（不勾选表示不限）</legend>
        <div className="mt-2 flex flex-wrap gap-4">{meetingTypes.map(type => <label key={type.id} className="flex min-h-11 items-center gap-2 text-sm font-bold text-gray-700"><input type="checkbox" aria-label={`规则会议类型${type.label}`} checked={form.meetingTypes.includes(type.id)} onChange={() => setForm({ ...form, meetingTypes: form.meetingTypes.includes(type.id) ? form.meetingTypes.filter(item => item !== type.id) : [...form.meetingTypes, type.id] })} />{type.label}</label>)}</div>
      </fieldset>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="text-xs font-bold text-gray-500">专属资源<select aria-label="规则专属资源条件" value={form.exclusive} onChange={event => setForm({ ...form, exclusive: event.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100"><option value="ANY">不限</option><option value="YES">是</option><option value="NO">否</option></select></label>
        <label className="text-xs font-bold text-gray-500">重服务<select aria-label="规则重服务条件" value={form.heavyService} onChange={event => setForm({ ...form, heavyService: event.target.value })} className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100"><option value="ANY">不限</option><option value="YES">是</option><option value="NO">否</option></select></label>
        <label className="text-xs font-bold text-gray-500">连续超过天数<input aria-label="规则连续超过天数" type="number" min="1" max="366" step="1" value={form.continuousOverDays} onChange={event => setForm({ ...form, continuousOverDays: event.target.value })} placeholder="不限" className="mt-1 w-full p-3 bg-gray-50 rounded-xl border border-gray-100" /></label>
      </div>
      {error && <p role="alert" className="mt-4 text-xs font-bold text-rose-600">{error}</p>}
      <div className="flex gap-3 mt-6">
        <button type="button" onClick={onClose} className="flex-1 min-h-11 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold">取消</button>
        <button type="button" onClick={save} className={`flex-1 min-h-11 py-3 bg-${theme}-600 text-white rounded-xl font-bold`}>保存到草稿</button>
      </div>
    </div>
  </div>;
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
      setError(formatUserError(reason, '保存失败，请稍后重试。', messages));
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

const BookingFormModal = ({ resource, theme, initialDate, initialValues, onClose, onConfirm, availableUsers = [], currentUser, bookings = [], ruleSettings = DEFAULT_RULE_SETTINGS, confidentialityAuthorizations = [], serviceCatalog = [], externalError }: any) => {
  const modalRef = useModalA11y(onClose);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const isRoom = resource.type === 'ROOM';
  const isAuditorium = resource.roomCategory === 'AUDITORIUM';
  const videoSupported = resourceSupportsFeature(resource, 'VIDEO');
  const initialDateObj = initialValues?.start ? new Date(initialValues.start) : initialDate ? new Date(initialDate) : new Date();
  const initialServices = (initialValues?.extras?.serviceRequirements || []) as BookingServiceRequirement[];
  const contactUser = initialValues?.userId === currentUser.id
    ? currentUser
    : availableUsers.find((user: User) => user.id === initialValues?.userId) || currentUser;

  const [selectedDate, setSelectedDate] = useState(initialDateObj);
  const [selectedTimeRange, setSelectedTimeRange] = useState<{start: string | null, end: string | null}>({
    start: initialValues?.start ? formatTime(new Date(initialValues.start)) : isRoom ? null : '09:00',
    end: initialValues?.end ? formatTime(new Date(initialValues.end)) : isRoom ? null : '18:00'
  });
  const [deskEndDate, setDeskEndDate] = useState(initialDateObj);
  const [purpose, setPurpose] = useState(initialValues?.purpose || '');
  const [participants, setParticipants] = useState<number | undefined>(initialValues?.participants);
  const [meetingType, setMeetingType] = useState<MeetingType | ''>(initialValues?.extras?.meetingType || '');
  const [confidentialityChoice, setConfidentialityChoice] = useState<ConfidentialityChoice | ''>(initialValues?.extras?.confidentialityChoice || '');
  const [serviceRequirements, setServiceRequirements] = useState<BookingServiceRequirement[]>(initialServices.filter(item => !['TEA', 'VIDEO'].includes(item.type)));
  const [teaRequirement, setTeaRequirement] = useState<BookingServiceRequirement>(initialServices.find(item => item.type === 'TEA') || { type: 'TEA' });
  const [videoRequirement, setVideoRequirement] = useState<BookingServiceRequirement>(initialServices.find(item => item.type === 'VIDEO') || { type: 'VIDEO' });
  const [exclusiveRequestReason, setExclusiveRequestReason] = useState(initialValues?.extras?.exclusiveRequestReason || '');
  const [auditoriumSetup, setAuditoriumSetup] = useState<AuditoriumSetup>(initialValues?.extras?.auditoriumSetup || { seatingLayout: 'THEATER', stageRequired: false, rehearsalMinutes: 0, notes: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [errorFieldId, setErrorFieldId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [hasLeader, setHasLeader] = useState(initialValues?.extras?.hasLeader || false);
  const [leaderDetails, setLeaderDetails] = useState(initialValues?.extras?.leaderDetails || '');
  const [isVideoConference, setIsVideoConference] = useState(initialValues?.extras?.isVideoConference || initialServices.some(item => item.type === 'VIDEO'));
  const [requiredFeatures, setRequiredFeatures] = useState<RoomFeature[]>(initialValues?.extras?.requiredFeatures || initialValues?.requiredFeatures || []);
  const [needsTeaService, setNeedsTeaService] = useState(initialValues?.extras?.needsTeaService || initialServices.some(item => item.type === 'TEA'));
  const [attendeeIds, setAttendeeIds] = useState<string[]>(initialValues?.extras?.attendeeIds || []);
  const [repeatFrequency, setRepeatFrequency] = useState<'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY'>(initialValues?.recurrence?.frequency || 'NONE');
  const [repeatCount, setRepeatCount] = useState(initialValues?.recurrence?.count || 4);
  const [longTermEndDate, setLongTermEndDate] = useState(() => initialValues?.seriesEndDate ? new Date(`${initialValues.seriesEndDate}T12:00:00`) : getLongTermMaxEndDate(initialDateObj, ruleSettings.longTermMaxCalendarMonths));
  const isRenewal = !!initialValues?.renewalOfSeriesId;
  const longTermMaxEndDate = getLongTermMaxEndDate(selectedDate, ruleSettings.longTermMaxCalendarMonths);
  const longTermDays = getDailyOccurrenceCount(selectedDate, longTermEndDate);
  const showFormError = (message: string, fieldId?: string) => {
    setFormError(message);
    setErrorFieldId(fieldId);
    requestAnimationFrame(() => (fieldId ? document.getElementById(fieldId) : errorRef.current)?.focus());
  };
  useEffect(() => {
    if (!externalError) return;
    const fields: Record<string, string> = {
      INVALID_BOOKING_PURPOSE: 'booking-purpose',
      INVALID_PARTICIPANTS: 'booking-participants',
      CAPACITY_EXCEEDED: 'booking-participants',
      MEETING_TYPE_REQUIRED: 'booking-meeting-type',
      CONFIDENTIALITY_CHOICE_REQUIRED: 'booking-confidentiality',
      CONFIDENTIALITY_TYPE_MISMATCH: 'booking-confidentiality',
      RESOURCE_OUTSIDE_OPEN_HOURS: 'booking-start-time',
      BOOKING_START_IN_PAST: 'booking-start-time',
      EXCLUSIVE_LEADER_REQUIRED: 'booking-has-leader',
      EXCLUSIVE_REQUEST_REASON_REQUIRED: 'booking-exclusive-reason',
      AUDITORIUM_SETUP_REQUIRED: 'booking-auditorium-layout',
      SERVICE_DETAILS_REQUIRED: 'booking-service-OTHER'
    };
    showFormError(externalError.message, fields[externalError.code]);
  }, [externalError]);

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
    const toMinutes = (value: string) => value.split(':').map(Number).reduce((hours, minutes) => hours * 60 + minutes);
    const startMinutes = toMinutes(resource.openStart || '08:00');
    const endMinutes = toMinutes(resource.openEnd || '20:00');
    const slots = [];
    for (let minutes = startMinutes; minutes <= endMinutes; minutes += 30) {
      slots.push(`${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`);
    }
    return slots;
  }, [resource.openStart, resource.openEnd]);
  const finalTimeSlot = timeSlots[timeSlots.length - 1];

  const isSlotBooked = (time: string) => {
    const slotStart = new Date(`${formatDate(selectedDate)}T${time}`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
    
    return bookings.some((b: any) => {
        if (b.id === initialValues?.id || b.resourceId !== resource.id || !isActiveBooking(b)) return false;
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
    if (time === finalTimeSlot && (!selectedTimeRange.start || selectedTimeRange.end)) return;
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

  const selectedRange = useMemo(() => {
    if (isRoom && (!selectedTimeRange.start || !selectedTimeRange.end)) return null;
    const startTime = isRoom ? `${formatDate(selectedDate)}T${selectedTimeRange.start}:00` : `${formatDate(selectedDate)}T09:00:00`;
    const endTime = isRoom ? `${formatDate(selectedDate)}T${selectedTimeRange.end}:00` : `${formatDate(deskEndDate)}T18:00:00`;
    return new Date(endTime) > new Date(startTime) ? { startTime, endTime } : null;
  }, [isRoom, selectedDate, deskEndDate, selectedTimeRange.start, selectedTimeRange.end]);
  const quotaSegments = selectedRange ? splitBookingByNaturalDay(new Date(selectedRange.startTime).toISOString(), new Date(selectedRange.endTime).toISOString()) : [];
  const attendeeWarnings = useMemo(() => {
    if (!selectedRange || !attendeeIds.length) return [];
    const candidate = { ...selectedRange, resourceId: resource.id, attendeeIds } as Booking;
    const overlaps = findAttendeeOverlaps(bookings, candidate, initialValues?.id);
    return [...new Set(attendeeIds.filter(id => overlaps.some(booking => booking.userId === id || booking.attendeeIds?.includes(id) || booking.overlapParticipantIds?.includes(id)))
      .map(id => availableUsers.find((user: User) => user.id === id)?.name || '参会人')
      .map(name => `${name}在该时段已有其他预约`))];
  }, [selectedRange, attendeeIds, bookings, availableUsers, initialValues?.id, resource.id]);
  const applicableServiceCatalog = (serviceCatalog as ServiceCatalogItem[]).filter(item => item.resourceTypes.includes(resource.type)
    && (!item.roomCategories?.length || (resource.roomCategory && item.roomCategories.includes(resource.roomCategory))));
  const catalogFor = (type: BookingServiceRequirement['type']) => applicableServiceCatalog.find(item => item.type === type);
  const toggleService = (type: BookingServiceRequirement['type']) => setServiceRequirements(prev => prev.some(item => item.type === type) ? prev.filter(item => item.type !== type) : [...prev, { type }]);
  const updateServiceField = (type: BookingServiceRequirement['type'], key: string, value: string) => {
    const update = (item: BookingServiceRequirement) => ({
      ...item,
      fieldValues: { ...(item.fieldValues || {}), [key]: value },
      ...(key === 'notes' ? { details: value } : {})
    });
    if (type === 'TEA') setTeaRequirement(update);
    else if (type === 'VIDEO') setVideoRequirement(update);
    else setServiceRequirements(prev => prev.map(item => item.type === type ? update(item) : item));
  };
  const renderServiceFields = (requirement: BookingServiceRequirement) => {
    const catalog = catalogFor(requirement.type);
    if (!catalog?.fields.length) return null;
    return <div className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-3" aria-label={`${catalog.name}字段`}>
      <p className="text-[10px] font-black text-gray-500">{catalog.name} · 当前目录 v{catalog.version} · 提交时冻结快照</p>
      {catalog.fields.map(field => {
        const id = `booking-service-${requirement.type}-${field.key}`;
        const value = requirement.fieldValues?.[field.key] ?? (field.key === 'notes' ? requirement.details || '' : '');
        return <label key={field.key} htmlFor={id} className="block text-[11px] font-bold text-gray-600">{field.label}{field.required ? '（必填）' : ''}
          {field.type === 'TEXTAREA' ? <textarea id={id} aria-required={field.required} rows={2} maxLength={500} value={value} onChange={event => updateServiceField(requirement.type, field.key, event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3 text-xs outline-none"/> : field.type === 'SELECT' ? <select id={id} aria-required={field.required} value={value} onChange={event => updateServiceField(requirement.type, field.key, event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3 text-xs outline-none"><option value="">请选择</option>{field.options?.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input id={id} aria-required={field.required} type={field.type === 'NUMBER' ? 'number' : 'text'} min={field.type === 'NUMBER' ? '0' : undefined} maxLength={field.type === 'NUMBER' ? undefined : 500} value={value} onChange={event => updateServiceField(requirement.type, field.key, event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3 text-xs outline-none"/>}
        </label>;
      })}
    </div>;
  };

  const handleSubmit = async () => {
    setFormError(null);
    setErrorFieldId(undefined);
    if (!isValidBookingPurpose(purpose)) return showFormError(BOOKING_ERROR_MESSAGES.INVALID_BOOKING_PURPOSE, 'booking-purpose');
    if (!meetingType) return showFormError(BOOKING_ERROR_MESSAGES.MEETING_TYPE_REQUIRED, 'booking-meeting-type');
    if (!confidentialityChoice) return showFormError(BOOKING_ERROR_MESSAGES.CONFIDENTIALITY_CHOICE_REQUIRED, 'booking-confidentiality');
    if ((meetingType === 'CONFIDENTIAL') !== (confidentialityChoice === 'CONFIDENTIAL')) {
      return showFormError(BOOKING_ERROR_MESSAGES.CONFIDENTIALITY_TYPE_MISMATCH, 'booking-confidentiality');
    }
    if (!contactUser?.name || !contactUser.landline?.trim() || !contactUser.mobile?.trim()) {
      return showFormError(BOOKING_ERROR_MESSAGES.CONTACT_SNAPSHOT_INCOMPLETE);
    }
    if (participants === undefined || !Number.isInteger(participants) || participants < 1) {
      return showFormError(BOOKING_ERROR_MESSAGES.INVALID_PARTICIPANTS, 'booking-participants');
    }
    if (isRoom && resource.capacity && participants > resource.capacity) {
      return showFormError(`「${resource.name}」最多容纳 ${resource.capacity} 人，请减少人数或更换更大的会议室`, 'booking-participants');
    }
    if (resource.isExclusive && !hasLeader) {
      return showFormError(BOOKING_ERROR_MESSAGES.EXCLUSIVE_LEADER_REQUIRED, 'booking-has-leader');
    }
    if (resource.isExclusive && exclusiveRequestReason.trim().length < 2) {
      return showFormError(BOOKING_ERROR_MESSAGES.EXCLUSIVE_REQUEST_REASON_REQUIRED, 'booking-exclusive-reason');
    }
    const selectedServices = [...serviceRequirements,
      ...(needsTeaService ? [teaRequirement] : []),
      ...(isVideoConference ? [videoRequirement] : [])];
    for (const requirement of selectedServices) {
      const catalog = catalogFor(requirement.type);
      if (!catalog) return showFormError('所选服务不适用于当前资源，请取消该服务或更换资源。', `booking-service-${requirement.type}`);
      for (const field of catalog.fields) {
        const value = String(requirement.fieldValues?.[field.key] ?? (field.key === 'notes' ? requirement.details || '' : '')).trim();
        if (field.required && !value) return showFormError(`请填写${catalog.name}的“${field.label}”。`, `booking-service-${requirement.type}-${field.key}`);
        if (value && field.type === 'NUMBER' && (!Number.isFinite(Number(value)) || Number(value) < 0)) return showFormError(`“${field.label}”必须是非负数字。`, `booking-service-${requirement.type}-${field.key}`);
      }
    }

    let finalStart, finalEnd;
    if (isRoom) {
      if (!selectedTimeRange.start || !selectedTimeRange.end) return showFormError('请选择开始和结束时间', 'booking-start-time');
      finalStart = `${formatDate(selectedDate)}T${selectedTimeRange.start}:00`;
      finalEnd = `${formatDate(selectedDate)}T${selectedTimeRange.end}:00`;
    } else {
      finalStart = `${formatDate(selectedDate)}T09:00:00`;
      finalEnd = `${formatDate(deskEndDate)}T18:00:00`;
      if (new Date(deskEndDate) < new Date(selectedDate)) return showFormError('结束日期不能早于开始日期');
    }

    const requestedFeatures = [...new Set<RoomFeature>([...requiredFeatures, ...(isVideoConference ? ['VIDEO' as const] : [])])];
    const resourceError = validateBookingResource(resource, { startTime: finalStart, endTime: finalEnd, participants, requiredFeatures: requestedFeatures, isVideoConference });
    if (resourceError) return showFormError(BOOKING_ERROR_MESSAGES[resourceError], ['INVALID_PARTICIPANTS', 'CAPACITY_EXCEEDED'].includes(resourceError) ? 'booking-participants' : 'booking-start-time');

    let recurrence;
    if (repeatFrequency === 'DAILY') {
      if (longTermDays < 1) return showFormError('长期预订截止日期不能早于开始日期');
      if (longTermEndDate > longTermMaxEndDate) {
        return showFormError(`单期长期预订最长 ${ruleSettings.longTermMaxCalendarMonths} 个日历月，请选择 ${formatDate(longTermMaxEndDate)} 或更早的截止日期`);
      }
      recurrence = { frequency: 'DAILY', count: longTermDays };
    } else if (repeatFrequency !== 'NONE') {
      recurrence = { frequency: repeatFrequency, count: repeatCount };
    }

    const services = selectedServices.map(item => ({
      ...item,
      details: item.details?.trim() || undefined,
      fieldValues: Object.fromEntries(Object.entries(item.fieldValues || {}).map(([key, value]) => [key, String(value).trim()]).filter(([, value]) => value))
    }));
    const wasConfidential = initialValues?.extras?.meetingType === 'CONFIDENTIAL' || initialValues?.extras?.confidentialityChoice === 'CONFIDENTIAL';
    const declassify = Boolean(initialValues?.id && wasConfidential && meetingType !== 'CONFIDENTIAL' && confidentialityChoice !== 'CONFIDENTIAL');
    const attendeeChange = Boolean(initialValues?.id && wasConfidential
      && JSON.stringify([...(initialValues?.extras?.attendeeIds || [])].sort()) !== JSON.stringify([...attendeeIds].sort()));
    const usableAuthorizations = confidentialityAuthorizations.filter((item: ConfidentialityAuthorization) => item.bookingId === initialValues?.id && !item.usedAt);
    const securityAuthorizationIds: string[] = [];
    if (declassify) {
      const authorizers = new Set<string>();
      for (const item of usableAuthorizations.filter((authorization: ConfidentialityAuthorization) => authorization.action === 'DECLASSIFY')) {
        if (authorizers.has(item.authorizedBy)) continue;
        authorizers.add(item.authorizedBy);
        securityAuthorizationIds.push(item.id);
        if (authorizers.size === 2) break;
      }
      if (authorizers.size !== 2) return showFormError(BOOKING_ERROR_MESSAGES.CONFIDENTIAL_DECLASSIFY_DUAL_AUTHORIZATION_REQUIRED, 'booking-confidentiality');
    }
    if (attendeeChange) {
      const authorization = usableAuthorizations.find((item: ConfidentialityAuthorization) => item.action === 'ATTENDEE_CHANGE');
      if (!authorization) return showFormError(BOOKING_ERROR_MESSAGES.CONFIDENTIAL_ATTENDEE_AUTHORIZATION_REQUIRED, 'booking-attendees');
      securityAuthorizationIds.push(authorization.id);
    }
    setSubmitting(true);
    try {
      await onConfirm(resource.id, purpose.trim(), finalStart, finalEnd, participants, {
        meetingType,
        confidentialityChoice,
        serviceRequirements: services,
        exclusiveRequestReason: resource.isExclusive ? exclusiveRequestReason.trim() : undefined,
        auditoriumSetup: isAuditorium ? { ...auditoriumSetup, notes: auditoriumSetup.notes?.trim() || undefined } : undefined,
        hasLeader,
        leaderDetails: hasLeader ? leaderDetails : undefined,
        isVideoConference,
        needsTeaService,
        requiredFeatures: requestedFeatures,
        attendeeIds,
        securityAuthorizationIds,
        recurrence,
        seriesKind: repeatFrequency === 'DAILY' ? 'LONG_TERM' : undefined,
        seriesEndDate: repeatFrequency === 'DAILY' ? formatDate(longTermEndDate) : undefined,
        renewalOfSeriesId: initialValues?.renewalOfSeriesId,
        rootSeriesId: initialValues?.rootSeriesId
      });
    } finally {
      setSubmitting(false);
    }
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
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label={`${initialValues?.id ? '修改预约' : '预约'}${resource.name}`} className="booking-modal-shell fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="booking-modal bg-white w-full animate-in zoom-in">
        <header className="booking-modal-header">
          <div>
            <span className="booking-modal-kicker">{initialValues?.id ? '修改会议安排' : isRenewal ? '长期预订续期' : '提交会议预约'}</span>
            <h3>{isRoom ? <Monitor size={22}/> : <Coffee size={22}/>}<span>{initialValues?.id ? '修改预约' : isRenewal ? '长期预订续期' : '预约'} {resource.name}</span></h3>
          </div>
          <div className="booking-resource-summary" aria-label="会议室当前配置">
            <div><span>{resource.location} · 最多 {resource.capacity || 0} 人</span><StatusBadge status={resource.status} theme={theme}/></div>
            <p>{(resource.features || []).join(' · ') || '未配置特殊设备'}</p>
            {!isResourceAcceptingBookings(resource) && <p role="alert" className="booking-resource-warning">当前状态暂停新预约，请返回选择其他会议室。</p>}
          </div>
        </header>

        <div className="booking-modal-body custom-scrollbar">
          <section className="booking-form-section" aria-labelledby="booking-section-info">
            <div className="booking-form-section-heading"><span>01</span><div><h4 id="booking-section-info">会议信息</h4><p>填写主题、会议类型和涉密属性，带必填标记的内容需完整填写。</p></div></div>
          <div className="space-y-2">
            <label htmlFor="booking-purpose" className="text-[11px] font-black text-gray-500 uppercase tracking-widest">申请用途</label>
            <input
              id="booking-purpose"
              aria-label="申请用途"
              aria-required="true"
              aria-invalid={errorFieldId === 'booking-purpose'}
              aria-describedby={errorFieldId === 'booking-purpose' ? 'booking-form-error' : undefined}
              maxLength={200}
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              placeholder="会议主题或办公内容..."
              className="w-full bg-gray-50 p-4 rounded-2xl border-none outline-none font-bold shadow-inner focus:ring-2 ring-indigo-100 transition-all text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">会议类型
              <select id="booking-meeting-type" aria-label="会议类型" aria-required="true" value={meetingType} onChange={e => setMeetingType(e.target.value as MeetingType | '')} className="mt-2 w-full p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none normal-case tracking-normal">
                <option value="">请选择会议类型</option><option value="NORMAL">普通会议</option><option value="IMPORTANT">重要会议</option><option value="CONFIDENTIAL">涉密会议</option>
              </select>
            </label>
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">涉密确认
              <select id="booking-confidentiality" aria-label="涉密确认" aria-required="true" value={confidentialityChoice} onChange={e => setConfidentialityChoice(e.target.value as ConfidentialityChoice | '')} className="mt-2 w-full p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none normal-case tracking-normal">
                <option value="">请明确选择</option><option value="NON_CONFIDENTIAL">非涉密</option><option value="CONFIDENTIAL">涉密</option>
              </select>
            </label>
          </div>
          <div className="p-3 rounded-2xl bg-gray-50 border border-gray-100 text-[11px] text-gray-600 space-y-1" aria-label="联系人快照说明">
            <p className="font-black text-gray-700">联系人快照 · {contactUser?.name || '当前用户'}</p>
            <p>座机：{contactUser?.landline || '未维护'} · 手机：{contactUser?.mobile || '未维护'}</p>
            <p className="text-gray-500">提交时由服务端读取{initialValues?.userId ? '原申请人' : '当前'}档案并冻结快照，不使用草案或表单中伪造的联系方式。</p>
          </div>
          {resource.isExclusive && <div className="space-y-2">
            <label htmlFor="booking-exclusive-reason" className="text-[11px] font-black text-gray-500 uppercase tracking-widest">专属会议室临时申请理由</label>
            <textarea id="booking-exclusive-reason" aria-required="true" rows={3} maxLength={500} value={exclusiveRequestReason} onChange={e => setExclusiveRequestReason(e.target.value)} placeholder={`该资源默认关闭，仅会前 ${ruleSettings.exclusiveRequestOpenHours} 小时内可申请，请说明临时使用理由`} className="w-full p-3 bg-amber-50 rounded-xl border border-amber-100 text-xs font-bold outline-none" />
          </div>}
          </section>

          <section className="booking-form-section" aria-labelledby="booking-section-schedule">
            <div className="booking-form-section-heading"><span>02</span><div><h4 id="booking-section-schedule">日期与时段</h4><p>灰色时段不可选；也可先选开始时间，再使用快捷时长。</p></div></div>
          {/* Date Picker - Horizontal Scroll */}
          <div className="space-y-2">
             <div className="flex items-center justify-between">
               <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">{isRenewal ? '续期开始日期（自动衔接）' : '选择日期'}</label>
               <input aria-label="自定义预约日期" type="date" min={formatDate(new Date())} value={formatDate(selectedDate)} disabled={isRenewal} onChange={e => { if (!e.target.value) return; const nextDate = new Date(`${e.target.value}T12:00`); setSelectedDate(nextDate); setLongTermEndDate(getLongTermMaxEndDate(nextDate, ruleSettings.longTermMaxCalendarMonths)); setSelectedTimeRange({ start: null, end: null }); }} className="text-xs font-bold text-gray-500 bg-gray-50 rounded-lg px-2 py-1 outline-none disabled:opacity-60"/>
             </div>
             <div className="flex space-x-3 overflow-x-auto pb-2 custom-scrollbar">
                {dateOptions.map((d) => {
                    const isSelected = formatDate(d) === formatDate(selectedDate);
                    const isToday = formatDate(d) === formatDate(new Date());
                    const dayName = ['日','一','二','三','四','五','六'][d.getDay()];
                    return (
                        <button 
                            key={formatDate(d)}
                            onClick={() => { if (isRenewal) return; setSelectedDate(d); setLongTermEndDate(getLongTermMaxEndDate(d, ruleSettings.longTermMaxCalendarMonths)); setSelectedTimeRange({start:null,end:null}); }}
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
                    <span>选择时段 ({resource.openStart || '08:00'} - {resource.openEnd || '20:00'})</span>
                    {selectedTimeRange.start && selectedTimeRange.end && <span className={`text-${theme}-600`}>{selectedTimeRange.start} - {selectedTimeRange.end}</span>}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select id="booking-start-time" aria-label="预约开始时间" value={selectedTimeRange.start || ''} onChange={e => { setFormError(null); setSelectedTimeRange({ start: e.target.value, end: null }); }} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none">
                    <option value="" disabled>开始时间</option>
                    {timeSlots.filter(t => t !== finalTimeSlot).map(t => <option key={t} value={t} disabled={isSlotBooked(t) || isSlotPast(t)}>{t}{isSlotBooked(t) ? '（已占用）' : ''}</option>)}
                  </select>
                  <select aria-label="预约结束时间" value={selectedTimeRange.end || ''} disabled={!selectedTimeRange.start} onChange={e => selectRange(selectedTimeRange.start!, e.target.value)} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none disabled:opacity-50">
                    <option value="" disabled>结束时间</option>
                    {timeSlots.map(t => <option key={t} value={t} disabled={!selectedTimeRange.start || timeToMinutes(t) <= timeToMinutes(selectedTimeRange.start)}>{t}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-gray-500 shrink-0">快捷时长</span>
                  {[30, 60, 90, 120].map(minutes => <button key={minutes} disabled={!selectedTimeRange.start || timeToMinutes(selectedTimeRange.start) + minutes > timeToMinutes(finalTimeSlot)} onClick={() => selectRange(selectedTimeRange.start!, minutesToTime(timeToMinutes(selectedTimeRange.start!) + minutes))} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border disabled:opacity-30 ${selectedTimeRange.start && selectedTimeRange.end && timeToMinutes(selectedTimeRange.end) - timeToMinutes(selectedTimeRange.start) === minutes ? `border-${theme}-300 bg-${theme}-50 text-${theme}-600` : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}>{minutes < 60 ? `${minutes}分钟` : `${minutes / 60}小时`}</button>)}
                </div>
                <div className="booking-time-grid grid grid-cols-4 gap-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                    {timeSlots.map(time => {
                        const booked = isSlotBooked(time);
                        const past = isSlotPast(time);
                        const endOnlyBlocked = time === finalTimeSlot && (!selectedTimeRange.start || !!selectedTimeRange.end);
                        const disabled = booked || past || endOnlyBlocked;
                        const selected = isSlotSelected(time);
                        const inRange = isSlotInRange(time);
                        return (
                            <button
                                key={time}
                                onClick={() => handleTimeClick(time)}
                                disabled={disabled}
                                title={booked ? '该时段已被预订' : past ? '已过时间不可预订' : endOnlyBlocked ? `${finalTimeSlot} 仅可作为结束时间` : undefined}
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
          </section>

          <section className="booking-form-section" aria-labelledby="booking-section-attendees">
            <div className="booking-form-section-heading"><span>03</span><div><h4 id="booking-section-attendees">参会与重复</h4><p>确认人数和参会人；需要长期或周期会议时，在此设置重复方式。</p></div></div>
          <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex justify-between">
              <span>人数</span>
              {resource.capacity ? <span className="text-gray-500 normal-case">该空间最多 {resource.capacity} 人</span> : null}
            </label>
            <input id="booking-participants" aria-label="参与人数" aria-required="true" aria-invalid={errorFieldId === 'booking-participants'} aria-describedby={errorFieldId === 'booking-participants' ? 'booking-form-error' : undefined} type="number" min="1" step="1" max={resource.capacity || undefined} value={Number.isNaN(participants) ? '' : participants ?? ''} onChange={e => setParticipants(e.target.value === '' ? undefined : Number(e.target.value))} className="w-full bg-gray-50 p-4 rounded-2xl border-none outline-none font-bold shadow-inner text-sm" />
          </div>

          {isAuditorium && <fieldset className="space-y-3 p-4 rounded-2xl bg-gray-50 border border-gray-100">
            <legend className="px-1 text-[11px] font-black text-gray-500 uppercase tracking-widest">礼堂布置</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-gray-600">座位布局
                <select id="booking-auditorium-layout" value={auditoriumSetup.seatingLayout} onChange={e => setAuditoriumSetup(prev => ({ ...prev, seatingLayout: e.target.value as AuditoriumSetup['seatingLayout'] }))} className="mt-1 w-full p-3 bg-white rounded-xl text-xs font-bold outline-none"><option value="THEATER">剧院式</option><option value="CLASSROOM">课桌式</option><option value="ROUNDTABLE">圆桌式</option></select>
              </label>
              <label className="text-xs font-bold text-gray-600">彩排时长（分钟）
                <input aria-label="彩排时长" type="number" min="0" max="1440" step="30" value={auditoriumSetup.rehearsalMinutes || 0} onChange={e => setAuditoriumSetup(prev => ({ ...prev, rehearsalMinutes: Number(e.target.value) }))} className="mt-1 w-full p-3 bg-white rounded-xl text-xs font-bold outline-none" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-600"><input type="checkbox" checked={auditoriumSetup.stageRequired} onChange={e => setAuditoriumSetup(prev => ({ ...prev, stageRequired: e.target.checked }))} className="accent-indigo-600" />需要舞台</label>
            <textarea aria-label="礼堂布置备注" rows={2} maxLength={500} value={auditoriumSetup.notes || ''} onChange={e => setAuditoriumSetup(prev => ({ ...prev, notes: e.target.value }))} placeholder="礼堂布置补充说明（可选）" className="w-full p-3 bg-white rounded-xl text-xs font-bold outline-none" />
          </fieldset>}

          <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">参会人（可选）</label>
            <div id="booking-attendees" tabIndex={-1} className="booking-attendee-grid max-h-32 overflow-y-auto grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded-2xl outline-none">
              {availableUsers.filter((u: User) => u.id !== contactUser?.id).map((u: User) => <label key={u.id} className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer"><input type="checkbox" checked={attendeeIds.includes(u.id)} onChange={() => setAttendeeIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])} className="accent-indigo-600"/><span>{u.name}<small className="block text-gray-500 font-medium">{u.department}</small></span></label>)}
            </div>
          </div>

          {isRoom && !initialValues?.id && <div className="space-y-2">
            <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">预订方式</label>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="重复频率" value={repeatFrequency} disabled={isRenewal} onChange={e => { const frequency = e.target.value as any; setRepeatFrequency(frequency); setFormError(null); if (frequency === 'DAILY') setLongTermEndDate(getLongTermMaxEndDate(selectedDate, ruleSettings.longTermMaxCalendarMonths)); }} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none disabled:opacity-60"><option value="NONE">单次预约</option><option value="DAILY">长期预订 · 每天</option><option value="WEEKLY">每周重复</option><option value="BIWEEKLY">隔周重复</option></select>
              {repeatFrequency === 'DAILY' ? (
                <input aria-label="长期预订截止日期" type="date" min={formatDate(selectedDate)} max={formatDate(longTermMaxEndDate)} value={formatDate(longTermEndDate)} onChange={e => { if (e.target.value) setLongTermEndDate(new Date(`${e.target.value}T12:00:00`)); setFormError(null); }} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none" />
              ) : (
                <select aria-label="重复次数" value={repeatCount} disabled={repeatFrequency === 'NONE'} onChange={e => setRepeatCount(Number(e.target.value))} className="p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none disabled:opacity-50">{[2, 3, 4, 6, 8, 12].map(n => <option key={n} value={n}>共 {n} 次</option>)}</select>
              )}
            </div>
            {repeatFrequency === 'DAILY' ? (
              <div className={`p-3 rounded-xl bg-${theme}-50 text-[11px] leading-relaxed text-gray-600`}>
                <p><strong>本期 {longTermDays} 天</strong> · {formatDate(selectedDate)} 至 {formatDate(longTermEndDate)}，每天 {selectedTimeRange.start || '--:--'} - {selectedTimeRange.end || '--:--'}。</p>
                <p className="mt-1">单期最长 {ruleSettings.longTermMaxCalendarMonths} 个日历月；到期可续期，审批通过后衔接使用。逐次检测冲突，冲突日期可跳过。</p>
              </div>
            ) : repeatFrequency !== 'NONE' && <p className="text-[11px] text-gray-500">提交后逐次检测冲突，冲突单次可跳过或改期</p>}
          </div>}
          </section>

          <section className="booking-form-section" aria-labelledby="booking-section-services">
            <div className="booking-form-section-heading"><span>04</span><div><h4 id="booking-section-services">会务与保障</h4><p>按需选择领导参会、视频会议、茶水及其他会务服务。</p></div></div>
          <div className="space-y-4">
             <div className="flex items-center justify-between">
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex items-center space-x-1">
                    <Crown size={12}/> <span>公司领导参会{resource.isExclusive ? '（专属会议室必填）' : ''}</span>
                </label>
                <button
                    id="booking-has-leader"
                    type="button"
                    aria-label="公司领导参会"
                    aria-pressed={hasLeader}
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
                    disabled={(!videoSupported || !catalogFor('VIDEO')) && !isVideoConference}
                    title={!videoSupported ? '当前会议室未配置视频会议设备' : !catalogFor('VIDEO') ? '当前资源不在视频会议服务目录适用范围内' : undefined}
                    onClick={() => { const enabled = !isVideoConference; setIsVideoConference(enabled); setRequiredFeatures(prev => enabled ? [...new Set<RoomFeature>([...prev, 'VIDEO'])] : prev.filter(feature => feature !== 'VIDEO')); }}
                    className={`w-10 h-6 rounded-full p-1 transition-all disabled:opacity-40 ${isVideoConference ? `bg-${theme}-600` : 'bg-gray-200'}`}
                >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${isVideoConference ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </button>
             </div>
             {!videoSupported && <p className="-mt-2 text-[11px] text-gray-500">当前会议室未配置视频会议设备。</p>}
             {isVideoConference && renderServiceFields(videoRequirement)}

             <div className="flex items-center justify-between">
                <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex items-center space-x-1">
                    <CupSoda size={12}/> <span>茶水服务</span>
                </label>
                <button
                    type="button"
                    aria-label="茶水服务"
                    aria-pressed={needsTeaService}
                    disabled={!catalogFor('TEA') && !needsTeaService}
                    title={!catalogFor('TEA') ? '当前资源不在茶水服务目录适用范围内' : undefined}
                    onClick={() => setNeedsTeaService(!needsTeaService)}
                    className={`w-10 h-6 rounded-full p-1 transition-all ${needsTeaService ? `bg-${theme}-600` : 'bg-gray-200'}`}
                >
                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${needsTeaService ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </button>
             </div>
             {needsTeaService && renderServiceFields(teaRequirement)}
             <div className="flex flex-wrap gap-2" aria-label="其他会务服务">
               {applicableServiceCatalog.filter(item => !['TEA', 'VIDEO'].includes(item.type)).map(item => {
                 const selected = serviceRequirements.some(requirement => requirement.type === item.type);
                 return <button key={item.id} id={`booking-service-${item.type}`} type="button" aria-pressed={selected} onClick={() => toggleService(item.type)} className={`px-3 py-2 rounded-xl text-[11px] font-bold border ${selected ? `bg-${theme}-600 text-white border-${theme}-600` : 'bg-white text-gray-500 border-gray-200'}`}>{item.name}{item.heavyService ? ' · 重服务' : ''}</button>;
               })}
             </div>
             {serviceRequirements.map(item => <React.Fragment key={item.type}>{renderServiceFields(item)}</React.Fragment>)}
          </div>
          </section>

          {selectedRange && <div className="p-3 rounded-2xl bg-gray-50 border border-gray-100 text-[11px] leading-relaxed text-gray-600" aria-label="部门额度提示">
            <p className="font-black text-gray-700">本部门在当前会议室的每日净额度 · 每日 {ruleSettings.departmentDailyNetMinutes} 分钟</p>
            {quotaSegments.map(segment => <p key={segment.date}>{segment.date}：本次计 {segment.minutes} 分钟{segment.minutes > ruleSettings.departmentDailyNetMinutes ? '，已超过单日上限' : ''}</p>)}
            <p className="text-gray-500">不跨其他会议室扣减；跨日按中国自然日拆分，系列逐期累计，取消或驳回自动返还。实际剩余额度以服务端提交校验为准。</p>
          </div>}
          {attendeeWarnings.length > 0 && <div role="status" className="p-3 rounded-2xl bg-amber-50 border border-amber-100 text-[11px] font-bold text-amber-700 space-y-1">
            <p>参会人时间重叠提示（不阻断申请）</p>{attendeeWarnings.map(warning => <p key={warning}>{warning}</p>)}
          </div>}

          {formError && (
            <p id="booking-form-error" ref={errorRef} tabIndex={-1} role="alert" className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 outline-none">{formError}</p>
          )}

        </div>
        <footer className="booking-modal-footer">
          <p>提交时将再次校验时段冲突、容量和预约规则。</p>
          <div>
            <button onClick={onClose} className="booking-cancel-button">取消</button>
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className={`booking-submit-button bg-${theme}-600`}
            >
              {submitting ? '正在校验并提交…' : initialValues?.id ? '保存修改' : isRenewal ? '提交续期审批' : '确认预约'}
            </button>
          </div>
        </footer>
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
                      <BookingStatusBadge booking={b} theme={theme} />
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

const ConfidentialityAdminPanel = ({ users, authorizationTargets, whitelist, authorizations, currentUser, onAddWhitelist, onRemoveWhitelist, onAuthorize }: any) => {
  const [whitelistUserId, setWhitelistUserId] = useState('');
  const [whitelistReason, setWhitelistReason] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [action, setAction] = useState<'DECLASSIFY' | 'ATTENDEE_CHANGE'>('DECLASSIFY');
  const [authorizationReason, setAuthorizationReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const userName = (id: string) => users.find((user: User) => user.id === id)?.name || id;
  const availableUsers = users.filter((user: User) => !whitelist.some((entry: ConfidentialWhitelistEntry) => entry.userId === user.id));
  const confidentialBookings = authorizationTargets.filter((booking: ConfidentialAuthorizationTarget) => booking.userId !== currentUser.id);
  const selectedAuthorizations = authorizations.filter((item: ConfidentialityAuthorization) => item.bookingId === bookingId);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (cause: any) { setError(formatUserError(cause, '操作失败，请刷新后重试。', BOOKING_ERROR_MESSAGES)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-6 animate-in fade-in">
    <div><h3 className="text-2xl font-black text-gray-800">保密控制</h3><p className="text-sm text-gray-500 mt-1">维护涉密申请白名单，并为待审批申请签发一次性变更授权。</p></div>
    {error && <p role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-100 text-xs font-bold text-rose-700">{error}</p>}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <section className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm" aria-labelledby="whitelist-title">
        <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 grid place-items-center"><ShieldCheck size={20}/></div><div><h4 id="whitelist-title" className="font-black text-gray-800">涉密白名单</h4><p className="text-xs text-gray-500 mt-1">申请人与全部参会人均须在名单内。</p></div></div>
        <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); if (!whitelistUserId || !whitelistReason.trim()) return setError('请选择成员并填写白名单设置理由。'); void run(async () => { await onAddWhitelist({ userId: whitelistUserId, reason: whitelistReason.trim() }); setWhitelistUserId(''); setWhitelistReason(''); }); }}>
          <select aria-label="白名单成员" value={whitelistUserId} onChange={event => setWhitelistUserId(event.target.value)} className="w-full p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none"><option value="">选择待加入成员</option>{availableUsers.map((user: User) => <option key={user.id} value={user.id}>{user.name} · {user.department}</option>)}</select>
          <textarea aria-label="白名单设置理由" rows={2} maxLength={500} value={whitelistReason} onChange={event => setWhitelistReason(event.target.value)} placeholder="设置理由（必填）" className="w-full p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none resize-none"/>
          <button disabled={busy || !availableUsers.length} className="w-full py-3 rounded-xl bg-indigo-600 text-white text-xs font-black disabled:opacity-40">加入白名单</button>
        </form>
        <div className="mt-5 space-y-2 max-h-80 overflow-y-auto">
          {whitelist.map((entry: ConfidentialWhitelistEntry) => <div key={entry.id} className="p-4 rounded-2xl bg-gray-50 flex items-start justify-between gap-3"><div><p className="text-sm font-black text-gray-800">{userName(entry.userId)}</p><p className="mt-1 text-xs text-gray-500">{entry.reason}</p><p className="mt-1 text-[11px] text-gray-500">设置人：{userName(entry.createdBy)} · {toLocalDateTimeString(entry.createdAt)}</p></div><button disabled={busy} aria-label={`移除${userName(entry.userId)}的白名单资格`} onClick={() => { if (!confirm(`确定移除${userName(entry.userId)}的白名单资格吗？进行中的最终核准也会重新校验。`)) return; void run(() => onRemoveWhitelist(entry.id)); }} className="p-2 text-gray-500 hover:text-rose-600 disabled:opacity-40"><Trash2 size={16}/></button></div>)}
          {!whitelist.length && <p className="py-8 text-center border border-dashed rounded-2xl text-xs font-bold text-gray-500">暂无白名单成员</p>}
        </div>
      </section>
      <section className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm" aria-labelledby="authorization-title">
        <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 grid place-items-center"><Key size={20}/></div><div><h4 id="authorization-title" className="font-black text-gray-800">涉密变更授权</h4><p className="text-xs text-gray-500 mt-1">降级需两名不同授权人；参会范围变化需一人。</p></div></div>
        <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); if (!bookingId || !authorizationReason.trim()) return setError('请选择待审批申请并填写授权理由。'); void run(async () => { await onAuthorize(bookingId, { action, reason: authorizationReason.trim() }); setAuthorizationReason(''); }); }}>
          <select aria-label="涉密变更申请" value={bookingId} onChange={event => setBookingId(event.target.value)} className="w-full p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none"><option value="">选择待审批涉密申请</option>{confidentialBookings.map((booking: ConfidentialAuthorizationTarget) => <option key={booking.id} value={booking.id}>{userName(booking.userId)} · {toLocalDateTimeString(booking.startTime)} · {booking.id}</option>)}</select>
          <select aria-label="涉密变更类型" value={action} onChange={event => setAction(event.target.value as 'DECLASSIFY' | 'ATTENDEE_CHANGE')} className="w-full p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none"><option value="DECLASSIFY">涉密降级授权</option><option value="ATTENDEE_CHANGE">参会范围变化授权</option></select>
          <textarea aria-label="涉密变更授权理由" rows={2} maxLength={500} value={authorizationReason} onChange={event => setAuthorizationReason(event.target.value)} placeholder="授权理由（必填）" className="w-full p-3 bg-gray-50 rounded-xl text-xs font-bold outline-none resize-none"/>
          <button disabled={busy || !confidentialBookings.length} className="w-full py-3 rounded-xl bg-amber-600 text-white text-xs font-black disabled:opacity-40">签发一次性授权</button>
        </form>
        {bookingId && <div className="mt-5 space-y-2"><p className="text-[11px] font-black text-gray-500">当前申请授权记录</p>{selectedAuthorizations.map((item: ConfidentialityAuthorization) => <div key={item.id} className="p-3 rounded-xl bg-gray-50 text-xs"><div className="flex justify-between gap-3"><span className="font-black text-gray-700">{item.action === 'DECLASSIFY' ? '降级' : '参会变化'} · {userName(item.authorizedBy)}</span><span className={item.usedAt ? 'text-gray-500' : 'text-emerald-600'}>{item.usedAt ? '已使用' : '未使用'}</span></div><p className="mt-1 text-gray-500">{item.reason}</p></div>)}{!selectedAuthorizations.length && <p className="text-xs text-gray-500">尚未签发授权</p>}</div>}
        {!confidentialBookings.length && <p className="mt-5 py-8 text-center border border-dashed rounded-2xl text-xs font-bold text-gray-500">暂无可授权的他人待审批涉密申请</p>}
      </section>
    </div>
  </div>;
};

// --- Main App ---

const App: React.FC = () => {
  const mainRef = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<AppView>(() => monitoringViewFromHash(window.location.hash) || 'DASHBOARD');
  const [scheduleRange, setScheduleRange] = useState<ScheduleRange>('TODAY');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState('indigo');
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 进入「总部楼层 3D」时自动收起侧栏，把宽度让给画面。
  // 这个状态**不写进用户偏好** —— 否则离开 3D 后侧栏会一直是收起的，
  // 而且下次登录还会恢复成收起，等于替用户改了设置。
  const [hqSidebarExpanded, setHqSidebarExpanded] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workflow, setWorkflow] = useState<ApprovalNode[]>([]);
  const [workflowVersions, setWorkflowVersions] = useState<WorkflowVersion[]>([]);
  const [approvalDelegates, setApprovalDelegates] = useState<ApprovalDelegate[]>([]);
  const [approvalRuleSetVersions, setApprovalRuleSetVersions] = useState<ApprovalRuleSetVersion[]>([]);
  const [confidentialWhitelist, setConfidentialWhitelist] = useState<ConfidentialWhitelistEntry[]>([]);
  const [confidentialAuthorizationTargets, setConfidentialAuthorizationTargets] = useState<ConfidentialAuthorizationTarget[]>([]);
  const [confidentialityAuthorizations, setConfidentialityAuthorizations] = useState<ConfidentialityAuthorization[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);
  const [serviceShifts, setServiceShifts] = useState<ServiceShift[]>([]);
  const [serviceInspections, setServiceInspections] = useState<ServiceInspection[]>([]);
  const [checkInEvents, setCheckInEvents] = useState<CheckInEvent[]>([]);
  const [usageFacts, setUsageFacts] = useState<BookingUsageFact[]>([]);
  const [usageAppeals, setUsageAppeals] = useState<UsageAppeal[]>([]);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [exceptions, setExceptions] = useState<OperationalException[]>([]);
  const [devices, setDevices] = useState<Array<Omit<DoorDevice, 'tokenHash'>>>([]);
  const operationRequestRef = useRef<{ id: number; owner: string } | null>(null);
  const operationSequenceRef = useRef(0);
  const operationOwnerRef = useRef<string | null>(null);
  operationOwnerRef.current = currentUser?.id || null;
  const [ruleSettings, setRuleSettings] = useState<BookingRuleSettings>(DEFAULT_RULE_SETTINGS);
  const [bookingFormError, setBookingFormError] = useState<{ code?: string; message: string } | null>(null);
  const preferencesSnapshotRef = useRef('');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    for (const key of ['SMART_OFFICE_DATA_V35', 'SMART_OFFICE_THEME', 'SMART_OFFICE_NOTIFICATIONS', 'SMART_OFFICE_REMINDERS']) {
      localStorage.removeItem(key);
    }
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [view, currentUser?.id]);

  useEffect(() => {
    syncMonitoringUrl(view, true);
  }, [view]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.actor) setCurrentUser(data.actor); })
      .finally(() => setAuthLoading(false));
  }, []);

  const applyWorkspace = useCallback((data: any) => {
    if (!data) return;
    setRoles(data.roles || []);
    setUsers(data.users || []);
    setResources(data.resources || []);
    setBookings(migrateBookings(data.bookings || []));
    setDepartments(data.departments || []);
    setWorkflow(data.workflow || []);
    setWorkflowVersions(data.workflowVersions || []);
    setApprovalDelegates(data.approvalDelegates || []);
    setApprovalRuleSetVersions(data.approvalRuleSetVersions || []);
    setConfidentialWhitelist(data.confidentialWhitelist || []);
    setConfidentialAuthorizationTargets(data.confidentialAuthorizationTargets || []);
    setConfidentialityAuthorizations(data.confidentialityAuthorizations || []);
    setWorkOrders(data.workOrders || []);
    setServiceCatalog(data.serviceCatalog || []);
    setServiceAreas(data.serviceAreas || []);
    setServiceShifts(data.serviceShifts || []);
    setServiceInspections(data.serviceInspections || []);
    setCheckInEvents(data.checkInEvents || []);
    setUsageFacts(data.usageFacts || []);
    setUsageAppeals(data.usageAppeals || []);
    setDevices(data.devices || []);
    setRuleSettings(data.ruleSettings || DEFAULT_RULE_SETTINGS);
  }, []);

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

  const refreshOperations = async () => {
    const owner = currentUser?.id;
    if (!owner || operationRequestRef.current?.owner === owner) return;
    const requestId = ++operationSequenceRef.current;
    operationRequestRef.current = { id: requestId, owner };
    try {
      const [workspaceResponse, dashboardResponse, exceptionResponse, notificationResponse] = await Promise.all([
        fetch('/api/workspace'), fetch('/api/dashboard'), fetch('/api/exceptions'), fetch('/api/notifications')
      ]);
      const [workspaceData, dashboardData, exceptionData, notificationData] = await Promise.all([
        workspaceResponse.json(), dashboardResponse.json(), exceptionResponse.json(), notificationResponse.json()
      ]);
      if ([workspaceResponse, dashboardResponse, exceptionResponse, notificationResponse].some(response => response.status === 401) && operationOwnerRef.current === owner) {
        setCurrentUser(null);
      }
      if (!workspaceResponse.ok || !dashboardResponse.ok || !exceptionResponse.ok || !notificationResponse.ok) throw new Error('OPERATIONS_REFRESH_FAILED');
      if (operationOwnerRef.current !== owner) return;
      applyWorkspace(workspaceData);
      setWorkspaceLoaded(true);
      setDashboard(dashboardData);
      setExceptions(exceptionData.exceptions || []);
      setNotifications(notificationData.notifications || []);
      setIsOnline(true);
    } catch {
      if (operationOwnerRef.current === owner) setIsOnline(false);
    } finally {
      if (operationRequestRef.current?.id === requestId) operationRequestRef.current = null;
    }
  };

  const apiRequest = useCallback(async (path: string, method: string, body: any = {}) => {
    setSaveStatus('saving');
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : JSON.stringify(body)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(formatUserError(result, '操作失败，请刷新后重试。', BOOKING_ERROR_MESSAGES)) as Error & { code?: string };
        if (typeof result.error === 'string') error.code = result.error;
        throw error;
      }
      if (result.workspace) applyWorkspace(result.workspace);
      setSaveStatus('saved');
      setIsOnline(true);
      return result;
    } catch (error) {
      setSaveStatus('error');
      throw error;
    }
  }, [applyWorkspace]);

  useEffect(() => {
    setWorkspaceLoaded(false);
    setPreferencesLoaded(false);
  }, [currentUser?.id]);

  useEffect(() => {
    setDashboard(null);
    setExceptions([]);
    setDevices([]);
    if (!currentUser) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      if (!document.hidden && navigator.onLine) await refreshOperations();
      if (active) timer = setTimeout(() => void poll(), 10000);
    };
    const resume = () => { if (!document.hidden && navigator.onLine) void refreshOperations(); };
    void poll();
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
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
  // 视图一变就把「手动展开」的许可作废：离开 3D 恢复原样，再进 3D 重新自动收起
  useEffect(() => { setHqSidebarExpanded(false); }, [view]);
  const [searchQuery, setSearchQuery] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState<'ALL' | ResourceType>('ALL');
  const [resourceStatusFilter, setResourceStatusFilter] = useState<'ALL' | ResourceStatus>('ALL');
  const [resourceBuildingFilter, setResourceBuildingFilter] = useState<'ALL' | BuildingId>('ALL');
  const [resourceMinCapacity, setResourceMinCapacity] = useState(0);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showResourceModal, setShowResourceModal] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [spatialFocus, setSpatialFocus] = useState<{ location: string; building?: BuildingId; floor?: number; token: number | string } | null>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [editingWorkflowNode, setEditingWorkflowNode] = useState<ApprovalNode | null>(null);
  const latestApprovalRuleSet = useMemo(
    () => [...approvalRuleSetVersions].sort((a, b) => b.version - a.version)[0],
    [approvalRuleSetVersions]
  );
  const [approvalRuleDraft, setApprovalRuleDraft] = useState<ApprovalRule[]>([]);
  const [approvalDefaultWorkflowVersion, setApprovalDefaultWorkflowVersion] = useState(0);
  const [approvalRuleBaseVersion, setApprovalRuleBaseVersion] = useState(0);
  const [showApprovalRuleModal, setShowApprovalRuleModal] = useState(false);
  const [editingApprovalRule, setEditingApprovalRule] = useState<ApprovalRule | null>(null);
  const [publishingApprovalRules, setPublishingApprovalRules] = useState(false);
  useEffect(() => {
    if (!latestApprovalRuleSet || latestApprovalRuleSet.version === approvalRuleBaseVersion) return;
    setApprovalRuleDraft(structuredClone(latestApprovalRuleSet.rules));
    setApprovalDefaultWorkflowVersion(latestApprovalRuleSet.defaultWorkflowVersion);
    setApprovalRuleBaseVersion(latestApprovalRuleSet.version);
  }, [latestApprovalRuleSet, approvalRuleBaseVersion]);
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditFilters, setAuditFilters] = useState({ actorId: '', action: '', entityType: '', entityId: '', start: '', end: '' });
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [viewDetail, setViewDetail] = useState<{ type: 'USER' | 'RESOURCE', data: any } | null>(null);
  const [showAgent, setShowAgent] = useState(false);
  const [hq3dLocation, setHq3dLocation] = useState<Hq3dLocation | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [helpTopicId, setHelpTopicId] = useState<string>();
  const [agentRequest, setAgentRequest] = useState<{ id: number; question: string }>();
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
  const [unlockedResourceIds, setUnlockedResourceIds] = useState<Set<string>>(() => new Set());
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const isResourceLocked = (resourceId: string) => !unlockedResourceIds.has(resourceId);
  const toggleResourceLock = (resourceId: string) => {
    setUnlockedResourceIds(current => {
      const next = new Set(current);
      if (next.has(resourceId)) next.delete(resourceId);
      else next.add(resourceId);
      return next;
    });
  };
  useEffect(() => { setUnlockedResourceIds(new Set()); }, [currentUser?.id]);

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
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addLocalDays(new Date(), i)), []);
  const monthDays = useMemo(() => Array.from({ length: 30 }, (_, i) => addLocalDays(new Date(), i)), []);

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
    const displayContent = type === 'WARNING' ? formatUserError(content, '操作未完成，请刷新后重试。', BOOKING_ERROR_MESSAGES) : content;
    const newNotif: Notification = { id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, userId: userId || currentUser?.id || 'sys', title, content: displayContent, timestamp: new Date().toISOString(), isRead: false, type };
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
  const ownsWorkOrder = !!currentUser && workOrders.some(order => bookings.some(booking => booking.id === order.bookingId && booking.userId === currentUser.id));
  const canAccessWorkOrders = !!currentUser && (ownsWorkOrder || currentUser.role.some(role => ['SYSTEM_ADMIN', 'APPROVAL_ADMIN', 'SERVICE_COORDINATOR', 'FRONT_DESK'].includes(role)));
  const workOrderRank = (status: WorkOrder['status']) => ['DONE', 'CANCELLED'].includes(status) ? 1 : 0;
  const visibleWorkOrders = workOrders.filter(order => currentUser?.role.includes('SYSTEM_ADMIN') || currentUser?.role.includes(order.assigneeRole) || bookings.some(booking => booking.id === order.bookingId && booking.userId === currentUser?.id)).sort((a, b) => workOrderRank(a.status) - workOrderRank(b.status) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const openWorkOrderCount = visibleWorkOrders.filter(order => !['DONE', 'CANCELLED'].includes(order.status)).length;
  const canAccessExceptions = canAccessApproval
    || !!currentUser?.role.some(role => ['SYSTEM_ADMIN', 'APPROVAL_ADMIN', 'SERVICE_COORDINATOR', 'FRONT_DESK'].includes(role))
    || workOrders.some(order => currentUser?.role.includes(order.assigneeRole));
  const allowedViews = new Set<SystemView>(['DASHBOARD', 'RESOURCES', 'BOOKINGS', 'HQ_3D']);
  if (canViewMonitoring(currentUser, roles, 'MEETING_ROOMS')) allowedViews.add('MONITORING_ROOMS');
  if (canViewMonitoring(currentUser, roles, 'OFFICES')) allowedViews.add('MONITORING_OFFICES');
  if (canAccessApproval) allowedViews.add('APPROVAL_CENTER');
  if (canAccessWorkOrders) allowedViews.add('WORK_ORDERS');
  if (canAccessExceptions) allowedViews.add('EXCEPTIONS');
  if (currentUser?.role.includes('SYSTEM_ADMIN')) {
    for (const item of ['WORKFLOW_CONFIG', 'DEPARTMENTS', 'ROLES', 'USERS', 'REPORTS', 'DEVICES', 'DATA_CENTER'] as const) allowedViews.add(item);
  }
  if (currentUser?.role.some(role => ['SYSTEM_ADMIN', 'SECURITY_ADMIN'].includes(role))) allowedViews.add('CONFIDENTIALITY');

  const navigateToView = (target: SystemView) => {
    if (!allowedViews.has(target)) {
      addNotification('无法打开功能', '目标页面不存在，或当前角色没有访问权限。', 'WARNING');
      return;
    }
    syncMonitoringUrl(target);
    setView(target);
    setHq3dLocation(null);
    setShowHelp(false);
    setShowMobileMenu(false);
  };

  useEffect(() => {
    const restoreRoute = () => {
      if (!workspaceLoaded) return;
      const target = monitoringViewFromHash(window.location.hash);
      if (target && allowedViews.has(target)) {
        setView(target);
        setHq3dLocation(null);
      } else if (target) {
        addNotification('无法打开监控页面', '当前角色没有该类监控的查看权限，请联系系统管理员授权。', 'WARNING');
        syncMonitoringUrl('DASHBOARD', true);
        setView('DASHBOARD');
      } else if (MONITORING_ROUTES[view]) {
        setView('DASHBOARD');
      }
    };
    window.addEventListener('popstate', restoreRoute);
    window.addEventListener('hashchange', restoreRoute);
    return () => {
      window.removeEventListener('popstate', restoreRoute);
      window.removeEventListener('hashchange', restoreRoute);
    };
  }, [workspaceLoaded, currentUser, roles, view]);

  useEffect(() => {
    if (!workspaceLoaded || !MONITORING_ROUTES[view] || allowedViews.has(view)) return;
    addNotification('监控查看权限已变更', '当前角色已无此页面的查看权限，已返回会议工作台。', 'WARNING');
    syncMonitoringUrl('DASHBOARD', true);
    setView('DASHBOARD');
  }, [workspaceLoaded, currentUser, roles, view]);

  const openHelp = (topicId?: string) => {
    if (topicId) {
      const topic = getHelpTopic(topicId);
      if (!topic || !canUseHelpTopic(topic, currentUser?.role || [], allowedViews)) throw new Error('该指南不存在，或当前角色没有查看权限。');
    }
    setHelpTopicId(topicId);
    setShowHelp(true);
    setShowAgent(false);
  };
  const askAgent = (question: string) => {
    setAgentRequest({ id: Date.now(), question });
    setShowHelp(false);
    setShowAgent(true);
  };

  const fallbackStats = useMemo(() => {
    const totalResources = resources.length;
    const availableRooms = resources.filter(r => r.type === 'ROOM' && r.status === 'AVAILABLE').length;
    const availableDesks = resources.filter(r => r.type === 'DESK' && r.status === 'AVAILABLE').length;
    const activeBookings = bookings.filter(b => b.status === 'APPROVED').length;
    return { totalResources, availableRooms, availableDesks, activeBookings };
  }, [resources, bookings]);
  const stats = dashboard?.stats || fallbackStats;

  const localNextBooking = useMemo(() => {
    if (!currentUser) return null;
    const now = Date.now();
    return bookings
      .filter(b => b.status === 'APPROVED' && new Date(b.endTime).getTime() >= now && (b.userId === currentUser.id || (b.attendeeIds || []).includes(currentUser.id)))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0] || null;
  }, [bookings, currentUser]);
  const nextBooking = dashboard ? dashboard.nextBooking || null : localNextBooking;
  const nextBookingResource = nextBooking ? resources.find(r => r.id === nextBooking.resourceId) : null;
  const activeSchedule = SCHEDULE_RANGES.find(range => range.id === scheduleRange)!;

  const recordConfidentialDetails = (items: Booking[]) => {
    for (const booking of items) {
      if (booking.meetingType !== 'CONFIDENTIAL' && booking.confidentialityChoice !== 'CONFIDENTIAL') continue;
      void fetch(`/api/bookings/${encodeURIComponent(booking.id)}/confidential-read`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      }).catch(() => {});
    }
  };

  const openDayDetail = (detail: any) => {
    setDayDetail(detail);
    recordConfidentialDetails(detail.bookings || []);
  };

  const openScheduleDay = (resourceId: string | null, date: Date) => {
    const dayStart = startOfLocalDay(date);
    const dayEnd = addLocalDays(dayStart, 1);
    const now = new Date();
    openDayDetail({
      resource: resourceId ? resources.find(r => r.id === resourceId) : { name: '全公司资源概览' },
      date,
      bookings: bookings.filter(b => countsTowardOccupancy(b, now) && (!resourceId || b.resourceId === resourceId)
        && Date.parse(b.startTime) < dayEnd.getTime() && Date.parse(bookingEffectiveEnd(b)) > dayStart.getTime())
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

  // Filters
  const filteredResources = useMemo(() => filterResources(resources, searchQuery, {
    type: resourceTypeFilter,
    status: resourceStatusFilter,
    minCapacity: resourceMinCapacity
  }).filter(resource => resourceBuildingFilter === 'ALL' || getResourceBuilding(resource) === resourceBuildingFilter), [resources, searchQuery, resourceTypeFilter, resourceStatusFilter, resourceMinCapacity, resourceBuildingFilter]);
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
      building: getResourceBuilding(firstMatch),
      floor: getResourceFloor(firstMatch) || undefined,
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
      else {
        next.add(id);
        const booking = bookings.find(item => item.id === id);
        if (booking) recordConfidentialDetails([booking]);
      }
      setExpandedBookingIds(next);
  };

  const handleSaveResource = async (data: any) => {
    if (!isOnline) throw new Error('预约服务未连接，暂时无法保存会议室配置。');
    const resourceId = editingResource?.id || `r-${String(data.code).trim().toLowerCase()}`;
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
        ...RESOURCE_IMPORT_ERROR_MESSAGES,
        ACTIVE_BOOKINGS_REQUIRE_REVIEW: `当前有 ${impactCount} 条未结束的有效预约，请先取消或改期后再切换维护状态。`,
        CAPACITY_EXCEEDED: `有 ${impactCount} 条有效预约超过新容量，请先调整相关预约。`,
        REQUIRED_FEATURE_UNAVAILABLE: `有 ${impactCount} 条有效预约仍依赖即将移除的设备，请先调整相关预约。`,
        RESOURCE_CODE_IMMUTABLE: '资源永久编码创建后不可修改。',
        DUPLICATE_RESOURCE_ID: '资源 ID 已存在，请检查永久编码。',
        DUPLICATE_RESOURCE_CODE: '永久编码已被其他资源使用。',
        DUPLICATE_RESOURCE_NAME: '资源名称已存在，请使用唯一名称。',
        INVALID_RESOURCE_OPEN_HOURS: '开放时段必须成对填写，且开始时间早于结束时间。',
        INVALID_RESOURCE_LEADER_LEVEL: '专属会议室必须填写适用领导层级。',
        INVALID_RESOURCE: '资源配置不完整，请检查名称、容量、状态和设备信息。'
      };
      throw new Error(messages[result.error] || '保存失败，请刷新后重试。');
    }
    const saved = result.resource || payload;
    if (result.workspace) applyWorkspace(result.workspace);
    else setResources(prev => editingResource ? prev.map(resource => resource.id === editingResource.id ? saved : resource) : [...prev, saved]);
    if (saved.type === 'ROOM') setSpatialFocus({ location: saved.location, building: saved.building, floor: saved.floor, token: Date.now() });
    setShowResourceModal(false);
    setEditingResource(null);
    addNotification('配置已同步', saved.type === 'ROOM' ? `会议室设备、容量与服务状态已同步至预约服务，3D 视图已定位至${saved.location}。` : '资源配置已同步至预约服务。', 'SUCCESS');
  };

  const saveBookingSeries = async (plan: any, occurrences: any[]) => {
    if (!currentUser || !occurrences.length) return;
    const seriesId = `series-${Date.now()}`;
    const newBookings: Booking[] = occurrences.map((o, index) => ({
      id: `bk-${Date.now()}-${index}`,
      userId: currentUser.id,
      resourceId: plan.resource.id,
      type: plan.resource.type,
      startTime: new Date(o.start).toISOString(),
      endTime: new Date(o.end).toISOString(),
      status: 'PENDING',
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
    let savedBookings: Booking[] = [];
    try {
      const res = await fetch('/api/bookings/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookings: newBookings }) });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        savedBookings = Array.isArray(result.bookings) ? result.bookings : newBookings;
        if (result.workspace) applyWorkspace(result.workspace);
        setBookingFormError(null);
        const warnings = [...new Set((result.bookings || []).flatMap((booking: Booking) => booking.attendeeWarnings || []))];
        if (warnings.length) addNotification('参会人时间重叠提示', warnings.join('；'), 'WARNING');
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
          const message = messages[result.error] || '预约信息未通过校验，请调整后重试。';
          setBookingFormError({ code: result.error, message });
          addNotification('无法提交系列预约', message, 'WARNING');
        }
        return;
      }
    } catch {
      const message = '无法连接预约服务，请检查网络后重试。';
      setBookingFormError({ message });
      addNotification('预约未保存', message, 'WARNING');
      return;
    }
    setRecurringPlan(null);
    setShowBookingModal(false);
    setBookingPrefill(null);
    const isLongTerm = plan.extras.seriesKind === 'LONG_TERM';
    const isRenewal = !!plan.extras.renewalOfSeriesId;
    const pendingBookings = savedBookings.filter(booking => booking.status === 'PENDING');
    const approvedCount = savedBookings.filter(booking => booking.status === 'APPROVED').length;
    const statusSummary = pendingBookings.length && approvedCount
      ? `其中 ${approvedCount} 次已自动核准，${pendingBookings.length} 次待审批`
      : pendingBookings.length ? `${pendingBookings.length} 次待审批` : `${approvedCount} 次已自动核准`;
    addNotification(isRenewal ? '续期申请已提交' : isLongTerm ? '长期预订已创建' : '周期会议已创建', `已创建 ${savedBookings.length} 次「${plan.purpose}」预约，${statusSummary}${isLongTerm ? `，本期至 ${plan.extras.seriesEndDate}` : ''}。`, 'SUCCESS');
    (plan.extras?.attendeeIds || []).forEach((id: string) => addNotification(isLongTerm ? '长期会议邀请' : '周期会议邀请', `${currentUser.name} 邀请您参加 ${savedBookings.length} 次「${plan.purpose}」。`, 'INFO', id));
    const approvalNotifications = new Map<string, number>();
    pendingBookings.forEach(booking => {
      const firstRole = booking.approvalWorkflow?.[0]?.approverRole;
      if (!firstRole) return;
      users.filter(user => user.role.includes(firstRole)).forEach(user => approvalNotifications.set(user.id, (approvalNotifications.get(user.id) || 0) + 1));
    });
    approvalNotifications.forEach((count, userId) => addNotification(isRenewal ? '长期预订续期待审批' : isLongTerm ? '长期预订待审批' : '周期会议待审批', `${currentUser.name} 提交了 ${count} 次「${plan.purpose}」。`, 'INFO', userId));
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
    setBookingFormError(null);
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
      status: 'PENDING',
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
    let savedBooking = newBooking;
    try {
      const res = await fetch(editingBooking ? `/api/bookings/${editingBooking.id}` : '/api/bookings', {
        method: editingBooking ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking: newBooking })
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        savedBooking = result.booking || newBooking;
        if (result.workspace) applyWorkspace(result.workspace);
        setBookingFormError(null);
        if (result.booking?.attendeeWarnings?.length) addNotification('参会人时间重叠提示', result.booking.attendeeWarnings.join('；'), 'WARNING');
      }
      if (!res.ok) {
        if (result.error === 'CONFLICT') openConflict('CONFLICT');
        else {
          const message = BOOKING_ERROR_MESSAGES[result.error] || '预约服务暂时不可用，请稍后重试。';
          setBookingFormError({ code: result.error, message });
          addNotification('预约未保存', message, 'WARNING');
        }
        return;
      }
    } catch {
      const message = '无法连接预约服务，请检查网络后重试。';
      setBookingFormError({ message });
      addNotification('预约未保存', message, 'WARNING');
      return;
    }

    setShowBookingModal(false);
    setCalendarDateForBooking(null);
    setBookingPrefill(null);
    setEditingBooking(null);
    const needsApproval = savedBooking.status === 'PENDING';
    addNotification(editingBooking ? '预约已修改' : needsApproval ? '预约申请已提交' : '预约已自动核准', editingBooking
      ? `资源 ${resource.name} 的预约已更新，并${needsApproval ? '重新进入审批流程' : '自动核准'}。`
      : `资源 ${resource.name} 的预约${needsApproval ? '已进入审批流程' : '已自动核准'}。`, 'SUCCESS');
    const confidential = savedBooking.meetingType === 'CONFIDENTIAL' || savedBooking.confidentialityChoice === 'CONFIDENTIAL';
    (extras?.attendeeIds || []).filter((id: string) => id !== currentUser.id).forEach((id: string) => addNotification('会议邀请', confidential
      ? `${currentUser.name} 邀请您参加一项涉密会议，请在“我的申请”中查看已授权详情。`
      : `${currentUser.name} 邀请您参加「${purpose}」，时间：${toLocalDateTimeString(savedBooking.startTime)}。`, 'INFO', id));
    const firstRole = needsApproval ? savedBooking.approvalWorkflow?.[0]?.approverRole : undefined;
    if (firstRole) users.filter(u => u.id !== currentUser.id && u.role.includes(firstRole)).forEach(u => addNotification('新预约待审批', confidential
      ? `${currentUser.name} 提交了一项涉密会议申请，请在审批工作台处理。`
      : `${currentUser.name} 提交了「${purpose}」，资源：${resource.name}，时间：${toLocalDateTimeString(savedBooking.startTime)}。`, 'INFO', u.id));
  };

  const handleRenewLongTerm = (booking: Booking) => {
    if (!currentUser || booking.userId !== currentUser.id || booking.seriesKind !== 'LONG_TERM' || !booking.seriesId) return false;
    const resource = resources.find(item => item.id === booking.resourceId);
    if (!resource) return false;
    if (!isResourceAcceptingBookings(resource)) {
      addNotification('暂不能续期', '会议室当前维护或待开放，请恢复预约服务后再续期。', 'WARNING');
      return false;
    }
    if (bookings.some(item => item.renewalOfSeriesId === booking.seriesId && isActiveBooking(item))) {
      addNotification('续期已存在', '本期已有审批中或已核准的续期，无需重复提交。', 'INFO');
      return false;
    }
    const seriesBookings = bookings.filter(item => item.seriesId === booking.seriesId);
    if (seriesBookings.some(item => item.status === 'PENDING')) {
      addNotification('暂不能续期', '请等待当前长期预订完成审批后再申请续期。', 'WARNING');
      return false;
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
    const seriesEndDate = formatDate(getLongTermMaxEndDate(nextStart, ruleSettings.longTermMaxCalendarMonths));
    setEditingBooking(null);
    setSelectedResource(resource);
    setCalendarDateForBooking(null);
    setBookingPrefill({
      userId: booking.userId,
      purpose: booking.purpose,
      start: nextStart.toISOString(),
      end: nextEnd.toISOString(),
      participants: booking.participants,
      recurrence: { frequency: 'DAILY', count: getDailyOccurrenceCount(nextStart, new Date(`${seriesEndDate}T12:00:00`)) },
      seriesEndDate,
      renewalOfSeriesId: booking.seriesId,
      rootSeriesId: booking.rootSeriesId || booking.seriesId,
      extras: {
        meetingType: booking.meetingType,
        confidentialityChoice: booking.confidentialityChoice,
        serviceRequirements: booking.serviceRequirements || [],
        exclusiveRequestReason: booking.exclusiveRequestReason,
        auditoriumSetup: booking.auditoriumSetup,
        hasLeader: booking.hasLeader,
        leaderDetails: booking.leaderDetails,
        isVideoConference: booking.isVideoConference,
        needsTeaService: booking.needsTeaService,
        requiredFeatures: booking.requiredFeatures || [],
        attendeeIds: booking.attendeeIds || []
      }
    });
    setShowBookingModal(true);
    return true;
  };

  const handleCancelBooking = async (id: string) => {
    if (!confirm("确定要撤销此项预约申请吗？撤销后该时段资源将立即释放。")) return;
    try {
      await handleAgentAction({ type: 'PROPOSE_CANCEL', bookingId: id, summary: '取消预约' });
    } catch {}
  };

  const handleCheckIn = async (id: string, source: 'QR' | 'MANUAL' = 'MANUAL', scheduleVersion?: number) => {
    if (!navigator.onLine) {
      addNotification('签到未完成', '当前离线，未保存任何签到或释放操作，请联网后重试。', 'WARNING');
      return false;
    }
    try {
      await apiRequest(`/api/bookings/${encodeURIComponent(id)}/check-in`, 'POST', { source, subjectUserId: currentUser?.id, ...(source === 'QR' ? { scheduleVersion } : {}) });
      addNotification('签到成功', source === 'QR' ? '扫码结果已通过服务端校验，签到事件与实际使用事实已保存。' : '人工签到事件与实际使用事实已保存。', 'SUCCESS');
      return true;
    } catch (err: any) {
      addNotification('签到未完成', err?.message || '请刷新后重试。', 'WARNING');
      return false;
    }
  };

  const handleEndEarly = async (id: string) => {
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(id)}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      const result = await res.json();
      if (!res.ok) throw new Error(formatUserError(result, '当前不可提前结束。', BOOKING_ERROR_MESSAGES));
      if (result.workspace) applyWorkspace(result.workspace);
      addNotification('会议已提前结束', result.message || '剩余时段已释放。', 'SUCCESS');
    } catch (err: any) {
      addNotification('操作未完成', err?.message || '请刷新后重试。', 'WARNING');
    }
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
      setApprovalActionErrors(prev => ({ ...prev, [key]: formatUserError(err, '审批未完成，请刷新后重试。', BOOKING_ERROR_MESSAGES) }));
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
          meetingType: action.draft.meetingType,
          serviceRequirements: action.draft.serviceRequirements || [],
          exclusiveRequestReason: action.draft.exclusiveRequestReason,
          auditoriumSetup: action.draft.auditoriumSetup,
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

    if (action.type === 'PROPOSE_EDIT_BOOKING' && action.bookingId && action.draft) {
      const booking = bookings.find(item => item.id === action.bookingId);
      if (!booking || booking.userId !== currentUser?.id || !['PENDING', 'APPROVED'].includes(booking.status)) throw new Error('预约已变化，请刷新后重新定位可修改的申请。');
      if (booking.meetingType === 'CONFIDENTIAL' || booking.confidentialityChoice === 'CONFIDENTIAL') throw new Error('涉密预约请在正式表单中按授权流程修改。');
      const resource = resources.find(item => item.id === action.draft!.resourceId);
      if (!resource) throw new Error('预约资源已不存在，请刷新后重试。');
      const draftError = validateBookingDraft(action.draft, resources, bookings.filter(item => item.id !== booking.id));
      if (draftError) throw new Error(draftError);
      setEditingBooking(booking);
      setSelectedResource(resource);
      setCalendarDateForBooking(null);
      setBookingPrefill({
        id: booking.id,
        userId: booking.userId,
        purpose: action.draft.purpose,
        start: action.draft.startTime,
        end: action.draft.endTime,
        participants: action.draft.participants,
        extras: {
          meetingType: action.draft.meetingType || booking.meetingType,
          confidentialityChoice: booking.confidentialityChoice,
          serviceRequirements: action.draft.serviceRequirements || booking.serviceRequirements || [],
          exclusiveRequestReason: action.draft.exclusiveRequestReason ?? booking.exclusiveRequestReason,
          auditoriumSetup: action.draft.auditoriumSetup ?? booking.auditoriumSetup,
          hasLeader: action.draft.hasLeader ?? booking.hasLeader,
          leaderDetails: action.draft.leaderDetails ?? booking.leaderDetails,
          isVideoConference: action.draft.isVideoConference ?? booking.isVideoConference,
          needsTeaService: action.draft.needsTeaService ?? booking.needsTeaService,
          requiredFeatures: action.draft.requiredFeatures || booking.requiredFeatures || [],
          attendeeIds: action.draft.attendeeIds || booking.attendeeIds || []
        }
      });
      setShowAgent(false);
      setShowBookingModal(true);
      return;
    }

    if (action.type === 'PROPOSE_RENEW_BOOKING' && action.bookingId) {
      const booking = bookings.find(item => item.id === action.bookingId);
      if (!booking || !handleRenewLongTerm(booking)) throw new Error('当前预约不能续期，请核对审批状态、续期记录和资源状态。');
      setShowAgent(false);
      return;
    }

    if (action.type === 'OPEN_HELP') {
      openHelp(action.topicId);
      return;
    }

    if (action.type === 'NAVIGATE' && action.view) {
      if (!allowedViews.has(action.view)) throw new Error('目标页面不存在，或当前角色没有访问权限。');
      navigateToView(action.view);
      if (action.view === 'HQ_3D' && action.hq3d) {
        setHq3dLocation({ ...action.hq3d, navigationId: Date.now() });
      }
      setShowAgent(false);
      return;
    }

    if (action.type === 'REFRESH') {
      const data = await loadWorkspace();
      if (!data) throw new Error('数据刷新失败，请检查网络后重试。');
      await refreshOperations();
      addNotification('数据已刷新', '已重新读取当前权限范围内的数据。', 'SUCCESS');
      return;
    }

    if (['PROPOSE_CANCEL', 'PROPOSE_APPROVAL', 'PROPOSE_CHECK_IN', 'PROPOSE_WORK_ORDER'].includes(action.type)) {
      try {
        const res = await fetch('/api/agent/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(formatUserError(result, '操作失败，请刷新后重试。', BOOKING_ERROR_MESSAGES));
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
      INVALID_USER_ROLE: '请选择有效角色。',
      RESOURCE_NOT_FOUND: '资源不存在或已被删除，请刷新后重试。',
      RESOURCE_HAS_BOOKINGS: '该资源存在预约记录，不能删除。请改为维护或待开放状态以停止新预约。',
      RESOURCE_HAS_DEVICES: '该资源仍有关联门口屏设备记录，不能删除。'
    };
    addNotification('操作未完成', formatUserError(error, '请刷新后重试。', messages), 'WARNING');
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

  const handleDeleteResource = async (resource: Resource) => {
    if (!confirm(`确定删除“${resource.name}”吗？此操作无法撤销。仅无预约记录且无门口屏设备绑定的资源可删除；有关联记录时请改为维护或待开放状态。`)) return;
    try {
      await apiRequest(`/api/resources/${encodeURIComponent(resource.id)}`, 'DELETE');
      setSelectedResourceIds(prev => prev.filter(id => id !== resource.id));
      if (selectedResource?.id === resource.id) {
        setSelectedResource(null);
        setShowBookingModal(false);
      }
      if (editingResource?.id === resource.id) {
        setEditingResource(null);
        setShowResourceModal(false);
      }
      if (showResourceCalendar?.id === resource.id) setShowResourceCalendar(null);
      if (viewDetail?.type === 'RESOURCE' && viewDetail.data?.id === resource.id) setViewDetail(null);
      addNotification('删除成功', `资源 ${resource.name} 已移除，删除操作已写入审计。`, 'SUCCESS');
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

  const handleSaveApprovalRule = (rule: ApprovalRule) => {
    setApprovalRuleDraft(current => editingApprovalRule
      ? current.map(item => item.id === editingApprovalRule.id ? rule : item)
      : [...current, rule]);
    setShowApprovalRuleModal(false);
    setEditingApprovalRule(null);
  };

  const handlePublishApprovalRules = async () => {
    if (!latestApprovalRuleSet || !approvalRuleSetDirty) return;
    if (!confirm(`确定发布动态规则集 V${latestApprovalRuleSet.version + 1} 吗？新申请将立即使用新版本，在途申请保持原审批规则。`)) return;
    setPublishingApprovalRules(true);
    try {
      const result = await apiRequest('/api/approval-rule-set', 'PUT', {
        baseVersion: latestApprovalRuleSet.version,
        defaultWorkflowVersion: approvalDefaultWorkflowVersion,
        rules: approvalRuleDraft
      });
      addNotification('规则集已发布', `动态规则集 V${result.ruleSet.version} 已生效；在途申请仍按原冻结版本审批。`, 'SUCCESS');
    } catch (error) { adminError(error); } finally {
      setPublishingApprovalRules(false);
    }
  };

  const handleResetApprovalRules = () => {
    if (!latestApprovalRuleSet) return;
    setApprovalRuleDraft(structuredClone(latestApprovalRuleSet.rules));
    setApprovalDefaultWorkflowVersion(latestApprovalRuleSet.defaultWorkflowVersion);
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

  const handleAddConfidentialWhitelist = async (entry: { userId: string; reason: string }) => {
    await apiRequest('/api/confidential-whitelist', 'POST', { entry });
    addNotification('白名单已更新', '成员已获得涉密会议申请与参会资格。', 'SUCCESS');
  };

  const handleRemoveConfidentialWhitelist = async (id: string) => {
    await apiRequest(`/api/confidential-whitelist/${id}`, 'DELETE');
    addNotification('白名单已更新', '资格已移除，后续提交和最终核准将按新名单校验。', 'SUCCESS');
  };

  const handleCreateConfidentialityAuthorization = async (bookingId: string, input: { action: 'DECLASSIFY' | 'ATTENDEE_CHANGE'; reason: string }) => {
    await apiRequest(`/api/bookings/${bookingId}/confidential-authorizations`, 'POST', input);
    addNotification('授权已签发', '一次性授权已记录，申请人提交匹配变更后自动核销。', 'SUCCESS');
  };

  const loadAuditEvents = async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      for (const field of ['actorId', 'action', 'entityType', 'entityId'] as const) {
        if (auditFilters[field].trim()) params.set(field, auditFilters[field].trim());
      }
      if (auditFilters.start) params.set('start', new Date(`${auditFilters.start}T00:00:00`).toISOString());
      if (auditFilters.end) {
        const end = new Date(`${auditFilters.end}T00:00:00`);
        end.setDate(end.getDate() + 1);
        params.set('end', end.toISOString());
      }
      const res = await fetch(`/api/audit?${params}`);
      const result = await res.json();
      if (!res.ok) throw new Error(formatUserError(result, '审计记录读取失败，请稍后重试。'));
      setAuditEvents(result.events || []);
    } catch (error: any) {
      setAuditError(formatUserError(error, '审计记录读取失败，请稍后重试。'));
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

  const approvalRuleSetDirty = !!latestApprovalRuleSet && (
    approvalDefaultWorkflowVersion !== latestApprovalRuleSet.defaultWorkflowVersion
    || JSON.stringify(approvalRuleDraft) !== JSON.stringify(latestApprovalRuleSet.rules)
  );
  const normalizedAuditQuery = auditQuery.trim().toLowerCase();
  const filteredAuditEvents = auditEvents.filter(event => !normalizedAuditQuery || [
    event.action, event.entityType, event.entityId, event.actorId,
    users.find(user => user.id === event.actorId)?.name
  ].some(value => String(value || '').toLowerCase().includes(normalizedAuditQuery)));

  const monitoringNavItems: NavItem[] = [
    ...(allowedViews.has('MONITORING_ROOMS') ? [{ id: 'MONITORING_ROOMS', label: '会议室监控', shortLabel: '会议室', icon: MonitorPlay, href: `#${MONITORING_ROUTES.MONITORING_ROOMS}` } as NavItem] : []),
    ...(allowedViews.has('MONITORING_OFFICES') ? [{ id: 'MONITORING_OFFICES', label: '办公室监控', shortLabel: '办公室', icon: DoorOpen, href: `#${MONITORING_ROUTES.MONITORING_OFFICES}` } as NavItem] : [])
  ];
  const workflowNavItems: NavItem[] = [
    ...(canAccessApproval ? [{ id: 'APPROVAL_CENTER', label: '审批工作台', shortLabel: '审批', icon: ShieldCheck, badge: pendingCount } as NavItem] : []),
    ...(canAccessWorkOrders ? [{ id: 'WORK_ORDERS', label: '服务工单', shortLabel: '工单', icon: Coffee, badge: openWorkOrderCount } as NavItem] : []),
    ...(canAccessExceptions ? [{ id: 'EXCEPTIONS', label: '异常中心', shortLabel: '异常', icon: AlertTriangle, badge: exceptions.filter(item => item.status !== 'RESOLVED').length } as NavItem] : [])
  ];
  const adminNavItems: NavItem[] = [
    ...(currentUser.role.includes('SYSTEM_ADMIN') ? [
      { id: 'WORKFLOW_CONFIG', label: '流程配置', shortLabel: '流程', icon: GitMerge },
      { id: 'DEPARTMENTS', label: '部门管理', shortLabel: '部门', icon: Building2 },
      { id: 'ROLES', label: '角色管理', shortLabel: '角色', icon: Shield },
      { id: 'USERS', label: '成员中心', shortLabel: '成员', icon: Users },
      { id: 'REPORTS', label: '运营报表', shortLabel: '报表', icon: PieChart },
      { id: 'DEVICES', label: '门口屏设备', shortLabel: '设备', icon: Monitor }
    ] as NavItem[] : []),
    ...((currentUser.role.includes('SYSTEM_ADMIN') || currentUser.role.includes('SECURITY_ADMIN')) ? [{ id: 'CONFIDENTIALITY', label: '保密控制', shortLabel: '保密', icon: Lock } as NavItem] : []),
    ...(currentUser.role.includes('SYSTEM_ADMIN') ? [{ id: 'DATA_CENTER', label: '数据中心', shortLabel: '数据', icon: Database } as NavItem] : [])
  ];
  const primaryWorkflowItem = canAccessApproval ? workflowNavItems.find(item => item.id === 'APPROVAL_CENTER') : workflowNavItems.find(item => item.id === 'WORK_ORDERS');
  const mobilePrimaryItems: NavItem[] = [
    { id: 'DASHBOARD', label: '会议工作台', shortLabel: '看板', icon: LayoutDashboard },
    { id: 'RESOURCES', label: '空间资源库', shortLabel: '资源', icon: MapPin },
    { id: 'BOOKINGS', label: '我的申请', shortLabel: '申请', icon: Calendar },
    ...(primaryWorkflowItem ? [primaryWorkflowItem] : [])
  ];
  const mobileMoreItems = [
    ...monitoringNavItems,
    { id: 'HQ_3D', label: '总部楼层 3D', shortLabel: '3D', icon: Layers } as NavItem,
    ...workflowNavItems.filter(item => !mobilePrimaryItems.some(primary => primary.id === item.id)),
    ...adminNavItems
  ];
  // 3D 视图默认收起；用户在该视图里手动展开后（hqSidebarExpanded）就不再自动收
  const effectiveSidebarCollapsed = sidebarCollapsed || (view === 'HQ_3D' && !hqSidebarExpanded);
  const toggleSidebar = () => {
    setSidebarCollapsed(!effectiveSidebarCollapsed);
    // 从收起切到展开时记下「这次是用户要的」，避免下一帧又被自动收回去
    setHqSidebarExpanded(effectiveSidebarCollapsed);
  };
  const isMoreView = mobileMoreItems.some(item => item.id === view);
  const isAdminView = adminNavItems.some(item => item.id === view);
  const brandLogoSrc = theme === 'coamc'
    ? '/images/china-orient-logo-horizontal.png'
    : '/images/china-orient-logo-horizontal-reverse.png';

  return (
    <div className="studio-app min-h-screen flex overflow-hidden" data-theme={theme} data-view={view} data-sidebar={effectiveSidebarCollapsed ? 'collapsed' : 'expanded'}>
      {/* Toast Notifications */}
      <div className="fixed top-6 right-6 z-[1000] space-y-3 pointer-events-none">
        {myNotifications.filter(n => !n.isRead).slice(0, 3).map(n => (
          <React.Fragment key={n.id}><ToastNotification notification={n} onClose={() => markNotificationRead(n.id)} /></React.Fragment>
        ))}
      </div>

      <aside className="studio-sidebar w-[268px] hidden lg:flex flex-col p-6 shrink-0">
        <div className="studio-brand shrink-0">
          <div className="studio-brand-mark"><Cpu className="studio-brand-icon-classic" size={21} strokeWidth={1.5}/></div>
          <div className="studio-brand-orient">
            <img className="studio-brand-logo-orient" src={brandLogoSrc} alt="中国东方" />
            <img className="studio-brand-symbol-orient" src={brandLogoSrc} alt="" aria-hidden="true" />
          </div>
          <div className="studio-brand-copy"><div className="studio-brand-name">SmartOffice</div><div className="studio-brand-sub">MEETING & SPACE</div></div>
          <button
            type="button"
            className="studio-sidebar-toggle"
            aria-label={effectiveSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!effectiveSidebarCollapsed}
            aria-controls="studio-sidebar-navigation"
            title={effectiveSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            onClick={toggleSidebar}
          >
            {effectiveSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav id="studio-sidebar-navigation" aria-label="桌面主导航" className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
          <SidebarItem icon={LayoutDashboard} label="会议工作台" id="DASHBOARD" active={view === 'DASHBOARD'} onClick={navigateToView} />
          {monitoringNavItems.map(item => <SidebarItem key={item.id} icon={item.icon} label={item.label} id={item.id} href={item.href} active={view === item.id} onClick={navigateToView} />)}
          <SidebarItem icon={MapPin} label="空间资源库" id="RESOURCES" active={view === 'RESOURCES'} onClick={navigateToView} />
          <SidebarItem icon={Calendar} label="我的申请" id="BOOKINGS" active={view === 'BOOKINGS'} onClick={navigateToView} />
          <SidebarItem icon={Layers} label="总部楼层 3D" id="HQ_3D" active={view === 'HQ_3D'} onClick={navigateToView} />
          {(workflowNavItems.length > 0 || adminNavItems.length > 0) && <div className="studio-nav-label">流程与中心</div>}
          {workflowNavItems.map(item => <SidebarItem key={item.id} icon={item.icon} label={item.label} id={item.id} active={view === item.id} onClick={navigateToView} badge={item.badge} />)}
          {adminNavItems.length > 0 && (
            <div className="studio-nav-group">
              <button type="button" className="studio-nav-item studio-nav-group-toggle" data-active={isAdminView} aria-label="系统管理" title="系统管理" aria-expanded={showAdminMenu} aria-controls="desktop-admin-menu" onClick={() => setShowAdminMenu(value => !value)}>
                <FolderTree size={17} strokeWidth={1.7} /><span>系统管理</span><ChevronDown size={14} className={showAdminMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {showAdminMenu && <div id="desktop-admin-menu" className="studio-nav-children">{adminNavItems.map(item => <SidebarItem key={item.id} icon={item.icon} label={item.label} id={item.id} active={view === item.id} onClick={navigateToView} />)}</div>}
            </div>
          )}
        </nav>

        <div className="studio-sidebar-themes mt-4 pt-4 border-t shrink-0">
          <div className="mb-3 flex items-center justify-between gap-2 px-2">
            <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">界面风格</p>
            <span className="studio-theme-current">{THEMES.find(item => item.id === theme)?.name}</span>
          </div>
          <div className="studio-theme-swatches flex items-center justify-around px-2" role="group" aria-label="界面主题风格">
            {THEMES.map(t => (
              <button key={t.id} type="button" data-theme-option={t.id} aria-label={`切换到${t.name}主题`} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)} title={t.name} className={`studio-theme-swatch w-6 h-6 rounded-full ${t.color} border-2 transition-all ${theme === t.id ? 'border-gray-900 scale-125 shadow-md' : 'border-transparent hover:scale-110'}`} />
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
          <button key={item.id} type="button" onClick={() => navigateToView(item.id)} aria-current={view === item.id ? 'page' : undefined}>
            <item.icon size={18} strokeWidth={1.7} /><span>{item.shortLabel}</span>
            {(item.badge || 0) > 0 && <strong className="studio-mobile-badge">{item.badge}</strong>}
          </button>
        ))}
        <button type="button" data-active={isMoreView} aria-expanded={showMobileMenu} aria-controls="mobile-more-menu" onClick={() => setShowMobileMenu(true)}>
          <MoreHorizontal size={19} strokeWidth={1.7} /><span>更多</span>
        </button>
      </nav>

      {showMobileMenu && <div id="mobile-more-menu"><MobileMoreSheet items={mobileMoreItems} currentView={view} onSelect={navigateToView} onClose={() => setShowMobileMenu(false)} theme={theme} onThemeChange={setTheme} currentUser={currentUser} isOnline={isOnline} saveStatus={saveStatus} onLogout={handleLogout} /></div>}

      <main ref={mainRef} className="studio-main flex-1 min-w-0 overflow-auto relative pb-32">
        <header className="studio-topbar backdrop-blur-md flex items-center justify-between gap-3 sticky top-0 z-40">
          <div className="flex items-center gap-6 flex-1 min-w-0 max-w-2xl">
            <div className="min-w-0 lg:shrink-0"><span className="studio-page-kicker">企业会议与空间管理</span><h2 className="studio-page-title truncate">
              {view === 'DASHBOARD' && '会议工作台'}
              {view === 'MONITORING_ROOMS' && '会议室监控大屏'}
              {view === 'MONITORING_OFFICES' && '办公室监控大屏'}
              {view === 'RESOURCES' && '空间资源库'}
              {view === 'USERS' && '成员中心'}
              {view === 'BOOKINGS' && '我的会议与申请'}
              {view === 'APPROVAL_CENTER' && '审批中心'}
              {view === 'WORK_ORDERS' && '服务工单中心'}
              {view === 'EXCEPTIONS' && '异常中心'}
              {view === 'DEVICES' && '门口屏设备'}
              {view === 'WORKFLOW_CONFIG' && '审批引擎配置'}
              {view === 'CONFIDENTIALITY' && '保密控制'}
              {view === 'DEPARTMENTS' && '组织架构'}
              {view === 'ROLES' && '角色权限集'}
              {view === 'REPORTS' && '运营报表'}
              {view === 'DATA_CENTER' && '数据维护中心'}
              {view === 'HQ_3D' && '总部楼层 3D 分布图'}
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
          <div className="studio-topbar-actions flex items-center gap-2 sm:gap-4 shrink-0">
             <button className="studio-secondary studio-topbar-checkin !min-h-11 !px-3" onClick={() => setShowQRScanner(true)} aria-label="扫码签到">
               <QrCode size={14}/>
               <span>扫码签到</span>
             </button>
             <button type="button" onClick={() => openHelp()} aria-label="打开帮助" aria-expanded={showHelp} className="studio-help-launcher">
               <CircleHelp size={19}/>
               <span className="hidden xl:inline">帮助</span>
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
          {/* 负 margin 抵消 .studio-content 的响应式内边距，让独立 3D 页面使用完整可用画面。 */}
          {view === 'HQ_3D' && (
            <div className="hq3d-view animate-in fade-in">
              <iframe
                src={buildHq3dSrc(theme, hq3dLocation)}
                title="总部楼层 3D 分布图"
                style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#dfeaf8' }}
              />
            </div>
          )}

          {(view === 'MONITORING_ROOMS' || view === 'MONITORING_OFFICES') && (
            <React.Suspense fallback={<p role="status" className="studio-panel p-8 text-sm text-gray-500">正在建立实时监控连接…</p>}>
              <MonitoringScreen key={view} scope={view === 'MONITORING_ROOMS' ? 'MEETING_ROOMS' : 'OFFICES'} onOpenAssistant={() => setShowAgent(true)} />
            </React.Suspense>
          )}

          {view === 'DASHBOARD' && (
            <div className="space-y-6 animate-in fade-in">
              <section className="agenda-hero" aria-label="今日会议安排">
                <div className="agenda-date">
                  <span className="agenda-date-year">{new Date().getFullYear()} / {pad2(new Date().getMonth() + 1)}</span>
                  <span className="agenda-date-day">{pad2(new Date().getDate())}</span>
                  <span className="agenda-date-week">{new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}<br/>今日议程</span>
                </div>
                <div className="agenda-intro">
                  <p className="agenda-eyebrow">MEETING & SPACE / 会议与空间</p>
                  <h1>您好，{currentUser.name}<br/><em>安排会议，从这里开始。</em></h1>
                  <p>查找合适的会议室，确认时间与参会人；提交后可在“我的申请”中跟踪审批和会务进度。</p>
                  <div className="agenda-actions">
                    <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className="studio-primary"><Monitor size={16}/> 预订会议室 <ArrowUpRight size={15}/></button>
                    <button onClick={() => setView('BOOKINGS')} className="studio-secondary"><Calendar size={16}/> 查看我的会议</button>
                  </div>
                </div>
                <button className="agenda-next text-left" onClick={() => nextBooking ? openDayDetail({ resource: nextBookingResource, date: new Date(nextBooking.startTime), bookings: [nextBooking] }) : setView('BOOKINGS')}>
                  <span className="agenda-next-label">下一场会议</span>
                  <span className="agenda-next-time">{nextBooking ? `${toLocalTimeString(nextBooking.startTime)} — ${toLocalTimeString(nextBooking.endTime)}` : '— : —'}</span>
                  <span className="agenda-next-title">{nextBooking?.purpose || '暂无后续会议'}</span>
                  <span className="agenda-next-meta">{nextBooking ? <>{nextBookingResource?.name || '会议空间'}<br/>{nextBookingResource?.location}</> : '可前往空间资源库查找可用会议室'}</span>
                  <span className="agenda-next-foot">{nextBooking ? '查看会议详情 →' : `${stats.availableRooms} 间会议室 · ${stats.availableDesks} 个工位可用`}</span>
                </button>
              </section>

              <div className="studio-stat-grid">
                <StatCard title="空间资源总数" value={stats.totalResources} icon={MapPin} trend={`${stats.availableRooms + stats.availableDesks} 个空间当前可用`} color={theme} onClick={() => setView('RESOURCES')} />
                <StatCard title="已核准会议" value={stats.activeBookings} icon={Activity} trend="实时统计 · 点击查看会议" color="emerald" onClick={() => setView('BOOKINGS')} />
                {canAccessApproval ? <StatCard title="待我审批" value={pendingCount} icon={ShieldCheck} trend={pendingCount ? '有申请等待处理' : '当前没有待办审批'} color="amber" onClick={() => setView('APPROVAL_CENTER')} /> : <StatCard title="我的待审批申请" value={bookings.filter(b => b.userId === currentUser.id && b.status === 'PENDING').length} icon={Activity} trend="点击查看申请进度" color="amber" onClick={() => setView('BOOKINGS')} />}
              </div>

              {dashboard?.executive && <ExecutiveDashboard executive={dashboard.executive} resources={resources} bookings={bookings} exceptions={exceptions}
                onDayClick={openScheduleDay} onOpenExceptions={() => setView('EXCEPTIONS')} />}

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
                    <TodayResourceUsage resources={resources} bookings={bookings} users={users} onBookingClick={openDayDetail} />
                  ) : (
                    <ResourceUsageGrid days={scheduleRange === 'WEEK' ? weekDays : monthDays} resources={resources} bookings={bookings} onDayClick={openScheduleDay} />
                  )}
                </div>
                <div className="studio-schedule-foot"><span>{resources.length} 个空间 · 实时日程</span><span>点击会议可查看时间、地点与预约详情</span></div>
              </section>
            </div>
          )}

          {/* ... existing views ... */}
          {view === 'RESOURCES' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="studio-page-head">
                <div><span className="studio-page-kicker">MEETING & SPACE / 会议与空间</span><h3>找到合适的会议空间</h3><p>按楼栋、楼层、时间和设备筛选会议室，查看排期后直接提交预约。</p></div>
                <div className="studio-page-actions">
                  <button onClick={() => setShowResourceFinder(prev => !prev)} aria-expanded={showResourceFinder} className="studio-secondary"><Search size={16}/> <span>按条件找会议室</span></button>
                  {currentUser.role.includes('SYSTEM_ADMIN') && <><button onClick={() => setShowImportModal('RESOURCES')} className="studio-secondary"><Upload size={16}/> <span>批量导入</span></button>
                  <button onClick={() => { setEditingResource(null); setShowResourceModal(true); }} className="studio-primary"><Plus size={16}/> <span>新增资源</span></button></>}
                </div>
              </div>
              <section className="resource-filter-panel" aria-label="资源组合筛选">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-xs font-black text-gray-600"><Filter size={14}/>筛选空间</span>
                  <span role="status" className="text-[11px] font-bold text-gray-500">符合 {filteredResources.length} 个 · 共 {resources.length} 个</span>
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
                theme={theme}
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
                canManage={currentUser.role.includes('SYSTEM_ADMIN')}
                isResourceLocked={isResourceLocked}
                onToggleResourceLock={toggleResourceLock}
                onEdit={(resource) => { setEditingResource(resource); setShowResourceModal(true); }}
                onDelete={handleDeleteResource}
              />
              <div className="studio-table-shell">
                <div className="resource-list-head"><div><strong>资源清单</strong><span>查看详情与排期，或选择可预约空间</span></div><span>{filteredResources.length} 个结果</span></div>
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
                    {filteredResources.map(r => {
                      const locked = isResourceLocked(r.id);
                      return (
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
                            {currentUser.role.includes('SYSTEM_ADMIN') && <>
                              <button type="button" className={`resource-lock-button p-2 transition-colors ${locked ? 'text-amber-600 hover:text-amber-700' : 'text-emerald-600 hover:text-emerald-700'}`} aria-pressed={!locked} aria-label={`${locked ? '解锁' : '加锁'}${r.name}`} title={locked ? '解锁后才能编辑或删除' : '重新加锁以禁用编辑和删除'} onClick={() => toggleResourceLock(r.id)}>{locked ? <Lock size={16}/> : <LockOpen size={16}/>}</button>
                              <button aria-label={`编辑${r.name}`} title={locked ? '请先解锁此资源' : '编辑资源'} disabled={locked} onClick={() => { setEditingResource(r); setShowResourceModal(true); }} className="p-2 text-gray-500 hover:text-indigo-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><Edit2 size={16}/></button>
                              <button aria-label={`删除${r.name}`} title={locked ? '请先解锁此资源' : '删除资源'} disabled={locked} onClick={() => handleDeleteResource(r)} className="p-2 text-gray-500 hover:text-rose-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 size={16}/></button>
                            </>}
                          </td>
                        </tr>
                      );
                    })}
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
                     <div><span className="studio-page-kicker">MY MEETINGS / 我的会议</span><h3>我的会议与申请</h3><p>查看预约进度、审批结果、签到和会务服务状态。</p></div>
                     <div className="studio-page-actions">
                       <span className="resource-count-label">共 {myBookings.length} 条记录</span>
                       <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className="studio-primary"><Plus size={16}/> 预订会议室</button>
                     </div>
                 </div>

                 {myBookings.length === 0 ? (
                   <div className="booking-empty-state">
                     <History size={40}/>
                     <h4>还没有会议或空间申请</h4>
                     <p>从空间资源库选择会议室，确认时间后即可提交预约。</p>
                     <button onClick={() => { setView('RESOURCES'); setSearchQuery(''); }} className="studio-primary"><Monitor size={16}/> 查找会议室</button>
                   </div>
                 ) : (
                   <>
                       <div className="space-y-4">
                           {currentPageBookings.map(b => {
                               const isExpanded = expandedBookingIds.has(b.id);
                               const resource = resources.find(r => r.id === b.resourceId);
                               const longTermSeries = b.seriesKind === 'LONG_TERM' && b.seriesId ? bookings.filter(item => item.seriesId === b.seriesId) : [];
                               const activeRenewal = b.seriesId && bookings.some(item => item.renewalOfSeriesId === b.seriesId && isActiveBooking(item));
                               const usageFact = usageFacts.find(item => item.bookingId === b.id && item.scheduleVersion === (b.scheduleVersion || 1));
                               const bookingAppeals = usageAppeals.filter(item => item.bookingId === b.id);
                               return (
                                   <div key={b.id} className={`bg-white rounded-[2rem] border transition-all duration-300 overflow-hidden ${isExpanded ? 'shadow-lg border-indigo-100' : 'shadow-sm border-gray-100 hover:border-gray-200'}`}>
                                       {/* Header - Click to Toggle */}
                                       <div
                                           role="button"
                                           tabIndex={0}
                                           aria-expanded={isExpanded}
                                           aria-controls={`booking-details-${b.id}`}
                                           onClick={() => toggleBookingExpand(b.id)}
                                           onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleBookingExpand(b.id); } }}
                                           className="booking-record-head"
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
                                           
                                           <div className="booking-record-badges">
                                               {b.userId !== currentUser.id && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">受邀会议</span>}
                                               {b.checkedInAt && <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">已签到 {toLocalTimeString(b.checkedInAt)}</span>}
                                               {b.seriesKind === 'LONG_TERM' && <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">{b.renewalOfSeriesId ? '续期' : '长期预订'} · {longTermSeries.length} 天</span>}
                                               <BookingStatusBadge booking={b} theme={theme} />
                                               <div className={`p-2 rounded-full transition-transform duration-300 ${isExpanded ? 'rotate-180 bg-gray-100 text-gray-600' : 'text-gray-500'}`}>
                                                   <ChevronDown size={16}/>
                                               </div>
                                           </div>
                                       </div>

                                       {/* Expanded Content */}
                                       {isExpanded && (
                                           <div id={`booking-details-${b.id}`} className="px-6 pb-8 pt-2 border-t border-gray-50 animate-in slide-in-from-top-2 fade-in">
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
                                               {b.type === 'ROOM' && b.userId === currentUser.id && <BookingUsageActions booking={b} fact={usageFact} appeals={bookingAppeals} apiRequest={apiRequest} notify={addNotification}/>}

                                               <div className="mt-8 flex justify-end gap-3 flex-wrap">
                                                 {b.seriesKind === 'LONG_TERM' && b.recurrenceIndex === 0 && b.status === 'APPROVED' && b.userId === currentUser.id && <button onClick={() => handleRenewLongTerm(b)} disabled={!!activeRenewal} className="flex items-center space-x-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-5 py-2.5 rounded-xl border border-indigo-100 disabled:opacity-50"><RefreshCw size={14}/><span>{activeRenewal ? '续期已提交' : '申请续期'}</span></button>}
                                                 {(b.status === 'APPROVED' || b.status === 'CANCELLED') && resource && <button onClick={() => void downloadBookingIcs(b).then(() => addNotification('日历已导出', 'ICS 文件已通过服务端权限校验并下载。', 'SUCCESS')).catch((error: Error) => addNotification('日历导出失败', error.message, 'WARNING'))} className="flex items-center space-x-2 text-xs font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-5 py-2.5 rounded-xl border border-emerald-100"><Download size={14}/><span>下载 ICS 日历</span></button>}
                                                 {checkableBookings.some(item => item.id === b.id) && <button onClick={() => setShowQRScanner(true)} className={`flex items-center space-x-2 text-xs font-bold text-${theme}-600 bg-${theme}-50 hover:bg-${theme}-100 px-5 py-2.5 rounded-xl border border-${theme}-100`}><CheckCircle size={14}/><span>会议签到</span></button>}
                                                 {b.status === 'APPROVED' && b.checkedInAt && b.userId === currentUser.id && Date.now() >= new Date(b.startTime).getTime() && Date.now() < new Date(b.endTime).getTime() && <button onClick={() => handleEndEarly(b.id)} className="flex items-center space-x-2 text-xs font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 px-5 py-2.5 rounded-xl border border-amber-100"><LogOut size={14}/><span>提前结束并释放</span></button>}
                                                 {['PENDING', 'APPROVED'].includes(b.status) && b.userId === currentUser.id && <>
                                                        <button onClick={(e) => { e.stopPropagation(); if (!resource) return; setEditingBooking(b); setSelectedResource(resource); setCalendarDateForBooking(null); setBookingPrefill({ id: b.id, userId: b.userId, purpose: b.purpose, start: b.startTime, end: b.endTime, participants: b.participants, extras: { meetingType: b.meetingType, confidentialityChoice: b.confidentialityChoice, serviceRequirements: b.serviceRequirements || [], exclusiveRequestReason: b.exclusiveRequestReason, auditoriumSetup: b.auditoriumSetup, hasLeader: b.hasLeader, leaderDetails: b.leaderDetails, isVideoConference: b.isVideoConference, needsTeaService: b.needsTeaService, requiredFeatures: b.requiredFeatures || [], attendeeIds: b.attendeeIds || [] } }); setShowBookingModal(true); }} className="flex items-center space-x-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-5 py-2.5 rounded-xl transition-all border border-indigo-100"><Edit2 size={14}/><span>修改预约</span></button>
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
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">通用特殊审批流程</h3><p className="text-sm text-gray-500 mt-1">发布后用于重要、专属和重服务预约；普通预约自动核准，涉密与连续超 3 天使用专用流程。在途申请仍按冻结版本审批。</p></div><button onClick={() => { setEditingWorkflowNode(null); setShowWorkflowModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增节点</span></button></div>
               <div className="space-y-4">
                 {workflow.map((node, index) => (
                   <div key={node.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between group hover:border-gray-200 transition-all">
                     <div className="flex items-center space-x-6">
                       <div className={`w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-black text-${theme}-600 border border-gray-100 shadow-inner`}>{index + 1}</div>
                       <div><h5 className="font-bold text-gray-800">{node.name}</h5><p className="text-xs text-gray-500 mt-1 font-medium">负责角色：{roles.find(r => r.id === node.approverRole)?.name}</p><p className="mt-1 text-[11px] font-medium text-gray-500">部门：{node.departmentIds?.length ? node.departmentIds.map(id => departments.find(department => department.id === id)?.name || id).join('、') : '全部'} · 公司：{node.campuses?.length ? node.campuses.join('、') : '全部'}</p></div>
                     </div>
                     <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-all">
                       <button onClick={() => { const nw = [...workflow]; if(index > 0) { [nw[index], nw[index-1]] = [nw[index-1], nw[index]]; void handleSaveWorkflow(nw); } }} disabled={index === 0} className="p-2 text-gray-500 hover:text-indigo-600 disabled:opacity-30"><ChevronUp size={16}/></button>
                       <button onClick={() => { const nw = [...workflow]; if(index < nw.length-1) { [nw[index], nw[index+1]] = [nw[index+1], nw[index]]; void handleSaveWorkflow(nw); } }} disabled={index === workflow.length-1} className="p-2 text-gray-500 hover:text-indigo-600 disabled:opacity-30"><ChevronDown size={16}/></button>
                       <button onClick={() => { setEditingWorkflowNode(node); setShowWorkflowModal(true); }} className="p-2 text-gray-500 hover:text-indigo-600"><Edit2 size={16}/></button>
                       <button onClick={() => void handleSaveWorkflow(workflow.filter(n => n.id !== node.id), '审批节点已删除。')} className="p-2 text-gray-500 hover:text-rose-500"><Trash2 size={16}/></button>
                     </div>
                   </div>
                 ))}
                 {workflow.length === 0 && <div className="p-20 text-center bg-white rounded-3xl border border-dashed text-gray-500 font-bold">请新增至少一个审批节点后再发布；普通预约自动核准不受影响。</div>}
               </div>
               {latestApprovalRuleSet && <section className="bg-white rounded-3xl border border-gray-100 p-4 sm:p-6 shadow-sm" aria-labelledby="approval-rules-title">
                 <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                   <div>
                     <div className="flex flex-wrap items-center gap-2"><h4 id="approval-rules-title" className="font-black text-gray-800">动态规则集 V{latestApprovalRuleSet.version}</h4>{approvalRuleSetDirty && <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">有未发布修改</span>}</div>
                     <p className="mt-1 text-xs text-gray-500">按优先级从高到低命中第一条规则，同一规则的条件需同时满足；发布后新申请使用 V{latestApprovalRuleSet.version + 1}，在途申请保持冻结版本。</p>
                   </div>
                   <div className="flex flex-wrap gap-2 shrink-0">
                     <button type="button" onClick={() => { setEditingApprovalRule(null); setShowApprovalRuleModal(true); }} className="studio-secondary min-h-11"><Plus size={15}/>新增规则</button>
                     {approvalRuleSetDirty && <button type="button" onClick={handleResetApprovalRules} className="studio-secondary min-h-11"><RotateCcw size={15}/>重置草稿</button>}
                     <button type="button" onClick={() => void handlePublishApprovalRules()} disabled={!approvalRuleSetDirty || publishingApprovalRules} className={`min-h-11 rounded-xl bg-${theme}-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40`}><Save size={15} className="mr-1 inline"/>{publishingApprovalRules ? '发布中…' : '发布新版本'}</button>
                   </div>
                 </div>
                 <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                   <label className="text-xs font-black text-gray-600">默认流程版本<select aria-label="规则集默认流程版本" value={approvalDefaultWorkflowVersion} onChange={event => setApprovalDefaultWorkflowVersion(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-gray-200 bg-white p-3 text-sm font-medium">{[...workflowVersions].sort((a, b) => b.version - a.version).map(version => <option key={version.version} value={version.version}>V{version.version} · {version.nodes.map(node => node.name).join(' → ') || '空流程'}</option>)}</select></label>
                   <p className="mt-2 text-[11px] text-gray-500">普通预约未命中特殊规则时仍自动核准；默认流程版本用于规则集版本追踪。</p>
                 </div>
                 <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">{[...approvalRuleDraft].sort((a, b) => b.priority - a.priority).map(rule => <article key={rule.id} className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                   <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-gray-800">{rule.name}</p><p className="mt-1 text-[10px] font-medium text-gray-500">{rule.id}</p></div><span className="shrink-0 text-[11px] font-black text-indigo-600">优先级 {rule.priority}</span></div>
                   <p className="mt-2 text-xs text-gray-600">{[rule.conditions.meetingTypes?.length ? `会议类型：${rule.conditions.meetingTypes.map(type => MEETING_TYPE_LABELS[type]).join(' / ')}` : '', rule.conditions.exclusive !== undefined ? `专属资源：${rule.conditions.exclusive ? '是' : '否'}` : '', rule.conditions.heavyService !== undefined ? `重服务：${rule.conditions.heavyService ? '是' : '否'}` : '', rule.conditions.continuousOverDays !== undefined ? `单次连续超过：${rule.conditions.continuousOverDays} 天` : ''].filter(Boolean).join(' · ')}</p>
                   <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-200 pt-3"><p className="text-[11px] font-bold text-gray-500">目标流程 V{rule.workflowVersion}</p><div className="flex gap-1"><button type="button" aria-label={`编辑规则${rule.name}`} onClick={() => { setEditingApprovalRule(rule); setShowApprovalRuleModal(true); }} className="min-h-11 min-w-11 p-3 text-gray-500 hover:text-indigo-600"><Edit2 size={16}/></button><button type="button" aria-label={`删除规则${rule.name}`} onClick={() => setApprovalRuleDraft(current => current.filter(item => item.id !== rule.id))} className="min-h-11 min-w-11 p-3 text-gray-500 hover:text-rose-600"><Trash2 size={16}/></button></div></div>
                 </article>)}</div>
                 {approvalRuleDraft.length === 0 && <p className="mt-4 rounded-2xl border border-dashed border-gray-200 py-8 text-center text-xs font-bold text-gray-500">草稿中没有特殊规则；发布后所有未配置特殊规则的申请将按现有自动核准口径处理。</p>}
               </section>}
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

          {view === 'CONFIDENTIALITY' && (currentUser.role.includes('SYSTEM_ADMIN') || currentUser.role.includes('SECURITY_ADMIN')) && <ConfidentialityAdminPanel
            users={users}
            authorizationTargets={confidentialAuthorizationTargets}
            whitelist={confidentialWhitelist}
            authorizations={confidentialityAuthorizations}
            currentUser={currentUser}
            onAddWhitelist={handleAddConfidentialWhitelist}
            onRemoveWhitelist={handleRemoveConfidentialWhitelist}
            onAuthorize={handleCreateConfidentialityAuthorization}
          />}

          {view === 'ROLES' && (
             <div className="space-y-6 animate-in fade-in">
               <div className="flex justify-between items-center mb-6"><div><h3 className="text-2xl font-black">权限集管理</h3><p className="text-sm text-gray-500 mt-1">定义系统角色及其对应的业务职能。</p></div><button onClick={() => { setEditingRole(null); setShowRoleModal(true); }} className={`bg-${theme}-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg flex items-center space-x-2`}><Plus size={18}/> <span>新增角色集</span></button></div>
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                 {roles.map(r => (
                   <div key={r.id} className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm relative group hover:border-gray-200 hover:shadow-md transition-all">
                     <div className={`w-12 h-12 rounded-2xl bg-${r.color}-50 flex items-center justify-center text-${r.color}-600 mb-6 shadow-inner`}><Shield size={24}/></div>
                     <h5 className="font-black text-xl text-gray-800">{r.name}</h5>
                     <p className="text-xs text-gray-500 mt-3 leading-relaxed font-medium">{r.description}</p>
                     <div className="mt-4 rounded-xl bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                       <span className="font-black text-gray-700">监控授权：</span>
                       {r.id === 'SYSTEM_ADMIN' ? '会议室监控、办公室监控（管理员默认）' : [
                         ...(r.monitoringScopes?.includes('MEETING_ROOMS') ? ['会议室监控'] : []),
                         ...(r.monitoringScopes?.includes('OFFICES') ? ['办公室监控'] : [])
                       ].join('、') || '未授权'}
                     </div>
                     <div className="mt-6 pt-6 border-t border-gray-50 flex justify-between items-center">
                       <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">ID: {r.id}</span>
                       <button aria-label={`编辑角色${r.name}`} onClick={() => { setEditingRole(r); setShowRoleModal(true); }} className="p-2 text-gray-500 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all"><Edit2 size={14}/></button>
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

          {view === 'WORK_ORDERS' && canAccessWorkOrders && <ServiceOperations
            currentUser={currentUser}
            users={users}
            resources={resources}
            bookings={bookings}
            workOrders={visibleWorkOrders}
            serviceCatalog={serviceCatalog}
            serviceAreas={serviceAreas}
            serviceShifts={serviceShifts}
            serviceInspections={serviceInspections}
            checkInEvents={checkInEvents}
            usageFacts={usageFacts}
            usageAppeals={usageAppeals}
            roles={roles}
            apiRequest={apiRequest}
            notify={addNotification}
          />}

          {view === 'EXCEPTIONS' && canAccessExceptions && <ExceptionCenter
            currentUser={currentUser}
            users={users}
            roles={roles}
            exceptions={exceptions}
            apiRequest={apiRequest}
            onChanged={refreshOperations}
            notify={addNotification}
          />}

          {view === 'DEVICES' && currentUser.role.includes('SYSTEM_ADMIN') && <DeviceManagement
            devices={devices}
            resources={resources}
            apiRequest={apiRequest}
            onChanged={async () => { await loadWorkspace(); }}
            notify={addNotification}
          />}

          {view === 'REPORTS' && currentUser.role.includes('SYSTEM_ADMIN') && (
            <React.Suspense fallback={<p role="status" className="p-6 text-sm text-gray-500">正在加载运营报表…</p>}>
              <OperationsReports bookings={bookings} notify={addNotification} />
            </React.Suspense>
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
                        if (!res.ok) throw new Error(formatUserError(backup, '备份失败，请稍后重试。'));
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
                           } catch(err: any) { alert(formatUserError(err, '文件格式错误或保存失败，请检查后重试。')); }
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
                   <div><h4 id="audit-title" className="font-black text-gray-800">操作审计</h4><p className="mt-1 text-xs text-gray-500">关键写入与业务操作同事务记录；组合条件在 MySQL 服务端查询，最多返回 200 条。</p></div>
                   <div className="flex gap-2"><input aria-label="筛选审计记录" type="search" value={auditQuery} onChange={e => setAuditQuery(e.target.value)} placeholder="在结果中快速筛选" className="studio-search min-w-0 px-3 py-2 text-xs"/><button onClick={() => void loadAuditEvents()} disabled={auditLoading} className="studio-secondary shrink-0"><RefreshCw size={14} className={auditLoading ? 'animate-spin' : ''}/>刷新</button></div>
                 </div>
                 <form className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7" onSubmit={event => { event.preventDefault(); void loadAuditEvents(); }}>
                   <select aria-label="审计操作人" value={auditFilters.actorId} onChange={event => setAuditFilters(current => ({ ...current, actorId: event.target.value }))} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold"><option value="">全部操作人</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
                   <input aria-label="审计动作" value={auditFilters.action} onChange={event => setAuditFilters(current => ({ ...current, action: event.target.value }))} placeholder="动作，如 USER_UPDATE" className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs"/>
                   <select aria-label="审计对象类型" value={auditFilters.entityType} onChange={event => setAuditFilters(current => ({ ...current, entityType: event.target.value }))} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold"><option value="">全部对象类型</option>{['USER', 'ROLE', 'DEPARTMENT', 'WORKFLOW', 'RULE_SETTINGS', 'RESOURCE', 'DELEGATION', 'BOOKING', 'DEVICE'].map(type => <option key={type} value={type}>{type}</option>)}</select>
                   <input aria-label="审计对象ID" value={auditFilters.entityId} onChange={event => setAuditFilters(current => ({ ...current, entityId: event.target.value }))} placeholder="对象 ID" className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs"/>
                   <input aria-label="审计开始日期" type="date" value={auditFilters.start} onChange={event => setAuditFilters(current => ({ ...current, start: event.target.value }))} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs"/>
                   <input aria-label="审计结束日期" type="date" value={auditFilters.end} onChange={event => setAuditFilters(current => ({ ...current, end: event.target.value }))} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs"/>
                   <button type="submit" disabled={auditLoading} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">查询审计</button>
                 </form>
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
          onPreflight={async (data: any) => {
            const result = await apiRequest('/api/resources/ledger/preflight', 'POST', { items: data });
            return result.report as ResourceImportReport;
          }}
          onImport={async (data: any) => {
            try {
              if (!Array.isArray(data) || !data.length) throw new Error('未解析到有效数据。');
              if (showImportModal === 'RESOURCES') {
                const result = await apiRequest('/api/resources/ledger/import', 'POST', { items: data });
                addNotification('台账导入成功', `已写入 MySQL：新增 ${result.report.creates} 条、更新 ${result.report.updates} 条，不变 ${result.report.unchanged} 条。`, 'SUCCESS');
              } else {
                await apiRequest(`/api/imports/${showImportModal}`, 'POST', { items: data });
                addNotification('导入成功', `已成功导入 ${data.length} 条数据并写入 MySQL。`, 'SUCCESS');
              }
              setShowImportModal(null);
            } catch (err: any) {
              addNotification('导入失败', err?.message || '请刷新后重试。', 'WARNING');
              throw err;
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
      {showApprovalRuleModal && latestApprovalRuleSet && <ApprovalRuleModal
        rule={editingApprovalRule}
        rules={approvalRuleDraft}
        workflowVersions={workflowVersions}
        defaultWorkflowVersion={approvalDefaultWorkflowVersion}
        onClose={() => { setShowApprovalRuleModal(false); setEditingApprovalRule(null); }}
        onSave={handleSaveApprovalRule}
        theme={theme}
      />}
      {showDelegateModal && <ApprovalDelegateModal users={users} onClose={() => setShowDelegateModal(false)} onSave={handleSaveDelegate} theme={theme} />}
      
      {showBookingModal && selectedResource && (<BookingFormModal resource={selectedResource} theme={theme} initialDate={calendarDateForBooking} initialValues={bookingPrefill} onClose={() => { setShowBookingModal(false); setCalendarDateForBooking(null); setBookingPrefill(null); setEditingBooking(null); setBookingFormError(null); }} onConfirm={handleBooking} availableUsers={users} currentUser={currentUser} bookings={bookings} ruleSettings={ruleSettings} confidentialityAuthorizations={confidentialityAuthorizations} serviceCatalog={serviceCatalog} externalError={bookingFormError} />)}

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

      {!showMobileMenu && view !== 'MONITORING_ROOMS' && view !== 'MONITORING_OFFICES' && <button
        type="button"
        onClick={() => setShowAgent(true)}
        aria-label="打开智能助手"
        className="studio-agent-launcher fixed right-4 bottom-24 lg:bottom-6 z-[90] flex items-center gap-3 p-3 lg:px-4 lg:py-3 transition-all active:scale-[0.97]"
      >
        <MessageSquare size={18} />
        <span className="hidden lg:block text-left"><span className="block text-[12.5px] font-semibold">智办助手</span><small className="block mt-0.5">ASK YOUR OFFICE</small></span>
      </button>}

      <React.Suspense fallback={null}>
        <HelpDrawer
          open={showHelp}
          topicId={helpTopicId}
          roles={currentUser.role}
          allowedViews={allowedViews}
          onClose={() => setShowHelp(false)}
          onNavigate={navigateToView}
          onAsk={askAgent}
        />
        <ChatDock
          open={showAgent}
          onClose={() => setShowAgent(false)}
          userId={currentUser.id}
          userName={currentUser.name}
          theme={theme}
          resources={resources}
          bookings={bookings}
          users={users}
          serviceCatalog={serviceCatalog}
          onAction={handleAgentAction}
          onNavigate={navigateToView}
          request={agentRequest}
        />
      </React.Suspense>
    </div>
  );
};

export default App;