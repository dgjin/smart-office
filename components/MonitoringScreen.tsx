import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Building2, CheckCircle2, CircleDashed, Clock3, DoorOpen, MessageSquare, Radio, RefreshCw, Search, UsersRound, Wrench } from 'lucide-react';
import type { MeetingRoomMonitoringItem, MeetingRoomMonitoringStatus, MonitoringSnapshot, OfficeMonitoringItem, OfficeMonitoringStatus } from '../types';
import { toLocalTimeString } from '../utils/dateTime';

type ConnectionState = 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'OFFLINE';
type RoomFilter = 'ALL' | 'OCCUPIED' | MeetingRoomMonitoringStatus;
type OfficeFilter = 'ALL' | OfficeMonitoringStatus;

const roomStatusLabels: Record<MeetingRoomMonitoringStatus, string> = {
  IN_USE: '已签到使用中', RESERVED: '预约占用', IDLE: '当前空闲', MAINTENANCE: '维护中', PENDING: '待开放'
};
const officeStatusLabels: Record<OfficeMonitoringStatus, string> = {
  ASSIGNED: '已分配', VACANT: '空置', UNREGISTERED: '未登记', MAINTENANCE: '维护中'
};
const connectionLabels: Record<ConnectionState, string> = {
  CONNECTING: '正在建立实时连接', LIVE: '实时推送已连接', RECONNECTING: '连接中断，正在自动重连', OFFLINE: '实时连接已停止'
};

function Metric({ label, value, detail, icon: Icon, tone = '' }: { label: string; value: number; detail: string; icon: React.ElementType; tone?: string }) {
  return <div className={`monitoring-metric ${tone}`}>
    <div className="monitoring-metric-label"><Icon size={16} aria-hidden="true" /><span>{label}</span></div>
    <strong>{value}</strong><p>{detail}</p>
  </div>;
}

function MeetingRoomCard({ room }: { room: MeetingRoomMonitoringItem; key?: string }) {
  return <article className="monitoring-room-card" data-status={room.status}>
    <div className="monitoring-card-head"><div><p>{room.location}</p><h4>{room.name}</h4></div><span className="monitoring-status-badge"><i aria-hidden="true" />{roomStatusLabels[room.status]}</span></div>
    <div className="monitoring-room-body">
      {room.currentBooking ? <>
        <strong>{room.currentBooking.purpose}</strong>
        <p><Clock3 size={13} aria-hidden="true" />{toLocalTimeString(room.currentBooking.startTime)} — {toLocalTimeString(room.currentBooking.endTime)}</p>
        <span>{room.currentBooking.checkedIn ? `已签到${room.currentBooking.checkInTime ? ` · ${toLocalTimeString(room.currentBooking.checkInTime)}` : ''}` : '有效预约进行中，尚未登记签到'}</span>
      </> : room.status === 'IDLE' ? <><strong>现在可以安排会议</strong><p>{room.capacity ? `可容纳 ${room.capacity} 人` : '容量以资源台账为准'}</p></> : <><strong>{roomStatusLabels[room.status]}</strong><p>当前状态由空间资源台账维护</p></>}
    </div>
    <footer>{room.nextBooking ? `下一场 ${toLocalTimeString(room.nextBooking.startTime)} — ${toLocalTimeString(room.nextBooking.endTime)}` : '暂无后续已核准安排'}</footer>
  </article>;
}

function OfficeRow({ office }: { office: OfficeMonitoringItem; key?: string }) {
  return <tr>
    <td><strong>{office.name}</strong><span>{office.buildingName} {office.floorNo}层 · {office.roomNumber}</span></td>
    <td>{office.department || '—'}</td><td>{office.person || '—'}</td>
    <td><span className="monitoring-office-status" data-status={office.status}>{officeStatusLabels[office.status]}</span></td>
  </tr>;
}

export default function MonitoringScreen({ onOpenAssistant }: { onOpenAssistant: () => void }) {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('CONNECTING');
  const [connectionMessage, setConnectionMessage] = useState('正在建立实时连接');
  const [retryKey, setRetryKey] = useState(0);
  const [roomFilter, setRoomFilter] = useState<RoomFilter>('ALL');
  const [officeFilter, setOfficeFilter] = useState<OfficeFilter>('ALL');
  const [building, setBuilding] = useState('ALL');
  const [floor, setFloor] = useState('ALL');
  const [query, setQuery] = useState('');
  const [officeLimit, setOfficeLimit] = useState(40);

  useEffect(() => {
    let disposed = false;
    setConnection('CONNECTING');
    setConnectionMessage('正在建立实时连接');
    const events = new EventSource('/api/monitoring/events');
    const onSnapshot = (event: Event) => {
      if (disposed) return;
      setSnapshot(JSON.parse((event as MessageEvent).data) as MonitoringSnapshot);
      setConnection('LIVE');
      setConnectionMessage('实时推送已连接');
    };
    const onError = (event: Event) => {
      if (disposed) return;
      let message: { error?: string; message?: string } | null = null;
      try { message = (event as MessageEvent).data ? JSON.parse((event as MessageEvent).data) : null; } catch { return; }
      if (message?.error === 'SESSION_EXPIRED') {
        setConnection('OFFLINE');
        setConnectionMessage('登录会话已失效，请重新登录');
        events.close();
      } else setConnectionMessage(message?.message || '监控数据暂时不可用，正在自动重试');
    };
    events.addEventListener('snapshot', onSnapshot);
    events.addEventListener('error', onError);
    events.onopen = () => { if (!disposed) setConnectionMessage('实时通道已连接，正在接收最新快照'); };
    events.onerror = () => {
      if (disposed) return;
      setConnection(events.readyState === EventSource.CLOSED ? 'OFFLINE' : 'RECONNECTING');
    };
    return () => { disposed = true; events.close(); };
  }, [retryKey]);

  const roomCounts = useMemo(() => Object.fromEntries(Object.keys(roomStatusLabels).map(status => [status, snapshot?.meetingRooms.filter(room => room.status === status).length || 0])) as Record<MeetingRoomMonitoringStatus, number>, [snapshot]);
  const officeCounts = useMemo(() => Object.fromEntries(Object.keys(officeStatusLabels).map(status => [status, snapshot?.offices.filter(office => office.status === status).length || 0])) as Record<OfficeMonitoringStatus, number>, [snapshot]);
  const filteredRooms = useMemo(() => snapshot?.meetingRooms.filter(room => roomFilter === 'ALL' || (roomFilter === 'OCCUPIED' ? ['IN_USE', 'RESERVED'].includes(room.status) : room.status === roomFilter)) || [], [snapshot, roomFilter]);
  const floors = useMemo(() => {
    const values: number[] = snapshot?.offices.filter(office => building === 'ALL' || office.buildingId === building).map(office => office.floorNo) || [];
    return [...new Set(values)].sort((a, b) => a - b);
  }, [snapshot, building]);
  const filteredOffices = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return snapshot?.offices.filter(office => (building === 'ALL' || office.buildingId === building)
      && (floor === 'ALL' || office.floorNo === Number(floor)) && (officeFilter === 'ALL' || office.status === officeFilter)
      && (!normalized || [office.name, office.roomNumber, office.department, office.person].some(value => value.toLowerCase().includes(normalized)))) || [];
  }, [snapshot, building, floor, officeFilter, query]);
  const buildings = useMemo(() => [...new Map((snapshot?.offices || []).map(office => [office.buildingId, office.buildingName])).entries()], [snapshot]);

  return <div className="monitoring-screen animate-in fade-in">
    <header className="monitoring-hero">
      <div><p className="studio-panel-kicker">LIVE OPERATIONS / 实时空间运行</p><h3>会议与办公空间监控</h3><p>会议室跟随预约、签到、释放与维护变更即时更新；办公室呈现当前分配台账。</p></div>
      <div className="monitoring-connection" data-state={connection}>
        <Radio size={17} aria-hidden="true" /><div><span role="status" aria-live="polite" aria-atomic="true">{connectionLabels[connection]}</span><small>{snapshot ? `最近更新 ${toLocalTimeString(snapshot.generatedAt)}` : connectionMessage}</small></div>
        {connection === 'OFFLINE' && <button type="button" aria-label="重新连接实时监控" onClick={() => setRetryKey(value => value + 1)}><RefreshCw size={15} />重连</button>}
      </div>
      <button type="button" className="monitoring-assistant" aria-label="打开智能助手" onClick={onOpenAssistant}><MessageSquare size={17} aria-hidden="true" />智办助手</button>
    </header>
    {connectionMessage && connection !== 'LIVE' && <p className="monitoring-connection-note">{connectionMessage}；页面保留最近一次成功快照。</p>}

    <section className="monitoring-section" aria-labelledby="meeting-monitor-title">
      <div className="monitoring-section-heading"><div><span>01 / MEETING ROOMS</span><h3 id="meeting-monitor-title">会议室实时使用</h3></div><p>共 {snapshot?.meetingRooms.length ?? '—'} 间 · 预约占用 {roomCounts.RESERVED + roomCounts.IN_USE} 间</p></div>
      <div className="monitoring-metrics">
        <Metric label="已签到使用中" value={roomCounts.IN_USE} detail="已登记签到事实" icon={Activity} tone="active" />
        <Metric label="预约占用" value={roomCounts.RESERVED} detail="有效预约进行中" icon={Clock3} tone="reserved" />
        <Metric label="当前空闲" value={roomCounts.IDLE} detail="无当前有效预约" icon={CheckCircle2} tone="available" />
        <Metric label="维护 / 待开放" value={roomCounts.MAINTENANCE + roomCounts.PENDING} detail={`${roomCounts.MAINTENANCE} 间维护 · ${roomCounts.PENDING} 间待开放`} icon={Wrench} tone="warning" />
      </div>
      <div className="monitoring-filter" role="group" aria-label="会议室状态筛选">
        {([['ALL', '全部'], ['OCCUPIED', '占用中'], ['IDLE', '空闲'], ['MAINTENANCE', '维护中'], ['PENDING', '待开放']] as Array<[RoomFilter, string]>).map(([id, label]) => <button key={id} type="button" aria-pressed={roomFilter === id} onClick={() => setRoomFilter(id)}>{label}</button>)}
      </div>
      {!snapshot ? <div className="monitoring-loading" role="status">正在读取会议室实时快照…</div> : filteredRooms.length ? <div className="monitoring-room-grid">{filteredRooms.map(room => <MeetingRoomCard key={room.resourceId} room={room} />)}</div> : <div className="monitoring-empty"><CircleDashed size={25} /><p>当前筛选条件下没有会议室</p></div>}
    </section>

    <section className="monitoring-section" aria-labelledby="office-monitor-title">
      <div className="monitoring-section-heading"><div><span>02 / OFFICE ALLOCATION</span><h3 id="office-monitor-title">办公室使用情况</h3></div><p>共 {snapshot?.offices.length ?? '—'} 间 · 已分配 {officeCounts.ASSIGNED} 间</p></div>
      <div className="monitoring-office-summary" aria-label="办公室状态汇总">
        {(Object.keys(officeStatusLabels) as OfficeMonitoringStatus[]).map(status => <button key={status} type="button" data-status={status} aria-pressed={officeFilter === status} onClick={() => { setOfficeFilter(value => value === status ? 'ALL' : status); setOfficeLimit(40); }}><span>{officeStatusLabels[status]}</span><strong>{officeCounts[status]}</strong></button>)}
      </div>
      <p className="monitoring-source-note">数据口径：来自总部楼层 3D 房间资料及维护记录；“已分配”表示登记了使用人或部门，不代表门禁、传感器或现场实测有人。</p>
      <div className="monitoring-office-tools">
        <label><span>楼栋</span><select value={building} onChange={event => { setBuilding(event.target.value); setFloor('ALL'); setOfficeLimit(40); }}><option value="ALL">全部楼栋</option>{buildings.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>楼层</span><select value={floor} onChange={event => { setFloor(event.target.value); setOfficeLimit(40); }}><option value="ALL">全部楼层</option>{floors.map(value => <option key={value} value={value}>{value} 层</option>)}</select></label>
        <label className="monitoring-office-search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜索办公室</span><input type="search" placeholder="搜索房间、部门或使用人" value={query} onChange={event => { setQuery(event.target.value); setOfficeLimit(40); }} /></label>
      </div>
      <div className="monitoring-office-table-shell">
        <table><caption className="sr-only">办公室分配台账，共 {filteredOffices.length} 条匹配记录</caption><thead><tr><th scope="col">房间 / 位置</th><th scope="col">部门</th><th scope="col">使用人</th><th scope="col">台账状态</th></tr></thead>
          <tbody>{filteredOffices.slice(0, officeLimit).map(office => <OfficeRow key={office.uid} office={office} />)}</tbody>
        </table>
        {!filteredOffices.length && <div className="monitoring-empty"><DoorOpen size={25} /><p>当前筛选条件下没有办公室记录</p></div>}
      </div>
      {filteredOffices.length > officeLimit && <button type="button" className="monitoring-more" onClick={() => setOfficeLimit(value => value + 40)}><Building2 size={15} />显示更多（已显示 {officeLimit} / {filteredOffices.length}）</button>}
      {officeFilter !== 'ALL' && <button type="button" className="monitoring-clear-filter" onClick={() => setOfficeFilter('ALL')}><UsersRound size={14} />清除办公室状态筛选</button>}
    </section>
  </div>;
}
