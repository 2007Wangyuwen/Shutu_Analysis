import type { BuilderOptions, ChartRecommendation, InferredSchema, ChartType, Aggregation } from '../data/types';

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export default function ChartBuilderControls({
  schema,
  recommendations,
  value,
  onChange,
}: {
  schema: InferredSchema;
  recommendations: ChartRecommendation[];
  value: BuilderOptions | null;
  onChange: (next: BuilderOptions) => void;
}) {
  const chartTypeOptions = uniq(recommendations.map((r) => r.chartType)) as ChartType[];

  const columnsByType = {
    time: schema.columns.filter((c) => c.type === 'time').map((c) => c.name),
    number: schema.columns.filter((c) => c.type === 'number').map((c) => c.name),
    category: schema.columns.filter((c) => c.type === 'category').map((c) => c.name),
  };

  const current: BuilderOptions =
    value ??
    recommendations[0]?.defaultOptions ?? {
      chartType: chartTypeOptions[0] ?? 'time_series',
    };

  const set = (patch: Partial<BuilderOptions>) => {
    onChange({ ...current, ...patch });
  };

  const renderAgg = (agg?: Aggregation) => {
    if (current.chartType !== 'bar_aggregate') return null;
    return (
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">聚合方式</label>
        <select
          className="premium-input p-2 text-xs"
          value={agg ?? 'mean'}
          onChange={(e) => set({ agg: e.target.value as Aggregation })}
        >
          <option value="mean">均值 (mean)</option>
          <option value="median">中位数 (median)</option>
          <option value="sum">求和 (sum)</option>
          <option value="count">计数 (count)</option>
        </select>
      </div>
    );
  };

  const renderColumns = () => {
    if (current.chartType === 'time_series') {
      return (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">时间列 (x)</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.x ?? ''}
              onChange={(e) => set({ x: e.target.value })}
            >
              {columnsByType.time.length ? columnsByType.time.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用时间列</option>}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">数值列 (y)</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.y ?? ''}
              onChange={(e) => set({ y: e.target.value })}
            >
              {columnsByType.number.length ? columnsByType.number.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用数值列</option>}
            </select>
          </div>
        </>
      );
    }

    if (current.chartType === 'bar_aggregate') {
      return (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">分类列 (x)</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.x ?? ''}
              onChange={(e) => set({ x: e.target.value })}
            >
              {columnsByType.category.length ? columnsByType.category.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用分类列</option>}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">数值列 (y)</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.y ?? ''}
              onChange={(e) => set({ y: e.target.value })}
            >
              {columnsByType.number.length ? columnsByType.number.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用数值列</option>}
            </select>
          </div>
          {renderAgg(current.agg)}
        </>
      );
    }

    if (current.chartType === 'scatter_xy') {
      return (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">x 列</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.x ?? ''}
              onChange={(e) => set({ x: e.target.value })}
            >
              {columnsByType.number.length ? columnsByType.number.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用数值列</option>}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">y 列</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.y ?? ''}
              onChange={(e) => set({ y: e.target.value })}
            >
              {columnsByType.number.length ? columnsByType.number.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用数值列</option>}
            </select>
          </div>
        </>
      );
    }

    if (current.chartType === 'histogram') {
      return (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">数值列 (x)</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.x ?? current.y ?? ''}
              onChange={(e) => set({ x: e.target.value })}
            >
              {columnsByType.number.length ? columnsByType.number.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用数值列</option>}
            </select>
          </div>
        </>
      );
    }

    if (current.chartType === 'stacked_bar_counts') {
      const groupChoices = columnsByType.category.filter((c) => c !== current.x);
      return (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">x 分类列</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.x ?? ''}
              onChange={(e) => set({ x: e.target.value, groupBy: groupChoices[0] })}
            >
              {columnsByType.category.length ? columnsByType.category.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用分类列</option>}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">分组分类列</label>
            <select
              className="premium-input p-2 text-xs"
              value={current.groupBy ?? ''}
              onChange={(e) => set({ groupBy: e.target.value })}
            >
              {groupChoices.length ? groupChoices.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">无可用分组列</option>}
            </select>
          </div>
        </>
      );
    }

    if (current.chartType === 'correlation_heatmap') {
      return (
        <div className="col-span-1 sm:col-span-2 p-3 bg-black/5 rounded-xl text-xs text-[#1a1a1a]/70">
          将自动选取前 10 个数值列并计算两两相关系数。
        </div>
      );
    }

    return null;
  };

  return (
    <div className="bg-white border border-[rgba(26,26,26,0.1)] rounded-2xl p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 mb-3">
        <div className="text-sm font-bold uppercase tracking-widest text-[#1a1a1a]">概览图（可编辑）</div>
        <div className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60 leading-snug">
          根据字段类型自动构建并允许修改
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">图表类型</label>
          <select
            className="premium-input p-2 text-xs"
            value={current.chartType as ChartType}
            onChange={(e) => set({ chartType: e.target.value as ChartType })}
          >
            {chartTypeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/60">标题</label>
          <input
            type="text"
            className="premium-input p-2 text-xs"
            value={current.title ?? ''}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="用于图表标题"
          />
        </div>

        {renderColumns()}
      </div>
    </div>
  );
}

