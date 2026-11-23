import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, Coffee, Edit2, MapPin, Plus, QrCode, ShieldCheck, Video } from 'lucide-react';
import type { Booking, BookingUsageFact, CheckInEvent, Resource, RoleDefinition, ServiceArea, ServiceCatalogItem, ServiceFieldTemplate, ServiceInspection, ServiceShift, UsageAppeal, User, WorkOrder } from '../types';
import { toLocalDateTimeString, toLocalTimeString } from '../utils/dateTime';
import { SERVICE_TYPE_LABELS } from '../constants';
import { formatUserError } from '../utils/userErrors';

type Notify = (title: string, content: string, type?: 'INFO' | 'SUCCESS' | 'WARNING') => void;
type ApiRequest = (path: string, method: string, body?: any) => Promise<any>;

const statusLabels: Record<string, string> = {
  TODO: '待响应', PENDING_INFO: '待补充', IN_PROGRESS: '执行中', DONE: '已完成',
  APPROVED: '已核准', CANCELLED: '已取消', EXCEPTION: '异常', PENDING: '待处理',
  RESTORED: '已恢复', REJECTED: '已驳回', IN_USE: '正常使用', UNUSED: '确认未使用'
};
const serviceLabels: Record<string, string> = SERVICE_TYPE_LABELS;
const actionLabels: Record<string, string> = { REQUEST_INFO: '要求补充', PROVIDE_INFO: '补充信息', START: '开始执行', COMPLETE: '执行完成', CANCEL: '取消工单', EXCEPTION: '登记异常', RESUME: '恢复执行' };
const allowedActions: Record<string, string[]> = {
  TODO: ['START', 'REQUEST_INFO', 'CANCEL', 'EXCEPTION'],
  PENDING_INFO: ['CANCEL', 'EXCEPTION'],
  IN_PROGRESS: ['COMPLETE', 'REQUEST_INFO', 'EXCEPTION'],
  EXCEPTION: ['RESUME']
};
const inspectionLabels: Record<string, string> = { PRE_OPEN: '开放前巡查', IMPORTANT_PRE_30: '重要会议会前巡查', ROUTINE_2H: '例行巡查', EXCEPTION: '异常复查' };
const inputClass = 'mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-gray-700 outline-none focus:border-indigo-300';
const toInput = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
const fromInput = (value: string) => value ? new Date(value).toISOString() : undefined;

export default function ServiceOperations({ currentUser, users, resources, bookings, workOrders, serviceCatalog, serviceAreas, serviceShifts, serviceInspections, checkInEvents, usageFacts, usageAppeals, roles, apiRequest, notify }: {
  currentUser: User;
  users: User[];
  resources: Resource[];
  bookings: Booking[];
  workOrders: WorkOrder[];
  serviceCatalog: ServiceCatalogItem[];
  serviceAreas: ServiceArea[];
  serviceShifts: ServiceShift[];
  serviceInspections: ServiceInspection[];
  checkInEvents: CheckInEvent[];
  usageFacts: BookingUsageFact[];
  usageAppeals: UsageAppeal[];
  roles: RoleDefinition[];
  apiRequest: ApiRequest;
  notify: Notify;
}) {
  const [tab, setTab] = useState<'ORDERS' | 'USAGE' | 'INSPECTIONS' | 'AREAS' | 'CATALOG'>('ORDERS');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = currentUser.role.includes('SYSTEM_ADMIN');
  const canOperate = isAdmin || currentUser.role.some(role => ['SERVICE_COORDINATOR', 'FRONT_DESK'].includes(role));
  const canResolveAppeals = canOperate || currentUser.role.includes('APPROVAL_ADMIN');
  const canManageOrder = (order: WorkOrder) => isAdmin || currentUser.role.includes(order.assigneeRole);
  const run = async (action: () => Promise<any>, success: string) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      await action();
      notify('操作成功', success, 'SUCCESS');
      return true;
    } catch (reason: any) {
      setError(formatUserError(reason, '操作未完成，请刷新后重试。'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openOrders = workOrders.filter(order => !['DONE', 'CANCELLED'].includes(order.status));
  const overdueOrders = openOrders.filter(order => order.responseDueAt && !order.respondedAt && Date.parse(order.responseDueAt) < Date.now());
  const dueOrders = workOrders.filter(order => order.responseDueAt);
  const onTimeOrders = dueOrders.filter(order => order.respondedAt && Date.parse(order.respondedAt) <= Date.parse(order.responseDueAt || ''));
  const slaRate = dueOrders.length ? Math.round(onTimeOrders.length / dueOrders.length * 1000) / 10 : 100;
  const tabs: Array<readonly [typeof tab, string, number]> = [
    ['ORDERS', '服务工单', openOrders.length],
    ...(canResolveAppeals ? [['USAGE', canOperate ? '签到与释放' : '释放申诉', usageAppeals.filter(item => item.status === 'PENDING').length] as const] : []),
    ...(canOperate ? [
      ['INSPECTIONS', '责任区巡查', serviceInspections.filter(item => item.status === 'PENDING').length] as const,
      ['AREAS', '责任区与班次', 0] as const
    ] : []),
    ...(isAdmin ? [['CATALOG', '服务目录', 0] as const] : [])
  ];

  return <div className="space-y-6 animate-in fade-in">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">SERVICE OPERATIONS</p><h3 className="mt-1 text-2xl font-black text-gray-800">会务服务与使用释放</h3><p className="mt-2 text-sm text-gray-500">服务目录快照、执行工单、现场签到、巡查与异常恢复在同一工作区处理。</p></div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3"><p className="text-[10px] font-black text-gray-500">开放工单</p><p className="mt-1 text-xl font-black text-gray-800">{openOrders.length}</p></div>
        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3"><p className="text-[10px] font-black text-gray-500">SLA 超时</p><p className={`mt-1 text-xl font-black ${overdueOrders.length ? 'text-rose-600' : 'text-gray-800'}`}>{overdueOrders.length}</p></div>
        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3"><p className="text-[10px] font-black text-gray-500">按时响应率</p><p className="mt-1 text-xl font-black text-gray-800">{slaRate}%</p></div>
      </div>
    </div>
    <div role="tablist" aria-label="会务工作区" className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map(([id, label, count]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setError(''); }} className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-black ${tab === id ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-500'}`}>{label}{count > 0 && <span className={`ml-2 rounded-full px-2 py-0.5 ${tab === id ? 'bg-white/20' : 'bg-amber-50 text-amber-600'}`}>{count}</span>}</button>)}
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-600">{error}</p>}

    {tab === 'ORDERS' && <OrdersPanel currentUser={currentUser} bookings={bookings} resources={resources} users={users} workOrders={workOrders} canManageOrder={canManageOrder} busy={busy} run={run} apiRequest={apiRequest} />}
    {tab === 'USAGE' && canResolveAppeals && <UsagePanel currentUser={currentUser} users={users} resources={resources} bookings={bookings} checkInEvents={checkInEvents} usageFacts={usageFacts} usageAppeals={usageAppeals} canOperate={canOperate} canResolveAppeals={canResolveAppeals} busy={busy} run={run} apiRequest={apiRequest} />}
    {tab === 'INSPECTIONS' && canOperate && <InspectionsPanel inspections={serviceInspections} areas={serviceAreas} bookings={bookings} users={users} busy={busy} run={run} apiRequest={apiRequest} />}
    {tab === 'AREAS' && canOperate && <AreasPanel users={users} resources={resources} areas={serviceAreas} shifts={serviceShifts} busy={busy} run={run} apiRequest={apiRequest} />}
    {tab === 'CATALOG' && isAdmin && <CatalogPanel catalog={serviceCatalog} roles={roles} busy={busy} run={run} apiRequest={apiRequest} />}
  </div>;
}

function OrdersPanel({ currentUser, bookings, resources, users, workOrders, canManageOrder, busy, run, apiRequest }: any) {
  const [selectedId, setSelectedId] = useState('');
  const [action, setAction] = useState('START');
  const [reason, setReason] = useState('');
  const [executionResult, setExecutionResult] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [costNote, setCostNote] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const selectOrder = (order: WorkOrder, provideInfo = false) => {
    const closing = selectedId === order.id && (action === 'PROVIDE_INFO') === provideInfo;
    setSelectedId(closing ? '' : order.id);
    setAction(provideInfo ? 'PROVIDE_INFO' : allowedActions[order.status]?.[0] || '');
    setFieldValues({ ...(order.fieldValues || {}) });
    setReason(''); setExecutionResult(''); setCostAmount(''); setCostNote('');
  };
  const submit = async (order: WorkOrder) => {
    const targetStatus = { REQUEST_INFO: 'PENDING_INFO', PROVIDE_INFO: 'TODO', START: 'IN_PROGRESS', COMPLETE: 'DONE', CANCEL: 'CANCELLED', EXCEPTION: 'EXCEPTION', RESUME: 'IN_PROGRESS' }[action];
    const ok = await run(() => apiRequest(`/api/work-orders/${encodeURIComponent(order.id)}/transitions`, 'POST', {
      action, reason: reason || undefined, executionResult: executionResult || undefined,
      costAmount: costAmount === '' ? undefined : Number(costAmount), costNote: costNote || undefined,
      fieldValues: action === 'PROVIDE_INFO' ? fieldValues : undefined
    }), `${order.title}已更新为${statusLabels[targetStatus || action] || targetStatus || action}。`);
    if (ok) setSelectedId('');
  };
  if (!workOrders.length) return <div className="rounded-3xl border border-dashed bg-white py-24 text-center font-bold text-gray-500"><Coffee size={40} className="mx-auto mb-4 opacity-30"/>暂无服务工单</div>;
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{workOrders.map((order: WorkOrder) => {
    const booking = bookings.find((item: Booking) => item.id === order.bookingId);
    const resource = resources.find((item: Resource) => item.id === booking?.resourceId);
    const snapshot = order.requirementSnapshot?.catalogSnapshot;
    const overdue = order.responseDueAt && !order.respondedAt && Date.parse(order.responseDueAt) < Date.now() && !['DONE', 'CANCELLED'].includes(order.status);
    const canProvideInfo = order.status === 'PENDING_INFO' && (booking?.userId === currentUser.id || canManageOrder(order));
    const missingRequiredField = action === 'PROVIDE_INFO' && snapshot?.fields.some(field => field.required && !fieldValues[field.key]?.trim());
    return <article key={order.id} className={`rounded-3xl border bg-white p-5 shadow-sm ${['DONE', 'CANCELLED'].includes(order.status) ? 'opacity-70' : ''} ${overdue ? 'border-rose-200' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${order.type === 'TEA' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>{order.type === 'TEA' ? <Coffee size={20}/> : order.type === 'VIDEO' ? <Video size={20}/> : <ShieldCheck size={20}/>}</div><div className="min-w-0"><p className="text-[10px] font-black uppercase text-gray-500">{serviceLabels[order.type]} · 目录 v{snapshot?.catalogVersion || '历史'}</p><h4 className="mt-1 break-words font-black text-gray-800">{order.title}</h4></div></div>
        <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold ${order.status === 'EXCEPTION' || overdue ? 'bg-rose-50 text-rose-600' : order.status === 'DONE' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-600'}`}>{statusLabels[order.status]}</span>
      </div>
      <div className="my-4 space-y-1 rounded-2xl bg-gray-50 p-4 text-xs text-gray-500"><p className="font-bold text-gray-700">{resource?.name || booking?.resourceId || '关联资源不可读'}</p><p>{booking ? `${toLocalDateTimeString(booking.startTime)} - ${toLocalTimeString(booking.endTime)}` : '关联预约不可读'}</p><p>响应截止：{order.responseDueAt ? toLocalDateTimeString(order.responseDueAt) : '未设置'}{order.respondedAt ? ` · 已响应 ${toLocalDateTimeString(order.respondedAt)}` : ''}</p>{order.assigneeId && <p>执行人:{users.find((user: User) => user.id === order.assigneeId)?.name || order.assigneeId}</p>}</div>
      {Object.keys(order.fieldValues || {}).length > 0 && <dl className="mb-4 grid grid-cols-2 gap-2 text-xs">{Object.entries(order.fieldValues || {}).map(([key, value]) => <div key={key} className="rounded-xl border border-gray-100 p-3"><dt className="text-[10px] font-black text-gray-500">{snapshot?.fields.find(field => field.key === key)?.label || key}</dt><dd className="mt-1 break-words font-bold text-gray-700">{String(value)}</dd></div>)}</dl>}
      {(order.exceptionReason || order.executionResult || order.cancellationReason) && <div className="mb-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">{order.exceptionReason || order.executionResult || order.cancellationReason}{order.costAmount !== undefined && <p className="mt-1 font-black">成本：¥{order.costAmount}{order.costNote ? ` · ${order.costNote}` : ''}</p>}</div>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canProvideInfo && <button onClick={() => selectOrder(order, true)} aria-expanded={selectedId === order.id && action === 'PROVIDE_INFO'} className="flex-1 rounded-xl bg-amber-500 py-2.5 text-xs font-black text-white">补充待定信息</button>}
        {canManageOrder(order) && allowedActions[order.status]?.length > 0 && <button onClick={() => selectOrder(order)} aria-expanded={selectedId === order.id && action !== 'PROVIDE_INFO'} className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-xs font-black text-white">处理工单</button>}
      </div>
      {selectedId === order.id && <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
        {action === 'PROVIDE_INFO' ? <fieldset className="space-y-3"><legend className="text-xs font-black text-gray-700">按提交时冻结的目录模板补充</legend>{snapshot?.fields.map(field => <label key={field.key} className="block text-[11px] font-black text-gray-500">{field.label}{field.required && <span className="ml-1 text-rose-500">*</span>}{field.type === 'TEXTAREA' ? <textarea aria-label={`${order.title}${field.label}`} rows={3} maxLength={500} value={fieldValues[field.key] || ''} onChange={event => setFieldValues(prev => ({ ...prev, [field.key]: event.target.value }))} className={inputClass}/> : field.type === 'SELECT' ? <select aria-label={`${order.title}${field.label}`} value={fieldValues[field.key] || ''} onChange={event => setFieldValues(prev => ({ ...prev, [field.key]: event.target.value }))} className={inputClass}><option value="">请选择</option>{field.options?.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input aria-label={`${order.title}${field.label}`} type={field.type === 'NUMBER' ? 'number' : 'text'} min={field.type === 'NUMBER' ? '0' : undefined} maxLength={field.type === 'NUMBER' ? undefined : 500} value={fieldValues[field.key] || ''} onChange={event => setFieldValues(prev => ({ ...prev, [field.key]: event.target.value }))} className={inputClass}/>}</label>)}{!snapshot?.fields.length && <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500">该历史工单没有可补充的目录字段，请由责任角色直接处理。</p>}</fieldset> : <label className="block text-[11px] font-black text-gray-500">状态操作<select aria-label={`${order.title}状态操作`} value={action} onChange={event => setAction(event.target.value)} className={inputClass}>{allowedActions[order.status].map(item => <option key={item} value={item}>{actionLabels[item]}</option>)}</select></label>}
        {['REQUEST_INFO', 'CANCEL', 'EXCEPTION', 'RESUME'].includes(action) && <label className="block text-[11px] font-black text-gray-500">原因（必填）<textarea aria-label="工单操作原因" rows={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} className={inputClass}/></label>}
        {action === 'COMPLETE' && <label className="block text-[11px] font-black text-gray-500">执行结果（必填）<textarea aria-label="工单执行结果" rows={3} maxLength={1000} value={executionResult} onChange={event => setExecutionResult(event.target.value)} className={inputClass}/></label>}
        {['COMPLETE', 'EXCEPTION'].includes(action) && <div className="grid grid-cols-2 gap-2"><label className="text-[11px] font-black text-gray-500">成本金额<input aria-label="工单成本金额" type="number" min="0" step="0.01" value={costAmount} onChange={event => setCostAmount(event.target.value)} className={inputClass}/></label><label className="text-[11px] font-black text-gray-500">成本说明<input aria-label="工单成本说明" value={costNote} onChange={event => setCostNote(event.target.value)} className={inputClass}/></label></div>}
        <button disabled={busy || missingRequiredField || (['REQUEST_INFO', 'CANCEL', 'EXCEPTION', 'RESUME'].includes(action) && !reason.trim()) || (action === 'COMPLETE' && !executionResult.trim())} onClick={() => void submit(order)} className="w-full rounded-xl bg-gray-900 py-2.5 text-xs font-black text-white disabled:opacity-40">提交{actionLabels[action]}</button>
      </div>}
      {order.statusHistory?.length > 0 && <details className="mt-4 text-[11px] text-gray-500"><summary className="cursor-pointer font-bold">状态历史（{order.statusHistory.length}）</summary><ol className="mt-2 space-y-2">{order.statusHistory.map((record, index) => <li key={`${record.at}-${index}`}>{toLocalDateTimeString(record.at)} · {record.from ? `${statusLabels[record.from]} → ` : ''}{statusLabels[record.to]} · {users.find((user: User) => user.id === record.actorId)?.name || (record.actorId ? record.actorId : '系统')}{record.reason ? ` · ${record.reason}` : ''}</li>)}</ol></details>}
    </article>;
  })}</div>;
}

function UsagePanel({ currentUser, users, resources, bookings, checkInEvents, usageFacts, usageAppeals, canOperate, canResolveAppeals, busy, run, apiRequest }: any) {
  const actionable = canOperate ? bookings.filter((booking: Booking) => booking.type === 'ROOM' && (booking.status === 'APPROVED' || (booking.status === 'CANCELLED' && booking.releaseType))) : [];
  const [bookingId, setBookingId] = useState(actionable[0]?.id || '');
  const booking = bookings.find((item: Booking) => item.id === bookingId) || actionable[0];
  const participants = booking ? [booking.userId, ...(booking.attendeeIds || [])] : [];
  const [subjectUserId, setSubjectUserId] = useState(currentUser.id);
  const [checkedInAt, setCheckedInAt] = useState(toInput(new Date().toISOString()));
  const [reason, setReason] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [usageDecision, setUsageDecision] = useState<'IN_USE' | 'UNUSED'>('IN_USE');
  const [usageNote, setUsageNote] = useState('');
  const [appealNotes, setAppealNotes] = useState<Record<string, string>>({});
  const subject = participants.includes(subjectUserId) ? subjectUserId : booking?.userId;
  const fact = booking && usageFacts.find((item: BookingUsageFact) => item.bookingId === booking.id && item.scheduleVersion === (booking.scheduleVersion || 1));
  const events = booking ? checkInEvents.filter((event: CheckInEvent) => event.bookingId === booking.id) : [];
  const doAction = (path: string, body: any, message: string) => run(() => apiRequest(path, 'POST', body), message);
  return <div className={`grid grid-cols-1 gap-5 ${canOperate ? '2xl:grid-cols-[1fr_360px]' : ''}`}>
    {canOperate && <section className="rounded-3xl border border-gray-100 bg-white p-5 md:p-6">
      {!actionable.length ? <div className="py-20 text-center text-sm font-bold text-gray-500">当前没有可管理的会议使用记录</div> : <>
      <label className="text-[11px] font-black text-gray-500">选择预约<select aria-label="现场管理预约" value={booking?.id || ''} onChange={event => { setBookingId(event.target.value); setReason(''); setReleaseReason(''); }} className={inputClass}>{actionable.map((item: Booking) => <option key={item.id} value={item.id}>{item.purpose} · {toLocalDateTimeString(item.startTime)} · {statusLabels[item.status] || item.status}</option>)}</select></label>
      {booking && <>
        <div className="my-5 rounded-2xl bg-gray-50 p-4 text-xs text-gray-600"><p className="font-black text-gray-800">{resources.find((resource: Resource) => resource.id === booking.resourceId)?.name || booking.resourceId} · {booking.purpose}</p><p className="mt-1">{toLocalDateTimeString(booking.startTime)} - {toLocalTimeString(booking.endTime)} · 排期 v{booking.scheduleVersion || 1}</p><p className="mt-1">签到：{booking.checkedInAt ? `${toLocalDateTimeString(booking.checkedInAt)} · ${booking.checkInSource === 'QR' ? '扫码' : booking.checkInSource === 'MANUAL' ? '人工' : '纠错'}` : '未签到'}{booking.releaseReason ? ` · 释放：${booking.releaseReason}` : ''}</p></div>
        {booking.status === 'APPROVED' && <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <fieldset className="space-y-3 rounded-2xl border border-gray-100 p-4"><legend className="px-1 text-xs font-black text-gray-700">签到与事实纠错</legend>
            <label className="block text-[11px] font-bold text-gray-500">签到成员<select aria-label="签到成员" value={subject || ''} onChange={event => setSubjectUserId(event.target.value)} className={inputClass}>{participants.map((id: string) => <option key={id} value={id}>{users.find((user: User) => user.id === id)?.name || id}{id === booking.userId ? '（申请人）' : ''}</option>)}</select></label>
            <label className="block text-[11px] font-bold text-gray-500">签到时间<input aria-label="签到时间" type="datetime-local" value={checkedInAt} onChange={event => setCheckedInAt(event.target.value)} className={inputClass}/></label>
            <label className="block text-[11px] font-bold text-gray-500">纠错或撤销原因<textarea aria-label="签到纠错原因" rows={2} value={reason} onChange={event => setReason(event.target.value)} className={inputClass}/></label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{!booking.checkedInAt ? <button disabled={busy} onClick={() => void doAction(`/api/bookings/${booking.id}/check-in`, { source: 'MANUAL', subjectUserId: subject }, '人工签到及使用事实已保存。')} className="rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-black text-white sm:col-span-3">人工签到</button> : <><button disabled={busy || !reason.trim() || !checkedInAt} onClick={() => void doAction(`/api/bookings/${booking.id}/check-in`, { source: 'MANUAL', subjectUserId: booking.userId, mode: 'CORRECT', checkedInAt: fromInput(checkedInAt), reason }, '签到时间已纠错并保留关联事件。')} className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-black text-amber-700 disabled:opacity-40">纠错</button><button disabled={busy || !reason.trim()} onClick={() => void doAction(`/api/bookings/${booking.id}/check-in`, { source: 'MANUAL', subjectUserId: booking.userId, mode: 'REVOKE', reason }, '签到已撤销，历史事件仍保留。')} className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-black text-rose-600 disabled:opacity-40">撤销签到</button></>}</div>
          </fieldset>
          <div className="space-y-5">
            <fieldset className="space-y-3 rounded-2xl border border-gray-100 p-4"><legend className="px-1 text-xs font-black text-gray-700">实际使用确认</legend><div className="flex gap-2">{(['IN_USE', 'UNUSED'] as const).map(decision => <button key={decision} aria-pressed={usageDecision === decision} onClick={() => setUsageDecision(decision)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-black ${usageDecision === decision ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-500'}`}>{decision === 'IN_USE' ? '正常使用' : '确认未使用'}</button>)}</div><textarea aria-label="使用确认说明" rows={2} value={usageNote} onChange={event => setUsageNote(event.target.value)} placeholder={usageDecision === 'UNUSED' ? '未使用原因（必填）' : '使用说明（可选）'} className={inputClass}/><button disabled={busy || (usageDecision === 'UNUSED' && !usageNote.trim())} onClick={() => void doAction(`/api/bookings/${booking.id}/usage-confirmation`, { decision: usageDecision, note: usageNote }, usageDecision === 'UNUSED' ? '未使用已确认，资源、额度、服务与门禁已联动释放。' : '实际使用已确认。')} className="w-full rounded-xl bg-gray-900 py-2.5 text-xs font-black text-white disabled:opacity-40">保存使用确认</button></fieldset>
            <fieldset className="space-y-3 rounded-2xl border border-rose-100 p-4"><legend className="px-1 text-xs font-black text-rose-700">人工异常释放</legend><textarea aria-label="人工释放原因" rows={2} value={releaseReason} onChange={event => setReleaseReason(event.target.value)} placeholder="填写可审计的现场异常原因" className={inputClass}/><button disabled={busy || !releaseReason.trim()} onClick={() => { if (confirm('人工释放将取消预约并联动撤销未执行服务，确定继续吗？')) void doAction(`/api/bookings/${booking.id}/release`, { reason: releaseReason }, '预约已人工异常释放，并保留使用事实。'); }} className="w-full rounded-xl bg-rose-600 py-2.5 text-xs font-black text-white disabled:opacity-40">确认异常释放</button><p className="text-[10px] leading-relaxed text-gray-500">单一设备事件不会直接触发释放；本操作要求会务人员明确确认。</p></fieldset>
          </div>
        </div>}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2"><div className="rounded-2xl bg-gray-50 p-4"><h4 className="text-xs font-black text-gray-700">实际使用事实 {fact ? `· revision ${fact.revision}` : ''}</h4>{fact ? <dl className="mt-3 space-y-2 text-[11px] text-gray-600"><div className="flex justify-between gap-3"><dt>预约时长</dt><dd className="font-bold">{fact.scheduledMinutes} 分钟</dd></div><div className="flex justify-between gap-3"><dt>实际开始</dt><dd className="font-bold">{fact.actualStartTime ? toLocalDateTimeString(fact.actualStartTime) : '—'}</dd></div><div className="flex justify-between gap-3"><dt>实际结束</dt><dd className="font-bold">{fact.actualEndTime ? toLocalDateTimeString(fact.actualEndTime) : '—'}</dd></div><div className="flex justify-between gap-3"><dt>实际时长</dt><dd className="font-bold">{fact.actualMinutes} 分钟</dd></div><div className="flex justify-between gap-3"><dt>事实来源</dt><dd className="font-bold">{fact.source}</dd></div></dl> : <p className="mt-3 text-xs text-gray-500">当前排期尚无使用事实。</p>}</div><div className="rounded-2xl bg-gray-50 p-4"><h4 className="text-xs font-black text-gray-700">签到事件（只追加，不覆盖历史）</h4><ol className="mt-3 max-h-44 space-y-2 overflow-y-auto text-[11px] text-gray-600">{events.map((event: CheckInEvent) => <li key={event.id} className="rounded-xl bg-white p-2"><span className="font-black">{event.action === 'CHECK_IN' ? '签到' : event.action === 'CORRECT' ? '纠错' : '撤销'} · {event.source}</span><p>{toLocalDateTimeString(event.createdAt)} · 操作人 {users.find((user: User) => user.id === event.operatorId)?.name || event.operatorId}</p>{event.reason && <p>原因：{event.reason}</p>}</li>)}{!events.length && <li>暂无签到事件</li>}</ol></div></div>
      </>}
      </>}
    </section>}
    {canResolveAppeals && <aside className="space-y-4"><h4 className="flex items-center gap-2 text-sm font-black text-gray-800"><AlertTriangle size={16}/>释放申诉处理</h4>{usageAppeals.map((appeal: UsageAppeal) => { const related = bookings.find((item: Booking) => item.id === appeal.bookingId); return <article key={appeal.id} className="rounded-2xl border border-gray-100 bg-white p-4"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-black text-gray-800">{related?.purpose || appeal.bookingId}</p><p className="mt-1 text-[11px] text-gray-500">{users.find((user: User) => user.id === appeal.requesterId)?.name || appeal.requesterId} · {toLocalDateTimeString(appeal.createdAt)}</p></div><span className="text-[11px] font-black text-amber-600">{statusLabels[appeal.status]}</span></div><p className="mt-3 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">{appeal.reason}</p>{appeal.status === 'PENDING' ? <div className="mt-3 space-y-2"><textarea aria-label={`申诉处理意见 ${appeal.id}`} rows={2} value={appealNotes[appeal.id] || ''} onChange={event => setAppealNotes(prev => ({ ...prev, [appeal.id]: event.target.value }))} placeholder="处理意见（必填）" className={inputClass}/><div className="grid grid-cols-2 gap-2"><button disabled={busy || !appealNotes[appeal.id]?.trim()} onClick={() => void doAction(`/api/usage-appeals/${appeal.id}`, { decision: 'RESTORE', note: appealNotes[appeal.id] }, '申诉已通过，恢复前已重检冲突和额度。')} className="rounded-xl bg-emerald-600 py-2 text-xs font-black text-white disabled:opacity-40">恢复预约</button><button disabled={busy || !appealNotes[appeal.id]?.trim()} onClick={() => void doAction(`/api/usage-appeals/${appeal.id}`, { decision: 'REJECT', note: appealNotes[appeal.id] }, '申诉已驳回并记录处理意见。')} className="rounded-xl bg-gray-100 py-2 text-xs font-black text-gray-600 disabled:opacity-40">驳回申诉</button></div></div> : appeal.resolutionNote && <p className="mt-3 text-[11px] text-gray-500">处理意见：{appeal.resolutionNote}</p>}</article>; })}{!usageAppeals.length && <p className="rounded-2xl border border-dashed bg-white py-12 text-center text-xs font-bold text-gray-500">暂无释放申诉</p>}</aside>}
  </div>;
}

export function BookingUsageActions({ booking, fact, appeals, apiRequest, notify }: {
  booking: Booking;
  fact?: BookingUsageFact;
  appeals: UsageAppeal[];
  apiRequest: ApiRequest;
  notify: Notify;
}) {
  const [decision, setDecision] = useState<'IN_USE' | 'UNUSED'>('IN_USE');
  const [note, setNote] = useState('');
  const [appealReason, setAppealReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmation = fact?.unusedConfirmation;
  const canConfirm = booking.status === 'APPROVED';
  const canAppeal = booking.status === 'CANCELLED' && Boolean(booking.releaseType);
  const hasPendingAppeal = appeals.some(appeal => appeal.status === 'PENDING');
  const run = async (path: string, body: any, success: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(path, 'POST', body);
      notify('操作成功', success, 'SUCCESS');
      setNote('');
      setAppealReason('');
    } catch (reason: any) {
      setError(formatUserError(reason, '操作未完成，请刷新后重试。'));
    } finally {
      setBusy(false);
    }
  };
  const confirmUsage = () => {
    if (decision === 'UNUSED' && !confirm('确认本次会议未使用吗？确认后将释放资源、额度、未执行服务与门禁授权。')) return;
    void run(`/api/bookings/${encodeURIComponent(booking.id)}/usage-confirmation`, { decision, note }, decision === 'UNUSED' ? '未使用事实已保存，关联资源与服务已释放。' : '实际使用事实已确认。');
  };
  if (!canConfirm && !canAppeal && !confirmation && !appeals.length) return null;
  return <section className="mt-5 rounded-2xl border border-gray-100 bg-gray-50/70 p-4" aria-label={`${booking.purpose}使用与申诉`}>
    <div className="flex items-center justify-between gap-3"><h5 className="text-xs font-black text-gray-800">实际使用与异常申诉</h5>{fact && <span className="text-[10px] font-bold text-gray-500">事实 revision {fact.revision} · 实际 {fact.actualMinutes} 分钟</span>}</div>
    {confirmation && <div className={`mt-3 rounded-xl p-3 text-xs ${confirmation.status === 'UNUSED' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}><p className="font-black">{statusLabels[confirmation.status] || confirmation.status}{confirmation.confirmedAt ? ` · ${toLocalDateTimeString(confirmation.confirmedAt)}` : ''}</p>{confirmation.note && <p className="mt-1">{confirmation.note}</p>}</div>}
    {canConfirm && confirmation?.status !== 'IN_USE' && <div className="mt-3 space-y-3"><div className="flex gap-2">{(['IN_USE', 'UNUSED'] as const).map(item => <button key={item} type="button" aria-pressed={decision === item} onClick={() => setDecision(item)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-black ${decision === item ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500'}`}>{statusLabels[item]}</button>)}</div><textarea aria-label={`${booking.purpose}使用确认说明`} rows={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder={decision === 'UNUSED' ? '请填写未使用原因（必填）' : '可补充实际使用说明'} className={inputClass}/><button type="button" disabled={busy || (decision === 'UNUSED' && !note.trim())} onClick={confirmUsage} className="rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">保存使用确认</button></div>}
    {booking.releaseReason && <p className="mt-3 rounded-xl bg-white p-3 text-xs text-gray-600"><span className="font-black text-gray-700">释放原因：</span>{booking.releaseReason}</p>}
    {canAppeal && !hasPendingAppeal && <div className="mt-3 space-y-2"><label className="block text-[11px] font-black text-gray-500">对释放结果有异议<textarea aria-label={`${booking.purpose}申诉理由`} rows={3} maxLength={1000} value={appealReason} onChange={event => setAppealReason(event.target.value)} placeholder="说明实际使用或误判情况，恢复前将重新检查资源冲突与部门额度" className={inputClass}/></label><button type="button" disabled={busy || appealReason.trim().length < 2} onClick={() => void run(`/api/bookings/${encodeURIComponent(booking.id)}/usage-appeals`, { reason: appealReason }, '释放申诉已提交，请等待会务或审批负责人处理。')} className="rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">提交释放申诉</button></div>}
    {appeals.length > 0 && <ol className="mt-3 space-y-2">{appeals.map(appeal => <li key={appeal.id} className="rounded-xl bg-white p-3 text-xs text-gray-600"><div className="flex items-center justify-between gap-2"><span className="font-black text-gray-700">申诉 · {toLocalDateTimeString(appeal.createdAt)}</span><span className={`font-black ${appeal.status === 'RESTORED' ? 'text-emerald-600' : appeal.status === 'REJECTED' ? 'text-rose-600' : 'text-amber-600'}`}>{statusLabels[appeal.status]}</span></div><p className="mt-2">{appeal.reason}</p>{appeal.resolutionNote && <p className="mt-2 border-t border-gray-100 pt-2"><span className="font-black">处理意见：</span>{appeal.resolutionNote}{appeal.resolvedAt ? ` · ${toLocalDateTimeString(appeal.resolvedAt)}` : ''}</p>}</li>)}</ol>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-600">{error}</p>}
  </section>;
}

function InspectionsPanel({ inspections, areas, bookings, users, busy, run, apiRequest }: any) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const update = (inspection: ServiceInspection, status: 'DONE' | 'EXCEPTION') => run(() => apiRequest(`/api/service-inspections/${inspection.id}`, 'POST', { status, note: notes[inspection.id] }), status === 'DONE' ? '巡查已完成。' : '巡查异常已登记并保留说明。');
  return <div className="space-y-3">{inspections.map((inspection: ServiceInspection) => <article key={inspection.id} className="rounded-2xl border border-gray-100 bg-white p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-black text-gray-800">{inspectionLabels[inspection.kind]} · {areas.find((area: ServiceArea) => area.id === inspection.areaId)?.name || inspection.areaId}</p><p className="mt-1 text-[11px] text-gray-500">截止 {toLocalDateTimeString(inspection.dueAt)}{inspection.bookingId ? ` · ${bookings.find((booking: Booking) => booking.id === inspection.bookingId)?.purpose || inspection.bookingId}` : ''}</p>{inspection.completedAt && <p className="mt-1 text-[11px] text-gray-500">{toLocalDateTimeString(inspection.completedAt)} · {users.find((user: User) => user.id === inspection.completedBy)?.name || inspection.completedBy}{inspection.note ? ` · ${inspection.note}` : ''}</p>}</div><span className={`self-start rounded-lg px-2 py-1 text-[11px] font-black ${inspection.status === 'EXCEPTION' ? 'bg-rose-50 text-rose-600' : inspection.status === 'DONE' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{statusLabels[inspection.status]}</span></div>{inspection.status === 'PENDING' && <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input aria-label={`巡查说明 ${inspection.id}`} value={notes[inspection.id] || ''} onChange={event => setNotes(prev => ({ ...prev, [inspection.id]: event.target.value }))} placeholder="巡查说明；登记异常时必填" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none"/><div className="flex gap-2"><button disabled={busy} onClick={() => void update(inspection, 'DONE')} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white">完成</button><button disabled={busy || !notes[inspection.id]?.trim()} onClick={() => void update(inspection, 'EXCEPTION')} className="rounded-xl bg-rose-50 px-4 py-2 text-xs font-black text-rose-600 disabled:opacity-40">异常</button></div></div>}</article>)}{!inspections.length && <p className="rounded-3xl border border-dashed bg-white py-20 text-center text-xs font-bold text-gray-500">暂无巡查任务，Worker 将按会议计划自动生成。</p>}</div>;
}

function AreasPanel({ users, resources, areas, shifts, busy, run, apiRequest }: any) {
  const emptyArea = { name: '', campus: '', building: '', resourceIds: [] as string[] };
  const [editingId, setEditingId] = useState('');
  const [area, setArea] = useState<any>(emptyArea);
  const [shift, setShift] = useState({ areaId: areas[0]?.id || '', assigneeId: '', startsAt: '', endsAt: '' });
  const editArea = (item?: ServiceArea) => { setEditingId(item?.id || ''); setArea(item ? { name: item.name, campus: item.campus || '', building: item.building || '', resourceIds: item.resourceIds } : emptyArea); };
  const eligibleUsers = users.filter((user: User) => user.role.some(role => ['SERVICE_COORDINATOR', 'FRONT_DESK', 'SYSTEM_ADMIN'].includes(role)));
  return <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
    <section className="rounded-3xl border border-gray-100 bg-white p-5"><div className="flex items-center justify-between"><h4 className="text-sm font-black text-gray-800">责任区维护</h4><button onClick={() => editArea()} className="flex items-center gap-1 text-xs font-black text-indigo-600"><Plus size={14}/>新增</button></div><div className="mt-4 flex flex-wrap gap-2">{areas.map((item: ServiceArea) => <button key={item.id} onClick={() => editArea(item)} className={`rounded-xl px-3 py-2 text-xs font-bold ${editingId === item.id ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-600'}`}><MapPin size={12} className="mr-1 inline"/>{item.name} · {item.resourceIds.length} 间</button>)}</div><div className="mt-5 space-y-3"><label className="block text-[11px] font-black text-gray-500">责任区名称<input aria-label="责任区名称" value={area.name} onChange={event => setArea((prev: any) => ({ ...prev, name: event.target.value }))} className={inputClass}/></label><div className="grid grid-cols-2 gap-2"><label className="text-[11px] font-black text-gray-500">校区<input aria-label="责任区校区" value={area.campus} onChange={event => setArea((prev: any) => ({ ...prev, campus: event.target.value }))} className={inputClass}/></label><label className="text-[11px] font-black text-gray-500">楼栋<select aria-label="责任区楼栋" value={area.building} onChange={event => setArea((prev: any) => ({ ...prev, building: event.target.value }))} className={inputClass}><option value="">不限</option><option value="MAIN">主楼</option><option value="ANNEX">配楼</option></select></label></div><div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-gray-50 p-3">{resources.filter((resource: Resource) => resource.type === 'ROOM').map((resource: Resource) => <label key={resource.id} className="flex items-center gap-2 rounded-lg bg-white p-2 text-xs font-bold text-gray-600"><input type="checkbox" checked={area.resourceIds.includes(resource.id)} onChange={() => setArea((prev: any) => ({ ...prev, resourceIds: prev.resourceIds.includes(resource.id) ? prev.resourceIds.filter((id: string) => id !== resource.id) : [...prev.resourceIds, resource.id] }))}/>{resource.name}<span className="ml-auto text-[10px] font-medium text-gray-500">{resource.location}</span></label>)}</div><button disabled={busy || !area.name.trim()} onClick={() => void run(() => apiRequest(editingId ? `/api/service-areas/${editingId}` : '/api/service-areas', editingId ? 'PUT' : 'POST', { ...area, campus: area.campus || undefined, building: area.building || undefined }), '责任区及资源归属已保存。')} className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-black text-white disabled:opacity-40">保存责任区</button></div></section>
    <section className="rounded-3xl border border-gray-100 bg-white p-5"><h4 className="text-sm font-black text-gray-800">班次安排</h4><div className="mt-4 space-y-3"><label className="block text-[11px] font-black text-gray-500">责任区<select aria-label="班次责任区" value={shift.areaId} onChange={event => setShift(prev => ({ ...prev, areaId: event.target.value }))} className={inputClass}>{areas.map((item: ServiceArea) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-[11px] font-black text-gray-500">值班人员<select aria-label="班次值班人员" value={shift.assigneeId} onChange={event => setShift(prev => ({ ...prev, assigneeId: event.target.value }))} className={inputClass}><option value="">请选择</option>{eligibleUsers.map((user: User) => <option key={user.id} value={user.id}>{user.name} · {user.department}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><label className="text-[11px] font-black text-gray-500">开始<input aria-label="班次开始时间" type="datetime-local" value={shift.startsAt} onChange={event => setShift(prev => ({ ...prev, startsAt: event.target.value }))} className={inputClass}/></label><label className="text-[11px] font-black text-gray-500">结束<input aria-label="班次结束时间" type="datetime-local" value={shift.endsAt} onChange={event => setShift(prev => ({ ...prev, endsAt: event.target.value }))} className={inputClass}/></label></div><button disabled={busy || !shift.areaId || !shift.assigneeId || !shift.startsAt || !shift.endsAt} onClick={() => void run(() => apiRequest('/api/service-shifts', 'POST', { ...shift, startsAt: fromInput(shift.startsAt), endsAt: fromInput(shift.endsAt) }), '值班班次已保存。')} className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-black text-white disabled:opacity-40">新增班次</button></div><div className="mt-5 max-h-72 space-y-2 overflow-y-auto">{shifts.map((item: ServiceShift) => <div key={item.id} className="rounded-xl bg-gray-50 p-3 text-xs"><p className="font-black text-gray-700">{users.find((user: User) => user.id === item.assigneeId)?.name || item.assigneeId} · {areas.find((area: ServiceArea) => area.id === item.areaId)?.name || item.areaId}</p><p className="mt-1 text-[11px] text-gray-500">{toLocalDateTimeString(item.startsAt)} — {toLocalDateTimeString(item.endsAt)}</p></div>)}{!shifts.length && <p className="py-8 text-center text-xs text-gray-500">暂无班次</p>}</div></section>
  </div>;
}

function CatalogPanel({ catalog, roles, busy, run, apiRequest }: any) {
  const blank = { type: 'OTHER', name: '', fields: [] as ServiceFieldTemplate[], responsibleRole: 'SERVICE_COORDINATOR', slaResponseMinutes: 10, heavyService: true, cancellable: true, resourceTypes: ['ROOM'], roomCategories: [] };
  const [editingId, setEditingId] = useState(catalog[0]?.id || '');
  const current = catalog.find((item: ServiceCatalogItem) => item.id === editingId);
  const [draft, setDraft] = useState<any>(current || blank);
  const select = (item?: ServiceCatalogItem) => { setEditingId(item?.id || ''); setDraft(item ? structuredClone(item) : structuredClone(blank)); };
  const updateField = (index: number, patch: any) => setDraft((prev: any) => ({ ...prev, fields: prev.fields.map((field: ServiceFieldTemplate, position: number) => position === index ? { ...field, ...patch } : field) }));
  return <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_1fr]"><aside className="space-y-2 rounded-3xl border border-gray-100 bg-white p-4"><button onClick={() => select()} className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-xs font-black text-white"><Plus size={14}/>新增目录项</button>{catalog.map((item: ServiceCatalogItem) => <button key={item.id} onClick={() => select(item)} className={`w-full rounded-xl p-3 text-left ${editingId === item.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}><span className="block text-xs font-black text-gray-800">{item.name}</span><span className="mt-1 block text-[10px] font-bold text-gray-500">{item.type} · v{item.version} · {item.slaResponseMinutes} 分钟 SLA</span></button>)}</aside><section className="rounded-3xl border border-gray-100 bg-white p-5 md:p-6"><div className="flex items-center gap-2"><Edit2 size={17} className="text-indigo-600"/><h4 className="text-sm font-black text-gray-800">{current ? `编辑 ${current.name}` : '新增服务目录'}</h4>{current && <span className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-500">保存后升级至 v{current.version + 1}，不改写历史快照</span>}</div><div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2"><label className="text-[11px] font-black text-gray-500">服务名称<input aria-label="目录服务名称" value={draft.name} onChange={event => setDraft((prev: any) => ({ ...prev, name: event.target.value }))} className={inputClass}/></label><label className="text-[11px] font-black text-gray-500">服务类型<select aria-label="目录服务类型" disabled={Boolean(current)} value={draft.type} onChange={event => setDraft((prev: any) => ({ ...prev, type: event.target.value }))} className={inputClass}>{Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label} · {value}</option>)}</select></label><label className="text-[11px] font-black text-gray-500">责任角色<select aria-label="目录责任角色" value={draft.responsibleRole} onChange={event => setDraft((prev: any) => ({ ...prev, responsibleRole: event.target.value }))} className={inputClass}>{roles.map((role: RoleDefinition) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label className="text-[11px] font-black text-gray-500">响应 SLA（分钟）<input aria-label="目录响应SLA" type="number" min="1" max="1440" value={draft.slaResponseMinutes} onChange={event => setDraft((prev: any) => ({ ...prev, slaResponseMinutes: Number(event.target.value) }))} className={inputClass}/></label></div><div className="mt-3 flex flex-wrap gap-4 rounded-2xl bg-gray-50 p-3 text-xs font-bold text-gray-600"><label><input type="checkbox" checked={draft.heavyService} onChange={event => setDraft((prev: any) => ({ ...prev, heavyService: event.target.checked }))} className="mr-2"/>重服务（120 分钟取消路径）</label><label><input type="checkbox" checked={draft.cancellable} onChange={event => setDraft((prev: any) => ({ ...prev, cancellable: event.target.checked }))} className="mr-2"/>允许未执行撤销</label><label><input type="checkbox" checked={draft.resourceTypes.includes('ROOM')} onChange={event => setDraft((prev: any) => ({ ...prev, resourceTypes: event.target.checked ? [...new Set([...prev.resourceTypes, 'ROOM'])] : prev.resourceTypes.filter((type: string) => type !== 'ROOM') }))} className="mr-2"/>会议室</label><label><input type="checkbox" checked={draft.resourceTypes.includes('DESK')} onChange={event => setDraft((prev: any) => ({ ...prev, resourceTypes: event.target.checked ? [...new Set([...prev.resourceTypes, 'DESK'])] : prev.resourceTypes.filter((type: string) => type !== 'DESK') }))} className="mr-2"/>工位</label></div><fieldset className="mt-5"><legend className="text-xs font-black text-gray-700">动态字段模板</legend><div className="mt-3 space-y-3">{draft.fields.map((field: ServiceFieldTemplate, index: number) => <div key={index} className="grid grid-cols-1 gap-2 rounded-2xl bg-gray-50 p-3 md:grid-cols-[1fr_1fr_130px_auto]"><input aria-label={`字段 ${index + 1} 键名`} value={field.key} onChange={event => updateField(index, { key: event.target.value })} placeholder="key，如 servings" className={inputClass}/><input aria-label={`字段 ${index + 1} 名称`} value={field.label} onChange={event => updateField(index, { label: event.target.value })} placeholder="字段显示名称" className={inputClass}/><select aria-label={`字段 ${index + 1} 类型`} value={field.type} onChange={event => updateField(index, { type: event.target.value })} className={inputClass}><option value="TEXT">单行文本</option><option value="TEXTAREA">多行文本</option><option value="NUMBER">数字</option><option value="SELECT">单选</option></select><button onClick={() => setDraft((prev: any) => ({ ...prev, fields: prev.fields.filter((_: any, position: number) => position !== index) }))} className="rounded-xl bg-rose-50 px-3 text-xs font-black text-rose-600">删除</button>{field.type === 'SELECT' && <input aria-label={`字段 ${index + 1} 选项`} value={(field.options || []).join('，')} onChange={event => updateField(index, { options: event.target.value.split(/[,，]/).map(value => value.trim()).filter(Boolean) })} placeholder="选项以逗号分隔" className={`${inputClass} md:col-span-3`}/>}<label className="flex items-center text-xs font-bold text-gray-600 md:col-span-4"><input type="checkbox" checked={field.required} onChange={event => updateField(index, { required: event.target.checked })} className="mr-2"/>必填字段</label></div>)}</div><button onClick={() => setDraft((prev: any) => ({ ...prev, fields: [...prev.fields, { key: `field_${prev.fields.length + 1}`, label: '新字段', type: 'TEXT', required: false }] }))} className="mt-3 rounded-xl border border-gray-200 px-4 py-2 text-xs font-black text-gray-600"><Plus size={13} className="mr-1 inline"/>添加字段</button></fieldset><button disabled={busy || !draft.name.trim() || !draft.resourceTypes.length} onClick={() => void run(() => apiRequest(current ? `/api/service-catalog/${current.id}` : '/api/service-catalog', current ? 'PUT' : 'POST', { ...draft, roomCategories: draft.roomCategories?.length ? draft.roomCategories : undefined }), current ? '目录版本已升级，既有预约仍使用原提交快照。' : '服务目录项已创建。')} className="mt-6 w-full rounded-xl bg-indigo-600 py-3 text-xs font-black text-white disabled:opacity-40">保存目录版本</button></section></div>;
}
