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
  } catch (err) {
    console.warn('[llm] proxy setup failed, using direct connection', err);
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
