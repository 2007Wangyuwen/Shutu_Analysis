export type EcnuMessage = {
  role: 'system' | 'user' | 'assistant' | string;
  content: string;
};

const STORAGE_KEY = 'shutu_ecnu_api_key';

export function getStoredEcnuApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * 经本地开发服务器 /api/ecnu/chat 转发至华东师大 OpenAI 兼容接口，避免浏览器直连跨域问题。
 */
export async function callECNUChatCompletion(params: {
  messages: EcnuMessage[];
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const key = (params.apiKey ?? getStoredEcnuApiKey()).trim();
  if (!key) {
    throw new Error('请先在「API 设置」中填写 ECNU API Key（华东师大令牌）。');
  }

  const res = await fetch('/api/ecnu/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: params.model ?? 'ecnu-plus',
      messages: params.messages,
      stream: false,
    }),
    signal: params.signal,
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      (typeof json?.error === 'string' ? json.error : null) ||
      `ECNU 请求失败：HTTP ${res.status}`;
    throw new Error(msg);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('ECNU 返回内容为空或格式异常。');
  }
  return content.trim();
}

const CHART_INTERPRETATION_SYSTEM =
  '你是一个数据分析解说员，请用非技术语言解读图表，帮助人文社科学生理解数据背后的含义';

/**
 * 基于图表元信息与数据摘要，请求 ECNU 生成面向人文社科学生的通俗解读。
 */
export async function generateChartInterpretation(params: {
  chartTitle: string;
  chartType: string;
  dataSummary: string;
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { chartTitle, chartType, dataSummary } = params;
  const userContent = `请根据以下图表信息，用非技术语言解读数据含义与可能启示：

【图表标题】${chartTitle}
【图表类型】${chartType}
【数据摘要】
${dataSummary}`;

  return callECNUChatCompletion({
    apiKey: params.apiKey,
    model: params.model,
    signal: params.signal,
    messages: [
      { role: 'system', content: CHART_INTERPRETATION_SYSTEM },
      { role: 'user', content: userContent },
    ],
  });
}
