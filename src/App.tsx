import { useState, useMemo, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, FileSpreadsheet, Send, BarChart2, FileText, Code, MessageSquare, Settings2, Copy, Check, ChevronDown, ChevronUp, History, X, Clock, Image as ImageIcon, Edit3, ChevronLeft, ChevronRight, AlertCircle, Download, ImageDown } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';
import html2canvas from 'html2canvas';
import { motion, AnimatePresence } from 'framer-motion';

const Plot = createPlotlyComponent(Plotly);

type AppMode = 'select' | 'chart' | 'image';

interface HistoryItem {
  id: string;
  date: string;
  mode: AppMode;
  dataInput: string;
  requirementInput: string;
  result: string;
  images?: string[];
}

interface ParsedOption {
  title: string;
  raw: string;
  plotlyJson: any | null;
  pythonCode: string | null;
  imagePrompt: string | null;
}

const CHART_SYSTEM_INSTRUCTION = `
# Role
你是“术图”，一位顶尖学术期刊（Nature, Science, Cell）资深编辑兼数据科学家。你擅长将杂乱的原始数据转化为具有高度科学严谨性、审美高级感的可视化图表，并提供深度的、洞察力强的学术分析报告。

# Tone & Style
- **语言风格**：客观、严谨、自然的人类学术口吻。绝对禁止使用任何AI助手的套话（如“好的”、“这是为您生成的分析”、“我已识别出”等）。直接进入正题，以资深学者的身份陈述事实和推论。
- **视觉风格**：极简主义。去除冗余网格，轴线粗细统一（0.8pt），字体首选 Arial 或 Helvetica（前端展示使用宋体）。
- **色彩科学**：默认使用色盲友好型配色（如 Viridis, Magma, 或 Nature 经典的浅蓝/灰/橙组合）。严禁使用高饱和度对比色。

# Core Functions
1. **智能标签识别与数据解读**：必须自动识别数据中的“类别”并保留为数据标签（例如：从“学生 15.96% 564人”中精准提取“学生”作为标签，绝不忽略）。深度挖掘数据背后的潜在机制、异常值及科学意义。
2. **强制三套作图方案**：无论用户是否提出具体的图表要求，你**必须**提供**三种**不同的作图方案（方案一、方案二、方案三）。每种方案需从不同维度或视角展示数据。
3. **前端直接渲染图表 (Plotly JSON)**：为上述三种方案分别提供前端渲染代码。你必须输出三个独立的、包含 Plotly 配置的 JSON 代码块。
4. **理论概念超链接**：在深度解读报告中，对于运用的相关理论、专业概念、官方解读或引用的书籍文段，**必须**使用加粗的 Markdown 超链接格式，链接到真实的百科或学术文献页面。例如：\`[**马太效应**](https://zh.wikipedia.org/wiki/马太效应)\`。
5. **自我审查**：在正式输出最终内容前，必须先在 \`<self_check>...</self_check>\` 标签内进行自我检查，确保满足所有要求（特别是三套方案和超链接）。

# Workflow & Output Requirements

## 第零阶段：自我审查
在 \`<self_check>\` 标签内简述你的分析思路，确认是否识别了类别标签，是否准备了三套方案。

## 第一阶段：数据初探与标签识别
- 简述数据结构、维度与质量。
- 明确提取并列出关键的类别标签。

## 第二阶段：生成深度解读报告（带超链接）
- **核心发现**：用一句话总结数据传递的最关键信息。
- **统计特征**：描述均值偏移、方差波动、相关性强度等。
- **科学推论**：结合数据表现，推测其可能的意义。**注意：此部分涉及的专业名词、理论必须加粗并附带真实可点击的超链接。**

## 第三阶段：三种作图方案 (Plotly JSON + Python 代码)
你必须依次输出方案一、方案二、方案三。必须使用 \`===方案一===\`、\`===方案二===\`、\`===方案三===\` 作为严格的分隔符。对于每一个方案，必须包含：
1. **方案说明**：解释为什么选择这种图表，它展示了什么维度。
2. **Plotly JSON**：严格包裹在 \`\`\`json plotly 和 \`\`\` 之间。必须包含 \`data\` 和 \`layout\` 字段。请应用用户指定的配色方案。
3. **Python 代码**：包含全局样式设置和出版级导出函数。严格包裹在 \`\`\`python 和 \`\`\` 之间。

示例结构：
<self_check>
分析思路：...
</self_check>
[第一阶段和第二阶段内容，直接陈述，不要有AI开场白]

===方案一===
### 方案一：[图表名称]
[方案说明]
\`\`\`json plotly
{ "data": [...], "layout": { "plot_bgcolor": "#f5f2ed", "paper_bgcolor": "#f5f2ed" } }
\`\`\`
\`\`\`python
# Python code here
\`\`\`

===方案二===
### 方案二：[图表名称]
...

===方案三===
### 方案三：[图表名称]
...

内部逻辑与注释：中文。图表内部标签严格使用中文。
`;

const IMAGE_SYSTEM_INSTRUCTION = `
# Role
你是“术图”，一位顶尖的视觉设计师兼学术插画师。你擅长根据用户的文本描述，进行深度的概念分析，并生成专业级别的平面设计图、建筑渲染图、科学插图等。

# Tone & Style
- **语言风格**：客观、严谨、自然的人类学术口吻。绝对禁止使用任何AI助手的套话（如“好的”、“这是为您生成的分析”、“我已识别出”等）。直接进入正题，以资深学者的身份陈述事实和推论。

# Core Functions
1. **深度概念解析**：分析用户提供的文本，提炼核心视觉元素、氛围、材质和构图。
2. **强制三套视觉方案**：无论用户是否提出具体要求，你**必须**提供**三种**不同的视觉设计方案（方案一、方案二、方案三）。每种方案需从不同风格或视角进行设计（例如：写实渲染、极简线框、概念插画）。
3. **图像生成提示词**：为上述三种方案分别提供用于 AI 图像生成的英文提示词（Prompt）。必须使用 \`<image_prompt>...</image_prompt>\` 标签包裹。
4. **理论概念超链接**：在深度解读报告中，对于运用的相关设计理论、建筑流派、色彩心理学等概念，**必须**使用加粗的 Markdown 超链接格式，链接到真实的百科或学术文献页面。
5. **自我审查**：在正式输出最终内容前，必须先在 \`<self_check>...</self_check>\` 标签内进行自我检查，确保满足所有要求。

# Workflow & Output Requirements

## 第零阶段：自我审查
在 \`<self_check>\` 标签内简述你的设计思路，确认是否准备了三种不同风格的方案。

## 第一阶段：文本深度解析与设计策略
- 简述文本传达的核心意象与情感。
- 提出整体的视觉设计策略。

## 第二阶段：生成深度解读报告（带超链接）
- **视觉核心**：用一句话总结设计的核心视觉传达。
- **设计推论**：结合文本，推测其背后的文化、心理或物理学意义。**注意：此部分涉及的专业名词、理论必须加粗并附带真实可点击的超链接。**

## 第三阶段：三种视觉方案 (Image Prompt)
你必须依次输出方案一、方案二、方案三。必须使用 \`===方案一===\`、\`===方案二===\`、\`===方案三===\` 作为严格的分隔符。对于每一个方案，必须包含：
1. **方案说明**：解释为什么选择这种风格，它突出了什么视觉元素。
2. **英文图像提示词**：严格包裹在 \`<image_prompt>\` 和 \`</image_prompt>\` 之间。提示词必须是高度详细的英文，包含主体、环境、光影、材质、渲染引擎（如 Unreal Engine 5, Octane Render）等描述。

示例结构：
<self_check>
设计思路：...
</self_check>
[第一阶段和第二阶段内容，直接陈述，不要有AI开场白]

===方案一===
### 方案一：[风格名称]
[方案说明]
<image_prompt>A highly detailed photorealistic architectural render of...</image_prompt>

===方案二===
### 方案二：[风格名称]
...

===方案三===
### 方案三：[风格名称]
...

内部逻辑与注释：中文。
`;

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('select');
  
  const [dataInput, setDataInput] = useState('');
  const [requirementInput, setRequirementInput] = useState('');
  const [modifyInput, setModifyInput] = useState('');
  
  const [conversation, setConversation] = useState<any[]>([]);
  const [result, setResult] = useState('');
  const [parsedData, setParsedData] = useState<{ selfCheck: string; intro: string; options: ParsedOption[] }>({ selfCheck: '', intro: '', options: [] });
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [error, setError] = useState('');
  
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

  // Parse the raw markdown result into structured options
  const parseResult = (text: string) => {
    const selfCheckMatch = text.match(/<self_check>([\s\S]*?)<\/self_check>/);
    const selfCheck = selfCheckMatch ? selfCheckMatch[1].trim() : '';
    
    const textWithoutSelfCheck = text.replace(/<self_check>[\s\S]*?<\/self_check>/, '');
    const parts = textWithoutSelfCheck.split(/===方案[一二三]===/);
    const intro = parts[0] ? parts[0].trim() : '';
    
    const options: ParsedOption[] = [];
    for (let i = 1; i <= 3; i++) {
      if (parts[i]) {
        const optionText = parts[i].trim();
        
        const plotlyMatch = optionText.match(/```json\s+plotly\s*([\s\S]*?)```/);
        let plotlyJson = null;
        if (plotlyMatch) {
          try {
            plotlyJson = JSON.parse(plotlyMatch[1].trim());
          } catch (e) {
            console.error("Failed to parse Plotly JSON", e);
          }
        }
        
        const pythonMatch = optionText.match(/```python\s*([\s\S]*?)```/);
        const pythonCode = pythonMatch ? pythonMatch[1].trim() : null;
        
        const imgPromptMatch = optionText.match(/<image_prompt>([\s\S]*?)<\/image_prompt>/);
        const imagePrompt = imgPromptMatch ? imgPromptMatch[1].trim() : null;

        options.push({
          title: `方案${['一', '二', '三'][i-1]}`,
          raw: optionText,
          plotlyJson,
          pythonCode,
          imagePrompt
        });
      }
    }
    
    return { selfCheck, intro, options };
  };

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
    
    if (!isModify) {
      setResult('');
      setParsedData({ selfCheck: '', intro: '', options: [] });
      setGeneratedImages([]);
      setActiveCard(0);
    } else {
      setResult(''); // Clear result for the new stream, but keep parsedData intact for now
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let currentConversation = [...conversation];
      
      if (!isModify) {
        const prompt = `请根据以下用户需求和原始数据生成报告和三套方案：\n
【用户具体需求】
${requirementInput.trim() || '无特定需求，请自动分析并生成三种不同的合适方案。'}

【排版与出版参数预设】
- 字体：${fontFamily === 'font-simsun' ? '宋体' : fontFamily === 'font-simhei' ? '黑体' : fontFamily === 'font-kaiti' ? '楷体' : '仿宋'}
- 配色方案：${colorPalette === 'auto' ? '由术图自主决定' : colorPalette}
- DPI: ${dpi === 'auto' ? '由术图自主决定' : dpi}
- 宽度 (mm): ${width === 'auto' ? '由术图自主决定' : width}
- 高度 (mm): ${height === 'auto' ? '由术图自主决定' : height}

【输入内容】
${dataInput}`;
        
        currentConversation = [{ role: 'user', parts: [{ text: prompt }] }];
      } else {
        const modifyPrompt = `用户对之前的方案提出了修改意见：\n【修改要求】\n${modifyInput}\n\n请注意：\n1. 仅针对上述要求重新生成三套方案（包含方案说明、JSON/Prompt和代码）。\n2. 保持与第一次生成时同等甚至更高的顶刊级专业水准，绝不能降低质量。\n3. 不要重复输出第一阶段和第二阶段的深度解读，直接从 \`===方案一===\` 开始输出。`;
        currentConversation.push({ role: 'user', parts: [{ text: modifyPrompt }] });
      }

      const response = await ai.models.generateContentStream({
        model: 'gemini-3.1-pro-preview',
        contents: currentConversation,
        config: {
          systemInstruction: appMode === 'chart' ? CHART_SYSTEM_INSTRUCTION : IMAGE_SYSTEM_INSTRUCTION,
        },
      });

      let fullResult = '';
      for await (const chunk of response) {
        const text = chunk.text || '';
        fullResult += text;
        setResult((prev) => prev + text);
        if (resultEndRef.current) {
          resultEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
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

      // Handle Image Generation if in Image Mode
      if (appMode === 'image' && finalOptions.some(o => o.imagePrompt)) {
        setIsGeneratingImages(true);
        const newImages = [...generatedImages];
        
        await Promise.all(finalOptions.map(async (opt, index) => {
          if (opt.imagePrompt) {
            try {
              const imgRes = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [{ text: opt.imagePrompt }] }
              });
              const base64 = imgRes.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
              if (base64) {
                newImages[index] = `data:image/jpeg;base64,${base64}`;
              }
            } catch (e) {
              console.error("Image generation failed for option", index, e);
            }
          }
        }));
        
        setGeneratedImages(newImages);
        setIsGeneratingImages(false);
      }

      if (!isModify) {
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
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setAppMode(item.mode);
    setDataInput(item.dataInput);
    setRequirementInput(item.requirementInput);
    setResult(item.result);
    setConversation([{ role: 'user', parts: [{ text: '加载历史记录' }] }, { role: 'model', parts: [{ text: item.result }] }]);
    
    const parsed = parseResult(item.result);
    setParsedData(parsed);
    setActiveCard(0);
    setGeneratedImages([]);
    
    setIsHistoryOpen(false);
    setError('');
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('shutu_history');
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

  const exportPanelAsImage = async () => {
    if (!analysisPanelRef.current) return;
    try {
      const canvas = await html2canvas(analysisPanelRef.current, { 
        scale: 2, 
        useCORS: true, 
        backgroundColor: '#f5f2ed',
        logging: false
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = '术图_深度解析长图.png';
      a.click();
    } catch (e) {
      console.error("Export failed", e);
    }
  };

  const downloadGeneratedImage = (base64: string, index: number) => {
    if (!base64) return;
    const a = document.createElement('a');
    a.href = base64;
    a.download = `术图_视觉方案_${index + 1}.jpg`;
    a.click();
  };

  const MarkdownComponents = {
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      const isPlotly = match && match[1] === 'plotly';
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
          <pre className="p-4 bg-white border border-[rgba(26,26,26,0.2)] rounded-2xl overflow-x-auto text-sm font-mono text-[#1a1a1a]">
            <code className={className} {...props}>
              {children}
            </code>
          </pre>
        </div>
      ) : (
        <code className="bg-black/5 px-1.5 py-0.5 rounded-md font-mono text-sm" {...props}>
          {children}
        </code>
      );
    },
    a({ node, children, href, ...props }: any) {
      return (
        <a 
          href={href} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[#1a1a1a] underline decoration-[rgba(26,26,26,0.4)] underline-offset-4 hover:decoration-[#1a1a1a] hover:bg-[#1a1a1a]/5 transition-all font-bold rounded-sm px-0.5"
          {...props}
        >
          {children}
        </a>
      );
    }
  };

  // Entry Screen
  if (appMode === 'select') {
    return (
      <div className="min-h-screen bg-[#f5f2ed] text-[#1a1a1a] font-serif flex flex-col items-center justify-center p-6 selection:bg-[#1a1a1a] selection:text-[#f5f2ed]">
        <div className="max-w-3xl w-full text-center mb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="w-16 h-16 border-2 border-[#1a1a1a] rounded-2xl flex items-center justify-center mx-auto mb-8">
            <BarChart2 size={32} strokeWidth={1.5} />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-widest uppercase mb-4">术图 Shutu</h1>
          <p className="text-sm md:text-base tracking-[0.2em] text-[#1a1a1a]/60 uppercase">Nature / Science / Cell Standards</p>
          <p className="mt-6 text-lg text-[#1a1a1a]/80 max-w-xl mx-auto leading-relaxed">
            顶尖学术期刊级的数据分析与视觉设计引擎。请选择您本次需要生成的内容类型。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-150">
          <button 
            onClick={() => setAppMode('chart')}
            className="group relative bg-white border border-[rgba(26,26,26,0.2)] rounded-3xl p-10 flex flex-col items-center text-center hover:border-[#1a1a1a] hover:shadow-2xl transition-all duration-500 overflow-hidden"
          >
            <div className="absolute inset-0 bg-[#1a1a1a] translate-y-[100%] group-hover:translate-y-0 transition-transform duration-500 ease-in-out" />
            <BarChart2 size={48} strokeWidth={1} className="mb-6 text-[#1a1a1a] group-hover:text-[#f5f2ed] transition-colors duration-500 relative z-10" />
            <h2 className="text-2xl font-bold tracking-widest mb-4 text-[#1a1a1a] group-hover:text-[#f5f2ed] transition-colors duration-500 relative z-10">数据可视化分析</h2>
            <p className="text-sm text-[#1a1a1a]/60 group-hover:text-[#f5f2ed]/80 transition-colors duration-500 relative z-10 leading-relaxed">
              输入原始数据，自动识别变量，生成深度学术解读报告及三套符合顶刊标准的交互式图表与 Python 代码。
            </p>
          </button>

          <button 
            onClick={() => setAppMode('image')}
            className="group relative bg-white border border-[rgba(26,26,26,0.2)] rounded-3xl p-10 flex flex-col items-center text-center hover:border-[#1a1a1a] hover:shadow-2xl transition-all duration-500 overflow-hidden"
          >
            <div className="absolute inset-0 bg-[#1a1a1a] translate-y-[100%] group-hover:translate-y-0 transition-transform duration-500 ease-in-out" />
            <ImageIcon size={48} strokeWidth={1} className="mb-6 text-[#1a1a1a] group-hover:text-[#f5f2ed] transition-colors duration-500 relative z-10" />
            <h2 className="text-2xl font-bold tracking-widest mb-4 text-[#1a1a1a] group-hover:text-[#f5f2ed] transition-colors duration-500 relative z-10">专业图像生成</h2>
            <p className="text-sm text-[#1a1a1a]/60 group-hover:text-[#f5f2ed]/80 transition-colors duration-500 relative z-10 leading-relaxed">
              输入文本描述，智能解析概念，生成三套不同风格的专业级平面设计图、建筑渲染图或科学插图。
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

      {/* Header */}
      <header className="border-b border-[rgba(26,26,26,0.1)] sticky top-0 z-20 bg-[#f5f2ed]/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer" onClick={() => setAppMode('select')}>
            <div className="w-10 h-10 border border-[#1a1a1a] rounded-xl flex items-center justify-center text-[#1a1a1a] hover:bg-[#1a1a1a] hover:text-[#f5f2ed] transition-colors">
              {appMode === 'chart' ? <BarChart2 size={20} strokeWidth={1.5} /> : <ImageIcon size={20} strokeWidth={1.5} />}
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-widest uppercase flex items-center gap-2">
                术图 <span className="text-xs font-normal opacity-50">| {appMode === 'chart' ? '数据可视化' : '专业图像生成'}</span>
              </h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#1a1a1a]/60">Nature / Science / Cell Standards</p>
            </div>
          </div>
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] hover:bg-white transition-all"
          >
            <History size={14} />
            <span className="hidden sm:inline">历史记录</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Panel: Input & Settings */}
          <div className="lg:col-span-4 xl:col-span-5 flex flex-col gap-6">
            
            <div className="premium-panel p-6 flex flex-col gap-6 sticky top-28">
              <div className="flex items-center justify-between border-b border-[rgba(26,26,26,0.1)] pb-4">
                <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                  <FileSpreadsheet size={16} />
                  输入与预设
                </h2>
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
                  placeholder={appMode === 'chart' ? "例如：我需要一个散点图矩阵..." : "例如：设计一个未来城市的建筑渲染图..."}
                  value={requirementInput}
                  onChange={(e) => setRequirementInput(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              {/* Data Input */}
              <div className="flex flex-col gap-3 flex-1">
                <label className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]/70 flex items-center gap-2">
                  <FileText size={14} />
                  {appMode === 'chart' ? '原始数据 (必填)' : '文本描述 (必填)'}
                </label>
                <textarea
                  className="premium-input flex-1 w-full p-4 resize-none font-mono text-sm min-h-[150px]"
                  placeholder={appMode === 'chart' ? "在此处粘贴您的原始数据..." : "详细描述您想要生成的图像内容、氛围、材质等..."}
                  value={dataInput}
                  onChange={(e) => setDataInput(e.target.value)}
                  disabled={isLoading}
                />
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
                  <div className="grid grid-cols-2 gap-4 mt-4">
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
                    <div className="flex flex-col gap-2 col-span-2">
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
                    {appMode === 'chart' && (
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
                    )}
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
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="premium-input flex-1 p-3 text-sm"
                      placeholder="输入修改要求，术图将仅更新方案..."
                      value={modifyInput}
                      onChange={(e) => setModifyInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAnalyze(true)}
                    />
                    <button
                      onClick={() => handleAnalyze(true)}
                      disabled={!modifyInput.trim() || isLoading}
                      className="premium-button px-4 flex items-center justify-center"
                      title="提交修改"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Output */}
          <div className="lg:col-span-8 xl:col-span-7 flex flex-col gap-8">
            
            {/* Loading / Streaming State */}
            {isLoading && (
              <div className="premium-panel p-8 min-h-[600px] flex flex-col">
                <div className="flex items-center gap-3 mb-6 text-[#1a1a1a]/50">
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-sm font-bold uppercase tracking-widest">术图思考中...</span>
                </div>
                <div className={`prose prose-slate max-w-none ${fontSize} opacity-70`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
                </div>
                <div ref={resultEndRef} />
              </div>
            )}

            {/* Flashcard UI (Shows when not loading and options exist) */}
            {!isLoading && parsedData.options.length > 0 && (
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700" ref={analysisPanelRef}>
                
                {/* Intro Text & Export Options */}
                {parsedData.intro && (
                  <div className={`premium-panel p-8 relative`}>
                    <div className="absolute top-4 right-4 flex gap-2 z-10">
                      <button 
                        onClick={exportText}
                        className="p-2 bg-white border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-sm"
                        title="导出纯文本"
                      >
                        <Download size={14} /> 文本
                      </button>
                      <button 
                        onClick={exportPanelAsImage}
                        className="p-2 bg-white border border-[rgba(26,26,26,0.2)] rounded-xl hover:border-[#1a1a1a] transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-sm"
                        title="保存为长图"
                      >
                        <ImageDown size={14} /> 长图
                      </button>
                    </div>
                    
                    <div className={`prose prose-slate max-w-none prose-headings:font-bold prose-headings:tracking-wide prose-p:leading-relaxed ${fontSize} mt-4`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                        {parsedData.intro}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Flashcard Navigation */}
                <div className="flex items-center justify-between bg-[#1a1a1a] text-[#f5f2ed] p-4 rounded-2xl shadow-xl">
                  <button 
                    onClick={() => setActiveCard(prev => (prev > 0 ? prev - 1 : parsedData.options.length - 1))}
                    className="p-2 hover:bg-white/10 rounded-xl transition-colors flex items-center gap-2 text-sm font-bold uppercase tracking-widest"
                  >
                    <ChevronLeft size={18} /> 上一方案
                  </button>
                  <div className="flex gap-3">
                    {parsedData.options.map((_, idx) => (
                      <button 
                        key={idx}
                        onClick={() => setActiveCard(idx)}
                        className={`w-2.5 h-2.5 rounded-full transition-all ${activeCard === idx ? 'bg-[#f5f2ed] scale-150' : 'bg-[#f5f2ed]/30 hover:bg-[#f5f2ed]/60'}`}
                      />
                    ))}
                  </div>
                  <button 
                    onClick={() => setActiveCard(prev => (prev < parsedData.options.length - 1 ? prev + 1 : 0))}
                    className="p-2 hover:bg-white/10 rounded-xl transition-colors flex items-center gap-2 text-sm font-bold uppercase tracking-widest"
                  >
                    下一方案 <ChevronRight size={18} />
                  </button>
                </div>

                {/* Active Flashcard with Framer Motion */}
                <div className="relative min-h-[600px]">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeCard}
                      initial={{ opacity: 0, x: 20, scale: 0.98 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -20, scale: 0.98 }}
                      transition={{ duration: 0.4, ease: "easeInOut" }}
                      className="premium-panel p-8 shadow-lg border-t-4 border-t-[#1a1a1a] absolute inset-0 h-max"
                    >
                      <div className="flex items-center justify-between border-b border-[rgba(26,26,26,0.1)] pb-4 mb-8">
                        <h2 className="text-lg font-bold uppercase tracking-widest flex items-center gap-2">
                          {parsedData.options[activeCard].title}
                        </h2>
                        <span className="text-xs font-bold uppercase tracking-widest text-[#1a1a1a]/50 bg-black/5 px-3 py-1 rounded-full">
                          {activeCard + 1} / {parsedData.options.length}
                        </span>
                      </div>

                      {/* Chart Rendering */}
                      {appMode === 'chart' && parsedData.options[activeCard].plotlyJson && (
                        <div className="mb-8 w-full overflow-x-auto flex justify-center border border-[rgba(26,26,26,0.1)] rounded-2xl p-4 bg-white">
                          <Plot
                            data={parsedData.options[activeCard].plotlyJson.data}
                            layout={{
                              ...parsedData.options[activeCard].plotlyJson.layout,
                              autosize: true,
                              margin: { l: 50, r: 30, t: 50, b: 50 },
                              paper_bgcolor: 'transparent',
                              plot_bgcolor: 'rgba(26,26,26,0.02)',
                            }}
                            useResizeHandler={true}
                            style={{ width: '100%', minHeight: '400px' }}
                            config={{ responsive: true, displayModeBar: true }}
                          />
                        </div>
                      )}

                      {/* Image Rendering */}
                      {appMode === 'image' && parsedData.options[activeCard].imagePrompt && (
                        <div className="mb-8 w-full flex flex-col items-center justify-center border border-[rgba(26,26,26,0.1)] rounded-2xl p-4 bg-white min-h-[400px] relative group">
                          {isGeneratingImages ? (
                            <div className="flex flex-col items-center gap-4 text-[#1a1a1a]/50">
                              <Loader2 size={32} className="animate-spin" />
                              <span className="text-sm font-bold uppercase tracking-widest">正在渲染高精度图像...</span>
                            </div>
                          ) : generatedImages[activeCard] ? (
                            <>
                              <img 
                                src={generatedImages[activeCard]} 
                                alt={`Generated for ${parsedData.options[activeCard].title}`}
                                className="max-w-full h-auto shadow-md rounded-xl"
                                referrerPolicy="no-referrer"
                              />
                              <button 
                                onClick={() => downloadGeneratedImage(generatedImages[activeCard], activeCard)}
                                className="absolute bottom-6 right-6 p-3 bg-white/90 backdrop-blur-sm border border-[rgba(26,26,26,0.2)] rounded-xl shadow-lg hover:bg-[#1a1a1a] hover:text-white transition-all opacity-0 group-hover:opacity-100 flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
                              >
                                <Download size={16} /> 下载高清图
                              </button>
                            </>
                          ) : (
                            <div className="text-sm text-red-500">图像生成失败或未找到提示词</div>
                          )}
                        </div>
                      )}

                      {/* Analysis Text */}
                      <div className={`prose prose-slate max-w-none prose-headings:font-bold prose-headings:tracking-wide prose-p:leading-relaxed ${fontSize}`}>
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={MarkdownComponents}
                        >
                          {/* Remove the plotly json and image prompt from the raw text for clean display */}
                          {parsedData.options[activeCard].raw
                            .replace(/```json\s+plotly[\s\S]*?```/, '')
                            .replace(/<image_prompt>[\s\S]*?<\/image_prompt>/, '')}
                        </ReactMarkdown>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

              </div>
            )}

            {/* Initial Empty State */}
            {!isLoading && parsedData.options.length === 0 && (
              <div className="premium-panel p-8 min-h-[600px] flex flex-col items-center justify-center text-[#1a1a1a]/30 gap-6">
                {appMode === 'chart' ? <BarChart2 size={64} strokeWidth={1} /> : <ImageIcon size={64} strokeWidth={1} />}
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
