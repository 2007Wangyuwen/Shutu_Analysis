export type DeepseekModel = 'deepseek-chat' | 'deepseek-reasoner' | (string & {});

export type DeepseekMessage = {
  role: 'system' | 'user' | 'assistant' | string;
  content: string;
};

export async function generateDeepseekTextStream(params: {
  apiKey?: string;
  model: DeepseekModel;
  mode?: 'basic' | 'advanced';
  /** 与 ECNU 拆分时：仅走「三套方案」模板或 DeepSeek 方案提示 */
  chartPart?: 'full' | 'schemes-only';
  messages: DeepseekMessage[];
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}): Promise<string> {
  const { apiKey, model, mode, chartPart, messages, signal, onChunk } = params;

  const createSessionRes = await fetch('/api/chat/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: apiKey?.trim() ? apiKey.trim() : undefined,
      model,
      mode: mode === 'advanced' ? 'advanced' : 'basic',
      chartPart: chartPart === 'schemes-only' ? 'schemes-only' : undefined,
      messages,
    }),
    signal
  });

  if (!createSessionRes.ok) {
    const text = await createSessionRes.text().catch(() => '');
    throw new Error(text || `创建会话失败：HTTP ${createSessionRes.status}`);
  }

  const { sessionId } = await createSessionRes.json();
  if (!sessionId) throw new Error('会话创建成功但未返回 sessionId');

  return new Promise<string>((resolve, reject) => {
    let full = '';
    const es = new EventSource(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`);

    const cleanup = () => {
      es.close();
      signal?.removeEventListener?.('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error('请求已取消'));
    };

    signal?.addEventListener?.('abort', onAbort);

    es.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        if (payload?.type === 'chunk' && payload?.text) {
          full += payload.text;
          onChunk?.(payload.text);
          return;
        }
        if (payload?.type === 'done') {
          cleanup();
          resolve(full);
          return;
        }
        if (payload?.type === 'error') {
          cleanup();
          reject(new Error(payload?.message || 'SSE 流式请求失败'));
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      cleanup();
      // if stream already has data and server closed without explicit done, return partial
      if (full) resolve(full);
      else reject(new Error('SSE 连接失败'));
    };
  });
}

