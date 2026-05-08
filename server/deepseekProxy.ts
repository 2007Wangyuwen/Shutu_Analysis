type DeepseekMessage = { role: string; content: string };

export async function streamDeepseekChatCompletions(params: {
  apiKey?: string;
  model: string;
  messages: DeepseekMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
}): Promise<void> {
  const { apiKey, model, messages, signal, onToken } = params;

  const key = (apiKey && apiKey.trim()) || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error('缺少 DeepSeek API Key：请在后端环境变量 DEEPSEEK_API_KEY 配置。');
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const endpoint = process.env.DEEPSEEK_CHAT_COMPLETIONS_PATH || '/chat/completions';

  const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    throw new Error(text || `DeepSeek 调用失败：HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE: split by newline, parse data lines
    const lines = buffer.split('\n');
    // Keep last incomplete line in buffer
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (!line.startsWith('data:')) continue;

      const data = line.slice(5).trim();
      if (data === '[DONE]') return;

      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta;
        const token: string | undefined = delta?.content;
        // deepseek-reasoner may also emit reasoning_content; we intentionally ignore it.
        if (token) onToken(token);
      } catch {
        // ignore parse errors for non-json data
      }
    }
  }
}

