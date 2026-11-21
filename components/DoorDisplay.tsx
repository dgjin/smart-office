import React, { useEffect, useRef, useState } from 'react';
import { Calendar, CheckCircle, Clock, CloudOff, Key, MapPin, Monitor, RefreshCw } from 'lucide-react';
import { toLocalDateTimeString, toLocalTimeString } from '../utils/dateTime';
import { DOOR_CACHE_KEY_PREFIX, doorCacheKey, doorSnapshotStatus } from '../utils/doorDisplay';

type Snapshot = {
  generatedAt: string;
  expiresAt: string;
  revision: number;
  device: { id: string; name: string; tokenPrefix: string };
  resource: { id: string; name: string; location: string; capacity?: number; status: string };
  bookings: Array<{ id: string; startTime: string; endTime: string; purpose: string; status: 'IN_PROGRESS' | 'UPCOMING' }>;
};
const TOKEN_KEY = 'SMART_OFFICE_DOOR_SESSION_TOKEN';
const clearCache = (token: string) => {
  localStorage.removeItem(DOOR_CACHE_KEY_PREFIX);
  if (token) localStorage.removeItem(doorCacheKey(token));
};
const readCache = (token: string): { snapshot: Snapshot | null; expired: boolean } => {
  if (!token) return { snapshot: null, expired: false };
  try {
    const value = localStorage.getItem(doorCacheKey(token));
    if (!value) return { snapshot: null, expired: false };
    const snapshot = JSON.parse(value) as Snapshot;
    if (doorSnapshotStatus(snapshot) !== 'FRESH' || snapshot.device?.tokenPrefix !== token.slice(0, 12) || !Array.isArray(snapshot.bookings)) {
      clearCache(token);
      return { snapshot: null, expired: true };
    }
    return { snapshot, expired: false };
  } catch {
    clearCache(token);
    return { snapshot: null, expired: true };
  }
};

export default function DoorDisplay() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [initialCache] = useState(() => readCache(token));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initialCache.snapshot);
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState(initialCache.expired ? '离线快照已过期或被替换，日程已停止展示，请联网获取最新快照。' : '');
  const [connecting, setConnecting] = useState(false);
  const [retry, setRetry] = useState(0);
  const tokenRef = useRef(token);
  const snapshotRef = useRef(snapshot);
  const inFlight = useRef(false);
  tokenRef.current = token;
  snapshotRef.current = snapshot;

  const acceptSnapshot = (result: Snapshot, credential: string) => {
    if (doorSnapshotStatus(result) !== 'FRESH' || result.device?.tokenPrefix !== credential.slice(0, 12) || !Array.isArray(result.bookings)) {
      throw new Error('设备快照无效或已过期，请核对设备时间后重试。');
    }
    setSnapshot(result); snapshotRef.current = result;
    localStorage.setItem(doorCacheKey(credential), JSON.stringify(result));
    setAuthenticated(true); setOnline(true); setError('');
  };

  useEffect(() => {
    if (!snapshot || doorSnapshotStatus(snapshot) === 'FRESH') return;
    clearCache(tokenRef.current);
    setSnapshot(null); snapshotRef.current = null;
    setError('快照已过期，日程已停止展示，请联网获取最新快照。');
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const timer = setTimeout(() => {
      clearCache(tokenRef.current);
      setSnapshot(null); snapshotRef.current = null;
      setOnline(false);
      setError('离线快照已到最长保留时间，日程已停止展示，请联网恢复。');
    }, Math.max(0, Date.parse(snapshot.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [snapshot?.expiresAt]);

  useEffect(() => {
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout>;
    let heartbeatTimer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!active || !tokenRef.current || inFlight.current || document.hidden || !navigator.onLine) return;
      inFlight.current = true;
      try {
        const response = await fetch('/api/device/snapshot', { headers: { Authorization: `Bearer ${tokenRef.current}` } });
        const result = await response.json().catch(() => ({}));
        if (!active) return;
        if (response.status === 401) {
          sessionStorage.removeItem(TOKEN_KEY); clearCache(tokenRef.current);
          setAuthenticated(false); setSnapshot(null); snapshotRef.current = null; setToken(''); setError('设备凭证无效、已轮换或已吊销，请重新配置。');
          return;
        }
        if (!response.ok) throw new Error(result.error || String(response.status));
        acceptSnapshot(result, tokenRef.current);
      } catch { if (active) { setOnline(false); setError(snapshotRef.current ? '连接中断，正在限时显示最后一次成功快照；不作为门禁或签到凭证。' : '无法获取有效日程快照，请检查网络、设备时间和设备凭证。'); } }
      finally { inFlight.current = false; }
    };
    const schedule = () => { pollTimer = setTimeout(async () => { await refresh(); if (active) schedule(); }, 10000); };
    const heartbeat = async () => {
      if (!tokenRef.current || !snapshotRef.current || document.hidden || !navigator.onLine) return;
      try {
        const response = await fetch('/api/device/heartbeat', { method: 'POST', headers: { Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lastSnapshotRevision: snapshotRef.current.revision }) });
        if (response.status === 401) await refresh();
      } catch {}
    };
    const resume = () => { setOnline(navigator.onLine); void refresh(); };
    void refresh(); schedule();
    heartbeatTimer = setInterval(() => void heartbeat(), 30000);
    window.addEventListener('online', resume); window.addEventListener('offline', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; clearTimeout(pollTimer); clearInterval(heartbeatTimer); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); document.removeEventListener('visibilitychange', resume); };
  }, [retry]);

  const connect = async () => {
    if (!token.trim() || connecting) return;
    setConnecting(true); setError('');
    const credential = token.trim();
    sessionStorage.setItem(TOKEN_KEY, credential); setToken(credential);
    try {
      const response = await fetch('/api/device/snapshot', { headers: { Authorization: `Bearer ${credential}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401 ? '设备凭证无效，请向管理员获取有效密钥。' : '门口屏服务暂不可用。');
      acceptSnapshot(result, credential);
    } catch (reason: any) {
      sessionStorage.removeItem(TOKEN_KEY); clearCache(credential);
      setAuthenticated(false); setSnapshot(null); snapshotRef.current = null;
      setError(reason?.message || '连接失败。');
    } finally { setConnecting(false); }
  };
  const disconnect = () => {
    sessionStorage.removeItem(TOKEN_KEY); clearCache(tokenRef.current);
    setToken(''); setSnapshot(null); snapshotRef.current = null; setAuthenticated(false); setError('');
  };
  const displaySnapshot = snapshot && doorSnapshotStatus(snapshot) === 'FRESH' ? snapshot : null;
  const current = displaySnapshot?.bookings.find(item => item.status === 'IN_PROGRESS');
  const upcoming = displaySnapshot?.bookings.filter(item => item.status === 'UPCOMING') || [];

  if (!authenticated) return <main className="door-setup"><section><div className="door-setup-mark"><Monitor size={34}/></div><p className="door-kicker">SMARTOFFICE / DOOR DISPLAY</p><h1>会议室门口屏</h1><p>使用管理员创建的独立设备密钥连接。无需、也不能使用管理员账号或 Cookie。</p><form onSubmit={event => { event.preventDefault(); void connect(); }}><label htmlFor="door-token">设备密钥</label><div><Key size={18}/><input id="door-token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} placeholder="粘贴 door_ 开头的一次性分发密钥"/></div><button disabled={!token.trim() || connecting}>{connecting ? '正在验证设备…' : '连接并显示日程'}</button></form>{error && <p role="alert" className="door-error">{error}</p>}</section></main>;

  if (!displaySnapshot) return <main className="door-setup"><section><div className="door-setup-mark"><CloudOff size={34}/></div><p className="door-kicker">SMARTOFFICE / SNAPSHOT UNAVAILABLE</p><h1>日程快照不可用</h1><p>过期、无效或其他设备的缓存不会展示，也不能用于开门、签到或释放会议室。</p>{error && <p role="alert" className="door-error">{error}</p>}<button onClick={() => setRetry(value => value + 1)}>重新获取最新快照</button><button onClick={disconnect}>断开并清除本机快照</button></section></main>;

  return <main className="door-display">
    <header><div><p className="door-kicker">SMARTOFFICE / ROOM STATUS</p><h1>{displaySnapshot.resource.name}</h1><p><MapPin size={16}/>{displaySnapshot.resource.location}{displaySnapshot.resource.capacity ? ` · 容纳 ${displaySnapshot.resource.capacity} 人` : ''}</p></div><div className="door-live" data-online={online}><span/>{online ? '实时日程' : '离线快照'}<small>更新于 {toLocalDateTimeString(displaySnapshot.generatedAt)} · 最长保留至 {toLocalTimeString(displaySnapshot.expiresAt)}</small></div></header>
    {error && <p role="status" className="door-offline"><CloudOff size={17}/>{error}</p>}
    <section className="door-current" data-active={Boolean(current)}><div className="door-current-label">{!online ? <><CloudOff size={20}/>离线日程参考</> : current ? <><span/>会议进行中</> : <><CheckCircle size={20}/>当前可预约</>}</div>{current ? <><h2>{current.purpose}</h2><p>{toLocalTimeString(current.startTime)} — {toLocalTimeString(current.endTime)}</p></> : <><h2>{online ? '空间就绪' : '现场状态待核实'}</h2><p>{online ? '请通过办公系统提交预约，核准后使用。' : '离线快照不代表实时空闲、门禁授权或签到结果。'}</p></>}</section>
    <section className="door-agenda"><div className="door-agenda-head"><h2><Calendar size={21}/>今日日程</h2><span>{upcoming.length + (current ? 1 : 0)} 场</span></div>{!displaySnapshot.bookings.length ? <div className="door-empty"><Clock size={34}/><p>今日暂无已核准会议</p></div> : <ol>{[...(current ? [current] : []), ...upcoming].map(item => <li key={item.id} data-current={item.status === 'IN_PROGRESS'}><time>{toLocalTimeString(item.startTime)}<small>{toLocalTimeString(item.endTime)}</small></time><div><strong>{item.purpose}</strong><span>{item.status === 'IN_PROGRESS' ? '进行中' : '待开始'}</span></div></li>)}</ol>}</section>
    <footer><span><RefreshCw size={13}/>每 10 秒整份刷新 · 离线最多保留 5 分钟 · 不作为门禁或签到凭证</span><button onClick={disconnect}>断开并清除本机快照</button></footer>
  </main>;
}
