import { useEffect, useMemo, useState } from 'react';

export default function PlotlyJsonEditor({
  value,
  onApply,
}: {
  value: any;
  onApply: (next: any) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    try {
      setText(JSON.stringify(value, null, 2));
      setError('');
    } catch {
      setText('');
    }
  }, [value]);

  const parsedPreview = useMemo(() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }, [text]);

  const handleApply = () => {
    try {
      const next = JSON.parse(text);
      setError('');
      onApply(next);
    } catch (e: any) {
      setError(e?.message || 'JSON 解析失败');
    }
  };

  return (
    <div className="bg-white border border-[rgba(26,26,26,0.1)] rounded-2xl p-4">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="text-sm font-bold uppercase tracking-widest text-[#1a1a1a]">Plotly JSON 编辑器</div>
        <button
          onClick={handleApply}
          className="premium-button px-4 py-2 text-xs font-bold uppercase tracking-widest"
          title="应用 JSON 编辑并重新渲染图表"
        >
          应用编辑
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="premium-input w-full min-h-[220px] font-mono text-xs p-3"
        spellCheck={false}
      />

      {error ? (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl">
          {error}
        </div>
      ) : parsedPreview ? (
        <div className="mt-3 p-3 bg-black/5 text-[#1a1a1a]/70 border border-[rgba(26,26,26,0.1)] text-xs rounded-xl">
          JSON 语法看起来是有效的。应用后将用于重新渲染图表。
        </div>
      ) : (
        <div className="mt-3 p-3 bg-black/5 text-[#1a1a1a]/70 border border-[rgba(26,26,26,0.1)] text-xs rounded-xl">
          请输入有效的 JSON（包含 `data` 和 `layout` 字段）。
        </div>
      )}
    </div>
  );
}

