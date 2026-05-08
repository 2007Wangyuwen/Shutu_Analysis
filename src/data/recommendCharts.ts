import type { ChartRecommendation, ChartType, BuilderOptions, InferredSchema } from './types';

function pickFirst<T>(arr: T[], fallback?: T): T | undefined {
  if (arr.length > 0) return arr[0];
  return fallback;
}

export function recommendCharts(schema: InferredSchema): ChartRecommendation[] {
  const timeCols = schema.columns.filter((c) => c.type === 'time').map((c) => c.name);
  const numberCols = schema.columns.filter((c) => c.type === 'number').map((c) => c.name);
  const categoryCols = schema.columns.filter((c) => c.type === 'category').map((c) => c.name);

  const recs: ChartRecommendation[] = [];

  const push = (chartType: ChartType, reason: string, defaultOptions: BuilderOptions) => {
    recs.push({ chartType, reason, defaultOptions });
  };

  if (timeCols.length >= 1 && numberCols.length >= 1) {
    push(
      'time_series',
      '存在时间字段与数值字段，适合用时间序列展示趋势与波动。',
      { chartType: 'time_series', x: pickFirst(timeCols), y: pickFirst(numberCols), title: '时间序列概览' }
    );
  }

  if (categoryCols.length >= 1 && numberCols.length >= 1) {
    push(
      'bar_aggregate',
      '存在分类字段与数值字段，可将数值按类别聚合后对比不同组的水平。',
      { chartType: 'bar_aggregate', x: pickFirst(categoryCols), y: pickFirst(numberCols), agg: 'mean', title: '类别聚合柱状图概览' }
    );
  }

  if (numberCols.length >= 2) {
    push(
      'scatter_xy',
      '存在多个数值字段，散点图更适合识别关系、聚类与可能的相关性结构。',
      { chartType: 'scatter_xy', x: pickFirst(numberCols), y: pickFirst(numberCols.slice(1)), title: '数值关系散点概览' }
    );
    push(
      'correlation_heatmap',
      '数值字段数量较多时，相关性热力图可快速定位强相关与潜在共线性。',
      { chartType: 'correlation_heatmap', title: '相关性热力图概览' }
    );
  }

  if (categoryCols.length >= 2) {
    push(
      'stacked_bar_counts',
      '若有多个分类字段，可用堆叠计数图展示不同组合下的分布结构。',
      { chartType: 'stacked_bar_counts', x: pickFirst(categoryCols), groupBy: categoryCols[1], title: '分类组合堆叠计数概览' }
    );
  }

  if (numberCols.length >= 1) {
    push(
      'histogram',
      '当关注某个数值变量的分布时，直方图用于观察偏态、离群与多峰结构。',
      { chartType: 'histogram', x: pickFirst(numberCols), title: '数值分布直方图概览' }
    );
  }

  // Keep it compact: top 4 unique chart types
  const seen = new Set<ChartType>();
  const out: ChartRecommendation[] = [];
  for (const r of recs) {
    if (seen.has(r.chartType)) continue;
    seen.add(r.chartType);
    out.push(r);
    if (out.length >= 4) break;
  }
  return out;
}

