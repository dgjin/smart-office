import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import type { Booking, OperationsReport, OperationsReportDimension } from '../types';
import { formatDate, toLocalDateTimeString } from '../utils/dateTime';
import { BOOKING_DISPLAY_STATUS_LABELS } from '../utils/bookingRules';
import { calendarReportRange, localDateInputValue } from '../utils/reports';
import OperationsDashboard from './OperationsDashboard';

type Notify = (title: string, content: string, type?: 'INFO' | 'SUCCESS' | 'WARNING') => void;
type RangeId = 'DAY' | 'WEEK' | 'MONTH' | '7' | '30' | '90' | 'ALL';

const dimensionLabels: Record<OperationsReportDimension, string> = {
  OVERALL: '整体', RESOURCE: '资源', BUILDING_FLOOR: '楼栋楼层', RESOURCE_TYPE: '资源类型', ROOM_CATEGORY: '会议室类型',
  TIME_SLOT: '时段', DEPARTMENT: '部门', SERVICE: '服务', USAGE: '实际使用'
};

export default function OperationsReports({ bookings, notify }: { bookings: Booking[]; notify: Notify }) {
  const [rangeId, setRangeId] = useState<RangeId>('MONTH');
  const [anchorDate, setAnchorDate] = useState(() => localDateInputValue(new Date()));
  const [dimension, setDimension] = useState<'ALL' | OperationsReportDimension>('ALL');
  const [view, setView] = useState<'OVERVIEW' | 'DETAIL'>('OVERVIEW');
  const [report, setReport] = useState<OperationsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | ''>('');
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const range = useMemo(() => {
    if (rangeId === 'DAY' || rangeId === 'WEEK' || rangeId === 'MONTH') return calendarReportRange(rangeId, anchorDate);
    const now = Date.now();
    const bookingEnds = bookings.map(booking => Date.parse(booking.endTime)).filter(Number.isFinite);
    const end = new Date(rangeId === 'ALL' && bookingEnds.length ? Math.max(now, ...bookingEnds) : now);
    const starts = bookings.map(booking => Date.parse(booking.startTime)).filter(Number.isFinite);
    const start = new Date(rangeId === 'ALL' && starts.length ? Math.min(...starts) : end.getTime() - (Number(rangeId === 'ALL' ? 30 : Number(rangeId)) - 1) * 86400000);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [bookings, rangeId, anchorDate]);
  const load = async () => {
    const requestId = ++requestRef.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/reports?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '报表读取失败。');
      if (requestId === requestRef.current) setReport(data);
    } catch (reason: any) {
      if (requestId === requestRef.current) setError(reason?.message || '报表读取失败，请稍后重试。');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [range.start, range.end]);
  const download = async (format: 'csv' | 'xlsx') => {
    if (exporting || !report) return;
    setExporting(format); setError('');
    try {
      const response = await fetch(`/api/reports/export?format=${format}&revision=${report.revision}&start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 409 && data.error === 'REPORT_SNAPSHOT_CHANGED') {
          await load();
          setError('报表数据已更新，已刷新到最新快照，请重新导出。');
          return;
        }
        throw new Error(data.error || '导出失败。');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `运营报表_${formatDate(new Date(range.start))}_${formatDate(new Date(range.end))}.${format}`;
      document.body.appendChild(link);
      link.click(); link.remove(); URL.revokeObjectURL(url);
      notify('报表已导出', `${format.toUpperCase()} 已按当前权限和时间范围生成。`, 'SUCCESS');
    } catch (reason: any) {
      setError(reason?.message || '导出失败，请稍后重试。');
    } finally { setExporting(''); }
  };
  const rows = report?.rows.filter(row => dimension === 'ALL' || row.dimension === dimension) || [];
  const changeViewWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextView = event.key === 'Home' ? 'OVERVIEW' : event.key === 'End' ? 'DETAIL' : view === 'OVERVIEW' ? 'DETAIL' : 'OVERVIEW';
    setView(nextView);
    document.getElementById(nextView === 'OVERVIEW' ? 'report-overview-tab' : 'report-detail-tab')?.focus();
  };
  return <div className="space-y-6 animate-in fade-in" aria-busy={loading}>
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="studio-eyebrow">运营分析 · 管理视角</p><h3 className="mt-1 text-2xl font-black text-gray-800">利用率与审批效率</h3><p className="mt-2 text-sm text-gray-500">{report ? `${formatDate(new Date(report.start))} 至 ${formatDate(new Date(report.end))}` : '正在读取服务端快照'} · 计划、签到、实际使用与服务分别对账</p></div>
      <div className="report-toolbar flex flex-wrap gap-2">
        <select aria-label="报表时间范围" value={rangeId} onChange={event => setRangeId(event.target.value as RangeId)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs font-bold"><option value="DAY">自然日</option><option value="WEEK">自然周（周一起）</option><option value="MONTH">自然月</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="ALL">全部数据</option></select>
        {(rangeId === 'DAY' || rangeId === 'WEEK' || rangeId === 'MONTH') && <input aria-label="报表基准日期" type="date" value={anchorDate} onChange={event => { if (event.target.value) setAnchorDate(event.target.value); }} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs font-bold text-gray-700"/>}
        <button onClick={() => void load()} disabled={loading} aria-label="刷新报表" className="rounded-xl border border-gray-200 bg-white px-3 text-gray-600 disabled:opacity-40"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/></button>
        <button onClick={() => void download('csv')} disabled={!report || Boolean(exporting)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs font-black text-gray-700 disabled:opacity-40"><Download size={15} className="mr-2 inline"/>{exporting === 'csv' ? '导出中' : '导出 CSV'}</button>
        <button onClick={() => void download('xlsx')} disabled={!report || Boolean(exporting)} className="rounded-xl bg-indigo-600 px-4 py-3 text-xs font-black text-white disabled:opacity-40"><FileSpreadsheet size={15} className="mr-2 inline"/>{exporting === 'xlsx' ? '导出中' : '导出 XLSX'}</button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-600">{error}</p>}
    <div className="report-view-tabs" role="tablist" aria-label="运营报表视图">
      <button id="report-overview-tab" type="button" role="tab" aria-selected={view === 'OVERVIEW'} aria-controls="report-overview-panel" tabIndex={view === 'OVERVIEW' ? 0 : -1} onClick={() => setView('OVERVIEW')} onKeyDown={changeViewWithKeyboard}>管理看板</button>
      <button id="report-detail-tab" type="button" role="tab" aria-selected={view === 'DETAIL'} aria-controls="report-detail-panel" tabIndex={view === 'DETAIL' ? 0 : -1} onClick={() => setView('DETAIL')} onKeyDown={changeViewWithKeyboard}>明细与对账</button>
    </div>
    {!report && loading && <div className="rounded-3xl border border-gray-100 bg-white py-24 text-center text-sm font-bold text-gray-500">正在按权限生成对账快照…</div>}
    {report && (view === 'OVERVIEW' ? <OperationsDashboard report={report} onShowDifferences={() => setView('DETAIL')}/> : <div className="report-details space-y-6" id="report-detail-panel" role="tabpanel" aria-label="明细与对账">
      <section className="space-y-4" aria-labelledby="report-dimensions-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h4 id="report-dimensions-title" className="font-black text-gray-800">多维统计</h4><p className="mt-1 text-xs text-gray-500">使用率按每日 08:00—20:00 可预约容量计算；服务行按工单类型统计。</p></div><select aria-label="报表维度" value={dimension} onChange={event => setDimension(event.target.value as typeof dimension)} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold"><option value="ALL">全部维度</option>{Object.entries(dimensionLabels).filter(([id]) => id !== 'OVERALL').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
        <div className="studio-table-shell">
          <table className="w-full min-w-[1180px] text-left">
            <thead><tr className="bg-gray-50 text-[11px] font-black uppercase text-gray-500">{['维度', '名称', '预约数', '计划小时', '实际小时', '使用小时', '使用率', '取消率', 'No-show率', '签到预约', '提前结束', '服务工单', '服务成本'].map(label => <th key={label} className="px-4 py-4">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">{rows.map(row => <tr key={`${row.dimension}-${row.id}`} className="text-xs text-gray-600"><td className="px-4 py-4"><span className="rounded-lg bg-indigo-50 px-2 py-1 font-bold text-indigo-600">{dimensionLabels[row.dimension]}</span></td><td className="px-4 py-4 font-black text-gray-800">{row.name}</td><td className="px-4 py-4">{row.bookingCount}</td><td className="px-4 py-4">{row.scheduledHours}</td><td className="px-4 py-4">{row.actualHours}</td><td className="px-4 py-4">{row.usageHours}</td><td className="px-4 py-4 font-bold">{row.utilization}%</td><td className="px-4 py-4">{row.cancellationRate}%</td><td className="px-4 py-4">{row.noShowRate}%</td><td className="px-4 py-4">{row.checkedInCount}</td><td className="px-4 py-4">{row.earlyEndCount}</td><td className="px-4 py-4">{row.serviceOrderCount}</td><td className="px-4 py-4">¥{row.serviceCost}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="space-y-4" aria-labelledby="report-supplies-title">
        <div><h4 id="report-supplies-title" className="font-black text-gray-800">会务备料量与执行状态</h4><p className="mt-1 text-xs text-gray-500">仅按工单冻结目录快照中的数值字段汇总，不使用当前目录回填；不同单位、目录版本和会议时段分行，成本仍在多维统计与服务明细中单独对账。</p></div>
        {!report.supplies.length ? <div className="rounded-3xl border border-dashed bg-white py-12 text-center text-sm font-bold text-gray-500">当前范围没有可汇总的结构化备料需求</div> : <div className="studio-table-shell">
          <table className="w-full min-w-[1280px] text-left">
            <thead><tr className="bg-gray-50 text-[11px] font-black text-gray-500">{['服务 / 目录版本', '数量字段', '时段', '需求量', '工单', '待办', '待补充', '进行中', '已完成', '已取消', '异常'].map(label => <th key={label} className="px-4 py-4">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">{report.supplies.map(row => <tr key={`${row.catalogItemId}-${row.catalogVersion}-${row.quantityField}-${row.unit}-${row.timeSlot}`} className="text-xs text-gray-600"><td className="px-4 py-4"><p className="font-black text-gray-800">{row.serviceName}</p><p className="mt-1 text-[10px] text-gray-500">{row.catalogItemId} · v{row.catalogVersion}</p></td><td className="px-4 py-4">{row.quantityLabel}<span className="ml-1 text-gray-400">{row.quantityField}</span></td><td className="whitespace-nowrap px-4 py-4">{row.timeSlot}</td><td className="px-4 py-4 font-black text-indigo-700">{row.quantity} {row.unit}</td><td className="px-4 py-4">{row.orderCount}</td><td className="px-4 py-4">{row.todoCount}</td><td className="px-4 py-4">{row.pendingInfoCount}</td><td className="px-4 py-4">{row.inProgressCount}</td><td className="px-4 py-4 text-emerald-700">{row.doneCount}</td><td className="px-4 py-4">{row.cancelledCount}</td><td className="px-4 py-4 text-amber-700">{row.exceptionCount}</td></tr>)}</tbody>
          </table>
        </div>}
      </section>
      <section className="space-y-4" aria-labelledby="report-differences-title">
        <div><h4 id="report-differences-title" className="font-black text-gray-800">对账差异与使用状态</h4><p className="mt-1 text-xs text-gray-500">提前结束、待确认使用和释放也属于需复核状态；完整明细包含在 XLSX 的预约对账、签到明细和服务明细中。</p></div>
        {!report.differences.length ? <div className="rounded-3xl border border-dashed bg-white py-16 text-center"><CheckCircle size={32} className="mx-auto mb-3 text-emerald-500"/><p className="text-sm font-bold text-gray-500">当前范围没有对账差异</p></div> : <div className="studio-table-shell">
          <table className="w-full min-w-[1150px] text-left">
            <thead><tr className="bg-gray-50 text-[11px] font-black text-gray-500">{['预约状态', '对账状态', '会议', '资源 / 部门', '计划时间', '签到', '实际分钟', '提前结束', '服务', '对账说明'].map(label => <th key={label} className="px-4 py-4">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">{report.differences.slice(0, 200).map(row => <tr key={row.id} className="align-top text-xs text-gray-600"><td className="whitespace-nowrap px-4 py-4 font-bold text-gray-700">{BOOKING_DISPLAY_STATUS_LABELS[row.displayStatus]}</td><td className="px-4 py-4"><span className="inline-flex items-center rounded-lg bg-amber-50 px-2 py-1 font-bold text-amber-700"><AlertTriangle size={12} className="mr-1"/>{row.reconciliationStatus}</span></td><td className="max-w-56 px-4 py-4"><p className="break-words font-black text-gray-800">{row.purpose}</p><p className="mt-1 text-[10px] text-gray-500">{row.id}</p></td><td className="px-4 py-4">{row.resource}<br/><span className="text-gray-500">{row.department}</span></td><td className="whitespace-nowrap px-4 py-4">{toLocalDateTimeString(row.startTime)}</td><td className="px-4 py-4">{row.checkInCount} 人</td><td className="px-4 py-4">{row.actualMinutes}</td><td className="px-4 py-4">{row.earlyEndMinutes} 分钟</td><td className="px-4 py-4">{row.serviceOrderCount} 单 · ¥{row.serviceCost}</td><td className="max-w-72 px-4 py-4 leading-relaxed">{row.reconciliationNote}</td></tr>)}</tbody>
          </table>
          {report.differences.length > 200 && <p className="border-t border-gray-100 px-4 py-3 text-xs font-bold text-gray-500">页面仅显示前 200 项，XLSX 包含全部 {report.differences.length} 项。</p>}
        </div>}
      </section>
    </div>)}
  </div>;
}
