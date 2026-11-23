import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion, LlmCancelledError, LlmTimeoutError, streamChatCompletion } from '../server/llm.ts';

const encoder = new TextEncoder();

/** 用一个假的 fetch 把预设的 SSE 分片喂进去，验证拼包逻辑。 */
const withFakeStream = async (chunks: string[], run: () => Promise<void>) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as any;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
};

test('流式解析把单字 delta 完整还原', async () => {
  const out: string[] = [];
  const frames = ['明', '天', '下', '午'].map(text =>
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
  );
  frames.push('data: [DONE]\n\n');

  await withFakeStream(frames, async () => {
    const message = await streamChatCompletion({}, { onDelta: text => out.push(text) });
    assert.equal(message.content, '明天下午');
    assert.equal(out.join(''), '明天下午');
    assert.equal(message.tool_calls, undefined);
  });
});

test('碎片化 tool_calls 被合并成完整的一次调用', async () => {
  const announced: string[] = [];
  // 模拟真实情况：id 与 name 首批下发，arguments 分多片
  const frames = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'find_available_resources', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"startTi' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'me":"2026-11-20T15:00",' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"endTime":"2026-11-20T16:00"}' } }] } }] }
  ].map(payload => `data: ${JSON.stringify(payload)}\n\n`);

  await withFakeStream(frames, async () => {
    const message = await streamChatCompletion({}, { onToolCallStart: name => announced.push(name) });
    assert.equal(message.tool_calls?.length, 1);
    const call = message.tool_calls![0];
    assert.equal(call.id, 'call_abc');
    assert.equal(call.function.name, 'find_available_resources');
    assert.deepEqual(JSON.parse(call.function.arguments), {
      startTime: '2026-11-20T15:00',
      endTime: '2026-11-20T16:00'
    });
    assert.deepEqual(announced, ['find_available_resources']);
  });
});

test('并行多工具调用按 index 分开累积', async () => {
  const frames = [
    { choices: [{ delta: { tool_calls: [
      { index: 0, id: 'c0', function: { name: 'list_my_bookings', arguments: '{}' } },
      { index: 1, id: 'c1', function: { name: 'get_work_orders', arguments: '{"stat' } }
    ] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'us":"TODO"}' } }] } }] }
  ].map(payload => `data: ${JSON.stringify(payload)}\n\n`);

  await withFakeStream(frames, async () => {
    const message = await streamChatCompletion({});
    assert.equal(message.tool_calls?.length, 2);
    assert.equal(message.tool_calls![0].function.name, 'list_my_bookings');
    assert.equal(message.tool_calls![1].function.name, 'get_work_orders');
    assert.deepEqual(JSON.parse(message.tool_calls![1].function.arguments), { status: 'TODO' });
  });
});

test('SSE 块被截断在不同网络包里也能正确重组', async () => {
  const full = `data: ${JSON.stringify({ choices: [{ delta: { content: '好的' } }] })}\n\ndata: [DONE]\n\n`;
  // 故意从 JSON 中间切开，制造半包
  const cut = Math.floor(full.length / 2);
  const out: string[] = [];

  await withFakeStream([full.slice(0, cut), full.slice(cut)], async () => {
    const message = await streamChatCompletion({}, { onDelta: text => out.push(text) });
    assert.equal(message.content, '好的');
    assert.deepEqual(out, ['好的']);
  });
});

test('缺少 API Key 时抛出可识别的未配置错误', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(
      () => streamChatCompletion({}),
      (err: any) => err?.message === 'AI_NOT_CONFIGURED'
    );
  } finally {
    if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('流式上游超时后取消 reader 并抛出有界超时错误', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  let readerCancelled = false;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = (async () => new Response(new ReadableStream({
    cancel() { readerCancelled = true; }
  }), { status: 200 })) as any;
  try {
    await assert.rejects(
      () => streamChatCompletion({}, {}, { timeoutMs: 20 }),
      LlmTimeoutError
    );
    assert.equal(readerCancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('外部取消信号会中断非流式上游请求', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  globalThis.fetch = (async (_input: any, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as any;
  const controller = new AbortController();
  try {
    const pending = chatCompletion({}, { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    await assert.rejects(() => pending, LlmCancelledError);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
