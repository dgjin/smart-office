import type { IncomingMessage, ServerResponse } from 'node:http';
import { readDb } from './db.ts';
import { streamChatCompletion, LlmCancelledError, LlmNotConfiguredError, LlmTimeoutError, type ChatMessage } from './llm.ts';
import { buildContextSummary, createExecutor, toolsForRoles, type AgentAction, type OfficeDb, type ToolResult } from './tools.ts';
import { readJson, send } from './http.ts';
import { getActorDbView } from './confidentiality.ts';
import type { User } from '../types.ts';

const MAX_TURNS = 6;
const MAX_HISTORY = 20;
const MAX_INPUT_CHARS = 4000;

const SYSTEM_PROMPT = `你是「智办」，智慧办公空间管理系统（SmartOffice）的操作助手，帮助用户查询、导航、理解功能、填写申请和处理可确认的待办。

工作原则：
1. 涉及具体资源、时间、人员、预订或统计的回答必须先调用工具取数，禁止编造名称、容量、时段、ID、权限或数字。
2. 用户要求订会议室时，先调用 find_available_resources，再调用 propose_booking 生成草案。只有纯询问空档时才只查不订。
3. 所有 propose_* 都只生成待确认操作。新建、修改和续期确认后只打开正式表单，用户仍须最终提交；绝不能说“已经订好/改好/续期成功”。取消、审批、签到和工单也必须在用户点击确认后才执行。
4. 新预约必须具有明确用途和正整数人数，不能用“会议/开会”代替用途，也不能擅自补人数。未说时长可按 1 小时；未说日期时根据当前时间推断。时间参数使用 YYYY-MM-DDTHH:mm 本地时间。
5. 用户问“怎么用/在哪里/如何操作”时优先调用 search_help，依据返回指南回答并保留帮助卡片。用户要求前往某功能时调用 navigate_system；不可编造视图，不可绕过角色限制。
6. 修改本人预约使用 propose_edit_booking，只改用户明确提出的时间、用途或人数；长期续期使用 propose_renew_booking。涉密变更不通过助手生成，引导用户在正式表单和保密流程中处理。
7. 组织同步应用、保密白名单与授权、集成补偿或重放、设备撤销或重启、备份恢复等高影响操作，只提供角色化导航和操作指南，不声称已执行。
8. 工具返回 ok:false 时如实说明原因和下一步，不把失败说成成功。回答用中文，先结论后细节，不暴露 JSON、工具名或参数结构。
9. 用户问待办时先调用 get_my_todos。审批和工单能力按真实角色提供，参会人也可在有效时间窗内签到。涉密工单只按具体责任范围提供履约所需信息，不得借此披露会议主题、申请人或参会人。
10. 修订上一份申请草案时，“当前申请草案”JSON 是唯一权威版本。只修改明确要求变更的字段，其他字段原样沿用；资源或时段变化时重新查询空档。
11. 用户询问东方蓝或其他界面主题时，依据 search_help 指南说明桌面侧栏底部“界面风格”和移动端“更多 → 界面主题”入口。助手不直接修改偏好，不得声称已经切换主题。
12. 用户询问中国东方标志、东方蓝总部3D外观或总部3D礼堂时，依据 search_help 说明侧栏展开/折叠品牌显示、总部3D与空间剖切同步主题、经典主题恢复，以及主席台、比例排座和中央过道。助手不能修改品牌资产、界面偏好、3D座位或房间布局，不得声称已完成此类维护。
13. 动态审批规则集只能由系统管理员在“流程配置”中维护本地草稿并发布。助手只提供指南和导航，不直接新增、编辑、删除或发布规则，也不改写审批历史；说明新申请使用最新发布版本，在途申请继续按提交时冻结的规则和流程处理。
14. 用户询问整栋或单层楼层图导入时，依据 search_help 说明系统管理员入口、JSON/系统Excel模板、原生楼层图Excel和单层PNG/JPEG本地OCR，以及统一预检差异和明确确认步骤。原生Excel按工作表、打印区域、合并单元格、行高和列宽识别，二层优先“全”、十四层优先“新”；必须提示人工核对文字、类别和坐标，不代表兼容任意Excel。图片匹配房间的部门、人员等多行识别文字变化会进入预检，保留原UID、类别、维护备注和几何，纯格式差异不制造更新，识别误字必须人工核对。必须区分Excel/JSON省略会软停用与图片漏识别会保留，并说明稳定UID、既有楼层范围和已映射房间保护。助手不直接上传、识别或修改布局，不得声称已经预检或导入。
15. 用户询问总部3D的具体楼栋、楼层、房间、部门、使用人、面积、维护记录、资源映射或处置状态时，必须先调用 query_hq3d_spaces 实时取数，不得凭模型记忆或帮助文案编造。可使用楼栋、楼层和房号/房间名/部门/使用人关键词组合查询；结果以房间资料覆盖后的当前值为准，保留查询附带的楼栋、楼层或唯一房间定位卡片。资源映射和可预订候选状态不等于已完成资源建档或当前可预约，预约仍须查询资源空档并走正式申请。查询工具只读，不上传、识别、预检、导入布局，也不修改房间资料、维护记录或映射。`;

export interface TraceEntry {
  tool: string;
  args: any;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface AgentHooks {
  onStatus?: (phase: 'thinking' | 'running', tool?: string) => void;
  onDelta?: (text: string) => void;
  onToolCallStart?: (tool: string) => void;
  onTrace?: (entry: TraceEntry) => void;
  onAction?: (action: AgentAction) => void;
  isCancelled?: () => boolean;
  signal?: AbortSignal;
}

export interface AgentOutcome {
  reply: string;
  actions: AgentAction[];
  trace: TraceEntry[];
  turns: number;
}

const sanitizeHistory = (raw: any): ChatMessage[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-MAX_HISTORY)
    .map(item => ({ role: item.role, content: item.content.slice(0, MAX_INPUT_CHARS) }));
};

const dedupeActions = (actions: AgentAction[]) => {
  const seen = new Set<string>();
  return actions.filter(action => {
    const key = JSON.stringify(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const runAgent = async (
  db: OfficeDb,
  user: User,
  userId: string,
  history: ChatMessage[],
  hooks: AgentHooks = {}
): Promise<AgentOutcome> => {
  const ctx = { userId, now: new Date() };
  const tools = toolsForRoles(user.role || [], db.workflow || [], db.workOrders || []);
  const allowed = new Set(tools.map(tool => tool.function.name));
  const executor = createExecutor(db, ctx);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\n${buildContextSummary(db, ctx)}\n\n本次会话可用工具：${tools.map(t => t.function.name).join('、')}`
    },
    ...history
  ];

  const actions: AgentAction[] = [];
  const trace: TraceEntry[] = [];
  let reply = '';
  let turns = 0;

  for (; turns < MAX_TURNS; turns++) {
    if (hooks.isCancelled?.()) break;
    hooks.onStatus?.('thinking');

    const message = await streamChatCompletion({ messages, tools, tool_choice: 'auto' }, {
      onDelta: hooks.onDelta,
      onToolCallStart: (name) => {
        hooks.onStatus?.('running', name);
        hooks.onToolCallStart?.(name);
      }
    }, { signal: hooks.signal });

    if (!message.content && !message.tool_calls?.length) throw new Error('EMPTY_RESPONSE');
    messages.push(message);

    if (!message.tool_calls?.length) {
      reply = message.content || '';
      break;
    }

    for (const call of message.tool_calls) {
      if (hooks.isCancelled?.()) break;
      const name = call?.function?.name || '';
      let args: any = {};
      try {
        args = JSON.parse(call?.function?.arguments || '{}');
      } catch {
        args = {};
      }

      const startedAt = Date.now();
      let outcome: ToolResult;
      if (!allowed.has(name)) {
        outcome = { ok: false, error: `当前角色无权调用 ${name}。` };
      } else if (!executor[name]) {
        outcome = { ok: false, error: `工具 ${name} 未实现。` };
      } else {
        try {
          outcome = await executor[name](args);
        } catch (err: any) {
          outcome = { ok: false, error: `工具执行异常：${err?.message || err}` };
        }
      }

      if (outcome.action) {
        actions.push(outcome.action);
        hooks.onAction?.(outcome.action);
      }

      const entry: TraceEntry = { tool: name, args, ok: outcome.ok, ms: Date.now() - startedAt };
      if (outcome.error) entry.error = outcome.error;
      trace.push(entry);
      hooks.onTrace?.(entry);

      // action 不下发给模型，避免它重复描述卡片内容
      const { action, ...forModel } = outcome;
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(forModel) });
    }
  }

  if (!reply && actions.length) reply = '已生成待确认的操作，请核对卡片信息后确认。';
  if (!reply) reply = '这次没能完成处理，可以换个说法或补充一下关键信息（时间、人数、资源）再试一次。';

  return { reply, actions: dedupeActions(actions), trace, turns: turns + 1 };
};

const readRequest = async (req: IncomingMessage) => {
  const body = await readJson(req);
  const history = sanitizeHistory(body.messages);
  return { body, history };
};

export async function handleAgentChat(req: IncomingMessage, res: ServerResponse, user: User) {
  const { body, history } = await readRequest(req);
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return send(res, 400, { error: 'NO_USER_MESSAGE' });
  }
  const db = getActorDbView(await readDb(), user);
  const userId = user.id;
  const wantsStream = body.stream === true || String(req.headers.accept || '').includes('text/event-stream');
  const controller = new AbortController();
  let closed = false;
  const cancel = () => {
    closed = true;
    if (!controller.signal.aborted) controller.abort();
  };
  const cleanup = () => {
    req.removeListener('aborted', cancel);
    res.removeListener('close', cancel);
  };
  req.once('aborted', cancel);
  res.once('close', cancel);

  if (!wantsStream) {
    try {
      const outcome = await runAgent(db, user, userId, history, { signal: controller.signal, isCancelled: () => closed });
      if (!closed) return send(res, 200, outcome);
    } catch (err: any) {
      if (closed) return;
      if (err instanceof LlmNotConfiguredError) return send(res, 503, { error: 'AI_NOT_CONFIGURED' });
      if (err instanceof LlmTimeoutError) return send(res, 504, { error: 'AI_UPSTREAM_TIMEOUT' });
      if (err instanceof LlmCancelledError) return send(res, 499, { error: 'AI_REQUEST_CANCELLED' });
      return send(res, 502, { error: 'AI_UPSTREAM_ERROR', detail: String(err?.message || err) });
    } finally {
      cleanup();
    }
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  const emit = (payload: any) => {
    if (closed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (closed || res.writableEnded) return;
    res.write(': ping\n\n');
  }, 15000);

  const startedAt = Date.now();
  try {
    const outcome = await runAgent(db, user, userId, history, {
      onStatus: (phase, tool) => emit({ type: 'status', phase, tool }),
      onDelta: (text) => emit({ type: 'delta', text }),
      onTrace: (entry) => emit({ type: 'trace', entry }),
      onAction: (action) => emit({ type: 'action', action }),
      isCancelled: () => closed || controller.signal.aborted,
      signal: controller.signal
    });
    emit({ type: 'done', ...outcome, elapsed: Date.now() - startedAt });
  } catch (err: any) {
    if (err instanceof LlmNotConfiguredError) {
      emit({ type: 'error', error: 'AI_NOT_CONFIGURED', message: 'AI 服务尚未配置，请联系管理员设置 DEEPSEEK_API_KEY。' });
    } else if (err instanceof LlmTimeoutError) {
      emit({ type: 'error', error: 'AI_UPSTREAM_TIMEOUT', message: '上游服务响应超时，请稍后重试。' });
    } else if (!(err instanceof LlmCancelledError)) {
      emit({ type: 'error', error: 'AI_UPSTREAM_ERROR', message: `上游服务异常：${String(err?.message || err)}` });
    }
  } finally {
    clearInterval(heartbeat);
    cleanup();
    if (!closed && !res.writableEnded) res.end();
  }
}

export function handleAgentStatus(req: IncomingMessage, res: ServerResponse) {
  return send(res, 200, { enabled: Boolean(process.env.DEEPSEEK_API_KEY), provider: 'deepseek', model: 'deepseek-chat', streaming: true });
}
