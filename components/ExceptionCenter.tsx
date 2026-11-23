import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, ShieldCheck } from 'lucide-react';
import type { OperationalException, RoleDefinition, User } from '../types';
import { toLocalDateTimeString } from '../utils/dateTime';
import { formatUserError } from '../utils/userErrors';
import IntegrationCenter from './IntegrationCenter';

const kindLabels = { APPROVAL_OVERDUE: '审批超时', NO_SHOW: '未签到释放', SERVICE_EXCEPTION: '服务异常', DEVICE_OFFLINE: '设备离线' };
const statusLabels = { OPEN: '待处理', ACKNOWLEDGED: '已认领', RESOLVED: '已关闭' };

export default function ExceptionCenter({ currentUser, users, roles, exceptions, apiRequest, onChanged, notify }: {
  currentUser: User;
  users: User[];
  roles: RoleDefinition[];
  exceptions: OperationalException[];
  apiRequest: (path: string, method: string, body?: any) => Promise<any>;
  onChanged: () => Promise<void>;
  notify: (title: string, content: string, type?: 'INFO' | 'SUCCESS' | 'WARNING') => void;
}) {
  const [filter, setFilter] = useState<'ACTIVE' | 'RESOLVED' | 'ALL'>('ACTIVE');
  const [selectedId, setSelectedId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [section, setSection] = useState<'BUSINESS' | 'INTEGRATIONS'>('BUSINESS');
  const visible = exceptions.filter(item => filter === 'ALL' || (filter === 'RESOLVED' ? item.status === 'RESOLVED' : item.status !== 'RESOLVED'));
  const canHandle = (item: OperationalException) => currentUser.role.includes('SYSTEM_ADMIN')
    || (item.kind === 'NO_SHOW' && currentUser.role.some(role => ['FRONT_DESK', 'APPROVAL_ADMIN'].includes(role)))
    || (item.kind !== 'DEVICE_OFFLINE' && currentUser.role.includes(item.ownerRole));
  const submit = async (item: OperationalException, action: 'ACKNOWLEDGE' | 'RESOLVE') => {
    if (busy || note.trim().length < 2) return;
    setBusy(true); setError('');
    try {
      await apiRequest(`/api/exceptions/${encodeURIComponent(item.id)}`, 'POST', { action, note });
      await onChanged();
      setSelectedId(''); setNote('');
      notify('异常记录已更新', action === 'RESOLVE' ? '复核记录已保存，异常已关闭。' : '责任人和处理说明已保存。', 'SUCCESS');
    } catch (reason: any) {
      setError(formatUserError(reason, '处理未完成，请刷新后核对异常事实。'));
    } finally { setBusy(false); }
  };
  const sectionTabs = <div role="tablist" aria-label="异常中心功能" className="flex w-fit gap-2 rounded-2xl bg-gray-100 p-1.5"><button role="tab" aria-selected={section === 'BUSINESS'} onClick={() => setSection('BUSINESS')} className={`rounded-xl px-4 py-2 text-xs font-black ${section === 'BUSINESS' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>业务异常</button>{currentUser.role.includes('SYSTEM_ADMIN') && <button role="tab" aria-selected={section === 'INTEGRATIONS'} onClick={() => setSection('INTEGRATIONS')} className={`rounded-xl px-4 py-2 text-xs font-black ${section === 'INTEGRATIONS' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>集成运维</button>}</div>;
  if (section === 'INTEGRATIONS') return <div className="space-y-6 animate-in fade-in">
    <div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">OPERATIONS / EXCEPTIONS</p><h3 className="mt-1 text-2xl font-black text-gray-800">异常中心</h3><p className="mt-2 text-sm text-gray-500">外部回调、日历、门禁事件与授权回执统一对账。</p></div>
    {sectionTabs}
    <IntegrationCenter apiRequest={apiRequest} notify={notify}/>
  </div>;
  return <div className="space-y-6 animate-in fade-in">
    {sectionTabs}
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">OPERATIONS / EXCEPTIONS</p><h3 className="mt-1 text-2xl font-black text-gray-800">异常中心</h3><p className="mt-2 text-sm text-gray-500">审批、签到、服务和设备异常统一分派；处理记录持久化到 MySQL。</p></div>
      <div role="tablist" aria-label="异常状态筛选" className="flex gap-2">{([['ACTIVE', '处理中'], ['RESOLVED', '已关闭'], ['ALL', '全部']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={`rounded-xl px-4 py-2.5 text-xs font-black ${filter === id ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-500'}`}>{label}</button>)}</div>
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-600">{error}</p>}
    {!visible.length && <div className="rounded-3xl border border-dashed bg-white py-24 text-center"><CheckCircle size={40} className="mx-auto mb-4 text-emerald-500 opacity-60"/><p className="text-sm font-bold text-gray-500">{filter === 'ACTIVE' ? '当前权限范围内没有待处理异常' : '暂无异常记录'}</p></div>}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{visible.map(item => {
      const selected = selectedId === item.id;
      return <article key={item.id} className={`rounded-3xl border bg-white p-5 ${item.status === 'RESOLVED' ? 'border-gray-100 opacity-75' : item.severity === 'CRITICAL' ? 'border-rose-200' : 'border-amber-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${item.status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{item.status === 'RESOLVED' ? <CheckCircle size={20}/> : <AlertTriangle size={20}/>}</span><div className="min-w-0"><p className="text-[10px] font-black text-gray-500">{kindLabels[item.kind]} · {item.severity === 'CRITICAL' ? '严重' : '提醒'}</p><h4 className="mt-1 break-words font-black text-gray-800">{item.title}</h4></div></div>
          <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold ${item.status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-600' : item.status === 'ACKNOWLEDGED' ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>{statusLabels[item.status]}</span>
        </div>
        <dl className="my-4 grid gap-2 rounded-2xl bg-gray-50 p-4 text-xs text-gray-500 sm:grid-cols-2">
          <div><dt className="font-black">责任角色</dt><dd className="mt-1 text-gray-700">{roles.find(role => role.id === item.ownerRole)?.name || item.ownerRole}{item.ownerId ? ` · ${users.find(user => user.id === item.ownerId)?.name || item.ownerId}` : ''}</dd></div>
          <div><dt className="font-black">发生时间</dt><dd className="mt-1 text-gray-700">{toLocalDateTimeString(item.occurredAt)}</dd></div>
          {item.dueAt && <div><dt className="font-black">处理时限</dt><dd className="mt-1 text-gray-700">{toLocalDateTimeString(item.dueAt)}</dd></div>}
          <div className="sm:col-span-2"><dt className="font-black">关闭条件</dt><dd className="mt-1 leading-relaxed text-gray-700">{item.closeCondition}</dd></div>
        </dl>
        {item.resolutionNote && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-700">{item.resolutionNote}</p>}
        {canHandle(item) && item.status !== 'RESOLVED' && <button onClick={() => { setSelectedId(selected ? '' : item.id); setNote(''); setError(''); }} aria-expanded={selected} className="w-full rounded-xl bg-gray-900 py-2.5 text-xs font-black text-white"><ShieldCheck size={14} className="mr-2 inline"/>填写处理记录</button>}
        {selected && <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <label className="block text-[11px] font-black text-gray-500">处理说明<textarea aria-label={`${item.title}处理说明`} rows={3} minLength={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-300" placeholder="说明已核实的事实、责任人动作和后续安排"/></label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button disabled={busy || note.trim().length < 2} onClick={() => void submit(item, 'ACKNOWLEDGE')} className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-xs font-black text-white disabled:opacity-40">认领并保存</button>
            {item.kind === 'NO_SHOW' && <button disabled={busy || note.trim().length < 2} onClick={() => void submit(item, 'RESOLVE')} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white disabled:opacity-40">复核完成并关闭</button>}
          </div>
          {item.kind !== 'NO_SHOW' && <p className="text-[11px] leading-relaxed text-gray-500"><Clock size={12} className="mr-1 inline"/>此类异常只能由事实恢复自动关闭，不能用手工记录掩盖。</p>}
        </div>}
        {item.history.length > 0 && <details className="mt-4 text-[11px] text-gray-500"><summary className="cursor-pointer font-bold">处理记录（{item.history.length}）</summary><ol className="mt-2 space-y-2">{item.history.map((record, index) => <li key={`${record.at}-${index}`} className="rounded-xl bg-gray-50 p-3"><p className="font-bold text-gray-700">{toLocalDateTimeString(record.at)} · {statusLabels[record.status]} · {users.find(user => user.id === record.actorId)?.name || record.actorId}</p><p className="mt-1 leading-relaxed">{record.note}</p></li>)}</ol></details>}
      </article>;
    })}</div>
  </div>;
}
