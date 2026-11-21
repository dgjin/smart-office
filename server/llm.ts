import { logEvent } from './observability.ts';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

let proxyConfigured = false;

/** Node 原生 fetch 不读代理环境变量，本机访问 DeepSeek 需要显式挂 ProxyAgent。 */
export async function ensureProxy() {
  if (proxyConfigured) return;
  proxyConfigured = true;
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (!raw) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(raw.replace(/^socks5h:/, 'socks5:')));
  } catch (err: any) {
    logEvent('warn', 'llm.proxy_setup_failed', { errorName: err?.name, code: err?.code });
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('AI_NOT_CONFIGURED');
  }
}

export async function chatCompletion(payload: Record<string, any>) {
  await ensureProxy();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new LlmNotConfiguredError();

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, stream: false, temperature: 0.2, ...payload })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`DeepSeek ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onToolCallStart?: (name: string) => void;
}

/**
 * 流式调用：边收边吐，同时把碎片化的 tool_calls 拼回完整结构。
 * 返回的 message 与 chatCompletion 的非流式 message 同构，方便上层共用同一套 tool loop。
 */
export async function streamChatCompletion(payload: Record<string, any>, handlers: StreamHandlers = {}): Promise<ChatMessage> {
  await ensureProxy();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new LlmNotConfiguredError();

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, ...payload, stream: true })
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(`DeepSeek ${response.status}: ${detail.slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls: any[] = [];
  const announced = new Set<string>();

  const consume = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;

    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }

    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) return;

    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      handlers.onDelta?.(delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const fragment of delta.tool_calls) {
        const index = typeof fragment.index === 'number' ? fragment.index : toolCalls.length;
        if (!toolCalls[index]) {
          toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        const slot = toolCalls[index];
        if (fragment.id) slot.id = fragment.id;
        const name = fragment.function?.name;
        // 名称偶尔分片下发，取更长的一份避免被截断
        if (name && name.length > slot.function.name.length) {
          slot.function.name = name;
          if (!announced.has(name)) {
            announced.add(name);
            handlers.onToolCallStart?.(name);
          }
        }
        if (fragment.function?.arguments) slot.function.arguments += fragment.function.arguments;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) consume(line);
  }
  if (buffer) consume(buffer);

  const cleaned = toolCalls.filter(Boolean).map((call, index) => ({
    ...call,
    id: call.id || `call_${index}_${Date.now()}`
  }));

  return {
    role: 'assistant',
    content: content || null,
    ...(cleaned.length ? { tool_calls: cleaned } : {})
  };
}
