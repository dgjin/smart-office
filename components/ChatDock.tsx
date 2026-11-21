import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, Check, TriangleAlert, Wrench, ChevronDown, Loader2, Trash2, Pencil, RotateCcw } from 'lucide-react';
import type { Booking, Resource, RoomFeature, User } from '../types';
import { formatDate, formatTime } from '../utils/dateTime';
import { isResourceAcceptingBookings } from '../utils/bookingRules';
import { validateBookingDraft } from '../utils/bookingDraft';

export interface BookingDraft {
  userId?: string;
  resourceId: string;
  type?: 'ROOM' | 'DESK';
  startTime: string;
  endTime: string;
  purpose: string;
  participants?: number;
  needsTeaService?: boolean;
  isVideoConference?: boolean;
  requiredFeatures?: RoomFeature[];
  attendeeIds?: string[];
  hasLeader?: boolean;
  leaderDetails?: string;
  recurrence?: { frequency: 'WEEKLY' | 'BIWEEKLY'; count: number };
}

export interface AgentAction {
  type: 'PROPOSE_BOOKING' | 'PROPOSE_CANCEL' | 'PROPOSE_APPROVAL' | 'PROPOSE_CHECK_IN' | 'PROPOSE_WORK_ORDER' | 'NAVIGATE' | 'REFRESH';
  draft?: BookingDraft;
  summary?: string;
  bookingId?: string;
  bookingIds?: string[];
  workOrderId?: string;
  decision?: 'APPROVE' | 'REJECT';
  comment?: string;
  view?: string;
}

interface TodoItem {
  id: string;
  kind: 'APPROVAL' | 'REJECTED' | 'CHECK_IN' | 'UPCOMING' | 'WORK_ORDER';
  title: string;
  detail: string;
  urgency: 'high' | 'normal' | 'low';
  actions: Array<AgentAction & { label: string }>;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  actions?: AgentAction[];
  trace?: Array<{ tool: string; ok: boolean; ms: number; error?: string }>;
  failed?: boolean;
  streaming?: boolean;
}

interface ChatDockProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  theme: string;
  resources: Resource[];
  bookings: Booking[];
  users: User[];
  onAction: (action: AgentAction) => void | Promise<void>;
  onNavigate: (view: string) => void;
}

type ActionState = 'done' | 'opened' | 'dismissed';
type ConversationState = { turns: Turn[]; handled: Record<string, ActionState>; input: string };

const conversationSnapshot = (state: ConversationState): ConversationState => ({
  turns: state.turns.map(({ streaming: _streaming, ...turn }) => turn),
  handled: state.handled,
  input: state.input
});

const TOOL_LABELS: Record<string, string> = {
  list_resources: '读取资源清单',
  find_available_resources: '查找空闲资源',
  get_resource_calendar: '查询资源占用',
  list_my_bookings: '查询我的申请',
  get_pending_approvals: '查询待审批',
  get_usage_stats: '统计使用数据',
  get_work_orders: '查询服务工单',
  get_my_todos: '整理我的待办',
  propose_booking: '填写申请草案',
  propose_cancel: '生成取消提案',
  propose_approval: '生成审批提案',
  propose_check_in: '生成签到提案',
  propose_complete_work_order: '生成工单完成提案'
};

const ACTION_META: Record<string, { label: string; hint: string; tone: string }> = {
  PROPOSE_BOOKING: { label: '确认并填写', hint: '将打开预约表单，核对后提交', tone: 'emerald' },
  PROPOSE_CANCEL: { label: '确认取消', hint: '取消后该时段立即释放', tone: 'red' },
  PROPOSE_APPROVAL: { label: '确认审批', hint: '提交后进入下一审批节点', tone: 'amber' },
  PROPOSE_CHECK_IN: { label: '确认签到', hint: '将记录本次到店签到', tone: 'indigo' },
  PROPOSE_WORK_ORDER: { label: '确认完成', hint: '完成后将通知会议申请人', tone: 'emerald' },
  NAVIGATE: { label: '前往查看', hint: '', tone: 'indigo' }
};

const renderInline = (text: string) => text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
  part.startsWith('**') && part.endsWith('**')
    ? <strong key={index} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
    : <span key={index}>{part}</span>
);

const RichText = ({ text }: { text: string }) => (
  <div className="space-y-1">
    {text.split('\n').map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return <div key={index} className="h-1" />;
      const bullet = trimmed.match(/^[-*]\s+(.*)$/);
      if (bullet) {
        return (
          <div key={index} className="flex gap-2">
            <span className="text-gray-400 shrink-0">·</span>
            <span>{renderInline(bullet[1])}</span>
          </div>
        );
      }
      const ordered = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (ordered) {
        return (
          <div key={index} className="flex gap-2">
            <span className="text-gray-400 shrink-0">{ordered[1]}.</span>
            <span>{renderInline(ordered[2])}</span>
          </div>
        );
      }
      return <div key={index}>{renderInline(trimmed)}</div>;
    })}
  </div>
);

const BookingDraftCard = ({ action, resources, bookings, users, currentUserId, state, error, onChange, onConfirm, onDiscard, onRestore }: {
  action: AgentAction & { draft: BookingDraft };
  resources: Resource[];
  bookings: Booking[];
  users: User[];
  currentUserId: string;
  state?: ActionState;
  error?: string;
  onChange: (draft: BookingDraft) => void;
  onConfirm: (action: AgentAction) => Promise<void>;
  onDiscard: () => void;
  onRestore: () => void;
}) => {
  const [draft, setDraft] = useState<BookingDraft>(action.draft);
  const [editDraft, setEditDraft] = useState<BookingDraft>(action.draft);
  const [editing, setEditing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resource = resources.find(item => item.id === draft.resourceId);
  const attendees = (draft.attendeeIds || []).map(id => users.find(user => user.id === id)?.name).filter(Boolean) as string[];
  const start = new Date(draft.startTime);
  const end = new Date(draft.endTime);
  const range = formatDate(start) === formatDate(end)
    ? `${formatDate(start)} ${formatTime(start)} — ${formatTime(end)}`
    : `${formatDate(start)} ${formatTime(start)} — ${formatDate(end)} ${formatTime(end)}`;

  const updateSchedule = (field: 'date' | 'startTime' | 'endTime', value: string) => {
    if (!value) return;
    setEditDraft(prev => {
      if (field === 'date') {
        return {
          ...prev,
          startTime: new Date(`${value}T${formatTime(new Date(prev.startTime))}`).toISOString(),
          endTime: new Date(`${value}T${formatTime(new Date(prev.endTime))}`).toISOString()
        };
      }
      const current = new Date(prev[field]);
      return { ...prev, [field]: new Date(`${formatDate(current)}T${value}`).toISOString() };
    });
  };

  const saveRevision = () => {
    const requiredFeatures = [...new Set<RoomFeature>([
      ...(editDraft.requiredFeatures || []),
      ...(editDraft.isVideoConference ? ['VIDEO' as const] : [])
    ])];
    const revised = {
      ...editDraft,
      participants: editDraft.participants ?? 1,
      requiredFeatures,
      purpose: editDraft.purpose.trim()
    };
    const draftError = validateBookingDraft(revised, resources, bookings);
    if (draftError) return setValidationError(draftError);
    setDraft(revised);
    onChange(revised);
    setValidationError(null);
    setEditing(false);
  };

  const confirm = async () => {
    const draftError = validateBookingDraft(draft, resources, bookings);
    if (draftError) {
      setValidationError(draftError);
      return;
    }
    setValidationError(null);
    setBusy(true);
    try {
      await onConfirm({
        ...action,
        draft,
        summary: `${resource?.name || draft.resourceId} · ${range} · ${draft.participants || 1} 人 · 用途：${draft.purpose}`
      });
    } finally {
      setBusy(false);
    }
  };

  if (state === 'dismissed') {
    return (
      <div className="chat-draft-dismissed">
        <span>申请草案已放弃，未提交任何数据。</span>
        <button type="button" onClick={onRestore}><RotateCcw size={13} />恢复草案</button>
      </div>
    );
  }

  return (
    <section className="chat-draft" aria-label="待确认申请草案">
      <div className="chat-draft-head">
        <div><span>APPLICATION DRAFT</span><h4>申请草案</h4></div>
        <span className="chat-draft-status">{state === 'opened' ? '表单已打开' : '待确认'}</span>
      </div>

      {editing ? (
        <div className="chat-draft-form">
          <label>预订资源
            <select value={editDraft.resourceId} onChange={event => setEditDraft(prev => ({ ...prev, resourceId: event.target.value }))}>
              {resources.filter(item => isResourceAcceptingBookings(item) || item.id === editDraft.resourceId).map(item => <option key={item.id} value={item.id}>{item.name} · {item.capacity || 1} 人</option>)}
            </select>
          </label>
          <label>申请用途
            <input value={editDraft.purpose} onChange={event => setEditDraft(prev => ({ ...prev, purpose: event.target.value }))} />
          </label>
          <label>日期
            <input type="date" value={formatDate(new Date(editDraft.startTime))} onChange={event => updateSchedule('date', event.target.value)} />
          </label>
          <div className="chat-draft-form-grid">
            <label>开始时间
              <input type="time" step="1800" value={formatTime(new Date(editDraft.startTime))} onChange={event => updateSchedule('startTime', event.target.value)} />
            </label>
            <label>结束时间
              <input type="time" step="1800" value={formatTime(new Date(editDraft.endTime))} onChange={event => updateSchedule('endTime', event.target.value)} />
            </label>
          </div>
          <label>参与人数
            <input type="number" min="1" value={editDraft.participants || 1} onChange={event => setEditDraft(prev => ({ ...prev, participants: Number(event.target.value) }))} />
          </label>
          <fieldset>
            <legend>参会人</legend>
            <div className="chat-draft-attendees">
              {users.filter(user => user.id !== currentUserId).map(user => (
                <label key={user.id}><input type="checkbox" checked={(editDraft.attendeeIds || []).includes(user.id)} onChange={() => setEditDraft(prev => ({ ...prev, attendeeIds: (prev.attendeeIds || []).includes(user.id) ? (prev.attendeeIds || []).filter(id => id !== user.id) : [...(prev.attendeeIds || []), user.id] }))} />{user.name}</label>
              ))}
            </div>
          </fieldset>
          <div className="chat-draft-checks">
            <label><input type="checkbox" checked={Boolean(editDraft.isVideoConference)} onChange={event => setEditDraft(prev => ({ ...prev, isVideoConference: event.target.checked }))} />视频会议</label>
            <label><input type="checkbox" checked={Boolean(editDraft.needsTeaService)} onChange={event => setEditDraft(prev => ({ ...prev, needsTeaService: event.target.checked }))} />茶水服务</label>
            <label><input type="checkbox" checked={Boolean(editDraft.hasLeader)} onChange={event => setEditDraft(prev => ({ ...prev, hasLeader: event.target.checked }))} />领导参会</label>
          </div>
          {editDraft.hasLeader && <label>领导姓名或职位<input value={editDraft.leaderDetails || ''} onChange={event => setEditDraft(prev => ({ ...prev, leaderDetails: event.target.value }))} /></label>}
          <div className="chat-draft-form-grid">
            <label>重复频率
              <select value={editDraft.recurrence?.frequency || 'NONE'} onChange={event => setEditDraft(prev => ({ ...prev, recurrence: event.target.value === 'NONE' ? undefined : { frequency: event.target.value as 'WEEKLY' | 'BIWEEKLY', count: prev.recurrence?.count || 4 } }))}>
                <option value="NONE">不重复</option><option value="WEEKLY">每周</option><option value="BIWEEKLY">隔周</option>
              </select>
            </label>
            <label>重复次数
              <select disabled={!editDraft.recurrence} value={editDraft.recurrence?.count || 4} onChange={event => setEditDraft(prev => ({ ...prev, recurrence: prev.recurrence ? { ...prev.recurrence, count: Number(event.target.value) } : undefined }))}>
                {[2, 3, 4, 6, 8, 12].map(count => <option key={count} value={count}>共 {count} 次</option>)}
              </select>
            </label>
          </div>
        </div>
      ) : (
        <dl className="chat-draft-summary">
          <div><dt>资源</dt><dd>{resource?.name || draft.resourceId}</dd></div>
          <div><dt>时间</dt><dd>{range}</dd></div>
          <div><dt>用途</dt><dd>{draft.purpose}</dd></div>
          <div><dt>人数</dt><dd>{draft.participants || 1} 人</dd></div>
          <div><dt>参会人</dt><dd>{attendees.length ? attendees.join('、') : '暂未添加'}</dd></div>
          <div><dt>服务</dt><dd>{[draft.isVideoConference ? '视频会议' : '', draft.needsTeaService ? '茶水服务' : '', draft.hasLeader ? `领导参会${draft.leaderDetails ? `：${draft.leaderDetails}` : ''}` : ''].filter(Boolean).join(' · ') || '无特殊需求'}</dd></div>
          <div><dt>周期</dt><dd>{draft.recurrence ? `${draft.recurrence.frequency === 'WEEKLY' ? '每周' : '隔周'}重复 · 共 ${draft.recurrence.count} 次` : '单次申请'}</dd></div>
        </dl>
      )}

      {(validationError || error) && <p className="chat-draft-error" role="alert">{validationError || error}</p>}
      {editing ? (
        <div className="chat-draft-actions">
          <button type="button" className="chat-draft-secondary" onClick={() => { setEditDraft(draft); setValidationError(null); setEditing(false); }}>取消修订</button>
          <button type="button" className="chat-action" onClick={saveRevision}>保存修订</button>
        </div>
      ) : (
        <>
          <p className="chat-draft-hint">已校验资源、容量、设备与首个时段；打开完整申请表后可继续核对周期安排，最终提交前会再次校验。</p>
          <div className="chat-draft-actions">
            <button type="button" className="chat-draft-secondary" onClick={() => { setEditDraft(draft); setValidationError(null); setEditing(true); }}><Pencil size={13} />修订申请</button>
            <button type="button" className="chat-action" disabled={busy} onClick={() => void confirm()}>{busy ? '正在打开…' : state === 'opened' ? '再次打开申请表' : '确认信息，打开申请表'}</button>
          </div>
          <button type="button" className="chat-draft-discard" onClick={onDiscard}>放弃此次草案</button>
        </>
      )}
    </section>
  );
};

const ApprovalActionCard = ({ action, done, busy, error, onConfirm }: {
  action: AgentAction;
  done: boolean;
  busy: boolean;
  error?: string;
  onConfirm: (action: AgentAction) => Promise<void>;
}) => {
  const [comment, setComment] = useState(action.comment || '');
  const [validationError, setValidationError] = useState('');
  const rejecting = action.decision === 'REJECT';
  const confirm = () => {
    if (rejecting && !comment.trim()) {
      setValidationError('驳回必须填写具体审批意见');
      return;
    }
    setValidationError('');
    void onConfirm({ ...action, comment: comment.trim() || undefined });
  };
  return (
    <section className="chat-message p-3 space-y-2" aria-label="待确认审批提案">
      <div className="text-[12.5px] text-gray-800 font-medium leading-snug">{action.summary || '待确认审批'}</div>
      <p className="text-[11px] text-gray-500">{rejecting ? '驳回后流程终止，申请人将收到以下审批意见。' : '请核对申请与审批节点；若当前是最终节点，通过后预约将正式核准。'}</p>
      <label className="block text-[11px] font-medium text-gray-600">审批附言{rejecting ? '（必填）' : '（可选）'}
        <textarea aria-label="助手审批附言" rows={2} value={comment} disabled={done || busy} onChange={event => { setComment(event.target.value); setValidationError(''); }} className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-normal text-gray-800 outline-none focus:border-gray-400 disabled:opacity-60" />
      </label>
      {(validationError || error) && <p className="chat-draft-error" role="alert">{validationError || error}</p>}
      <button type="button" disabled={done || busy} onClick={confirm} className={done ? 'w-full text-[12px] font-medium py-2 rounded-lg bg-gray-100 text-gray-400' : 'chat-action w-full text-[12px] font-medium py-2 hover:opacity-90 transition-opacity disabled:opacity-60'}>
        {busy ? '正在提交…' : done ? '已处理' : rejecting ? '确认驳回' : '确认通过'}
      </button>
    </section>
  );
};

const SUGGESTIONS = [
  '明天下午三点 10 人开会，要视频设备，帮我订个会议室',
  '我有哪些待审批的申请？',
  'Alpha 会议室明天还有空吗？',
  '最近 30 天会议室用得怎么样？'
];

export default function ChatDock({ open, onClose, userId, userName, theme, resources, bookings, users, onAction, onNavigate }: ChatDockProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [handled, setHandled] = useState<Record<string, ActionState>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({});
  const [expandedTrace, setExpandedTrace] = useState<Record<number, boolean>>({});
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [conversationReady, setConversationReady] = useState(false);
  const [conversationError, setConversationError] = useState('');
  const [conversationConflict, setConversationConflict] = useState(false);
  const [conversationDirty, setConversationDirty] = useState(false);
  const [conversationSaving, setConversationSaving] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const actionLocks = useRef(new Set<string>());
  const conversationGeneration = useRef(0);
  const conversationRevision = useRef(0);
  const conversationLastSaved = useRef('');
  const conversationSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationSaveChain = useRef<Promise<void>>(Promise.resolve());
  const conversationLatest = useRef<ConversationState>({ turns: [], handled: {}, input: '' });
  conversationLatest.current = { turns, handled, input };
  // 流式增量按帧合并：模型单字下发，逐字 setState 会把主线程拖死
  const pendingRef = useRef('');
  const frameRef = useRef<number | null>(null);

  const patchStreaming = (updater: (turn: Turn) => Turn) => {
    setTurns(prev => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant' && next[i].streaming) {
          next[i] = updater(next[i]);
          break;
        }
      }
      return next;
    });
  };

  const scheduleFlush = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const chunk = pendingRef.current;
      pendingRef.current = '';
      if (chunk) patchStreaming(turn => ({ ...turn, content: turn.content + chunk }));
    });
  };

  const flushNow = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const chunk = pendingRef.current;
    pendingRef.current = '';
    return chunk;
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, loading, status]);

  const refreshTodos = async () => {
    try {
      const res = await fetch('/api/todos');
      if (res.ok) setTodos((await res.json()).todos || []);
    } catch { /* 保留当前待办 */ }
  };

  useEffect(() => {
    const generation = ++conversationGeneration.current;
    abortRef.current?.abort();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (conversationSaveTimer.current) clearTimeout(conversationSaveTimer.current);
    frameRef.current = null;
    pendingRef.current = '';
    conversationRevision.current = 0;
    conversationLastSaved.current = '';
    conversationSaveChain.current = Promise.resolve();
    setConversationReady(false);
    setConversationError('');
    setConversationConflict(false);
    setConversationDirty(false);
    setConversationSaving(false);
    setTurns([]);
    setInput('');
    setTodos([]);
    setHandled({});
    setActionErrors({});
    setPendingActions({});
    actionLocks.current.clear();
    setExpandedTrace({});
    setLoading(false);
    setStatus(null);

    void fetch('/api/agent/conversation')
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.error || String(res.status));
        if (generation !== conversationGeneration.current) return;
        const state = data.state as ConversationState;
        conversationRevision.current = Number(data.revision || 0);
        conversationLastSaved.current = JSON.stringify(conversationSnapshot(state));
        setTurns(state.turns || []);
        setHandled(state.handled || {});
        setInput(state.input || '');
        setConversationReady(true);
      })
      .catch(err => {
        if (generation !== conversationGeneration.current) return;
        setConversationError(`对话恢复失败，当前内容未保存：${err?.message || '请检查连接后重试。'}`);
      });

    return () => {
      if (conversationSaveTimer.current) clearTimeout(conversationSaveTimer.current);
    };
  }, [userId]);

  useEffect(() => {
    if (!conversationReady) return;
    const generation = conversationGeneration.current;
    const snapshot = conversationSnapshot({ turns, handled, input });
    const serialized = JSON.stringify(snapshot);
    if (serialized === conversationLastSaved.current) {
      setConversationDirty(false);
      return;
    }
    setConversationDirty(true);
    if (conversationSaveTimer.current) clearTimeout(conversationSaveTimer.current);
    conversationSaveTimer.current = setTimeout(() => {
      conversationSaveChain.current = conversationSaveChain.current.then(async () => {
        if (generation !== conversationGeneration.current || serialized === conversationLastSaved.current) return;
        setConversationSaving(true);
        setConversationError('');
        setConversationConflict(false);
        try {
          const res = await fetch('/api/agent/conversation', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revision: conversationRevision.current, state: snapshot })
          });
          const data = await res.json().catch(() => ({}));
          if (generation !== conversationGeneration.current) return;
          if (res.status === 409) {
            setConversationConflict(true);
            throw new Error('对话已在其他窗口更新。为避免覆盖，当前变更未保存，请刷新页面恢复服务端版本。');
          }
          if (!res.ok) throw new Error(data.detail || data.error || String(res.status));
          conversationRevision.current = Number(data.revision || conversationRevision.current);
          conversationLastSaved.current = serialized;
          if (JSON.stringify(conversationSnapshot(conversationLatest.current)) === serialized) setConversationDirty(false);
        } catch (err: any) {
          if (generation === conversationGeneration.current) {
            setConversationError(err?.message?.includes('其他窗口') ? err.message : `对话保存失败，当前变更未保存：${err?.message || '请检查连接后重试。'}`);
          }
        } finally {
          if (generation === conversationGeneration.current) setConversationSaving(false);
        }
      });
    }, 350);
    return () => {
      if (conversationSaveTimer.current) clearTimeout(conversationSaveTimer.current);
    };
  }, [userId, conversationReady, turns, handled, input, saveRetry]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 120);
      void refreshTodos();
    }
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const handleEvent = (payload: any) => {
    switch (payload?.type) {
      case 'status':
        setStatus(payload.phase === 'running' && payload.tool
          ? `${TOOL_LABELS[payload.tool] || payload.tool}…`
          : '正在理解你的需求…');
        break;
      case 'delta':
        if (typeof payload.text === 'string') {
          pendingRef.current += payload.text;
          scheduleFlush();
        }
        break;
      case 'trace':
        if (payload.entry) {
          patchStreaming(turn => ({ ...turn, trace: [...(turn.trace || []), payload.entry] }));
        }
        break;
      case 'action':
        if (payload.action) {
          patchStreaming(turn => ({ ...turn, actions: [...(turn.actions || []), payload.action] }));
        }
        break;
      case 'done': {
        const buffered = flushNow();
        patchStreaming(turn => {
          const streamed = turn.content + buffered;
          return {
            ...turn,
            content: streamed.trim() ? streamed : (payload.reply || ''),
            actions: Array.isArray(payload.actions) && payload.actions.length ? payload.actions : turn.actions,
            trace: Array.isArray(payload.trace) && payload.trace.length ? payload.trace : turn.trace,
            streaming: false
          };
        });
        setStatus(null);
        break;
      }
      case 'error': {
        flushNow();
        patchStreaming(turn => ({
          ...turn,
          content: payload.message || '服务暂时不可用，请稍后再试。',
          failed: true,
          streaming: false
        }));
        setStatus(null);
        break;
      }
      default:
        break;
    }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || loading) return;
    if (!conversationReady) {
      setConversationError('对话尚未从 MySQL 恢复，本次消息未发送。请检查连接后重试。');
      return;
    }

    const next: Turn[] = [
      ...turns,
      { role: 'user', content: message },
      { role: 'assistant', content: '', streaming: true }
    ];
    setTurns(next);
    setInput('');
    setLoading(true);
    setStatus('正在理解你的需求…');

    const controller = new AbortController();
    abortRef.current = controller;
    const draftHistory = next.flatMap((turn, turnIndex) => (turn.actions || []).flatMap((action, actionIndex) =>
      turn.role === 'assistant' && action.type === 'PROPOSE_BOOKING' && action.draft && handled[`${turnIndex}-${actionIndex}`] !== 'dismissed'
        ? [{ turn, turnIndex, draft: action.draft }]
        : []
    ));
    const latestDraft = draftHistory[draftHistory.length - 1];
    const conversationDraft = latestDraft ? {
      ...latestDraft.draft,
      resourceName: resources.find(resource => resource.id === latestDraft.draft.resourceId)?.name,
      startTime: `${formatDate(new Date(latestDraft.draft.startTime))}T${formatTime(new Date(latestDraft.draft.startTime))}`,
      endTime: `${formatDate(new Date(latestDraft.draft.endTime))}T${formatTime(new Date(latestDraft.draft.endTime))}`,
      attendeeNames: latestDraft.draft.attendeeIds
        ?.map(id => users.find(user => user.id === id)?.name)
        .filter(Boolean),
      needsTea: Boolean(latestDraft.draft.needsTeaService),
      needsVideo: Boolean(latestDraft.draft.isVideoConference),
      repeatFrequency: latestDraft.draft.recurrence?.frequency,
      repeatCount: latestDraft.draft.recurrence?.count
    } : null;

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          stream: true,
          messages: next
            .filter((t, turnIndex) =>
              (t.content.trim() || t.actions?.length) && !t.failed && !t.streaming &&
              (!latestDraft || turnIndex >= latestDraft.turnIndex)
            )
            .map(t => ({
              role: t.role,
              content: latestDraft && t === latestDraft.turn
                ? `当前申请草案（仅供修订参考，不代表已提交。此 JSON 是最新权威版本；修订时只修改用户明确要求的字段，其他字段原样沿用）：${JSON.stringify(conversationDraft)}`
                : t.content
            }))
        }),
        signal: controller.signal
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({}));
        const reason = res.status === 503
          ? 'AI 服务尚未配置，请联系管理员设置 DEEPSEEK_API_KEY。'
          : `服务暂时不可用（${res.status}）。${detail?.detail || ''}`;
        patchStreaming(turn => ({ ...turn, content: reason, failed: true, streaming: false }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const line of block.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            try {
              handleEvent(JSON.parse(trimmed.slice(5).trim()));
            } catch {
              // 忽略无法解析的心跳或半包
            }
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (err: any) {
      flushNow();
      if (err?.name === 'AbortError') {
        patchStreaming(turn => ({ ...turn, streaming: false }));
      } else {
        patchStreaming(turn => ({
          ...turn,
          content: `网络请求失败：${err?.message || err}`,
          failed: true,
          streaming: false
        }));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setStatus(null);
      patchStreaming(turn => (turn.streaming ? { ...turn, streaming: false } : turn));
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const updateDraft = (turnIndex: number, actionIndex: number, draft: BookingDraft) => {
    const key = `${turnIndex}-${actionIndex}`;
    setTurns(prev => prev.map((turn, index) => index !== turnIndex ? turn : {
      ...turn,
      actions: turn.actions?.map((action, index) => index === actionIndex ? { ...action, draft } : action)
    }));
    setHandled(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setActionErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const confirmAction = async (action: AgentAction, key: string) => {
    if (actionLocks.current.has(key)) return;
    actionLocks.current.add(key);
    setPendingActions(prev => ({ ...prev, [key]: true }));
    setActionErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      if (action.type === 'NAVIGATE' && action.view) onNavigate(action.view);
      else await onAction(action);
      setHandled(prev => ({ ...prev, [key]: action.type === 'PROPOSE_BOOKING' ? 'opened' : 'done' }));
      await refreshTodos();
    } catch (err: any) {
      setActionErrors(prev => ({ ...prev, [key]: err?.message || '操作未完成，请稍后重试。' }));
    } finally {
      actionLocks.current.delete(key);
      setPendingActions(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[150] flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="对话式办公助手"
        className="chat-shell relative w-full sm:w-[430px] h-full shadow-2xl flex flex-col"
      >
        <header className="chat-header flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="chat-mark"><Sparkles size={17} /></div>
            <div>
              <div className="chat-title leading-tight">智办 <span className="font-mono text-[8px] tracking-widest opacity-50">/ CONCIERGE</span></div>
              <div className="chat-subtitle">你好，{userName} · 让我帮你安排今天的工作</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {turns.length > 0 && (
              <button
                onClick={() => { setTurns([]); setHandled({}); setActionErrors({}); }}
                className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50"
                title="清空对话"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50" aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="chat-body flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {conversationError && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700 space-y-2">
              <p>{conversationError}</p>
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => conversationConflict || !conversationReady ? window.location.reload() : setSaveRetry(value => value + 1)}
              >
                {conversationConflict || !conversationReady ? '重新加载' : '重试保存'}
              </button>
            </div>
          )}
          {turns.length === 0 && (
            <div className="space-y-3">
              <div className="chat-intro">
                用一句话描述需求就行，比如「明天下午三点十个人开会，要视频设备」。涉及提交的操作我会先出提案，你确认后才生效。
              </div>
              {todos.length > 0 && (
                <section className="space-y-2">
                  <div className="chat-section-title">
                    <h3>我的待办 · {todos.length}</h3>
                    <button onClick={() => void refreshTodos()} className="text-[11px] text-gray-500 hover:text-gray-800">刷新</button>
                  </div>
                  {todos.slice(0, 6).map(todo => (
                    <div key={todo.id} className="chat-todo" data-urgent={todo.urgency === 'high'}>
                      <div className="chat-todo-title">{todo.title}</div>
                      <div className="chat-todo-detail">{todo.detail}</div>
                      <div className="flex gap-2 mt-2.5">
                        {todo.actions.map((action, actionIndex) => {
                          const key = `todo-${todo.id}-${actionIndex}`;
                          const done = handled[key] === 'done';
                          const pending = Boolean(pendingActions[key]);
                          return (
                            <div key={key} className="flex-1">
                              <button disabled={done || pending} onClick={() => void confirmAction(action, key)}
                                className={`chat-action w-full py-1.5 text-[11.5px] font-medium ${done || pending ? 'opacity-40' : 'hover:opacity-90'}`}>
                                {done ? '已处理' : pending ? '处理中…' : action.label}
                              </button>
                              {actionErrors[key] && <p className="chat-draft-error" role="alert">{actionErrors[key]}</p>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              )}
              <div className="space-y-2">
                {SUGGESTIONS.map(text => (
                  <button
                    key={text}
                    onClick={() => send(text)}
                    className="chat-suggestion w-full text-left transition-all"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, index) => (
            <div key={index} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={turn.role === 'user'
                ? 'chat-user-message max-w-[85%] text-white px-3.5 py-2.5 text-[13px] leading-relaxed'
                : 'max-w-full w-full'
              }>
                {turn.role === 'user' ? turn.content : (
                  <div className="space-y-2.5">
                    {turn.trace && turn.trace.length > 0 && (
                      <div>
                        <button
                          onClick={() => setExpandedTrace(prev => ({ ...prev, [index]: !prev[index] }))}
                          className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 bg-white border border-gray-200 rounded-full px-2.5 py-1 hover:border-gray-300"
                        >
                          <Wrench size={11} />
                          调用了 {turn.trace.length} 个工具
                          {turn.trace.some(t => !t.ok) && <span className="text-amber-600">· 有失败</span>}
                          <ChevronDown size={11} className={expandedTrace[index] ? 'rotate-180 transition-transform' : 'transition-transform'} />
                        </button>
                        {expandedTrace[index] && (
                          <div className="mt-1.5 space-y-1">
                            {turn.trace.map((item, i) => (
                              <div key={i} className="flex items-center gap-2 text-[11px] text-gray-600 bg-white border border-gray-100 rounded-lg px-2 py-1.5">
                                {item.ok
                                  ? <Check size={11} className="text-emerald-600 shrink-0" />
                                  : <TriangleAlert size={11} className="text-amber-600 shrink-0" />}
                                <span className="font-mono">{item.tool}</span>
                                <span className="text-gray-400 ml-auto">{item.ms}ms</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {turn.content ? (
                      <div className={turn.failed
                        ? 'bg-red-50 border border-red-200 text-red-700 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px]'
                        : 'chat-message text-gray-800 px-3.5 py-2.5 text-[13px] leading-relaxed'
                      }>
                        <RichText text={turn.content} />
                        {turn.streaming && <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-gray-400 align-middle animate-pulse rounded-sm" />}
                      </div>
                    ) : (turn.streaming && (
                      <div className="flex items-center gap-2 text-[12px] text-gray-500 bg-white border border-gray-200 rounded-2xl rounded-bl-md px-3.5 py-2.5">
                        <Loader2 size={12} className="animate-spin" />
                        {status || '正在处理…'}
                      </div>
                    ))}

                    {turn.actions?.map((action, actionIndex) => {
                      const key = `${index}-${actionIndex}`;
                      if (action.type === 'PROPOSE_BOOKING' && action.draft) {
                        return (
                          <React.Fragment key={key}>
                            <BookingDraftCard
                              action={action as AgentAction & { draft: BookingDraft }}
                              resources={resources}
                              bookings={bookings}
                              users={users}
                              currentUserId={userId}
                              state={handled[key]}
                              error={actionErrors[key]}
                              onChange={draft => updateDraft(index, actionIndex, draft)}
                              onConfirm={nextAction => confirmAction(nextAction, key)}
                              onDiscard={() => setHandled(prev => ({ ...prev, [key]: 'dismissed' }))}
                              onRestore={() => setHandled(prev => {
                                const next = { ...prev };
                                delete next[key];
                                return next;
                              })}
                            />
                          </React.Fragment>
                        );
                      }
                      if (action.type === 'PROPOSE_APPROVAL') {
                        return (
                          <React.Fragment key={key}>
                            <ApprovalActionCard action={action} done={handled[key] === 'done'} busy={Boolean(pendingActions[key])} error={actionErrors[key]} onConfirm={nextAction => confirmAction(nextAction, key)} />
                          </React.Fragment>
                        );
                      }
                      const meta = ACTION_META[action.type];
                      if (!meta) return null;
                      const done = handled[key] === 'done';
                      const pending = Boolean(pendingActions[key]);
                      return (
                        <div key={key} className="chat-message p-3 space-y-2">
                          <div className="text-[12.5px] text-gray-800 font-medium leading-snug">{action.summary || '待确认操作'}</div>
                          {meta.hint && <div className="text-[11px] text-gray-500">{meta.hint}</div>}
                          {actionErrors[key] && <p className="chat-draft-error" role="alert">{actionErrors[key]}</p>}
                          <button
                            disabled={done || pending}
                            onClick={() => void confirmAction(action, key)}
                            className={done
                              ? 'w-full text-[12px] font-medium py-2 rounded-lg bg-gray-100 text-gray-400'
                              : 'chat-action w-full text-[12px] font-medium py-2 hover:opacity-90 transition-opacity disabled:opacity-60'
                            }
                          >
                            {done ? '已处理' : pending ? '处理中…' : meta.label}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && turns[turns.length - 1]?.role !== 'assistant' && (
            <div className="flex items-center gap-2 text-[12px] text-gray-500">
              <Loader2 size={13} className="animate-spin" />
              {status || '正在查询数据并整理…'}
            </div>
          )}
        </div>

        <div className="chat-composer shrink-0">
          <div className="chat-input-wrap flex items-end gap-2 px-3 py-2 focus-within:border-gray-300">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
              placeholder={conversationReady ? '描述你的需求，Enter 发送' : '正在从 MySQL 恢复对话…'}
              disabled={!conversationReady}
              className="flex-1 bg-transparent text-[13px] text-gray-800 placeholder-gray-400 resize-none outline-none max-h-28 leading-relaxed disabled:opacity-50"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading || !conversationReady}
              className={`chat-send p-2 shrink-0 ${input.trim() && !loading ? 'text-white' : 'opacity-40 text-gray-500'}`}
              aria-label="发送"
            >
              <Send size={14} />
            </button>
          </div>
          <div className={`text-[10.5px] mt-1.5 px-1 ${conversationError ? 'text-rose-500' : 'text-gray-400'}`}>
            {conversationError
              ? '当前变更未保存 · 不会写入浏览器存储'
              : conversationDirty || conversationSaving
                ? '正在将对话与草案保存至 MySQL…'
                : '对话与草案已保存至 MySQL · AI 可能出错，提交前请核对'}
          </div>
        </div>
      </aside>
    </div>
  );
}
