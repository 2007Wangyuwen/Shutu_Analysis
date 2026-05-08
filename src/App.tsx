import { useState, useMemo, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, FileSpreadsheet, Send, BarChart2, FileText, Code, MessageSquare, Settings2, Copy, Check, ChevronDown, ChevronUp, History, X, Clock, Edit3, ChevronLeft, ChevronRight, AlertCircle, Download, ImageDown, FileDown, LayoutTemplate, Info, Share2, Link2, Menu, ShieldCheck } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';
import html2canvas from 'html2canvas';
import { downloadCanvasAsA4Pdf } from './utils/canvasToA4Pdf';
import { motion, AnimatePresence } from 'framer-motion';
import PlotlyJsonEditor from './components/PlotlyJsonEditor';
import ChartBuilderControls from './components/ChartBuilderControls';
import ApiSettingsModal from './components/ApiSettingsModal';
import FileDropZone from './components/FileDropZone';
import { generateDeepseekTextStream, type DeepseekModel } from './api/deepseekGenerate';
import { callECNUChatCompletion, generateChartInterpretation } from './api/ecnuApi';
import { fetchGoogleSheetCsv } from './api/sheetsImport';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { parseCSVText } from './data/parseCSV';
import { inferSchema } from './data/inferSchema';
import { recommendCharts } from './data/recommendCharts';
import { toCsvText } from './data/toCsvText';
import { buildPlotlyFigure } from './plotly/plotlyBuilder';
import { summarizePlotlyFigureForInterpretation } from './plotly/summarizePlotlyForInterpretation';
import type { BuilderOptions, ChartRecommendation, InferredSchema } from './data/types';

const Plot = createPlotlyComponent(Plotly);

type QuickRequirementTemplate = { id: string; label: string; text: string };

/** 数据可视化：快速填入「具体需求」的分析场景 */
const CHART_QUICK_TEMPLATES: QuickRequirementTemplate[] = [
  {
    id: 'descriptive',
    label: '描述统计',
    text: '请围绕描述统计展开：关注各字段的有效样本量与缺失情况；对数值变量给出集中趋势与离散程度（如均值、中位数、标准差、分位数）；对分类变量给出类别频次与占比；必要时用直方图、箱线图等展示分布形态。',
  },
  {
    id: 'correlation',
    label: '相关性分析',
    text: '请围绕相关性分析展开：识别数值变量之间的关系强度与方向，优先考虑相关矩阵/热力图、散点图或散点图矩阵；指出相关性较强的变量对，并简要提示多重共线性或伪相关风险。',
  },
  {
    id: 'group',
    label: '分组对比',
    text: '请围绕分组对比展开：依据分类变量将样本分组，比较组间在关键数值指标上的差异（均值、中位数或整体分布）；适合柱状图、分组箱线图或小提琴图；可简要说明组间差异的解读角度。',
  },
  {
    id: 'time',
    label: '时间序列 / 趋势',
    text: '若数据含时间或顺序维度，请侧重趋势与波动：展示随时间的变化、可能的拐点或阶段划分；可配合折线图或分区对比；并简要说明趋势解读的前提与局限。',
  },
  {
    id: 'outlier',
    label: '异常与分布结构',
    text: '请侧重异常值与分布结构：识别潜在离群点、偏态或多峰；用箱线图、直方图或散点辅助说明；讨论对结论解释的潜在影响。',
  },
];

/** 应用模式：入口页 + 数据可视化工作区 */
type AppMode = 'select' | 'chart';



interface HistoryItem {
  id: string;
  date: string;
  mode: AppMode;
  dataInput: string;
  requirementInput: string;
  result: string;
}

interface ParsedOption {
  title: string;
  raw: string;
  plotlyJson: any | null;
  pythonCode: string | null;
  imagePrompt: string | null;
}

type ParsedResult = { selfCheck: string; intro: string; options: ParsedOption[] };

/** 分析主流程阶段：概览（ECNU）→ 方案流式（DeepSeek）→ 图表通俗解读（ECNU，可与主加载并行展示） */
type AnalysisStatus = 'idle' | 'overview' | 'schemes' | 'interpreting';

function getAnalysisStatusCopy(status: AnalysisStatus): { title: string; detail: string } | null {
  switch (status) {
    case 'overview':
      return {
        title: '正在生成数据概览',
        detail: '已通过华东师大 ecnu-plus 阅读您的数据与需求，正在输出结构化概览与自检说明。',
      };
    case 'schemes':
      return {
        title: '正在撰写三套方案',
        detail: 'DeepSeek 正在流式生成三套互异方案（说明、图表配置与代码），请稍候。',
      };
    case 'interpreting':
      return {
        title: '正在生成图表通俗解读',
        detail: '正在调用解读接口，把当前图表要点转写为便于汇报的通俗说明。',
      };
    case 'idle':
    default:
      return null;
  }
}

const ANALYSIS_CACHE_MAX_ENTRIES = 32;

/**
 * 区分图表/图像模式、是否填写 ECNU Key（图表模式下单路 DeepSeek vs ECNU 概览+DeepSeek）、以及输入文本。
 * 避免先无 Key 命中缓存后，补 Key 仍拿到旧单路结果。
 */
function makeAnalysisCacheKey(
  mode: 'chart',
  dataInput: string,
  requirementInput: string,
  hasEcnuKey: boolean
): string {
  return `${mode}\u241F${hasEcnuKey ? 'ecnu1' : 'ecnu0'}\u241F${dataInput}\u241F${requirementInput}`;
}

function hashAnalysisCacheKey(raw: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(h, 33) ^ raw.charCodeAt(i)) >>> 0;
  }
  return `${h.toString(16)}_${raw.length}`;
}

const analysisResultCacheLru = new Map<string, string>();

function getCachedAnalysisResult(keyHash: string): string | undefined {
  const v = analysisResultCacheLru.get(keyHash);
  if (v === undefined) return undefined;
  analysisResultCacheLru.delete(keyHash);
  analysisResultCacheLru.set(keyHash, v);
  return v;
}

function setCachedAnalysisResult(keyHash: string, markdown: string): void {
  if (analysisResultCacheLru.has(keyHash)) {
    analysisResultCacheLru.delete(keyHash);
  }
  analysisResultCacheLru.set(keyHash, markdown);
  while (analysisResultCacheLru.size > ANALYSIS_CACHE_MAX_ENTRIES) {
    const oldest = analysisResultCacheLru.keys().next().value;
    if (oldest === undefined) break;
    analysisResultCacheLru.delete(oldest);
  }
}

/** 加载中、尚无解析方案时：与真实方案卡同结构的占位骨架 */
function SchemeOptionSkeletonCards() {
  return (
    <div className="flex flex-col gap-4 mt-8">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="premium-panel border-t-4 border-t-[#1a1a1a] overflow-hidden animate-pulse"
        >
          <div className="w-full p-4 flex items-center justify-between bg-[#f5f2ed] border-b border-[rgba(26,26,26,0.08)] pointer-events-none">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="h-6 w-14 shrink-0 rounded-full bg-[#1a1a1a]/15" />
              <div className="h-4 flex-1 max-w-[min(280px,72%)] rounded bg-[#1a1a1a]/12" />
            </div>
            <div className="h-5 w-5 shrink-0 rounded bg-[#1a1a1a]/10" />
          </div>
          <div className="p-4 sm:p-6 space-y-3">
            <div className="h-3 w-full rounded bg-[#1a1a1a]/10" />
            <div className="h-3 w-[92%] rounded bg-[#1a1a1a]/08" />
            <div className="h-3 w-[70%] rounded bg-[#1a1a1a]/08" />
            <div className="h-24 w-full rounded-xl bg-[#1a1a1a]/06" />
          </div>
        </div>
      ))}
    </div>
  );
}

const SCHEME_DELIM_1 = '===方案一===';
const SCHEME_DELIM_2 = '===方案二===';
const SCHEME_DELIM_3 = '===方案三===';
const SCHEME_MARKERS_TAIL = [SCHEME_DELIM_1, SCHEME_DELIM_2, SCHEME_DELIM_3] as const;

/** 任一完整分隔符的最长「未完成」长度（仅末尾若干字符可能属于正在输入的分隔符） */
const MAX_INCOMPLETE_SCHEME_MARKER_LEN = Math.max(
  ...SCHEME_MARKERS_TAIL.map((m) => m.length - 1)
);

/**
 * 流式末尾可能正在输入「===方案一===」等分隔符：去掉不完整后缀，使 intro 可稳定渲染（含 Markdown 链接）。
 *
 * - 慢网下 chunk 可能极细（单字符）：`=`、`==`、`===`、`===方`、`===方案`、`===方案一` 等均为各 marker 的真前缀，会按从长到短匹配后剥掉最长一段。
 * - 浏览器将 SSE/UTF-8 解码为 JS 字符串后，通常不会出现「多字节汉字被切成非法半个字」；若见 � 多为解码替换字符，非本函数职责。
 * - 仅检查末尾 {@link MAX_INCOMPLETE_SCHEME_MARKER_LEN} 个字符，避免在长 intro 上从 len=body.length 向下扫带来的无谓比较。
 */
function stripIncompleteTrailingSchemeMarker(body: string): string {
  const maxLen = Math.min(body.length, MAX_INCOMPLETE_SCHEME_MARKER_LEN);
  for (let len = maxLen; len > 0; len--) {
    const suf = body.slice(-len);
    for (const marker of SCHEME_MARKERS_TAIL) {
      if (marker.startsWith(suf) && suf.length < marker.length) {
        return body.slice(0, -len);
      }
    }
  }
  return body;
}

/**
 * 解析模型 Markdown；兼容流式不完整内容（未闭合的 self_check / 代码块仅忽略，不抛错）。
 * Plotly JSON 仅在 ``` 代码块完整闭合且 JSON.parse 成功时填入。
 * Markdown 链接 `[text](url)`、GFM 自动链接等不会被当作围栏代码块处理或剥离；仅匹配 ```…``` 围栏与 `<image_prompt>`。
 *
 * intro：在首个完整「===方案一===」之前的全部正文（去掉 self_check 后）；流式时若分隔符未写完，已接收部分计入 intro。
 */
function parseResult(text: string): ParsedResult {
  const selfCheckMatch = text.match(/<self_check>([\s\S]*?)<\/self_check>/);
  const selfCheck = selfCheckMatch ? selfCheckMatch[1].trim() : '';

  let textWithoutSelfCheck = text;
  if (/<self_check>[\s\S]*?<\/self_check>/.test(text)) {
    textWithoutSelfCheck = text.replace(/<self_check>[\s\S]*?<\/self_check>/, '');
  } else if (/<self_check>/.test(text)) {
    textWithoutSelfCheck = text.replace(/<self_check>[\s\S]*$/, '');
  }

  const bodyRaw = textWithoutSelfCheck;
  const idxFirst = bodyRaw.indexOf(SCHEME_DELIM_1);

  let intro: string;
  let tailAfterFirst: string;

  if (idxFirst >= 0) {
    intro = bodyRaw.slice(0, idxFirst).trim();
    tailAfterFirst = bodyRaw.slice(idxFirst + SCHEME_DELIM_1.length);
  } else {
    intro = stripIncompleteTrailingSchemeMarker(bodyRaw).trim();
    tailAfterFirst = '';
  }

  const subParts = tailAfterFirst.split(/===方案[二三]===/);
  const options: ParsedOption[] = [];
  for (let i = 1; i <= 3; i++) {
    const optionText = subParts[i - 1]?.trim();
    if (!optionText) continue;

    let plotlyJson: any | null = null;
    /** 仅匹配闭合的 ```json plotly / ```plotly 围栏；与行内链接、反引号代码无关 */
    const jsonBlockRegex = /```(?:json(?:\s+plotly)?|plotly)\s*([\s\S]*?)```/gi;
    let m: RegExpExecArray | null = null;
    while ((m = jsonBlockRegex.exec(optionText)) !== null) {
      try {
        const candidate = JSON.parse((m[1] || '').trim());
        if (candidate && typeof candidate === 'object' && candidate.data && candidate.layout) {
          plotlyJson = candidate;
          break;
        }
      } catch {
        /* 流式中间态或无效 JSON：跳过 */
      }
    }

    let pythonCode: string | null = null;
    const pythonMatch = optionText.match(/```python\s*([\s\S]*?)```/);
    if (pythonMatch) pythonCode = pythonMatch[1].trim();

    let imagePrompt: string | null = null;
    const imgPromptMatch = optionText.match(/<image_prompt>([\s\S]*?)<\/image_prompt>/);
    if (imgPromptMatch) imagePrompt = imgPromptMatch[1].trim();

    options.push({
      title: `方案${['一', '二', '三'][i - 1]}`,
      raw: optionText,
      plotlyJson,
      pythonCode,
      imagePrompt,
    });
  }

  return { selfCheck, intro, options };
}

const CHART_SYSTEM_INSTRUCTION = `
# Role
你是“术图”，一位严谨的数据科学顾问与可视化总监。你的任务是把用户提供的原始数据（CSV/Excel 转换后的文本）转化为：结构化的数据概览 + 3 个互补且创新的分析视角，并为每个视角生成可前端渲染的 Plotly 图表 JSON 与出版级 Python 作图/导出代码。

# Tone & Style
- **语言风格**：客观、严谨、自然的学术口吻，直接进入正题，禁止套话与空泛结论。
- **视觉/标注**：图表内部标签严格使用中文；去除冗余网格，轴线与字体风格保持统一（极简主义）。
- **色彩科学**：默认色盲友好型配色（如 Viridis/Magma 或 Nature 经典浅蓝/灰/橙组合），避免高饱和刺眼对比。

# 关键约束（必须满足）
1. **强制三套创新视角**：无论用户是否指定，都必须给出 **创新视角 1/2/3** 三套互补作图与解释。
2. **交互式可编辑严谨性**：每套方案对应的 Plotly JSON 必须在 \`layout\` 中设置：
   - \`uirevision\`: 固定字符串 \`"shutu-uirevision"\`
   - \`hovermode\`: \`"closest"\`
   并确保每个 trace 都有：
   - \`name\`（非空）
   - 中文 \`hovertemplate\`（避免缺失/空）
3. **Plotly JSON & Python 代码必须可解析**：每套方案必须包含可解析的
   - \`\`\`json plotly ... \`\`\`
   - \`\`\`python ... \`\`\`
4. **输出分隔符必须严格**：必须使用严格分隔符
   - \`===方案一===\`
   - \`===方案二===\`
   - \`===方案三===\`
   并让每个分隔符下方对应 **创新视角 1/2/3**。

# 输出结构要求（按顺序输出）
## 第零阶段：自我审查（在 <self_check> 中）
在 \`<self_check>...</self_check>\` 内说明：你会如何完成数据概览、如何确保 3 个创新视角不重复、以及是否会在每套方案中提供 Plotly JSON + Python 代码。

## 第一阶段：数据概览（放在分隔符之前，作为 intro）
请以 Markdown 二级标题 \`## 数据参考分析报告\` 开头，再展开详细分析。
必须包含以下要点（从输入数据中直接计算/推断，给出关键数值而不是泛泛描述）：
- 数据维度与质量：行数/列数、缺失值大致情况、重复值提示（如可判断）
- 字段类型识别：每列推断为“数值/分类/时间”的结果（列名必须列出）
- 基本统计信息：
  - 数值列：均值/中位数/标准差/范围/分位数（至少给出一种关键统计）
  - 分类列：基数、Top 类别及其占比（至少给出一条）
  - 时间列：时间跨度、频率/粒度（如可判断）
- 异常与结构信号：离群点、明显偏态、分布断层、潜在相关性线索（简短但具体）

## 第二阶段：三套“创新视角”（对应方案一/二/三）
每个方案必须包含：
- \`### 创新视角 X：[标题]\`
- \`方案说明：[为什么有价值/回答什么问题/适用场景/科学依据（简短但具体）]\`
- 图表 JSON：
  \`\`\`json plotly
  { "data": [...], "layout": {..., "uirevision": "shutu-uirevision", "hovermode": "closest"} }
  \`\`\`
- Python 代码（出版级导出函数 + 复现导出，必须包含全局样式设置）：
  \`\`\`python
  # ...
  \`\`\`

# 创新视角候选（允许你选择最适合的数据类型）
- 交叉分析：分类变量分组后的数值对比（均值/中位数/分布形态）；可用柱状图/箱线图/小提琴图
- 相关性与结构：数值列间相关性热力图或散点图结构（可补充聚类/分层的可视线索）
- 趋势与动态：若存在时间列，给出时间序列趋势、平滑/窗口统计，并解释“为什么这样能揭示趋势”
- 趋势预测（可选但推荐）：对时间序列给出稳健的预测或外推策略，并明确前提与适用边界
- 异常与鲁棒：离群点、分布断裂、可能的测量偏差或机制性解释线索

# 理论概念超链接（必须）
在“方案说明”或“数据概览”中，至少插入 1 个加粗的 Markdown 超链接，指向真实可访问的百科或学术文献页面。
例如：\`[**马太效应**](https://zh.wikipedia.org/wiki/马太效应)\`

# 内部逻辑与注释
中文；图表内部标签严格使用中文。
`;

/** 华东师大 ecnu-plus：仅生成自我审查 + 数据概览（不含三套方案） */
const ECNU_CHART_OVERVIEW_SYSTEM = `
# Role
你是「术图」数据科学顾问。你的任务**仅限**：输出第零阶段自我审查与第一阶段数据概览。

# 严禁输出
- 不得输出 \`===方案一===\`、\`===方案二===\`、\`===方案三===\` 或任何「创新视角」方案正文。
- 不得输出 Plotly JSON、\`\`\`python\`\`\` 代码块或图像相关内容。

# 输出结构（按顺序）
1. 在 \`<self_check>...</self_check>\` 中简述你将如何从数据中提炼概览要点。
2. 使用 Markdown \`## 数据参考分析报告\` 作为小节标题，并基于用户数据写出（须含具体统计与列类型，列名逐一列出）：
   - 数据维度与质量：行数/列数、缺失值、重复值（如可判断）
   - 字段类型：每列为数值/分类/时间
   - 数值列：至少一种关键统计；分类列：基数与 Top 占比；时间列：跨度与粒度（如可判断）
   - 异常与结构信号（简短具体）
3. 在概览或自我审查中至少插入 **1 个**加粗的 Markdown 超链接，指向真实可访问的百科或学术页面。

# 风格
客观、严谨的学术中文；禁止套话与 AI 开场白。
`;

/** DeepSeek：在已有数据概览前提下，仅生成三套方案（与 ECNU 拆分使用） */
const CHART_SCHEMES_ONLY_INSTRUCTION = `
# Role
你是「术图」数据科学顾问与可视化总监。系统已通过华东师大 API 生成「数据概览」；你**只负责**三套互补的「创新视角」与对应 Plotly JSON、Python 代码。

# 严禁
- 不要重复输出 \`<self_check>\` 或「数据概览」章节。
- 不要复述上一段数据概览全文；必要时仅一句承接即可。
- 输出中**第一个非空字符起**即应为 \`===方案一===\`（之前可有极短过渡语，但不要另起数据概览）。

# Tone & Style
- **语言风格**：客观、严谨、自然的学术口吻。
- **图表**：标签与 hover 用中文；layout 须含 \`uirevision: "shutu-uirevision"\`、\`hovermode: "closest"\`；每条 trace 有 \`name\` 与中文 \`hovertemplate\`。

# 必须输出
使用严格分隔符 \`===方案一===\`、\`===方案二===\`、\`===方案三===\`，每套含：
- \`### 创新视角 X：[标题]\`、方案说明
- \`\`\`json plotly ... \`\`\` 与 \`\`\`python ... \`\`\`

# 理论超链接
至少在一个「方案说明」中加粗并给出真实可点的 Markdown 超链接。

# 内部逻辑
中文；图表内部标签严格使用中文。
`;

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('select');
  
  const [dataInput, setDataInput] = useState('');
  const [requirementInput, setRequirementInput] = useState('');
  const [requirementTemplateId, setRequirementTemplateId] = useState('');
  const [modifyInput, setModifyInput] = useState('');
  
  const [conversation, setConversation] = useState<any[]>([]);
  const [result, setResult] = useState('');
  /** SSE 累积全文，供流式过程中 parseResult 增量展示 */
  const [streamingPartialResult, setStreamingPartialResult] = useState('');
  const [parsedData, setParsedData] = useState<ParsedResult>({ selfCheck: '', intro: '', options: [] });
  
  const [isLoading, setIsLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  /** 串行生图：当前第几步、共几步、正在请求的方案卡片索引（用于千帆限流） */
  const [shareLinkNotice, setShareLinkNotice] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [error, setError] = useState('');

  const [uploadError, setUploadError] = useState('');
  const [googleSheetsUrlInput, setGoogleSheetsUrlInput] = useState('');
  const [sheetsImportLoading, setSheetsImportLoading] = useState(false);
  const [sheetsImportError, setSheetsImportError] = useState('');
  /** 用户在文本区手动改数据后，提示概览已按新内容重算 */
  const [dataSourceEditNotice, setDataSourceEditNotice] = useState(false);
  const chartTextSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataEditNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadedRows, setUploadedRows] = useState<Array<Record<string, any>>>([]);
  const [uploadedSchema, setUploadedSchema] = useState<InferredSchema | null>(null);
  const [chartRecommendations, setChartRecommendations] = useState<ChartRecommendation[]>([]);
  const [builderOptions, setBuilderOptions] = useState<BuilderOptions | null>(null);

  // Interactive overrides for AI-generated Plotly JSON (per option card)
  const [editedPlotlyFigures, setEditedPlotlyFigures] = useState<Record<number, any>>({});

  /** 当前激活方案卡片的 ECNU 通俗解读（缓存按卡片索引） */
  const [schemeInterpretationByCard, setSchemeInterpretationByCard] = useState<Record<number, string>>({});
  const [schemeInterpretationLoadingCard, setSchemeInterpretationLoadingCard] = useState<number | null>(null);
  const [schemeInterpretationErrorByCard, setSchemeInterpretationErrorByCard] = useState<Record<number, string>>({});

  // API Settings (DeepSeek + ECNU)
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState(false);
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [ecnuApiKey, setEcnuApiKey] = useState('');
  const [deepseekModel, setDeepseekModel] = useState<DeepseekModel>('deepseek-chat');
  const [analysisMode, setAnalysisMode] = useState<'basic' | 'advanced'>('basic');
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [fontFamily, setFontFamily] = useState('font-simsun');
  const [fontSize, setFontSize] = useState('text-xiaosi'); // 小四
  const [colorPalette, setColorPalette] = useState('auto');
  const [dpi, setDpi] = useState('600');
  const [width, setWidth] = useState('85');
  const [height, setHeight] = useState('70');

  // UI State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeCard, setActiveCard] = useState(0);
  const [showSelfCheck, setShowSelfCheck] = useState(false);

  const resultEndRef = useRef<HTMLDivElement>(null);
  const analysisPanelRef = useRef<HTMLDivElement>(null);
  /** 图表解读 effect 每次运行递增；用于避免旧请求的 finally 把 analysisStatus 误置为 idle（新请求已 interpreting） */
  const chartInterpretationSeqRef = useRef(0);

  useEffect(() => {
    const savedHistory = localStorage.getItem('shutu_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  useEffect(() => {
    try {
      const storedKey = localStorage.getItem('shutu_deepseek_api_key') || '';
      const storedModel = localStorage.getItem('shutu_deepseek_model') as DeepseekModel;
      const storedMode = localStorage.getItem('shutu_analysis_mode');
      setDeepseekApiKey(storedKey);
      if (storedModel === 'deepseek-chat' || storedModel === 'deepseek-reasoner') {
        setDeepseekModel(storedModel);
      }
      if (storedMode === 'basic' || storedMode === 'advanced') {
        setAnalysisMode(storedMode);
      }
      setEcnuApiKey(localStorage.getItem('shutu_ecnu_api_key') || '');
    } catch {
      // ignore storage errors
    }
  }, []);

  const overviewFigure = useMemo(() => {
    if (!uploadedSchema || !builderOptions || uploadedRows.length === 0) return null;
    try {
      return buildPlotlyFigure(builderOptions, uploadedRows, uploadedSchema);
    } catch (e) {
      console.error('Failed to build overview plot', e);
      return null;
    }
  }, [uploadedRows, uploadedSchema, builderOptions]);

  const streamingParsedCards = useMemo(
    () => parseResult(streamingPartialResult),
    [streamingPartialResult]
  );

  /** 流式阶段优先展示已解析出的方案，完成后以 parsedData 为准 */
  const displayParsed = useMemo((): ParsedResult => {
    if (isLoading && streamingParsedCards.options.length > 0) {
      return streamingParsedCards;
    }
    return parsedData;
  }, [isLoading, streamingParsedCards, parsedData]);

  /** 用于在方案或 Plotly 编辑变化时触发重新拉取解读 */
  const activeSchemeFigureKey = useMemo(() => {
    if (appMode !== 'chart' || !displayParsed.options.length) return '';
    const opt = displayParsed.options[activeCard];
    if (!opt) return '';
    const fig = editedPlotlyFigures[activeCard] ?? opt.plotlyJson;
    if (!fig?.data?.length) return '';
    try {
      return JSON.stringify(fig);
    } catch {
      return String(activeCard);
    }
  }, [appMode, activeCard, displayParsed.options, editedPlotlyFigures]);

  useEffect(() => {
    if (appMode !== 'chart' || isLoading || !activeSchemeFigureKey) return;

    const idx = activeCard;
    const opt = displayParsed.options[idx];
    if (!opt) return;

    const fig = editedPlotlyFigures[idx] ?? opt.plotlyJson;
    if (!fig?.data?.length) return;

    const ac = new AbortController();
    let cancelled = false;
    const runSeq = ++chartInterpretationSeqRef.current;

    (async () => {
      setAnalysisStatus('interpreting');
      setSchemeInterpretationLoadingCard(idx);
      setSchemeInterpretationErrorByCard((prev) => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
      try {
        const summary = summarizePlotlyFigureForInterpretation(fig);
        const text = await generateChartInterpretation({
          ...summary,
          apiKey: ecnuApiKey?.trim() || undefined,
          signal: ac.signal,
        });
        if (cancelled || ac.signal.aborted) return;
        setSchemeInterpretationByCard((prev) => ({ ...prev, [idx]: text }));
      } catch (e: any) {
        if (e?.name === 'AbortError' || ac.signal.aborted) return;
        const msg = e?.message || '图表解读生成失败';
        setSchemeInterpretationErrorByCard((prev) => ({ ...prev, [idx]: msg }));
        setSchemeInterpretationByCard((prev) => {
          const next = { ...prev };
          delete next[idx];
          return next;
        });
      } finally {
        setSchemeInterpretationLoadingCard((prev) => (prev === idx ? null : prev));
        // 仅最新一次解读请求结束时退出 interpreting；旧请求被 abort 后若已有新请求，不得把状态打回 idle
        if (runSeq === chartInterpretationSeqRef.current) {
          setAnalysisStatus('idle');
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [appMode, isLoading, activeCard, activeSchemeFigureKey, ecnuApiKey]);

  const getPlotlyFigureForCard = (idx: number, fallback: any | null) => {
    return editedPlotlyFigures[idx] ?? fallback;
  };

  const resetWorkspaceState = () => {
    setDataInput('');
    setRequirementInput('');
    setRequirementTemplateId('');
    setModifyInput('');
    setConversation([]);
    setResult('');
    setStreamingPartialResult('');
    setParsedData({ selfCheck: '', intro: '', options: [] });
    setError('');
    setUploadError('');
    setIsLoading(false);
    setAnalysisStatus('idle');
    setActiveCard(0);
    setEditedPlotlyFigures({});
    setSchemeInterpretationByCard({});
    setSchemeInterpretationLoadingCard(null);
    setSchemeInterpretationErrorByCard({});
    setShareLinkNotice(null);
    clearUploadedData();
  };

  const openModeWorkspace = (mode: AppMode) => {
    resetWorkspaceState();
    setAppMode(mode);
  };

  const clearUploadedData = () => {
    setUploadedFileName('');
    setUploadedRows([]);
    setUploadedSchema(null);
    setChartRecommendations([]);
    setBuilderOptions(null);
    setUploadError('');
    setDataSourceEditNotice(false);
    if (dataEditNoticeTimerRef.current) {
      clearTimeout(dataEditNoticeTimerRef.current);
      dataEditNoticeTimerRef.current = null;
    }
  };

  /** 将已解析的 rows 经 toCsvText 写入文本区，并更新 schema / 概览（上传文件专用） */
  const applyParsedUploadRows = useCallback((rows: Array<Record<string, any>>, fileName: string) => {
    const capped = rows.slice(0, 5000);
    if (!capped.length) {
      setUploadError('未发现有效数据行，请检查表头与内容。');
      return;
    }
    if (dataEditNoticeTimerRef.current) {
      clearTimeout(dataEditNoticeTimerRef.current);
      dataEditNoticeTimerRef.current = null;
    }
    setDataSourceEditNotice(false);
    const { csvText } = toCsvText(capped, { maxRows: 200 });
    setDataInput(csvText);
    const schema = inferSchema(capped);
    const recs = recommendCharts(schema);
    setUploadedFileName(fileName || '未命名文件');
    setUploadedRows(capped);
    setUploadedSchema(schema);
    setChartRecommendations(recs);
    setBuilderOptions(recs[0]?.defaultOptions ?? null);
    setUploadError('');
  }, []);

  /**
   * 按 CSV 文本重算左侧 schema / 推荐 / 概览图。
   * @param silent 为 true 时不弹出「手动修改数据」黄条（用于从历史恢复等场景）。
   */
  const syncOverviewFromCsvText = useCallback((text: string, opts?: { silent?: boolean }) => {
    const t = text.trim();
    if (!t) {
      setUploadedRows([]);
      setUploadedSchema(null);
      setChartRecommendations([]);
      setBuilderOptions(null);
      setUploadError('');
      setDataSourceEditNotice(false);
      if (dataEditNoticeTimerRef.current) {
        clearTimeout(dataEditNoticeTimerRef.current);
        dataEditNoticeTimerRef.current = null;
      }
      return;
    }
    const rows = parseCSVText(t);
    const capped = rows.slice(0, 5000);
    if (!capped.length) {
      setUploadedRows([]);
      setUploadedSchema(null);
      setChartRecommendations([]);
      setBuilderOptions(null);
      setUploadError('当前文本无法解析为有效表格行，左侧概览已清空。');
      setDataSourceEditNotice(false);
      return;
    }
    setUploadError('');
    const schema = inferSchema(capped);
    const recs = recommendCharts(schema);
    setUploadedRows(capped);
    setUploadedSchema(schema);
    setChartRecommendations(recs);
    setBuilderOptions(recs[0]?.defaultOptions ?? null);
    if (opts?.silent) {
      setDataSourceEditNotice(false);
      if (dataEditNoticeTimerRef.current) {
        clearTimeout(dataEditNoticeTimerRef.current);
        dataEditNoticeTimerRef.current = null;
      }
    } else {
      setDataSourceEditNotice(true);
      if (dataEditNoticeTimerRef.current) clearTimeout(dataEditNoticeTimerRef.current);
      dataEditNoticeTimerRef.current = setTimeout(() => {
        setDataSourceEditNotice(false);
        dataEditNoticeTimerRef.current = null;
      }, 6500);
    }
  }, []);

  const handleChartDataInputChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setDataInput(text);
      setUploadedFileName('');
      if (chartTextSyncTimerRef.current) clearTimeout(chartTextSyncTimerRef.current);
      chartTextSyncTimerRef.current = setTimeout(() => {
        chartTextSyncTimerRef.current = null;
        syncOverviewFromCsvText(text);
      }, 400);
    },
    [syncOverviewFromCsvText]
  );

  const handleGoogleSheetsImport = useCallback(async () => {
    const url = googleSheetsUrlInput.trim();
    if (!url) {
      setSheetsImportError('请先粘贴 Google 表格链接。');
      return;
    }
    setSheetsImportError('');
    setSheetsImportLoading(true);
    try {
      const csv = await fetchGoogleSheetCsv(url);
      setDataInput(csv);
      setUploadedFileName('Google Sheets');
      syncOverviewFromCsvText(csv, { silent: true });
    } catch (e: unknown) {
      setSheetsImportError(e instanceof Error ? e.message : '拉取失败');
    } finally {
      setSheetsImportLoading(false);
    }
  }, [googleSheetsUrlInput, syncOverviewFromCsvText]);

  useEffect(() => {
    return () => {
      if (chartTextSyncTimerRef.current) clearTimeout(chartTextSyncTimerRef.current);
      if (dataEditNoticeTimerRef.current) clearTimeout(dataEditNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (isHistoryOpen) setMobileNavOpen(false);
  }, [isHistoryOpen]);

  const buildChartDataPrompt = () =>
    `请根据以下用户需求和原始数据生成报告和三套方案：\n
【用户具体需求】
${requirementInput.trim() || '无特定需求，请自动分析并生成三种不同的合适方案。'}

【排版与出版参数预设】
- 字体：${fontFamily === 'font-simsun' ? '宋体' : fontFamily === 'font-simhei' ? '黑体' : fontFamily === 'font-kaiti' ? '楷体' : '仿宋'}
- 配色方案：${colorPalette === 'auto' ? '由术图自主决定' : colorPalette}
- DPI: ${dpi === 'auto' ? '由术图自主决定' : dpi}
- 宽度 (mm): ${width === 'auto' ? '由术图自主决定' : width}
- 高度 (mm): ${height === 'auto' ? '由术图自主决定' : height}

${uploadedSchema ? `【前端字段类型推断（用于提高作图匹配）】
${uploadedSchema.columns
  .map((c) => `- ${c.name}：${c.type === 'time' ? '时间' : c.type === 'number' ? '数值' : '分类'}`)
  .join('\n')}

【前端图表推荐（用于提高作图匹配）】
${chartRecommendations
  .map((r, i) => `${i + 1}. ${r.chartType}：${r.reason}`)
  .join('\n')}

` : ''}

【输入内容】
${dataInput}`;

  const handleAnalyze = async (isModify = false) => {
    if (!isModify && !dataInput.trim()) {
      setError('请输入或粘贴您的内容。');
      return;
    }
    if (isModify && !modifyInput.trim()) {
      return;
    }

    setIsLoading(true);
    setError('');

    const willUseEcnuOverview =
      appMode === 'chart' && !isModify && Boolean(ecnuApiKey?.trim());
    setAnalysisStatus(willUseEcnuOverview ? 'overview' : 'schemes');
    
    if (!isModify) {
      setResult('');
      setStreamingPartialResult('');
                      setParsedData({ selfCheck: '', intro: '', options: [] });
                      setEditedPlotlyFigures({});
      setSchemeInterpretationByCard({});
      setSchemeInterpretationLoadingCard(null);
      setSchemeInterpretationErrorByCard({});
      setActiveCard(0);
    } else {
      setResult(''); // Clear result for the new stream, but keep parsedData intact for now
      setStreamingPartialResult('');
    }

    try {
      let currentConversation = [...conversation];
      let fullResult = '';

      if (!isModify) {
        const prompt = buildChartDataPrompt();
        currentConversation = [{ role: 'user', parts: [{ text: prompt }] }];
      } else {
        const modifyPrompt = `用户对之前的方案提出了修改意见：\n【修改要求】\n${modifyInput}\n\n请注意：\n1. 仅针对上述要求重新生成三套方案（包含方案说明、JSON/Prompt和代码）。\n2. 保持与第一次生成时同等甚至更高的顶刊级专业水准，绝不能降低质量。\n3. 不要重复输出第一阶段和第二阶段的深度解读，直接从 \`===方案一===\` 开始输出。`;
        currentConversation.push({ role: 'user', parts: [{ text: modifyPrompt }] });
      }

      let analysisCacheKeyHash: string | null = null;
      let fromCache = false;
      if (!isModify && appMode === 'chart') {
        analysisCacheKeyHash = hashAnalysisCacheKey(
          makeAnalysisCacheKey(appMode, dataInput, requirementInput, Boolean(ecnuApiKey?.trim()))
        );
        const hit = getCachedAnalysisResult(analysisCacheKeyHash);
        if (hit !== undefined) {
          fullResult = hit;
          fromCache = true;
          setResult(hit);
          setStreamingPartialResult(hit);
          setAnalysisStatus('idle');
        }
      }

      const hasUserKey = Boolean(deepseekApiKey?.trim());
      const effectiveDeepseekModel: DeepseekModel =
        analysisMode === 'advanced' && hasUserKey
          ? (deepseekModel === 'deepseek-chat' ? 'deepseek-reasoner' : deepseekModel)
          : 'deepseek-chat';

      if (!fromCache && willUseEcnuOverview) {
        const chartPrompt = buildChartDataPrompt();
        const overviewText = await callECNUChatCompletion({
          apiKey: ecnuApiKey.trim(),
          messages: [
            { role: 'system', content: ECNU_CHART_OVERVIEW_SYSTEM },
            {
              role: 'user',
              content: `${chartPrompt}\n\n【重要】本任务仅输出 <self_check> 与「## 数据概览」；禁止输出任何 ===方案===、Plotly JSON 或 Python 代码。`,
            },
          ],
        });
        const overviewPrefix = overviewText + '\n\n';
        setResult(overviewPrefix);
        setStreamingPartialResult(overviewPrefix);
        setAnalysisStatus('schemes');
        const schemesUser = `以下为已通过华东师大 ecnu-plus 生成的数据概览（请勿重复输出概览或 <self_check>，直接从 ===方案一=== 开始）：\n\n---\n${overviewText}\n---\n\n${chartPrompt}`;
        const schemesMessages: { role: string; content: string }[] = [
          { role: 'system', content: CHART_SCHEMES_ONLY_INSTRUCTION },
          { role: 'user', content: schemesUser },
        ];
        let schemesAccum = '';
        const schemesText = await generateDeepseekTextStream({
          apiKey: analysisMode === 'advanced' && hasUserKey ? deepseekApiKey.trim() : undefined,
          model: effectiveDeepseekModel,
          mode: analysisMode,
          chartPart: 'schemes-only',
          messages: schemesMessages,
          onChunk: (chunk) => {
            schemesAccum += chunk;
            const next = overviewPrefix + schemesAccum;
            setResult(next);
            setStreamingPartialResult(next);
            if (resultEndRef.current) {
              resultEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
          },
        });
        fullResult = `${overviewText}\n\n${schemesText}`;
      } else if (!fromCache) {
        const systemPrompt =
          isModify
            ? CHART_SCHEMES_ONLY_INSTRUCTION
            : CHART_SYSTEM_INSTRUCTION;
        const messages = [
          { role: 'system', content: systemPrompt },
          ...currentConversation
            .map((m) => ({
              role: m.role === 'model' ? 'assistant' : 'user',
              content: m.parts?.[0]?.text ?? '',
            }))
            .filter((m) => m.content.trim() !== ''),
        ];

        fullResult = await generateDeepseekTextStream({
          apiKey: analysisMode === 'advanced' && hasUserKey ? deepseekApiKey.trim() : undefined,
          model: effectiveDeepseekModel,
          mode: analysisMode,
          messages,
          onChunk: (chunk) => {
            setResult((prev) => prev + chunk);
            setStreamingPartialResult((prev) => prev + chunk);
            if (resultEndRef.current) {
              resultEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
          },
        });
      }

      if (!fromCache && analysisCacheKeyHash && fullResult) {
        setCachedAnalysisResult(analysisCacheKeyHash, fullResult);
      }

      const newConversation = [...currentConversation, { role: 'model', parts: [{ text: fullResult }] }];
      setConversation(newConversation);

      const parsed = parseResult(fullResult);
      
      if (isModify) {
        setParsedData(prev => ({
          ...prev,
          options: parsed.options.length > 0 ? parsed.options : prev.options
        }));
      } else {
        setParsedData(parsed);
      }

      const finalOptions = isModify && parsed.options.length > 0 ? parsed.options : parsedData.options.length > 0 ? parsedData.options : parsed.options;

      if (!isModify && !fromCache) {
        const newItem: HistoryItem = {
          id: Date.now().toString(),
          date: new Date().toLocaleString('zh-CN', { hour12: false }),
          mode: appMode,
          dataInput,
          requirementInput,
          result: fullResult,
        };
        setHistory(prev => {
          const updated = [newItem, ...prev].slice(0, 20);
          localStorage.setItem('shutu_history', JSON.stringify(updated));
          return updated;
        });
      }

      if (isModify) {
        setModifyInput('');
        setActiveCard(0);
      }

    } catch (err: any) {
      setError(err.message || '分析过程中发生错误，请重试。');
    } finally {
      setIsLoading(false);
      setStreamingPartialResult('');
      setAnalysisStatus('idle');
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setAppMode('chart');
    setDataInput(item.dataInput);
    setRequirementInput(item.requirementInput);
    setRequirementTemplateId('');
    setResult(item.result);
    setConversation([{ role: 'user', parts: [{ text: '加载历史记录' }] }, { role: 'model', parts: [{ text: item.result }] }]);
    
    const parsed = parseResult(item.result);
    setParsedData(parsed);
    setStreamingPartialResult('');
    setAnalysisStatus('idle');
    setActiveCard(0);
    setEditedPlotlyFigures({});
    setSchemeInterpretationByCard({});
    setSchemeInterpretationLoadingCard(null);
    setSchemeInterpretationErrorByCard({});
    // 图表模式：历史项已含 dataInput，按同一文本重算 schema/概览（与当前文本一致）；图像模式仍清空表格推断。
    if (item.mode === 'chart' && item.dataInput.trim()) {
      syncOverviewFromCsvText(item.dataInput, { silent: true });
      setUploadedFileName('');
    } else {
      clearUploadedData();
    }

    setIsHistoryOpen(false);
    setError('');
    setShareLinkNotice(null);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('shutu_history');
  };

  const saveApiSettings = () => {
    try {
      localStorage.setItem('shutu_deepseek_api_key', deepseekApiKey || '');
      localStorage.setItem('shutu_deepseek_model', deepseekModel);
      localStorage.setItem('shutu_analysis_mode', analysisMode);
      localStorage.setItem('shutu_ecnu_api_key', ecnuApiKey || '');
    } catch {
      // ignore
    }
  };

  // Export Functions
  const exportText = () => {
    const textToExport = parsedData.intro + '\n\n' + parsedData.options.map(o => o.raw).join('\n\n');
    const blob = new Blob([textToExport], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '术图_深度解析报告.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const createShareLink = async () => {
    if (!parsedData.options.length) return;
    setShareLinkNotice(null);
    try {
      const mode = 'chart';
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result:
            result.trim() ||
            [parsedData.intro, ...parsedData.options.map((o) => o.raw)]
              .filter((s) => String(s || '').trim())
              .join('\n\n'),
          parsed: parsedData,
          mode,
          timestamp: Date.now(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `分享创建失败 (${res.status})`);
      }
      const id = data?.id as string;
      if (!id) throw new Error('未返回分享 id');
      const url = `${window.location.origin}/s/${id}`;
      await navigator.clipboard.writeText(url);
      setShareLinkNotice(`已复制只读链接（24 小时内有效）：${url}`);
      setTimeout(() => setShareLinkNotice(null), 8000);
    } catch (e: any) {
      setShareLinkNotice(e?.message || '创建分享失败');
      setTimeout(() => setShareLinkNotice(null), 6000);
    }
  };

  /** 与导出长图/PDF 共用：截取分析面板为 canvas（隐藏解读 loading/错误条以免入图） */
  const captureAnalysisPanelToCanvas = async (): Promise<HTMLCanvasElement | null> => {
    const root = analysisPanelRef.current;
    if (!root) return null;

    const nodes = root.querySelectorAll<HTMLElement>('.interpretation-loading, .error-banner');
    const restore: { el: HTMLElement; visibility: string }[] = [];
    nodes.forEach((el) => {
      restore.push({ el, visibility: el.style.visibility });
      el.style.visibility = 'hidden';
    });

    try {
      return await html2canvas(root, {
        scale: 2,
        backgroundColor: '#f5f2ed',
        onclone: (clonedDoc) => {
          // 1. 清除所有内联 style 中的 oklch / oklab
          clonedDoc.querySelectorAll('*').forEach((el) => {
            const s = el.getAttribute('style');
            if (s) {
              el.setAttribute(
                'style',
                s
                  .replace(/oklch\([^)]*\)/gi, 'transparent')
                  .replace(/oklab\([^)]*\)/gi, 'transparent')
              );
            }
          });

          // 2. 清除所有 <style> 标签内的 oklch / oklab
          clonedDoc.querySelectorAll('style').forEach((st) => {
            st.innerHTML = st.innerHTML
              .replace(/oklch\([^)]*\)/gi, 'transparent')
              .replace(/oklab\([^)]*\)/gi, 'transparent');
          });
        },
      });
    } finally {
      restore.forEach(({ el, visibility }) => {
        el.style.visibility = visibility;
      });
    }
  };

  const exportPanelAsImage = async () => {
    try {
      const canvas = await captureAnalysisPanelToCanvas();
      if (!canvas) return;
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = '术图_深度解析长图.png';
      a.click();
    } catch (e) {
      console.error('Export failed', e);
    }
  };

  const exportPanelAsPdf = async () => {
    try {
      const canvas = await captureAnalysisPanelToCanvas();
      if (!canvas) return;
      downloadCanvasAsA4Pdf(canvas, '术图_深度解析.pdf');
    } catch (e) {
      console.error('PDF export failed', e);
    }
  };

  const MarkdownComponents = {
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-([a-zA-Z0-9_-]+)/.exec(className || '');
      const lang = match?.[1] ?? 'text';
      const isPlotly = lang === 'plotly' || String(className || '').includes('plotly');
      const [copied, setCopied] = useState(false);

      if (isPlotly) return null;

      const handleCopy = () => {
        navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      };

      return !inline && match ? (
        <div className="relative group mt-4 mb-6">
          <div className="absolute right-0 top-0 p-2 z-10">
            <button 
              onClick={handleCopy} 
              className="flex items-center gap-1 px-3 py-1.5 bg-[#1a1a1a] text-[#f5f2ed] rounded-xl text-xs uppercase tracking-wider hover:bg-black/80 transition-colors"
              title="一键复制代码"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '已复制' : '复制代码'}
            </button>
          </div>
          <SyntaxHighlighter
            language={lang}
            style={oneLight}
            wrapLongLines={true}
            customStyle={{
              margin: 0,
              padding: '16px',
              border: '1px solid rgba(26,26,26,0.2)',
              borderRadius: '16px',
              background: '#fff',
              fontSize: '12px',
              overflowX: 'auto',
            }}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        </div>
      ) : (
        <code className="bg-black/5 px-1.5 py-0.5 rounded-md font-mono text-sm" {...props}>
          {children}
        </code>
      );
    },
    a({ node, children, href, ...props }: any) {
      const { target: _t, rel: _r, ...rest } = props as Record<string, unknown>;
      return (
        <a
          {...rest}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1a1a1a] underline decoration-[rgba(26,26,26,0.4)] underline-offset-4 hover:decoration-[#1a1a1a] hover:bg-[#1a1a1a]/5 transition-all font-bold rounded-sm px-0.5"
        >
          {children}
        </a>
      );
    }
  };

  // Entry Screen
  if (appMode === 'select') {
    return (
      <div className="min-h-screen bg-[#f5f2ed] text-[#1a1a1a] font-serif flex flex-col items-center justify-center p-4 sm:p-6 selection:bg-[#1a1a1a] selection:text-[#f5f2ed]">
        <div className="max-w-3xl w-full text-center mb-8 sm:mb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="w-16 h-16 border-2 border-[#1a1a1a] rounded-2xl flex items-center justify-center mx-auto mb-8">
            <BarChart2 size={32} strokeWidth={1.5} />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-widest uppercase mb-4">术图 Shutu</h1>
          <p className="text-sm md:text-base tracking-[0.2em] text-[#1a1a1a]/60 uppercase">Nature / Science / Cell Standards</p>
          <p className="mt-6 text-lg text-[#1a1a1a]/80 max-w-xl mx-auto leading-relaxed">
            顶尖学术期刊级的数据分析与视觉设计引擎。请选择您本次需要生成的内容类型。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-8 w-full max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-150">
          <button 
            onClick={() => openModeWorkspace('chart')}
            className="group relative bg-white border border-[rgba(26,26,26,0.2)] rounded-3xl p-6 sm:p-10 flex flex-col items-center text-center hover:border-[#1a1a1a] hover:shadow-2xl transition-all duration-500 overflow-hidden touch-manipulation"
          >
            <div className="absolute inset-0 bg-[#1a1a1a] translate-y-[100%] group-hover:translate-y-0 transition-transform duration-500 ease-in-out" />
            <BarChart2 size={48} strokeWidth={1} className="mb-6 text-[#1a1a1a] group-hover:text-[#f5f2ed] transition-colors duration-500 relative z-10" />
            <h2 className="text-2xl font-bold tracking-widest mb-4 text-[#1a1a1a] group-hover:text-[#f5f2ed] transition-colors duration-500 relative z-10">数据可视化分析</h2>
            <p className="text-sm text-[#1a1a1a]/60 group-hover:text-[#f5f2ed]/80 transition-colors duration-500 relative z-10 leading-relaxed">
              输入原始数据，自动识别变量，生成深度学术解读报告及三套符合顶刊标准的交互式图表与 Python 代码。
            </p>
          </button>


        </div>
      </div>
    );
  }

  // Workspace Screen
  return (
    <div className={`min-h-screen bg-[#f5f2ed] text-[#1a1a1a] ${fontFamily} selection:bg-[#1a1a1a] selection:text-[#f5f2ed] relative overflow-x-hidden`}>
      
      {/* History Drawer Overlay */}
      {isHistoryOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setIsHistoryOpen(false)}
        />
      )}

      {/* History Drawer */}
      <div className={`fixed inset-y-0 right-0 w-full sm:w-96 bg-[#f5f2ed] shadow-2xl z-50 transform transition-transform duration-300 ease-in-out border-l border-[rgba(26,26,26,0.1)] flex flex-col ${isHistoryOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-6 border-b border-[rgba(26,26,26,0.1)] flex items-center justify-between bg-white">
          <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
            <History size={16} />
            历史记录
          </h2>
          <button onClick={() => setIsHistoryOpen(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[#1a1a1a]/40 gap-3">
              <Clock size={32} strokeWidth={1} />
              <p className="text-xs uppercase tracking-widest">暂无历史记录</p>
            </div>
          ) : (
            <>
              <div className="flex justify-end mb-2">
                <button onClick={clearHistory} className="text-xs text-red-600/70 hover:text-red-600 uppercase tracking-wider font-bold bg-red-50 px-3 py-1 rounded-full">
                  清空记录
                </button>
              </div>
              {history.map((item) => (
                <div 
                  key={item.id} 
                  onClick={() => loadHistoryItem(item)}
                  className="bg-white p-4 border border-[rgba(26,26,26,0.1)] rounded-2xl hover:border-[#1a1a1a] cursor-pointer transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] text-[#1a1a1a]/50 font-sans">{item.date}</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-black/5 rounded-full">
                      {item.mode === 'chart' ? '图表' : '图像'}
                    </div>
                  </div>
                  <div className="text-sm font-bold line-clamp-1 mb-1 group-hover:underline underline-offset-4">
                    {item.requirementInput || '自动分析生成'}
                  </div>
                  <div className="text-xs text-[#1a1a1a]/70 line-clamp-2 font-mono bg-black/5 p-2 mt-2 rounded-xl">
                    {item.dataInput}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Header：桌面端平铺；移动端折叠为菜单 */}
      <header className="border-b border-[rgba(26,26,26,0.1)] sticky top-0 z-30 bg-[#f5f2ed]/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 min-h-16 md:h-20 flex items-center justify-between gap-2 py-2 md:py-0">
          <div
            className="flex items-center gap-3 sm:gap-4 cursor-pointer min-w-0 flex-1"
            onClick={() => {
              resetWorkspaceState();
              setAppMode('select');
              setMobileNavOpen(false);
            }}
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 border border-[#1a1a1a] rounded-xl flex items-center justify-center text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f5f2ed] transition-colors shrink-0">
              <BarChart2 size={20} strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold tracking-widest uppercase flex flex-wrap items-baseline gap-x-2 gap-y-0">
                术图{' '}
                <span className="text-[10px] sm:text-xs font-normal opacity-50 truncate max-w-[11rem] sm:max-w-none">
                  | 数据可视化
                </span>
              </h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#1a1a1a]/60 hidden sm:block">
                Nature / Science / Cell Standards
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const next = analysisMode === 'basic' ? 'advanced' : 'basic';
                setAnalysisMode(next);
                try {
                  localStorage.setItem('shutu_analysis_mode', next);
                } catch {
                  // ignore
                }
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] hover:bg-white transition-all"
              title="切换普通/高级模式"
            >
              <span className={`w-2 h-2 rounded-full ${analysisMode === 'advanced' ? 'bg-emerald-500' : 'bg-[#1a1a1a]/30'}`} />
              {analysisMode === 'advanced' ? '高级模式' : '普通模式'}
            </button>

            <button
              type="button"
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] hover:bg-white transition-all"
            >
              <History size={14} />
              历史记录
            </button>

            <button
              type="button"
              onClick={() => setIsApiSettingsOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] hover:bg-white transition-all"
              title="API 设置"
            >
              <Settings2 size={14} />
              API 设置
            </button>
          </div>

          <button
            type="button"
            className="md:hidden shrink-0 p-2.5 rounded-xl border border-[rgba(26,26,26,0.2)] hover:border-[#1a1a1a] hover:bg-white transition-colors touch-manipulation"
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? '关闭菜单' : '打开菜单'}
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            {mobileNavOpen ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
          </button>
        </div>

        {mobileNavOpen && (
          <div className="md:hidden border-t border-[rgba(26,26,26,0.08)] bg-[#f5f2ed]/95 backdrop-blur-sm px-4 py-3 flex flex-col gap-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
            <button
              type="button"
              onClick={() => {
                const next = analysisMode === 'basic' ? 'advanced' : 'basic';
                setAnalysisMode(next);
                try {
                  localStorage.setItem('shutu_analysis_mode', next);
                } catch {
                  // ignore
                }
                setMobileNavOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-widest border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] hover:bg-white transition-all touch-manipulation"
            >
              <span className={`w-2 h-2 rounded-full ${analysisMode === 'advanced' ? 'bg-emerald-500' : 'bg-[#1a1a1a]/30'}`} />
              {analysisMode === 'advanced' ? '高级模式' : '普通模式'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsHistoryOpen(true);
                setMobileNavOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-widest border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] hover:bg-white transition-all touch-manipulation"
            >
              <History size={14} />
              历史记录
            </button>
            <button
              type="button"
              onClick={() => {
                setIsApiSettingsOpen(true);
                setMobileNavOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-widest border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] hover:bg-white transition-all touch-manipulation"
            >
              <Settings2 size={14} />
              API 设置
            </button>
          </div>
        )}
      </header>

      <ApiSettingsModal
        open={isApiSettingsOpen}
        onClose={() => setIsApiSettingsOpen(false)}
        apiKey={deepseekApiKey}
        setApiKey={setDeepseekApiKey}
        model={deepseekModel}
        setModel={setDeepseekModel}
        ecnuApiKey={ecnuApiKey}
        setEcnuApiKey={setEcnuApiKey}
        onSave={saveApiSettings}
      />

      {/* Main Content：小屏单列堆叠，lg 起双栏 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
          
          {/* Left Panel: Input & Settings */}
          <div className="lg:col-span-6 xl:col-span-6 flex flex-col gap-6 min-w-0">
            
            <div className="premium-panel p-4 sm:p-6 flex flex-col gap-6 lg:sticky lg:top-28">
              <div className="flex items-center justify-between border-b border-[rgba(26,26,26,0.1)] pb-4">
                <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                  <FileSpreadsheet size={16} />
                  输入与预设
                </h2>
              </div>

              {/* 快速模板 */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70 flex items-center gap-2">
                  <LayoutTemplate size={14} />
                  快速模板
                </label>
                <select
                  className="premium-input w-full p-2.5 text-sm"
                  value={requirementTemplateId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setRequirementTemplateId(id);
                    const list = CHART_QUICK_TEMPLATES;
                    const t = list.find((x) => x.id === id);
                    if (t) setRequirementInput(t.text);
                  }}
                  disabled={isLoading}
                >
                  <option value="">选择场景后自动填入「具体需求」</option>
                  {CHART_QUICK_TEMPLATES.map(
                    (t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    )
                  )}
                </select>
              </div>
              
              {/* Requirement Input */}
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70 flex items-center gap-2">
                  <MessageSquare size={14} />
                  具体需求 (可选)
                </label>
                <input
                  type="text"
                  className="premium-input w-full p-3 text-sm"
                  placeholder="例如：关注各变量间相关性与异常值，并给出可解释的可视化建议"
                  value={requirementInput}
                  onChange={(e) => {
                    setRequirementInput(e.target.value);
                    setRequirementTemplateId('');
                  }}
                  disabled={isLoading}
                />
              </div>

              {/* Data Input */}
              <div className="flex flex-col gap-3 flex-1">
                <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70 flex items-center gap-2">
                  <FileText size={14} />
                  原始数据 (必填)
                </label>

                  <>
                    <FileDropZone
                      className="w-full"
                      disabled={isLoading}
                      onDataParsed={({ rows, fileName }) => {
                        applyParsedUploadRows(rows, fileName);
                      }}
                    />
                    <p className="mt-2 flex items-start gap-2 text-[10px] leading-relaxed text-[#1a1a1a]/50">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-800/70" strokeWidth={2} aria-hidden />
                      <span>
                        <span className="font-semibold text-[#1a1a1a]/60">本地处理：</span>
                        数据仅用于本次分析，不会上传至第三方服务器（ECNU 和 DeepSeek 仅接收您指定的文本内容）。
                      </span>
                    </p>
                    <details className="group rounded-2xl border border-[rgba(26,26,26,0.15)] bg-white/50 open:bg-white/80 transition-colors">
                      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-bold tracking-wide text-[#1a1a1a]/75 [&::-webkit-details-marker]:hidden">
                        ✏️或者直接粘贴原始数据
                      </summary>
                      <div className="border-t border-[rgba(26,26,26,0.08)] p-3">
                        <textarea
                          className="premium-input min-h-[150px] w-full resize-none p-4 font-mono text-sm"
                          placeholder="在此处粘贴您的原始数据（CSV 文本或表格粘贴）..."
                          value={dataInput}
                          onChange={handleChartDataInputChange}
                          disabled={isLoading}
                        />
                        <p className="mt-2 text-[10px] leading-relaxed text-[#1a1a1a]/45">
                          支持逗号 / 分号 / 制表符分隔。从 Excel 或 Numbers 直接粘贴即可，表头与分隔符会自动识别。
                        </p>
                      </div>
                    </details>
                    <details className="group rounded-2xl border border-[rgba(26,26,26,0.15)] bg-white/50 open:bg-white/80 transition-colors">
                      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-bold tracking-wide text-[#1a1a1a]/75 [&::-webkit-details-marker]:hidden flex items-center gap-2">
                        <Link2 size={14} className="shrink-0 opacity-70" />
                        从 Google 表格导入（公开链接）
                      </summary>
                      <div className="border-t border-[rgba(26,26,26,0.08)] p-3 flex flex-col gap-2">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="url"
                            className="premium-input flex-1 min-w-0 p-2.5 text-xs font-mono"
                            placeholder="https://docs.google.com/spreadsheets/d/.../edit?usp=sharing"
                            value={googleSheetsUrlInput}
                            onChange={(e) => {
                              setGoogleSheetsUrlInput(e.target.value);
                              setSheetsImportError('');
                            }}
                            disabled={isLoading || sheetsImportLoading}
                          />
                          <button
                            type="button"
                            onClick={handleGoogleSheetsImport}
                            disabled={isLoading || sheetsImportLoading}
                            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl border border-[rgba(26,26,26,0.12)] bg-[#1a1a1a] px-4 py-2.5 text-xs font-bold text-white hover:bg-black/90 disabled:opacity-50"
                          >
                            {sheetsImportLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Link2 className="h-4 w-4" />
                            )}
                            导入为 CSV
                          </button>
                        </div>
                        {sheetsImportError && (
                          <p className="text-[11px] leading-relaxed text-red-600 flex items-start gap-1.5">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {sheetsImportError}
                          </p>
                        )}
                        <p className="text-[10px] leading-relaxed text-[#1a1a1a]/45">
                          表格需设为「知道链接的任何人可查看」；链接中的 gid 会对应到当前工作表。数据将填入上方粘贴区并同步概览。
                        </p>
                      </div>
                    </details>
                    {dataSourceEditNotice && (
                      <div className="flex items-start gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-3 py-2.5 text-xs leading-relaxed text-amber-950/90">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700/90" strokeWidth={2} />
                        <span>
                          检测到您手动修改了数据，左侧概览图将基于新数据重新推断。
                        </span>
                      </div>
                    )}
                  </>

              </div>

              {/* 上传结果：字段类型与推荐（图表模式） */}

                <div className="border-t border-[rgba(26,26,26,0.1)] pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70 flex items-center gap-2">
                      <FileSpreadsheet size={14} />
                      数据概览与字段
                    </label>
                    <button
                      onClick={clearUploadedData}
                      disabled={isLoading || (!uploadedSchema && !uploadedFileName)}
                      className="text-[10px] uppercase tracking-wider font-bold bg-black/5 px-3 py-1 rounded-full hover:bg-black/10 disabled:opacity-50"
                      title="清除已上传文件的解析结果"
                    >
                      清除
                    </button>
                  </div>

                  {uploadError && (
                    <div className="mt-3 p-3 bg-red-50 text-red-600 text-sm border border-red-200 rounded-xl flex items-start gap-2">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <span>{uploadError}</span>
                    </div>
                  )}

                  {uploadedFileName && !uploadError && (
                    <div className="mt-3 text-xs text-[#1a1a1a]/70">
                      已上传：<span className="font-bold">{uploadedFileName}</span>（解析出 {uploadedRows.length} 行）
                    </div>
                  )}

                  {uploadedSchema && (
                    <div className="mt-3">
                      <div className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60 mb-2">
                        自动字段类型识别
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {uploadedSchema.columns.slice(0, 10).map((c) => (
                          <span
                            key={c.name}
                            className="text-[10px] px-2 py-1 rounded-full bg-black/5 text-[#1a1a1a]/70 border border-[rgba(26,26,26,0.08)]"
                            title={c.name}
                          >
                            {c.name}：{c.type === 'time' ? '时间' : c.type === 'number' ? '数值' : '分类'}
                          </span>
                        ))}
                        {uploadedSchema.columns.length > 10 && (
                          <span className="text-[10px] px-2 py-1 rounded-full bg-black/5 text-[#1a1a1a]/60">
                            +{uploadedSchema.columns.length - 10} 更多
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {chartRecommendations.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60 mb-2">
                        推荐图表类型（用于更精准生成）
                      </div>
                      <div className="flex flex-col gap-2">
                        {chartRecommendations.map((r, idx) => (
                          <div
                            key={`${r.chartType}-${idx}`}
                            className="text-xs bg-black/5 border border-[rgba(26,26,26,0.08)] rounded-xl px-3 py-2 text-[#1a1a1a]/70"
                          >
                            <span className="font-bold text-[#1a1a1a]">{idx + 1}. {r.chartType}</span>：{r.reason}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

              {/* Advanced Settings Toggle */}
              <div className="border-t border-[rgba(26,26,26,0.1)] pt-4">
                <button 
                  onClick={() => setShowSettings(!showSettings)}
                  className="flex items-center justify-between w-full text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70 hover:text-[#1a1a1a] transition-colors"
                >
                  <span className="flex items-center gap-2"><Settings2 size={14} /> 中文版式与参数预设</span>
                  {showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                
                {showSettings && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">字体样式</label>
                      <select className="premium-input p-2 text-xs" value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
                        <option value="font-simsun">宋体 (标准)</option>
                        <option value="font-simhei">黑体 (现代)</option>
                        <option value="font-kaiti">楷体 (传统)</option>
                        <option value="font-fangsong">仿宋 (公文)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">字号大小</label>
                      <select className="premium-input p-2 text-xs" value={fontSize} onChange={e => setFontSize(e.target.value)}>
                        <option value="text-xiaosan">小三 (15pt)</option>
                        <option value="text-sihao">四号 (14pt)</option>
                        <option value="text-xiaosi">小四 (12pt - 推荐)</option>
                        <option value="text-wuhao">五号 (10.5pt)</option>
                        <option value="text-xiaowu">小五 (9pt)</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-2 sm:col-span-2">
                      <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">配色方案</label>
                      <select className="premium-input p-2 text-xs" value={colorPalette} onChange={e => setColorPalette(e.target.value)}>
                        <option value="auto">自动 (由术图决定)</option>
                        <option value="Nature 经典 (浅蓝/灰/橙)">Nature 经典 (浅蓝/灰/橙)</option>
                        <option value="Science 科技 (高对比度)">Science 科技 (高对比度)</option>
                        <option value="Cell 鲜艳 (高饱和度)">Cell 鲜艳 (高饱和度)</option>
                        <option value="莫兰迪高级灰 (低饱和度)">莫兰迪高级灰 (低饱和度)</option>
                        <option value="极简黑白 (单色)">极简黑白 (单色)</option>
                      </select>
                    </div>

                      <>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">DPI</label>
                          <select className="premium-input p-2 text-xs" value={dpi} onChange={e => setDpi(e.target.value)}>
                            <option value="auto">自动</option>
                            <option value="300">300 (标准)</option>
                            <option value="600">600 (推荐)</option>
                            <option value="1200">1200 (超清)</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">宽度 (mm)</label>
                          <select className="premium-input p-2 text-xs" value={width} onChange={e => setWidth(e.target.value)}>
                            <option value="auto">自动</option>
                            <option value="85">85 (单栏)</option>
                            <option value="114">114 (1.5栏)</option>
                            <option value="170">170 (双栏)</option>
                          </select>
                        </div>
                      </>

                  </div>
                )}
              </div>

              {error && (
                <div className="p-3 bg-red-50 text-red-600 text-sm border border-red-200 rounded-xl flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              
              <button
                onClick={() => handleAnalyze(false)}
                disabled={isLoading || !dataInput.trim()}
                className="premium-button w-full py-4 px-4 text-sm font-bold uppercase tracking-widest flex items-center justify-center gap-3 mt-auto"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>术图正在深度分析...</span>
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    <span>开始智能分析 (生成三套方案)</span>
                  </>
                )}
              </button>

              {/* Modify Section (Appears after generation) */}
              {parsedData.options.length > 0 && !isLoading && (
                <div className="border-t border-[rgba(26,26,26,0.1)] pt-6 mt-2 animate-in fade-in">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70 flex items-center gap-2 mb-3">
                    <Edit3 size={14} />
                    对当前结果不满意？
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      className="premium-input flex-1 p-3 text-sm min-w-0"
                      placeholder="输入修改要求，术图将仅更新方案..."
                      value={modifyInput}
                      onChange={(e) => setModifyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAnalyze(true)}
                    />
                    <button
                      onClick={() => handleAnalyze(true)}
                      disabled={!modifyInput.trim() || isLoading}
                      className="premium-button px-4 py-3 sm:py-0 shrink-0 flex items-center justify-center touch-manipulation"
                      title="提交修改"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Output — 小屏随页面滚动，大屏独立滚动区 */}
          <div className="lg:col-span-6 xl:col-span-6 flex flex-col gap-4 min-h-0 min-w-0 lg:h-[calc(100vh-7.5rem)] lg:overflow-y-auto">
            
            {/* 主流程结束后：图表通俗解读（ECNU）进行中 */}
            {!isLoading && analysisStatus === 'interpreting' && (() => {
              const ic = getAnalysisStatusCopy('interpreting');
              if (!ic) return null;
              return (
                <div className="flex flex-col gap-2 rounded-2xl border border-[rgba(26,26,26,0.12)] bg-[#faf8f5] px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
                  <Loader2 size={18} className="animate-spin shrink-0 text-[#1a1a1a]/50 mt-0.5" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-bold text-[#1a1a1a]/80 tracking-wide">{ic.title}</p>
                    <p className="text-xs text-[#1a1a1a]/50 leading-relaxed">{ic.detail}</p>
                  </div>
                </div>
              );
            })()}

            {/* 流式中、尚未解析出任何方案时：整页 Markdown 预览 */}
            {isLoading && displayParsed.options.length === 0 && (() => {
              const sc = getAnalysisStatusCopy(analysisStatus);
              return (
                <div className="premium-panel p-4 sm:p-8 min-h-[min(600px,85vh)] sm:min-h-[600px] flex flex-col">
                  <div className="mb-6 space-y-2">
                    <div className="flex items-start gap-3 text-[#1a1a1a]/70">
                      <Loader2 size={20} className="animate-spin shrink-0 mt-0.5" />
                      <div className="min-w-0 space-y-1.5">
                        <span className="text-sm font-bold uppercase tracking-widest block">
                          {sc?.title ?? '术图思考中…'}
                        </span>
                        {sc?.detail && (
                          <p className="text-sm font-normal normal-case tracking-normal text-[#1a1a1a]/50 leading-relaxed max-w-2xl">
                            {sc.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={`prose prose-slate max-w-none ${fontSize} opacity-70`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                      {result}
                    </ReactMarkdown>
                  </div>
                  <SchemeOptionSkeletonCards />
                  <div ref={resultEndRef} />
                </div>
              );
            })()}

            {/* 已解析出至少一套方案：边生成边展示（流式与完成后通用） */}
            {displayParsed.options.length > 0 && (
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700" ref={analysisPanelRef}>
                {shareLinkNotice && (
                  <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/95 px-4 py-3 text-xs text-emerald-950/95 leading-relaxed">
                    {shareLinkNotice}
                  </div>
                )}
                {isLoading && (() => {
                  const sc = getAnalysisStatusCopy(analysisStatus);
                  return (
                    <div className="flex flex-col gap-2 rounded-2xl border border-[rgba(26,26,26,0.1)] bg-white/80 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
                      <Loader2 size={14} className="animate-spin shrink-0 text-[#1a1a1a]/50 mt-0.5" />
                      <div className="min-w-0 space-y-1">
                        <p className="text-xs font-bold uppercase tracking-widest text-[#1a1a1a]/70">
                          {sc?.title ?? '正在续写后续内容…'}
                        </p>
                        {sc?.detail && (
                          <p className="text-xs text-[#1a1a1a]/50 leading-relaxed">{sc.detail}</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {!isLoading && (
                  <div className="flex flex-wrap justify-start sm:justify-end gap-2">
                    <button
                      type="button"
                      onClick={exportText}
                      className="p-2 bg-white border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-sm"
                      title="导出纯文本"
                    >
                      <Download size={14} /> 文本
                    </button>
                    <button
                      type="button"
                      onClick={exportPanelAsImage}
                      className="p-2 bg-white border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-sm"
                      title="保存为长图"
                    >
                      <ImageDown size={14} /> 长图
                    </button>
                    <button
                      type="button"
                      onClick={exportPanelAsPdf}
                      className="p-2 bg-white border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-sm"
                      title="导出为 A4 纵向 PDF（适合插入论文/作业，含图表与正文排版）"
                    >
                      <FileDown size={14} /> PDF
                    </button>
                    <button
                      type="button"
                      onClick={createShareLink}
                      className="p-2 bg-white border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-sm"
                      title="生成 24 小时内有效的只读分享链接并复制到剪贴板"
                    >
                      <Share2 size={14} /> 分享
                    </button>
                  </div>
                )}

                {/* Intro Text */}
                {displayParsed.intro && (
                  <div className={`premium-panel p-4 sm:p-8`}>
                    <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#1a1a1a]/60">
                      <FileText size={14} />
                      数据参考分析报告
                    </div>
                    <div className={`prose prose-slate max-w-none prose-headings:font-bold prose-headings:tracking-wide prose-p:leading-relaxed ${fontSize}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                        {displayParsed.intro}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-4">
                  {displayParsed.options.length > 0 && (
                    <div className="px-1 text-xs font-bold uppercase tracking-widest text-[#1a1a1a]/60">
                      方案渲染与复现代码（先看渲染图，再复制代码复现）
                    </div>
                  )}
                  {displayParsed.options.map((opt, idx) => {
                    const isActive = activeCard === idx;
                    return (
                      <div key={idx} className="premium-panel border-t-4 border-t-[#1a1a1a] overflow-hidden">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setActiveCard(idx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setActiveCard(idx);
                            }
                          }}
                          className="w-full p-4 flex items-center justify-between bg-[#f5f2ed] hover:bg-white transition-colors border-b border-[rgba(26,26,26,0.08)] cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-bold uppercase tracking-widest text-[#1a1a1a]/50 bg-black/5 px-3 py-1 rounded-full">
                              {idx + 1} / {displayParsed.options.length}
                            </span>
                            <h3 className="text-sm sm:text-base font-bold uppercase tracking-widest truncate">
                              {opt.title}
                            </h3>
                          </div>
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
                              isActive
                                ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
                                : 'bg-white text-[#1a1a1a]/60 border-[rgba(26,26,26,0.15)]'
                            }`}
                          >
                            {isActive ? '当前解读' : '点击设为当前解读'}
                          </span>
                        </div>

                        <div className="p-4 sm:p-6 flex flex-col gap-6">
                            {appMode === 'chart' && (
                              <>
                                {uploadedSchema && builderOptions && overviewFigure && idx === activeCard && (
                                  <div className="flex flex-col gap-4">
                                    <ChartBuilderControls
                                      schema={uploadedSchema}
                                      recommendations={chartRecommendations}
                                      value={builderOptions}
                                      onChange={(next) => setBuilderOptions(next)}
                                    />
                                    <div className="w-full overflow-hidden flex justify-center border border-[rgba(26,26,26,0.1)] rounded-2xl p-4 bg-white">
                                      <div className="w-full h-[360px] sm:h-[440px] max-h-[45vh] overflow-hidden">
                                        <Plot
                                          data={overviewFigure.data}
                                          layout={{
                                            ...overviewFigure.layout,
                                            autosize: true,
                                            uirevision: overviewFigure.layout?.uirevision ?? 'shutu-uirevision',
                                            hovermode: overviewFigure.layout?.hovermode ?? 'closest',
                                            margin: { l: 50, r: 30, t: 50, b: 50 },
                                            paper_bgcolor: 'transparent',
                                            plot_bgcolor: 'rgba(26,26,26,0.02)',
                                          }}
                                          useResizeHandler={true}
                                          style={{ width: '100%', height: '100%' }}
                                          config={{ responsive: true, displayModeBar: true, scrollZoom: true, editable: true }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {getPlotlyFigureForCard(idx, opt.plotlyJson)?.data &&
                                  getPlotlyFigureForCard(idx, opt.plotlyJson)?.layout && (
                                  <>
                                    <div className="w-full overflow-hidden flex justify-center border border-[rgba(26,26,26,0.1)] rounded-2xl p-4 bg-white">
                                      <div className="w-full h-[380px] sm:h-[480px] max-h-[45vh] overflow-hidden">
                                        <Plot
                                          data={getPlotlyFigureForCard(idx, opt.plotlyJson).data}
                                          layout={{
                                            ...getPlotlyFigureForCard(idx, opt.plotlyJson).layout,
                                            autosize: true,
                                            uirevision: getPlotlyFigureForCard(idx, opt.plotlyJson).layout?.uirevision ?? 'shutu-uirevision',
                                            hovermode: getPlotlyFigureForCard(idx, opt.plotlyJson).layout?.hovermode ?? 'closest',
                                            margin: { l: 50, r: 30, t: 50, b: 50 },
                                            paper_bgcolor: 'transparent',
                                            plot_bgcolor: 'rgba(26,26,26,0.02)',
                                          }}
                                          useResizeHandler={true}
                                          style={{ width: '100%', height: '100%' }}
                                          config={{ responsive: true, displayModeBar: true, scrollZoom: true, editable: true }}
                                        />
                                      </div>
                                    </div>
                                    {idx === activeCard && (
                                      <>
                                        {schemeInterpretationLoadingCard === idx && (
                                          <div className="interpretation-loading bg-gray-50 p-3 rounded-md mt-2 flex items-center gap-2 text-sm text-gray-700 italic">
                                            <Loader2 className="animate-spin shrink-0" size={14} />
                                            正在生成图表通俗解读…
                                          </div>
                                        )}
                                        {schemeInterpretationErrorByCard[idx] && (
                                          <div className="error-banner bg-gray-50 p-3 rounded-md mt-2 text-sm text-red-600 italic">
                                            {schemeInterpretationErrorByCard[idx]}
                                          </div>
                                        )}
                                        {schemeInterpretationByCard[idx] && (
                                          <div className="bg-gray-50 p-3 rounded-md mt-2">
                                            <p className="text-sm text-gray-700 italic leading-relaxed">
                                              {schemeInterpretationByCard[idx]}
                                            </p>
                                          </div>
                                        )}
                                      </>
                                    )}
                                    <PlotlyJsonEditor
                                      value={getPlotlyFigureForCard(idx, opt.plotlyJson)}
                                      onApply={(next) =>
                                        setEditedPlotlyFigures((prev) => ({ ...prev, [idx]: next }))
                                      }
                                    />
                                  </>
                                )}
                              </>
                            )}

                            <div className={`prose prose-slate max-w-none prose-headings:font-bold prose-headings:tracking-wide prose-p:leading-relaxed ${fontSize}`}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                                {opt.raw
                                  .replace(/```json\s+plotly[\s\S]*?```/, '')
                                  .replace(/<image_prompt>[\s\S]*?<\/image_prompt>/, '')}
                              </ReactMarkdown>
                            </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            )}

            {/* Initial Empty State */}
            {!isLoading && displayParsed.options.length === 0 && (
              <div className="premium-panel p-6 sm:p-8 min-h-[min(520px,70vh)] sm:min-h-[600px] flex flex-col items-center justify-center text-[#1a1a1a]/30 gap-6">
                <BarChart2 size={64} strokeWidth={1} />
                <p className="text-sm text-center max-w-xs uppercase tracking-widest leading-loose">
                  等待输入<br/>术图将为您提供三套专业方案
                </p>
              </div>
            )}

          </div>

        </div>
      </main>
    </div>
  );
}
