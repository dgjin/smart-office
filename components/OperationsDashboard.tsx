import React, { useId, useMemo } from 'react';
import { ArrowRight, BarChart3, CheckCircle2 } from 'lucide-react';
import type { OperationsReport, OperationsReportRow, WorkOrderStatus } from '../types';
import { toLocalDateTimeString } from '../utils/dateTime';

type BarDatum = {
  id: string;
  label: string;
  value: number;
  detail: string;
  unit: string;
  tone?: 'accent' | 'moss' | 'amber' | 'danger' | 'muted';
};

type TrendDatum = {
  date: string;
  label: string;
  bookingCount: number;
  scheduledHours: number;
  actualHours: number;
};

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const formatNumber = (value: number) => numberFormat.format(value);
const hours = (minutes: number) => Math.round(minutes / 6) / 10;
const dateKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const shortDate = (value: string) => {
  const [, month, day] = value.split('-');
  return `${Number(month)}/${Number(day)}`;
};
const truncate = (value: string, length = 12) => value.length > length ? `${value.slice(0, length - 1)}…` : value;

const serviceStatusLabels: Record<WorkOrderStatus, string> = {
  TODO: '待办', PENDING_INFO: '待补充', IN_PROGRESS: '进行中', DONE: '已完成', CANCELLED: '已取消', EXCEPTION: '异常'
};
const serviceStatusOrder: WorkOrderStatus[] = ['TODO', 'PENDING_INFO', 'IN_PROGRESS', 'DONE', 'EXCEPTION', 'CANCELLED'];
const serviceStatusTones: Record<WorkOrderStatus, BarDatum['tone']> = {
  TODO: 'amber', PENDING_INFO: 'amber', IN_PROGRESS: 'accent', DONE: 'moss', CANCELLED: 'muted', EXCEPTION: 'danger'
};

function ChartCard({ title, description, emptyMessage, hasData, chart, table }: {
  title: string;
  description: string;
  emptyMessage: string;
  hasData: boolean;
  chart: React.ReactNode;
  table: React.ReactNode;
}) {
  const id = useId();
  return <section className="report-chart-card" aria-labelledby={`${id}-title`}>
    <header className="report-chart-head">
      <h4 id={`${id}-title`}>{title}</h4>
      <p>{description}</p>
    </header>
    {hasData ? <>
      <div className="report-chart-body">{chart}</div>
      <details className="report-chart-details">
        <summary>查看图表数据</summary>
        <div className="studio-table-shell">{table}</div>
      </details>
    </> : <div className="report-chart-empty"><BarChart3 size={25}/><p>{emptyMessage}</p></div>}
  </section>;
}

function TrendChart({ data, scheduledTotal, actualTotal }: { data: TrendDatum[]; scheduledTotal: number; actualTotal: number }) {
  const id = useId();
  const width = 760;
  const height = 286;
  const margin = { top: 34, right: 24, bottom: 48, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...data.flatMap(item => [item.scheduledHours, item.actualHours]));
  const yMax = maxValue <= 5 ? Math.ceil(maxValue) : Math.ceil(maxValue / 5) * 5;
  const x = (index: number) => margin.left + (data.length === 1 ? plotWidth / 2 : index * plotWidth / (data.length - 1));
  const y = (value: number) => margin.top + plotHeight - value / yMax * plotHeight;
  const path = (key: 'scheduledHours' | 'actualHours') => data.map((item, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(item[key])}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  return <>
    <div className="report-chart-legend" aria-label="趋势图例与合计">
      <span className="is-scheduled">计划 {formatNumber(scheduledTotal)} 小时</span>
      <span className="is-actual">实际 {formatNumber(actualTotal)} 小时</span>
    </div>
    <svg className="report-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>预约计划与实际使用趋势</title>
      <desc id={`${id}-desc`}>按会议开始日期归集，实线表示计划小时，虚线表示实际使用小时。完整数值见图表数据表。</desc>
      {[0, 0.25, 0.5, 0.75, 1].map(ratio => <g key={ratio}>
        <line className="report-chart-gridline" x1={margin.left} x2={width - margin.right} y1={y(yMax * ratio)} y2={y(yMax * ratio)}/>
        <text className="report-chart-axis" x={margin.left - 10} y={y(yMax * ratio) + 4} textAnchor="end">{formatNumber(yMax * ratio)}</text>
      </g>)}
      <text className="report-chart-axis" x="12" y="18">小时</text>
      <path className="report-trend-line is-scheduled" d={path('scheduledHours')}/>
      <path className="report-trend-line is-actual" d={path('actualHours')}/>
      {data.map((item, index) => <g key={item.date}>
        <title>{`${item.date}：${item.bookingCount} 单，计划 ${formatNumber(item.scheduledHours)} 小时，实际 ${formatNumber(item.actualHours)} 小时`}</title>
        <circle className="report-trend-point is-scheduled" cx={x(index)} cy={y(item.scheduledHours)} r="3.5"/>
        <circle className="report-trend-point is-actual" cx={x(index)} cy={y(item.actualHours)} r="3.5"/>
        {(index === 0 || index === data.length - 1 || index % labelEvery === 0) && <>
          <text className="report-trend-value is-scheduled" x={x(index)} y={Math.max(14, y(item.scheduledHours) - 10)} textAnchor="middle">{formatNumber(item.scheduledHours)}</text>
          <text className="report-trend-value is-actual" x={x(index)} y={Math.min(height - 48, y(item.actualHours) + 18)} textAnchor="middle">{formatNumber(item.actualHours)}</text>
          <text className="report-chart-axis is-date" x={x(index)} y={height - 20} textAnchor="middle">{item.label}</text>
        </>}
      </g>)}
    </svg>
  </>;
}

function HorizontalBars({ data, title, description }: { data: BarDatum[]; title: string; description: string }) {
  const id = useId();
  const width = 680;
  const rowHeight = 54;
  const height = Math.max(90, data.length * rowHeight + 16);
  const labelWidth = 154;
  const valueWidth = 94;
  const barWidth = width - labelWidth - valueWidth - 24;
  const maxValue = Math.max(1, ...data.map(item => item.value));
  return <svg className="report-bar-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>{title}</title>
    <desc id={`${id}-desc`}>{description} 每行直接标注数值，完整信息见图表数据表。</desc>
    {data.map((item, index) => {
      const y = index * rowHeight + 10;
      const filledWidth = item.value > 0 ? Math.max(2, item.value / maxValue * barWidth) : 0;
      return <g key={item.id}>
        <title>{`${item.label}：${formatNumber(item.value)} ${item.unit}，${item.detail}`}</title>
        <text className="report-bar-label" x="0" y={y + 13}>{truncate(item.label)}</text>
        <text className="report-bar-detail" x="0" y={y + 31}>{truncate(item.detail, 20)}</text>
        <rect className="report-bar-track" x={labelWidth} y={y + 7} width={barWidth} height="14" rx="1"/>
        <rect className={`report-bar-fill is-${item.tone || 'accent'}`} x={labelWidth} y={y + 7} width={filledWidth} height="14" rx="1"/>
        <text className="report-bar-value" x={width} y={y + 20} textAnchor="end">{formatNumber(item.value)} {item.unit}</text>
      </g>;
    })}
  </svg>;
}

const byActivity = (a: OperationsReportRow, b: OperationsReportRow) => b.scheduledHours - a.scheduledHours || b.bookingCount - a.bookingCount || a.name.localeCompare(b.name, 'zh-CN');

export default function OperationsDashboard({ report, onShowDifferences }: { report: OperationsReport; onShowDifferences: () => void }) {
  const data = useMemo(() => {
    const trendByDate = new Map<string, TrendDatum>();
    for (const booking of report.bookings) {
      const date = dateKey(booking.startTime);
      const current = trendByDate.get(date) || { date, label: shortDate(date), bookingCount: 0, scheduledHours: 0, actualHours: 0 };
      current.bookingCount += 1;
      current.scheduledHours += booking.scheduledMinutes;
      current.actualHours += booking.actualMinutes;
      trendByDate.set(date, current);
    }
    const trend = [...trendByDate.values()].map(item => ({
      ...item,
      scheduledHours: hours(item.scheduledHours),
      actualHours: hours(item.actualHours)
    })).sort((a, b) => a.date.localeCompare(b.date));
    const resources = report.rows.filter(row => row.dimension === 'RESOURCE' && row.bookingCount > 0)
      .sort((a, b) => b.usageHours - a.usageHours || byActivity(a, b)).slice(0, 8);
    const departments = report.rows.filter(row => row.dimension === 'DEPARTMENT' && row.bookingCount > 0)
      .sort(byActivity).slice(0, 8);
    const statusCounts = new Map<WorkOrderStatus, number>();
    for (const service of report.services) statusCounts.set(service.status, (statusCounts.get(service.status) || 0) + 1);
    const pendingServices = report.services.filter(service => !['DONE', 'CANCELLED'].includes(service.status)).length;
    return {
      trend,
      resources,
      departments,
      serviceStatus: serviceStatusOrder.map(status => ({ status, count: statusCounts.get(status) || 0 })),
      noShowCount: report.bookings.filter(booking => booking.noShow).length,
      pendingServices
    };
  }, [report]);

  const resourceBars: BarDatum[] = data.resources.map(row => ({
    id: row.id, label: row.name, value: row.usageHours, unit: '小时',
    detail: `${row.bookingCount} 单 · 使用率 ${formatNumber(row.utilization)}%`, tone: 'moss'
  }));
  const departmentBars: BarDatum[] = data.departments.map(row => ({
    id: row.id, label: row.name, value: row.scheduledHours, unit: '小时',
    detail: `实际 ${formatNumber(row.actualHours)} 小时 · ${row.bookingCount} 单`, tone: 'accent'
  }));
  const serviceBars: BarDatum[] = data.serviceStatus.map(item => ({
    id: item.status, label: serviceStatusLabels[item.status], value: item.count, unit: '单',
    detail: report.services.length ? `占会务工单 ${formatNumber(item.count / report.services.length * 100)}%` : '暂无工单',
    tone: serviceStatusTones[item.status]
  }));
  const metrics = [
    ['预约数', report.overall.bookingCount, '单', '范围内预约'],
    ['计划时长', report.overall.scheduledHours, '小时', '裁剪后排期'],
    ['实际时长', report.overall.actualHours, '小时', '实际使用事实'],
    ['使用率', report.overall.utilization, '%', '每日 08:00—20:00'],
    ['签到预约', report.overall.checkedInCount, '单', '至少一人有效签到'],
    ['提前结束', report.overall.earlyEndCount, '单', '提前释放空间'],
    ['服务成本', report.overall.serviceCost, '元', '实际登记成本'],
    ['对账差异', report.differences.length, '项', '需要管理复核']
  ] as const;

  return <div className="report-dashboard" id="report-overview-panel" role="tabpanel" aria-label="管理看板">
    <section className="report-management-summary" aria-labelledby="report-management-summary-title">
      <div className="report-management-intro">
        <span>管理摘要</span>
        <h4 id="report-management-summary-title">空间利用与会务执行概览</h4>
        <p>当前范围共 {report.overall.bookingCount} 单预约，实际使用 {formatNumber(report.overall.actualHours)} 小时；{report.differences.length ? `${report.differences.length} 项对账状态需要复核。` : '预约、签到与使用记录暂未发现差异。'}</p>
      </div>
      <dl className="report-management-facts">
        <div><dt>空间调度</dt><dd>{formatNumber(report.overall.utilization)}%</dd><p>计划使用 {formatNumber(report.overall.usageHours)} 小时</p></div>
        <div><dt>审批效率</dt><dd>{formatNumber(report.overall.averageApprovalHours)}<small> 小时</small></dd><p>平均审批时长</p></div>
        <div><dt>使用规范</dt><dd>{data.noShowCount}<small> 单</small></dd><p>未签到释放</p></div>
        <div><dt>会务保障</dt><dd>{data.pendingServices}<small> 单</small></dd><p>未完成或未取消工单</p></div>
      </dl>
      <p className="report-snapshot">快照 {toLocalDateTimeString(report.generatedAt)} · 数据修订 {report.revision} · 图表与导出使用同一报表口径</p>
    </section>

    <section className="report-kpi-grid" aria-label="运营核心指标">
      {metrics.map(([label, value, unit, note]) => <div className="report-kpi" key={label}>
        <span>{label}</span><strong>{formatNumber(value)}<small>{unit}</small></strong><p>{note}</p>
      </div>)}
    </section>

    <div className="report-chart-grid">
      <div className="report-chart-wide">
        <ChartCard title="预约计划与实际使用趋势" description="按会议开始日期归集，时长沿用当前报表裁剪口径；仅展示有预约的日期。" emptyMessage="当前范围没有预约趋势数据" hasData={data.trend.length > 0}
          chart={<TrendChart data={data.trend} scheduledTotal={report.overall.scheduledHours} actualTotal={report.overall.actualHours}/>}
          table={<table><thead><tr><th>日期</th><th>预约数</th><th>计划小时</th><th>实际小时</th></tr></thead><tbody>{data.trend.map(item => <tr key={item.date}><td>{item.date}</td><td>{item.bookingCount}</td><td>{formatNumber(item.scheduledHours)}</td><td>{formatNumber(item.actualHours)}</td></tr>)}</tbody></table>}/>
      </div>
      <ChartCard title="空间使用排行" description="按资源计划使用小时排序，最多展示 8 个有预约的空间。" emptyMessage="当前范围没有空间使用数据" hasData={resourceBars.length > 0}
        chart={<HorizontalBars data={resourceBars} title="空间使用排行" description="按计划使用小时比较资源"/>}
        table={<table><thead><tr><th>空间</th><th>预约数</th><th>计划小时</th><th>实际小时</th><th>使用率</th></tr></thead><tbody>{data.resources.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.bookingCount}</td><td>{formatNumber(row.usageHours)}</td><td>{formatNumber(row.actualHours)}</td><td>{formatNumber(row.utilization)}%</td></tr>)}</tbody></table>}/>
      <ChartCard title="部门会议投入" description="比较各部门计划会议时长，并同时列出实际使用与预约数量。" emptyMessage="当前范围没有部门会议数据" hasData={departmentBars.length > 0}
        chart={<HorizontalBars data={departmentBars} title="部门会议投入" description="按计划会议小时比较部门"/>}
        table={<table><thead><tr><th>部门</th><th>预约数</th><th>计划小时</th><th>实际小时</th><th>取消率</th></tr></thead><tbody>{data.departments.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.bookingCount}</td><td>{formatNumber(row.scheduledHours)}</td><td>{formatNumber(row.actualHours)}</td><td>{formatNumber(row.cancellationRate)}%</td></tr>)}</tbody></table>}/>
      <ChartCard title="会务执行状态" description={`共 ${report.services.length} 单会务工单，实际成本 ${formatNumber(report.overall.serviceCost)} 元。`} emptyMessage="当前范围没有会务工单数据" hasData={report.services.length > 0}
        chart={<HorizontalBars data={serviceBars} title="会务执行状态" description="按工单状态统计数量"/>}
        table={<table><thead><tr><th>执行状态</th><th>工单数</th><th>占比</th></tr></thead><tbody>{data.serviceStatus.map(item => <tr key={item.status}><td>{serviceStatusLabels[item.status]}</td><td>{item.count}</td><td>{formatNumber(item.count / report.services.length * 100)}%</td></tr>)}</tbody></table>}/>
      <section className="report-attention-card" aria-labelledby="report-attention-title">
        <div className="report-attention-heading"><span>管理关注</span><h4 id="report-attention-title">优先处理执行偏差</h4><p>将需要管理介入的事项与完整对账明细直接连接。</p></div>
        <dl>
          <div><dt>对账差异</dt><dd>{report.differences.length} 项</dd></div>
          <div><dt>待确认实际使用</dt><dd>{report.bookings.filter(item => item.reconciliationStatus === '待确认实际使用').length} 项</dd></div>
          <div><dt>事实缺口或不一致</dt><dd>{report.bookings.filter(item => ['事实不一致', '使用事实缺口', '签到事实缺口'].includes(item.reconciliationStatus)).length} 项</dd></div>
          <div><dt>异常会务工单</dt><dd>{report.services.filter(item => item.status === 'EXCEPTION').length} 单</dd></div>
        </dl>
        {report.differences.length ? <button type="button" onClick={onShowDifferences}>查看对账明细<ArrowRight size={15}/></button> : <p className="report-attention-clear"><CheckCircle2 size={16}/>当前范围无需额外复核</p>}
      </section>
    </div>
  </div>;
}
