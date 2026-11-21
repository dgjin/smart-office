import type { IncomingMessage, ServerResponse } from 'node:http';
import { readDb } from './db.ts';
import { streamChatCompletion, LlmNotConfiguredError, type ChatMessage } from './llm.ts';
import { buildContextSummary, createExecutor, toolsForRoles, type AgentAction, type OfficeDb, type ToolResult } from './tools.ts';
import { readJson, send } from './http.ts';
import { getActorDbView } from './confidentiality.ts';
import type { User } from '../types.ts';

const MAX_TURNS = 6;
const MAX_HISTORY = 20;
const MAX_INPUT_CHARS = 4000;

const SYSTEM_PROMPT = `你是「智办」，智慧办公空间管理系统（SmartOffice）的操作助手，帮助用户查资源、订会议室、走审批、看报表。

工作原则：
1. 凡是涉及具体资源、时间、人员、预订的回答，必须先调用工具取数。禁止编造资源名称、容量、时段、预订 ID 或统计数字。
2. 用户说出"订/预约/安排/找个/占个/帮我留"等祈使句，就是在发起预订，不要先反问"要不要生成提案"。必须走完 find_available_resources → propose_booking，直接出提案卡片，让用户用卡片确认。只有纯询问（"还有空吗""有没有 10 人的会议室"）才只查不订。
3. propose_* 类工具只生成"待确认草案"，不会真正落库。预订草案确认后会打开完整申请表，用户仍需在表单中最终提交；绝不能说"已经订好了"或"确认卡片就会提交"。
4. 只对"缺了就订不成"的字段追问：时间区间、人数、资源（或足以确定的资源特征）。像会议用途、参会名单、茶水这类非关键字段，缺失时用合理默认值（用途填"会议"）直接出提案，把补充机会留到提案卡片之后，绝不为了这些反问。
5. 默认值：未说时长按 1 小时；未说人数按 1 人；未说日期时根据当前时间推断（"下午"指 13:00-18:00，"明天"指次日）。时间参数一律输出 YYYY-MM-DDTHH:mm 格式的本地时间。
6. 工具返回 ok:false 时，如实转述真实原因并给出可执行建议（换个时段、换资源、补信息），不要把失败说成成功。
7. 回答用中文，先给结论再给细节，简洁。不要把 JSON、工具名、参数结构暴露给用户。
8. 用户身份和权限已经由系统校验，不要向用户索要 ID 或权限信息。
9. 用户问"待办/该做什么/提醒我"时先调用 get_my_todos；待办卡片可以直接执行，工单完成必须先出提案让用户确认。
10. 用户要求修订上一份申请草案时，"当前申请草案"JSON 是唯一权威版本。只修改用户明确要求变更的字段，资源、用途、参会人、服务、领导和周期等未提及字段必须从 JSON 原样沿用，不得省略或自行替换。只有资源或时段变化时才重新查询空档，其他修订直接调用 propose_booking 重新校验并生成新版草案；不要说已修改，直到用户在新版卡片和申请表中确认。`;

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
  const tools = toolsForRoles(user.role || [], db.workflow || []);
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
    });

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

  if (!wantsStream) {
    try {
      const outcome = await runAgent(db, user, userId, history);
      return send(res, 200, outcome);
    } catch (err: any) {
      if (err instanceof LlmNotConfiguredError) return send(res, 503, { error: 'AI_NOT_CONFIGURED' });
      return send(res, 502, { error: 'AI_UPSTREAM_ERROR', detail: String(err?.message || err) });
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  let closed = false;
  req.on('close', () => { closed = true; });

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
      isCancelled: () => closed
    });
    emit({ type: 'done', ...outcome, elapsed: Date.now() - startedAt });
  } catch (err: any) {
    if (err instanceof LlmNotConfiguredError) {
      emit({ type: 'error', error: 'AI_NOT_CONFIGURED', message: 'AI 服务尚未配置，请联系管理员设置 DEEPSEEK_API_KEY。' });
    } else {
      emit({ type: 'error', error: 'AI_UPSTREAM_ERROR', message: `上游服务异常：${String(err?.message || err)}` });
    }
  } finally {
    clearInterval(heartbeat);
    if (!closed && !res.writableEnded) res.end();
  }
}

export function handleAgentStatus(req: IncomingMessage, res: ServerResponse) {
  return send(res, 200, { enabled: Boolean(process.env.DEEPSEEK_API_KEY), provider: 'deepseek', model: 'deepseek-chat', streaming: true });
}
