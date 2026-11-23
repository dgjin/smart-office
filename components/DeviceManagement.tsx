import React, { useState } from 'react';
import { Copy, Key, Monitor, Plus, Power, RefreshCw, RotateCcw, Smartphone, X } from 'lucide-react';
import type { DoorDevice, Resource } from '../types';
import { toLocalDateTimeString } from '../utils/dateTime';
import { formatUserError } from '../utils/userErrors';

type PublicDevice = Omit<DoorDevice, 'tokenHash'>;

export default function DeviceManagement({ devices, resources, apiRequest, onChanged, notify }: {
  devices: PublicDevice[];
  resources: Resource[];
  apiRequest: (path: string, method: string, body?: any) => Promise<any>;
  onChanged: () => Promise<void>;
  notify: (title: string, content: string, type?: 'INFO' | 'SUCCESS' | 'WARNING') => void;
}) {
  const rooms = resources.filter(resource => resource.type === 'ROOM');
  const [name, setName] = useState('');
  const [resourceId, setResourceId] = useState(rooms[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credential, setCredential] = useState<{ device: PublicDevice; token: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ action: 'rotate' | 'restart' | 'revoke'; device: PublicDevice } | null>(null);
  const run = async (path: string, body: any, success: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await apiRequest(path, 'POST', body);
      if (result.token) setCredential(result);
      setConfirmation(null); setName('');
      await onChanged();
      notify('设备状态已更新', success, 'SUCCESS');
    } catch (reason: any) { setError(formatUserError(reason, '设备操作未完成，请刷新后重试。')); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!credential) return;
    try { await navigator.clipboard.writeText(credential.token); notify('密钥已复制', '请仅粘贴到目标门口屏，关闭后无法再次查看。', 'SUCCESS'); }
    catch { setError('浏览器未允许剪贴板访问，请使用系统安全凭证分发流程。'); }
  };
  return <div className="space-y-6 animate-in fade-in">
    <div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">DOOR DISPLAY / DEVICE BOUNDARY</p><h3 className="mt-1 text-2xl font-black text-gray-800">门口屏设备</h3><p className="mt-2 text-sm text-gray-500">独立 Bearer 凭证、单资源绑定和即时吊销；完整密钥仅创建或轮换时显示一次。</p></div>
    {error && <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-600">{error}</p>}
    {credential && <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5" aria-label="一次性设备密钥">
      <div className="flex items-start justify-between gap-3"><div><h4 className="font-black text-amber-900">立即配置「{credential.device.name}」</h4><p className="mt-1 text-xs leading-relaxed text-amber-700">这是唯一一次显示完整密钥。不要放入网址、聊天、截图或备份文件。</p></div><button onClick={() => setCredential(null)} aria-label="关闭一次性密钥" className="text-amber-700"><X size={18}/></button></div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input aria-label="一次性设备密钥" readOnly type="password" value={credential.token} onFocus={event => event.target.select()} className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2.5 font-mono text-xs"/><button onClick={() => void copy()} className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white"><Copy size={14} className="mr-2 inline"/>复制密钥</button></div>
      <p className="mt-3 text-[11px] font-bold text-amber-700">在门口屏打开 <a href="/door-display" target="_blank" rel="noreferrer" className="underline">/door-display</a>，粘贴密钥完成绑定。</p>
    </section>}
    <section className="rounded-3xl border border-gray-100 bg-white p-5 md:p-6">
      <h4 className="flex items-center gap-2 text-sm font-black text-gray-800"><Plus size={17}/>绑定新门口屏</h4>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="text-[11px] font-black text-gray-500">设备名称<input aria-label="设备名称" maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="例如：10层 Alpha 门口屏" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-xs font-bold outline-none focus:border-indigo-300"/></label>
        <label className="text-[11px] font-black text-gray-500">绑定会议室<select aria-label="绑定会议室" value={resourceId} onChange={event => setResourceId(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold">{rooms.map(room => <option key={room.id} value={room.id} disabled={devices.some(device => device.resourceId === room.id && device.status === 'ACTIVE')}>{room.name} · {room.location}{devices.some(device => device.resourceId === room.id && device.status === 'ACTIVE') ? '（已绑定）' : ''}</option>)}</select></label>
        <button disabled={busy || !name.trim() || !resourceId || devices.some(device => device.resourceId === resourceId && device.status === 'ACTIVE')} onClick={() => void run('/api/devices', { name, resourceId }, '设备已创建，请立即分发一次性密钥。')} className="self-end rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black text-white disabled:opacity-40">创建并生成密钥</button>
      </div>
    </section>
    {!devices.length ? <div className="rounded-3xl border border-dashed bg-white py-20 text-center text-sm font-bold text-gray-500"><Smartphone size={38} className="mx-auto mb-4 opacity-30"/>尚未绑定门口屏设备</div> : <div className="grid gap-4 xl:grid-cols-2">{devices.map(device => {
      const room = rooms.find(resource => resource.id === device.resourceId);
      const online = device.status === 'ACTIVE' && device.lastHeartbeatAt && Date.now() - Date.parse(device.lastHeartbeatAt) <= 120000;
      return <article key={device.id} className="rounded-3xl border border-gray-100 bg-white p-5">
        <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Monitor size={20}/></span><div><h4 className="font-black text-gray-800">{device.name}</h4><p className="mt-1 text-xs text-gray-500">{room?.name || device.resourceId} · {room?.location}</p></div></div><span className={`rounded-lg px-2 py-1 text-[11px] font-bold ${device.status === 'REVOKED' ? 'bg-gray-100 text-gray-500' : online ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>{device.status === 'REVOKED' ? '已吊销' : online ? '在线' : '离线'}</span></div>
        <div className="my-4 grid grid-cols-2 gap-2 rounded-2xl bg-gray-50 p-4 text-[11px] text-gray-500"><p>凭证标识：<span className="font-mono text-gray-700">{device.tokenPrefix}…</span></p><p>快照版本：{device.lastSnapshotRevision ?? '尚未上报'}</p><p className="col-span-2">最后心跳：{device.lastHeartbeatAt ? toLocalDateTimeString(device.lastHeartbeatAt) : '尚未连接'}</p></div>
        {device.status === 'ACTIVE' && (confirmation?.device.id === device.id ? <div className="rounded-xl border border-rose-100 bg-rose-50 p-3"><p className="text-xs font-bold text-rose-700">确认{confirmation.action === 'rotate' ? '轮换密钥？旧密钥将立即失效。' : confirmation.action === 'restart' ? '远程重启门口屏应用？设备将在下次同步后重新加载，硬件重启仍需现场联调。' : '吊销设备？该设备将立即失去读取权限。'}</p><div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => void run(`/api/devices/${device.id}/${confirmation.action}`, {}, confirmation.action === 'rotate' ? '新密钥已生成，旧密钥已失效。' : confirmation.action === 'restart' ? '重载指令已下发，设备将在下次同步后重新加载。' : '设备凭证已吊销。')} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-black text-white">确认执行</button><button onClick={() => setConfirmation(null)} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-gray-600">取消</button></div></div> : <div className="flex flex-wrap gap-2"><button onClick={() => setConfirmation({ action: 'rotate', device })} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-xs font-black text-gray-600"><RefreshCw size={13} className="mr-1 inline"/>轮换密钥</button><button onClick={() => setConfirmation({ action: 'restart', device })} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-xs font-black text-gray-600"><Power size={13} className="mr-1 inline"/>远程重启</button><button onClick={() => setConfirmation({ action: 'revoke', device })} className="flex-1 rounded-xl border border-rose-100 py-2.5 text-xs font-black text-rose-600"><RotateCcw size={13} className="mr-1 inline"/>吊销设备</button></div>)}
      </article>;
    })}</div>}
  </div>;
}
