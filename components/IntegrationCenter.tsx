import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { toLocalDateTimeString } from '../utils/dateTime';

type IntegrationEvent = {
  eventKey: string;
  eventType: 'CALENDAR_SYNC' | 'ACCESS_CONTROL';
  bookingId: string;
  scheduleVersion: number;
  operation: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  lastError?: string;
  delivery?: { outcome: string; reason?: string; httpStatus?: number; processedAt: string };
};

type IntegrationData = {
  summary: { pending: number; failed: number; stale: number; accessPendingAcknowledgement: number };
  events: IntegrationEvent[];
  callbacks: Array<{ id: string; eventId: string; bookingId: string; decision: string; status: string; errorCode?: string; receivedAt: string }>;
  compensations: Array<{ id: string; eventKey: string; note: string; createdAt: string }>;
  accessFacts: Array<{ id: string; bookingId: string; scheduleVersion: number; userId: string; status: string; grantAcknowledgedAt?: string; revokedAt?: string; revocationAcknowledgedAt?: string }>;
};

const statusText: Record<string, string> = { PENDING: '待处理', RUNNING: '处理中', DONE: '已处理', FAILED: '死信' };
const outcomeText: Record<string, string> = { DELIVERED: '供应商已接收', SKIPPED: '适配器未启用', STALE: '状态变化已跳过', FAILED: '投递失败' };

export default function IntegrationCenter({ apiRequest, notify }: {
  apiRequest: (path: string, method: string, body?: any) => Promise<any>;
  notify: (title: string, content: string, type?: 'INFO' | 'SUCCESS' | 'WARNING') => void;
}) {
  const [data, setData] = useState<IntegrationData | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [compensationEvent, setCompensationEvent] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await apiRequest('/api/integrations', 'GET'));
      setError('');
    } catch (reason: any) {
      setError(reason?.message || '集成运维数据加载失败');
    }
  }, [apiRequest]);
  useEffect(() => { void load(); }, [load]);

  const reconcile = async () => {
    setBusy('reconcile'); setError('');
    try {
      const result = await apiRequest('/api/integrations/reconcile', 'POST', {});
      notify('对账已完成', `已核对 ${result.checkedBookings} 条有效预约，缺失事件按原幂等键补齐。`, 'SUCCESS');
      await load();
    } catch (reason: any) { setError(reason?.message || '对账未完成'); }
    finally { setBusy(''); }
  };
  const replay = async (eventKey: string) => {
    setBusy(eventKey); setError('');
    try {
      await apiRequest('/api/integrations/replay', 'POST', { eventKey });
      notify('已加入安全重放队列', '保留原事件键，处理前会再次核对预约与人员状态。', 'SUCCESS');
      await load();
    } catch (reason: any) { setError(reason?.message || '事件当前不可重放'); }
    finally { setBusy(''); }
  };
  const compensate = async () => {
    if (!compensationEvent || note.trim().length < 2) return;
    setBusy(compensationEvent); setError('');
    try {
      await apiRequest('/api/integrations/compensations', 'POST', { eventKey: compensationEvent, note });
      notify('人工补偿记录已保存', '仅记录线下处理事实，不伪造供应商回执或修改授权事实。', 'SUCCESS');
      setCompensationEvent(''); setNote('');
      await load();
    } catch (reason: any) { setError(reason?.message || '补偿记录未保存'); }
    finally { setBusy(''); }
  };

  return <section aria-label="集成运维" className="space-y-5">
    <div className="flex flex-col gap-3 rounded-3xl border border-gray-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h4 className="font-black text-gray-800">外部事件对账</h4><p className="mt-1 text-xs leading-relaxed text-gray-500">只重放已有死信并保留原幂等键；过期授权即使重放也会跳过。</p></div>
      <div className="flex gap-2"><button onClick={() => void load()} className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-black text-gray-600"><RefreshCw size={14} className="mr-2 inline"/>刷新</button><button disabled={busy === 'reconcile'} onClick={() => void reconcile()} className="rounded-xl bg-gray-900 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">核对有效预约</button></div>
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-600">{error}</p>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      ['待处理', data?.summary.pending || 0], ['死信', data?.summary.failed || 0], ['过期跳过', data?.summary.stale || 0], ['授权待回执', data?.summary.accessPendingAcknowledgement || 0]
    ].map(([label, value]) => <div key={label} className="rounded-2xl border border-gray-100 bg-white p-4"><p className="text-[11px] font-bold text-gray-500">{label}</p><p className="mt-2 text-2xl font-black text-gray-800">{value}</p></div>)}</div>
    {!data?.events.length && <div className="rounded-3xl border border-dashed bg-white py-16 text-center"><CheckCircle size={36} className="mx-auto mb-3 text-emerald-500 opacity-60"/><p className="text-sm font-bold text-gray-500">暂无日历或门禁外部事件</p></div>}
    <div className="space-y-3">{data?.events.map(event => <article key={event.eventKey} className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-wide text-gray-400">{event.eventType === 'CALENDAR_SYNC' ? '企业日历' : '门禁授权'} · {event.operation} · v{event.scheduleVersion}</p><h5 className="mt-1 break-all text-sm font-black text-gray-800">{event.eventKey}</h5><p className="mt-2 text-xs text-gray-500">预约 {event.bookingId} · 尝试 {event.attempts}/{event.maxAttempts} · {toLocalDateTimeString(event.createdAt)}</p></div>
        <div className="flex shrink-0 flex-wrap items-center gap-2"><span className={`rounded-lg px-2.5 py-1 text-[11px] font-black ${event.status === 'FAILED' ? 'bg-rose-50 text-rose-600' : event.status === 'DONE' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{statusText[event.status] || event.status}</span>{event.delivery && <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">{outcomeText[event.delivery.outcome] || event.delivery.outcome}</span>}{event.status === 'FAILED' && <button disabled={busy === event.eventKey} onClick={() => void replay(event.eventKey)} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"><RotateCcw size={13} className="mr-1 inline"/>安全重放</button>}<button onClick={() => { setCompensationEvent(compensationEvent === event.eventKey ? '' : event.eventKey); setNote(''); }} aria-expanded={compensationEvent === event.eventKey} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-black text-gray-600">补偿记录</button></div>
      </div>
      {event.lastError && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-[11px] font-bold text-rose-600"><AlertTriangle size={13} className="mr-1 inline"/>{event.lastError}</p>}
      {compensationEvent === event.eventKey && <div className="mt-4 border-t border-gray-100 pt-4"><label className="text-[11px] font-black text-gray-500">线下核实与处理说明<textarea aria-label={`${event.eventKey}补偿说明`} rows={2} maxLength={1000} value={note} onChange={input => setNote(input.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-indigo-300" placeholder="记录实际处理人、时间和结果；不会改写供应商回执"/></label><button disabled={busy === event.eventKey || note.trim().length < 2} onClick={() => void compensate()} className="mt-2 rounded-xl bg-gray-900 px-4 py-2 text-xs font-black text-white disabled:opacity-40">保存补偿记录</button></div>}
    </article>)}</div>
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-3xl border border-gray-200 bg-white p-5"><h4 className="font-black text-gray-800"><ShieldCheck size={17} className="mr-2 inline text-indigo-600"/>门禁授权事实</h4><p className="mt-1 text-[11px] text-gray-500">无事实或待回执均不代表可通行；本地撤销与供应商回执分别记录。</p><div className="mt-4 max-h-80 space-y-2 overflow-auto">{data?.accessFacts.map(fact => <div key={fact.id} className="rounded-xl bg-gray-50 p-3 text-xs"><p className="font-black text-gray-700">{fact.bookingId} · v{fact.scheduleVersion} · {fact.userId}</p><p className="mt-1 text-gray-500">{fact.status}{fact.grantAcknowledgedAt ? ' · 授权已回执' : ''}{fact.revokedAt ? ' · 本地已撤销' : ''}{fact.revocationAcknowledgedAt ? ' · 撤销已回执' : ''}</p></div>)}</div></section>
      <section className="rounded-3xl border border-gray-200 bg-white p-5"><h4 className="font-black text-gray-800">OA 回调与补偿</h4><div className="mt-4 max-h-80 space-y-2 overflow-auto">{data?.callbacks.map(callback => <div key={callback.id} className="rounded-xl bg-gray-50 p-3 text-xs"><p className="font-black text-gray-700">{callback.eventId} · {callback.decision} · {callback.status}</p><p className="mt-1 text-gray-500">{callback.bookingId} · {toLocalDateTimeString(callback.receivedAt)}{callback.errorCode ? ` · ${callback.errorCode}` : ''}</p></div>)}{data?.compensations.map(item => <div key={item.id} className="rounded-xl bg-indigo-50 p-3 text-xs"><p className="break-all font-black text-indigo-700">{item.eventKey}</p><p className="mt-1 leading-relaxed text-gray-600">{item.note}</p></div>)}</div></section>
    </div>
  </section>;
}
