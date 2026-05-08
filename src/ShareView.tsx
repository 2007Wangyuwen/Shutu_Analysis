import { useState, useEffect, useMemo, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, BarChart2, Image as ImageIcon, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

const Plot = createPlotlyComponent(Plotly);

type ParsedOption = {
  title: string;
  raw: string;
  plotlyJson: any | null;
  pythonCode: string | null;
  imagePrompt: string | null;
};

type ParsedResult = { selfCheck: string; intro: string; options: ParsedOption[] };

type SharePayload = {
  result: string;
  parsed: ParsedResult;
  mode: 'chart' | 'image';
  timestamp: number;
  images?: (string | undefined)[];
};

function getPlotlyFigure(plotlyJson: any | null) {
  if (!plotlyJson?.data?.length || !plotlyJson?.layout) return null;
  return plotlyJson;
}

function ShareMdCode({ inline, className, children, ...props }: any) {
  const match = /language-([a-zA-Z0-9_-]+)/.exec(className || '');
  const lang = match?.[1] ?? 'text';
  const isPlotly = lang === 'plotly' || String(className || '').includes('plotly');
  const [copied, setCopied] = useState(false);

  if (isPlotly) return null;

  if (!inline && match) {
    return (
      <div className="relative group mt-4 mb-6">
        <div className="absolute right-0 top-0 p-2 z-10">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="flex items-center gap-1 px-3 py-1.5 bg-[#1a1a1a] text-[#f5f2ed] rounded-xl text-xs uppercase tracking-wider hover:bg-black/80 transition-colors"
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
    );
  }
  return (
    <code className="bg-black/5 px-1.5 py-0.5 rounded-md font-mono text-sm" {...props}>
      {children}
    </code>
  );
}

function ShareMdLink({ children, href, ...props }: any) {
  const { target: _t, rel: _r, ...rest } = props as Record<string, unknown>;
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#1a1a1a] underline decoration-[rgba(26,26,26,0.4)] underline-offset-4 hover:decoration-[#1a1a1a] font-bold"
    >
      {children}
    </a>
  );
}

export default function ShareView({ shareId }: { shareId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SharePayload | null>(null);
  const [activeCard, setActiveCard] = useState(0);
  const [isCardExpanded, setIsCardExpanded] = useState(true);

  const mdComponents = useMemo<ComponentProps<typeof ReactMarkdown>['components']>(
    () => ({
      code: ShareMdCode,
      a: ShareMdLink,
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error || `加载失败 (${res.status})`);
        }
        if (!cancelled) setData(json as SharePayload);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '无法加载分享内容');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const parsed = data?.parsed;
  const fontSize = 'text-xiaosi';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f2ed] flex items-center justify-center text-[#1a1a1a]/50">
        <Loader2 className="animate-spin mr-2" size={24} />
        <span className="text-sm font-bold uppercase tracking-widest">加载分享内容…</span>
      </div>
    );
  }

  if (error || !data || !parsed) {
    return (
      <div className="min-h-screen bg-[#f5f2ed] flex flex-col items-center justify-center p-6 text-center">
        <p className="text-red-600 mb-4">{error || '内容不可用'}</p>
        <a href="/" className="text-sm underline text-[#1a1a1a]">
          返回术图首页
        </a>
      </div>
    );
  }

  const modeLabel = data.mode === 'image' ? '专业图像' : '数据可视化';
  const ModeIcon = data.mode === 'image' ? ImageIcon : BarChart2;

  return (
    <div className="min-h-screen bg-[#f5f2ed] text-[#1a1a1a] font-serif selection:bg-[#1a1a1a] selection:text-[#f5f2ed]">
      <header className="sticky top-0 z-20 border-b border-[rgba(26,26,26,0.1)] bg-[#f5f2ed]/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 border-2 border-[#1a1a1a] rounded-xl flex items-center justify-center shrink-0">
              <ModeIcon size={22} strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold uppercase tracking-widest truncate">术图 · 分享（只读）</h1>
              <p className="text-[10px] text-[#1a1a1a]/55 uppercase tracking-wider mt-0.5 leading-snug hidden sm:block">
                {modeLabel} · 链接默认 24 小时内有效 · 不包含编辑与原始数据输入
              </p>
              <p className="text-[10px] text-[#1a1a1a]/55 uppercase tracking-wider mt-0.5 leading-snug sm:hidden">
                {modeLabel} · 24h 有效
              </p>
            </div>
          </div>
          <a
            href="/"
            className="text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl border border-[rgba(26,26,26,0.2)] hover:border-[#1a1a1a] transition-colors shrink-0 text-center touch-manipulation w-full sm:w-auto"
          >
            打开术图
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6">
        {parsed.intro && (
          <div className="premium-panel p-4 sm:p-8">
            <div className={`prose prose-slate max-w-none prose-headings:font-bold ${fontSize}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {parsed.intro}
              </ReactMarkdown>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {parsed.options.map((opt, idx) => {
            const isOpen = activeCard === idx && isCardExpanded;
            const fig = data.mode === 'chart' ? getPlotlyFigure(opt.plotlyJson) : null;
            const imgUrl = data.mode === 'image' ? data.images?.[idx] : undefined;

            return (
              <div key={idx} className="premium-panel border-t-4 border-t-[#1a1a1a] overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    if (activeCard === idx) setIsCardExpanded((v) => !v);
                    else {
                      setActiveCard(idx);
                      setIsCardExpanded(true);
                    }
                  }}
                  className="w-full p-4 flex items-center justify-between bg-[#f5f2ed] border-b border-[rgba(26,26,26,0.08)]"
                >
                  <div className="flex items-center gap-3 min-w-0 text-left">
                    <span className="text-xs font-bold uppercase tracking-widest text-[#1a1a1a]/50 bg-black/5 px-3 py-1 rounded-full">
                      {idx + 1} / {parsed.options.length}
                    </span>
                    <h2 className="text-sm sm:text-base font-bold uppercase tracking-widest truncate">{opt.title}</h2>
                  </div>
                  {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>

                {isOpen && (
                  <div className="p-4 sm:p-6 flex flex-col gap-6">
                    {data.mode === 'chart' && fig && (
                      <div className="w-full overflow-hidden flex justify-center border border-[rgba(26,26,26,0.1)] rounded-2xl p-4 bg-white">
                        <div className="w-full h-[380px] sm:h-[480px] max-h-[45vh] overflow-hidden">
                          <Plot
                            data={fig.data}
                            layout={{
                              ...fig.layout,
                              autosize: true,
                              uirevision: fig.layout?.uirevision ?? 'shutu-share',
                              hovermode: fig.layout?.hovermode ?? 'closest',
                              margin: { l: 50, r: 30, t: 50, b: 50 },
                              paper_bgcolor: 'transparent',
                              plot_bgcolor: 'rgba(26,26,26,0.02)',
                            }}
                            useResizeHandler={true}
                            style={{ width: '100%', height: '100%' }}
                            config={{ responsive: true, displayModeBar: true, scrollZoom: false, editable: false }}
                          />
                        </div>
                      </div>
                    )}

                    {data.mode === 'image' && opt.imagePrompt && (
                      <div className="w-full flex flex-col items-center justify-center border border-[rgba(26,26,26,0.1)] rounded-2xl p-4 bg-white min-h-[280px]">
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt={opt.title}
                            className="max-w-full h-auto shadow-md rounded-xl"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <p className="text-sm text-[#1a1a1a]/45">生成图未包含在分享快照中或链接已失效</p>
                        )}
                      </div>
                    )}

                    <div className={`prose prose-slate max-w-none prose-headings:font-bold ${fontSize}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {opt.raw
                          .replace(/```(?:json(?:\s+plotly)?|plotly)\s*[\s\S]*?```/gi, '')
                          .replace(/<image_prompt>[\s\S]*?<\/image_prompt>/, '')}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
