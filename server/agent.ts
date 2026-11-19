import type { IncomingMessage, ServerResponse } from 'node:http';
import { readDb } from './db.ts';
import { chatCompletion, LlmNotConfiguredError, type ChatMessage } from './llm.ts';
import { buildContextSummary, createExecutor, toolsForRoles, type AgentAction, type ToolResult } from './tools.ts';
import { readBody, send } from './http.ts';

const MAX_TURNS = 6;
const MAX_HISTORY = 20;
const MAX_INPUT_CHARS = 4000;

const SYSTEM_PROMPT = `你是「智办」，智慧办公空间管理系统（SmartOffice）的操作助手，帮助用户查资源、订会议室、走审批、看报表。

工作原则：
1. 凡是涉及具体资源、时间、人员、预订的回答，必须先调用工具取数。禁止编造资源名称、容量、时段、预订 ID 或统计数字。
2. 预订必须分两步：先 find_available_resources 查空闲，选定一个资源后再 propose_booking 生成提案。不要跳过查空闲直接提案。
3. propose_* 类工具只生成"待确认草案"，不会真正落库。所以你要说"已生成提案，点击确认后提交"，绝不能说"已经订好了"。
4. 参数不全时，只追问最关键的一个问题（通常是时间或人数），不要一次问四五个。
5. 默认值：未说时长按 1 小时；未说人数按 1 人；未说日期时根据当前时间推断（"下午"指 13:00-18:00，"明天"指次日）。时间参数一律输出 YYYY-MM-DDTHH:mm 格式的本地时间。
6. 工具返回 ok:false 时，如实转述真实原因并给出可执行建议（换个时段、换资源、补信息），不要把失败说成成功。
7. 回答用中文，先给结论再给细节，简洁。不要把 JSON、工具名、参数结构暴露给用户。
8. 用户身份和权限已经由系统校验，不要向用户索要 ID 或权限信息。`;

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

export async function handleAgentChat(req: IncomingMessage, res: ServerResponse) {
  let body: any;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch {
    return send(res, 400, { error: 'INVALID_JSON' });
  }

  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (!userId) return send(res, 400, { error: 'MISSING_USER' });

  const db = readDb();
  const user = (db.users || []).find((u: any) => u.id === userId);
  if (!user) return send(res, 401, { error: 'UNKNOWN_USER' });

  const history = sanitizeHistory(body.messages);
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return send(res, 400, { error: 'NO_USER_MESSAGE' });
  }

  const ctx = { userId, now: new Date() };
  const tools = toolsForRoles(user.role || []);
  const allowed = new Set(tools.map(tool => tool.function.name));
  const executor = createExecutor(db, ctx);

  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${buildContextSummary(db, ctx)}\n\n本次会话可用工具：${tools.map(t => t.function.name).join('、')}` },
    ...history
  ];

  const actions: AgentAction[] = [];
  const trace: any[] = [];
  let reply = '';
  let turns = 0;

  try {
    for (; turns < MAX_TURNS; turns++) {
      const result = await chatCompletion({ messages, tools, tool_choice: 'auto' });
      const message = result?.choices?.[0]?.message;
      if (!message) throw new Error('EMPTY_RESPONSE');

      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });

      if (!message.tool_calls?.length) {
        reply = message.content || '';
        break;
      }

      for (const call of message.tool_calls) {
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

        if (outcome.action) actions.push(outcome.action);
        const { action, ...forModel } = outcome;
        trace.push({ tool: name, args, ok: outcome.ok, ms: Date.now() - startedAt, error: outcome.error });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(forModel) });
      }
    }
  } catch (err: any) {
    if (err instanceof LlmNotConfiguredError) return send(res, 503, { error: 'AI_NOT_CONFIGURED' });
    return send(res, 502, { error: 'AI_UPSTREAM_ERROR', detail: String(err?.message || err) });
  }

  if (!reply && actions.length) reply = '已生成待确认的操作，请核对卡片信息后确认。';
  if (!reply) reply = '这次没能完成处理，可以换个说法或补充一下关键信息（时间、人数、资源）再试一次。';

  return send(res, 200, {
    reply,
    actions: dedupeActions(actions),
    trace,
    turns: turns + 1
  });
}

export function handleAgentStatus(req: IncomingMessage, res: ServerResponse) {
  return send(res, 200, { enabled: Boolean(process.env.DEEPSEEK_API_KEY), provider: 'deepseek', model: 'deepseek-chat' });
}
