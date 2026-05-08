import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import { streamDeepseekChatCompletions } from './deepseekProxy';
import crypto from 'node:crypto';
import { generateQianfanImage } from './qianfanImage';
import { saveShare, getShare, SHARE_TTL_MS } from './shareStore';
import { fetchPublicGoogleSheetAsCsv } from './googleSheetsFetch';

dotenv.config();

const app = express();
app.use(express.json({ limit: '12mb' }));

// If you access from Vite dev server without proxy:
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

type ChatSession = {
  apiKey?: string;
  model: string;
  mode?: 'basic' | 'advanced';
  /** 图表模式拆分时：仅生成三套方案块（与普通模式内置模板配合） */
  chartPart?: 'full' | 'schemes-only';
  messages: Array<{ role: string; content: string }>;
  createdAt: number;
};

const chatSessions = new Map<string, ChatSession>();

function extractInputCsvFromPrompt(text: string): string {
  const m = text.match(/【输入内容】\s*([\s\S]*)$/);
  return (m?.[1] || '').trim();
}

function inferColumns(csvText: string): string[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  return lines[0].split(',').map((s) => s.trim()).filter(Boolean);
}

function buildBasicModeResult(messages: Array<{ role: string; content: string }>): string {
  const latestUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const csvText = extractInputCsvFromPrompt(latestUser);
  const columns = inferColumns(csvText);
  const c1 = columns[0] || '类别';
  const c2 = columns[1] || '数值';
  const c3 = columns[2] || '时间';

  return `<self_check>
已启用普通模式（无 Key）。基于内置规则执行字段与图表推荐，不调用大模型。
</self_check>
## 数据参考分析报告
### 一、数据结构与可分析性判断
- 当前识别到 ${columns.length || 0} 列，列名候选为：${columns.length ? columns.join('、') : '（未识别到明确表头）'}。
- 依据字段命名与常见统计语义，系统优先采用“分类变量 + 数值变量 + 时间变量”的三层分析路径，确保先描述、再比较、后解释。
- 在无外部模型参与的普通模式下，报告强调可复核与可复现，避免过度推断。

### 二、建议优先阅读的分析视角
- **结构性对比视角**：先看不同类别在核心指标上的差异，判断是否存在头部集中或长尾。
- **时间演化视角**：若含时间字段（如 ${c3}），优先看趋势方向、阶段变化与波动区间。
- **关系解释视角**：通过变量关系图识别可能相关线索，但仅将其作为假设，不直接视为因果。

### 三、阅读与复现建议
- 先阅读下方三套方案的“渲染图”理解结论，再复制各方案 Python 代码做本地复现。
- 若你后续接入高级模式（或配置后端 DeepSeek Key），可在同一数据上获得更细致的统计解释与方法学扩展。

===方案一===
### 创新视角 1：分类对比（柱状图）
方案说明：适合快速比较不同类别的规模差异，便于发现头部/尾部分布。
\`\`\`json plotly
{
  "data": [
    {
      "type": "bar",
      "x": ["A", "B", "C", "D"],
      "y": [12, 19, 9, 14],
      "name": "${c2}",
      "hovertemplate": "${c1}: %{x}<br>${c2}: %{y}<extra></extra>"
    }
  ],
  "layout": {
    "title": "普通模式-分类对比",
    "xaxis": {"title": "${c1}"},
    "yaxis": {"title": "${c2}"},
    "uirevision": "shutu-uirevision",
    "hovermode": "closest"
  }
}
\`\`\`
\`\`\`python
import plotly.express as px
df = ...  # 你的数据
fig = px.bar(df, x="${c1}", y="${c2}", title="普通模式-分类对比")
fig.show()
\`\`\`

===方案二===
### 创新视角 2：时间趋势（折线图）
方案说明：用于观察随时间变化的趋势与波动，适合检测拐点。
\`\`\`json plotly
{
  "data": [
    {
      "type": "scatter",
      "mode": "lines+markers",
      "x": ["2024-01", "2024-02", "2024-03", "2024-04"],
      "y": [10, 13, 15, 14],
      "name": "趋势值",
      "hovertemplate": "${c3}: %{x}<br>值: %{y}<extra></extra>"
    }
  ],
  "layout": {
    "title": "普通模式-时间趋势",
    "xaxis": {"title": "${c3}"},
    "yaxis": {"title": "${c2}"},
    "uirevision": "shutu-uirevision",
    "hovermode": "closest"
  }
}
\`\`\`
\`\`\`python
import plotly.express as px
df = ...  # 你的数据
fig = px.line(df, x="${c3}", y="${c2}", title="普通模式-时间趋势", markers=True)
fig.show()
\`\`\`

===方案三===
### 创新视角 3：数值关系（散点图）
方案说明：用于探索变量间关系，识别相关性与离群点线索。
\`\`\`json plotly
{
  "data": [
    {
      "type": "scatter",
      "mode": "markers",
      "x": [1, 2, 3, 4, 5],
      "y": [2, 3, 5, 7, 8],
      "name": "相关关系",
      "hovertemplate": "x: %{x}<br>y: %{y}<extra></extra>"
    }
  ],
  "layout": {
    "title": "普通模式-数值关系",
    "xaxis": {"title": "${c1}"},
    "yaxis": {"title": "${c2}"},
    "uirevision": "shutu-uirevision",
    "hovermode": "closest"
  }
}
\`\`\`
\`\`\`python
import plotly.express as px
df = ...  # 你的数据
fig = px.scatter(df, x="${c1}", y="${c2}", title="普通模式-数值关系")
fig.show()
\`\`\`
`;
}

/** 普通模式 + 图表拆流：仅三套方案，避免与 ECNU 数据概览重复 */
function buildBasicModeSchemesOnly(messages: Array<{ role: string; content: string }>): string {
  const latestUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const csvText = extractInputCsvFromPrompt(latestUser);
  const columns = inferColumns(csvText);
  const c1 = columns[0] || '类别';
  const c2 = columns[1] || '数值';
  const c3 = columns[2] || '时间';

  return `===方案一===
### 创新视角 1：分类对比（柱状图）
方案说明：适合快速比较不同类别的规模差异，便于发现头部/尾部分布。
\`\`\`json plotly
{
  "data": [
    {
      "type": "bar",
      "x": ["A", "B", "C", "D"],
      "y": [12, 19, 9, 14],
      "name": "${c2}",
      "hovertemplate": "${c1}: %{x}<br>${c2}: %{y}<extra></extra>"
    }
  ],
  "layout": {
    "title": "普通模式-分类对比",
    "xaxis": {"title": "${c1}"},
    "yaxis": {"title": "${c2}"},
    "uirevision": "shutu-uirevision",
    "hovermode": "closest"
  }
}
\`\`\`
\`\`\`python
import plotly.express as px
df = ...  # 你的数据
fig = px.bar(df, x="${c1}", y="${c2}", title="普通模式-分类对比")
fig.show()
\`\`\`

===方案二===
### 创新视角 2：时间趋势（折线图）
方案说明：用于观察随时间变化的趋势与波动，适合检测拐点。
\`\`\`json plotly
{
  "data": [
    {
      "type": "scatter",
      "mode": "lines+markers",
      "x": ["2024-01", "2024-02", "2024-03", "2024-04"],
      "y": [10, 13, 15, 14],
      "name": "趋势值",
      "hovertemplate": "${c3}: %{x}<br>值: %{y}<extra></extra>"
    }
  ],
  "layout": {
    "title": "普通模式-时间趋势",
    "xaxis": {"title": "${c3}"},
    "yaxis": {"title": "${c2}"},
    "uirevision": "shutu-uirevision",
    "hovermode": "closest"
  }
}
\`\`\`
\`\`\`python
import plotly.express as px
df = ...  # 你的数据
fig = px.line(df, x="${c3}", y="${c2}", title="普通模式-时间趋势", markers=True)
fig.show()
\`\`\`

===方案三===
### 创新视角 3：数值关系（散点图）
方案说明：用于探索变量间关系，识别相关性与离群点线索。
\`\`\`json plotly
{
  "data": [
    {
      "type": "scatter",
      "mode": "markers",
      "x": [1, 2, 3, 4, 5],
      "y": [2, 3, 5, 7, 8],
      "name": "相关关系",
      "hovertemplate": "x: %{x}<br>y: %{y}<extra></extra>"
    }
  ],
  "layout": {
    "title": "普通模式-数值关系",
    "xaxis": {"title": "${c1}"},
    "yaxis": {"title": "${c2}"},
    "uirevision": "shutu-uirevision",
    "hovermode": "closest"
  }
}
\`\`\`
\`\`\`python
import plotly.express as px
df = ...  # 你的数据
fig = px.scatter(df, x="${c1}", y="${c2}", title="普通模式-数值关系")
fig.show()
\`\`\`
`;
}

app.post('/api/ecnu/chat', async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: '缺少 Authorization: Bearer <token>' });
    return;
  }
  const { model = 'ecnu-plus', messages, stream = false } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages 必填且为数组' });
    return;
  }
  try {
    const r = await fetch('https://chat.ecnu.edu.cn/open/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify({ model, messages, stream }),
    });
    const json: unknown = await r.json().catch(() => ({}));
    res.status(r.status).json(json);
  } catch (e: any) {
    res.status(502).json({ error: e?.message || '转发 ECNU 请求失败' });
  }
});

app.post('/api/chat/session', (req: Request, res: Response) => {
  const { apiKey, model, mode, messages, chartPart } = req.body || {};
  if (!model || !messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Invalid request: model/messages required.' });
    return;
  }
  const sessionId = crypto.randomUUID();
  chatSessions.set(sessionId, {
    apiKey: typeof apiKey === 'string' ? apiKey : undefined,
    model,
    mode: mode === 'advanced' ? 'advanced' : 'basic',
    chartPart: chartPart === 'schemes-only' ? 'schemes-only' : 'full',
    messages,
    createdAt: Date.now(),
  });
  res.json({ sessionId });
});

app.get('/api/chat', async (req: Request, res: Response) => {
  const sessionId = String(req.query.sessionId || '');
  const session = chatSessions.get(sessionId);
  if (!session) {
    res.status(404).end('Session not found');
    return;
  }
  chatSessions.delete(sessionId);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const send = (payload: any) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const hasUserKey = Boolean(session.apiKey && session.apiKey.trim());
    const hasServerKey = Boolean(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim());
    // 高级模式可使用「用户 Key」或「后端环境变量 Key」；仅在两者都缺失时回退普通模板
    const canUseDeepseek = session.mode === 'advanced' && (hasUserKey || hasServerKey);
    if (!canUseDeepseek) {
      const basic =
        session.chartPart === 'schemes-only'
          ? buildBasicModeSchemesOnly(session.messages)
          : buildBasicModeResult(session.messages);
      // pseudo-stream chunks so UI shows progressive output
      const chunkSize = 220;
      for (let i = 0; i < basic.length; i += chunkSize) {
        send({ type: 'chunk', text: basic.slice(i, i + chunkSize) });
      }
      send({ type: 'done' });
      res.end();
      return;
    }

    await streamDeepseekChatCompletions({
      apiKey: session.apiKey,
      model: session.model,
      messages: session.messages,
      onToken: (token) => send({ type: 'chunk', text: token }),
    });
    send({ type: 'done' });
    res.end();
  } catch (e: any) {
    send({ type: 'error', message: e?.message || 'chat stream failed' });
    res.end();
  }
});

app.post('/api/images/generate', async (req: Request, res: Response) => {
  const { prompt, negative_prompt, n, size } = req.body || {};
  try {
    const urls = await generateQianfanImage({
      prompt: String(prompt || ''),
      negative_prompt: typeof negative_prompt === 'string' ? negative_prompt : '',
      n: typeof n === 'number' ? n : 1,
      size: typeof size === 'string' ? size : '1024x1024',
    });
    res.json({ data: urls.map((url) => ({ url })) });
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || '图片生成失败，请稍后重试或检查千帆配置',
    });
  }
});

app.post('/api/share', (req: Request, res: Response) => {
  const body = req.body || {};
  if (typeof body.result !== 'string' || !body.result.trim()) {
    res.status(400).json({ error: 'result 必填（Markdown 全文）' });
    return;
  }
  if (!body.parsed || typeof body.parsed !== 'object') {
    res.status(400).json({ error: 'parsed 必填（解析后的结构化结果）' });
    return;
  }
  const mode = body.mode === 'image' ? 'image' : 'chart';
  const timestamp = typeof body.timestamp === 'number' ? body.timestamp : Date.now();
  const images = Array.isArray(body.images) ? body.images : undefined;
  try {
    const id = saveShare({
      result: body.result,
      parsed: body.parsed,
      mode,
      timestamp,
      images,
    });
    res.json({
      id,
      expiresInMs: SHARE_TTL_MS,
      expiresInHours: Math.round(SHARE_TTL_MS / 3600000),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || '创建分享失败' });
  }
});

app.get('/api/share/:id', (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) {
    res.status(400).json({ error: '缺少 id' });
    return;
  }
  const payload = getShare(id);
  if (!payload) {
    res.status(404).json({ error: '分享不存在或已过期（默认 24 小时）' });
    return;
  }
  res.json(payload);
});

app.post('/api/ai/deepseek/generate', async (req: Request, res: Response) => {
  const { apiKey, model, messages } = req.body || {};

  if (!model || !messages || !Array.isArray(messages)) {
    res.status(400).send('Invalid request: model/messages required.');
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    await streamDeepseekChatCompletions({
      apiKey,
      model,
      messages,
      onToken: (token) => {
        res.write(token);
      },
    });
    res.end();
  } catch (e: any) {
    const msg = e?.message || 'DeepSeek 代理失败';
    res.status(500).end(msg);
  }
});

/** 公开 Google 表格 → CSV（服务端拉取，避免浏览器 CORS） */
app.post('/api/sheets/fetch', async (req: Request, res: Response) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url) {
    res.status(400).json({ error: '缺少 url' });
    return;
  }
  if (!/docs\.google\.com/i.test(url) || !/spreadsheets\/d\//i.test(url)) {
    res.status(400).json({ error: '请粘贴完整的 Google 表格链接（含 /spreadsheets/d/...）。' });
    return;
  }
  try {
    const csv = await fetchPublicGoogleSheetAsCsv(url);
    res.json({ csv });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '拉取表格失败';
    res.status(422).json({ error: msg });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] deepseek proxy listening on http://localhost:${port}`);
});

