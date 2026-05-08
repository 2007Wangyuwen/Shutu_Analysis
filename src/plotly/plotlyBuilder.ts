import type { Aggregation, BuilderOptions, ChartType, InferredSchema } from '../data/types';

function isNilOrEmpty(v: any) {
  return v === null || v === undefined || String(v).trim() === '';
}

function toNumber(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Percent
  const percentMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    const n = Number(percentMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  const cleaned = s.replace(/[,，]/g, '').replace(/[¥￥$£€]/g, '').replace(/\s+/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toDate(v: any): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number') {
    // very rough: Excel serial
    if (v < 20000 || v > 70000) return null;
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    const y = d.getFullYear();
    if (y < 1900 || y > 2100) return null;
    return d;
  }
  return null;
}

function median(nums: number[]) {
  if (nums.length === 0) return NaN;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function aggregate(nums: number[], agg: Aggregation) {
  if (agg === 'count') return nums.length;
  if (nums.length === 0) return NaN;
  if (agg === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (agg === 'mean') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (agg === 'median') return median(nums);
  return NaN;
}

export function buildPlotlyFigure(
  options: BuilderOptions,
  rows: Array<Record<string, any>>,
  schema: InferredSchema
): { data: any[]; layout: any } {
  const chartType = options.chartType;
  const title = options.title ?? '图表概览';

  const inferType = (col?: string) => {
    if (!col) return null;
    return schema.columns.find((c) => c.name === col)?.type ?? null;
  };

  const xType = inferType(options.x);
  const yType = inferType(options.y);

  const commonLayout = {
    title: { text: title, x: 0.02, xanchor: 'left', font: { size: 16 } },
    hovermode: 'closest',
    legend: { orientation: 'h' },
    margin: { l: 60, r: 30, t: 60, b: 60 },
  };

  if (chartType === 'time_series' && options.x && options.y) {
    // Plotly can handle Date objects directly.
    const pts: Array<{ x: Date; y: number }> = [];
    for (const r of rows) {
      const xd = toDate(r[options.x]);
      const yn = toNumber(r[options.y]);
      if (!xd || yn === null || Number.isNaN(yn)) continue;
      pts.push({ x: xd, y: yn });
    }
    pts.sort((a, b) => a.x.getTime() - b.x.getTime());

    const x = pts.map((p) => p.x);
    const y = pts.map((p) => p.y);

    return {
      data: [
        {
          type: 'scatter',
          mode: 'lines+markers',
          x,
          y,
          name: options.y,
          marker: { size: 6 },
          line: { width: 2 },
        },
      ],
      layout: {
        ...commonLayout,
        xaxis: { title: options.x, type: 'date', automargin: true },
        yaxis: { title: options.y, automargin: true },
      },
    };
  }

  if (chartType === 'bar_aggregate' && options.x && options.y) {
    const agg = options.agg ?? 'mean';
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const keyRaw = r[options.x];
      if (isNilOrEmpty(keyRaw)) continue;
      const key = String(keyRaw).trim();
      const yn = toNumber(r[options.y]);
      if (yn === null || Number.isNaN(yn)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(yn);
    }

    const categories = Array.from(groups.keys());
    // deterministic sorting by aggregated value (desc), but keep stable fallback
    const aggValues = categories.map((c) => aggregate(groups.get(c) ?? [], agg));
    const pairs = categories.map((c, i) => ({ c, v: aggValues[i] })).sort((a, b) => {
      if (Number.isNaN(a.v) && Number.isNaN(b.v)) return 0;
      if (Number.isNaN(a.v)) return 1;
      if (Number.isNaN(b.v)) return -1;
      return b.v - a.v;
    });

    return {
      data: [
        {
          type: 'bar',
          x: pairs.map((p) => p.c),
          y: pairs.map((p) => p.v),
          name: options.y,
          marker: { line: { width: 0.4, color: 'rgba(0,0,0,0.25)' } },
        },
      ],
      layout: {
        ...commonLayout,
        xaxis: { title: options.x, automargin: true, tickangle: -30 },
        yaxis: { title: `${options.y} (${agg})`, automargin: true },
      },
    };
  }

  if (chartType === 'scatter_xy' && options.x && options.y) {
    const xVals: number[] = [];
    const yVals: number[] = [];
    for (const r of rows) {
      const xn = toNumber(r[options.x]);
      const yn = toNumber(r[options.y]);
      if (xn === null || yn === null) continue;
      if (Number.isNaN(xn) || Number.isNaN(yn)) continue;
      xVals.push(xn);
      yVals.push(yn);
    }
    return {
      data: [
        {
          type: 'scatter',
          mode: 'markers',
          x: xVals,
          y: yVals,
          name: `${options.y} vs ${options.x}`,
          marker: { size: 7, opacity: 0.75 },
        },
      ],
      layout: {
        ...commonLayout,
        xaxis: { title: options.x, automargin: true },
        yaxis: { title: options.y, automargin: true },
      },
    };
  }

  if (chartType === 'histogram' && (options.x || options.y)) {
    const col = options.x ?? options.y!;
    const vals: number[] = [];
    for (const r of rows) {
      const v = toNumber(r[col]);
      if (v === null || Number.isNaN(v)) continue;
      vals.push(v);
    }
    return {
      data: [
        {
          type: 'histogram',
          x: vals,
          nbinsx: 20,
          marker: { line: { width: 0.4, color: 'rgba(0,0,0,0.25)' } },
          name: col,
        },
      ],
      layout: {
        ...commonLayout,
        xaxis: { title: col, automargin: true },
        yaxis: { title: '计数', automargin: true },
      },
    };
  }

  if (chartType === 'stacked_bar_counts' && options.x && options.groupBy) {
    const xCol = options.x;
    const groupBy = options.groupBy;
    const xCats = new Set<string>();
    const gCats = new Set<string>();
    const counts = new Map<string, Map<string, number>>();

    for (const r of rows) {
      const xRaw = r[xCol];
      const gRaw = r[groupBy];
      if (isNilOrEmpty(xRaw) || isNilOrEmpty(gRaw)) continue;
      const xKey = String(xRaw).trim();
      const gKey = String(gRaw).trim();
      xCats.add(xKey);
      gCats.add(gKey);
      if (!counts.has(xKey)) counts.set(xKey, new Map());
      const m = counts.get(xKey)!;
      m.set(gKey, (m.get(gKey) ?? 0) + 1);
    }

    const xOrder = Array.from(xCats);
    // Order by total count desc
    const totals = xOrder.map((xk) => {
      const m = counts.get(xk);
      let sum = 0;
      for (const v of m?.values() ?? []) sum += v;
      return { xk, sum };
    });
    totals.sort((a, b) => b.sum - a.sum);
    const xSorted = totals.map((t) => t.xk);

    const gOrder = Array.from(gCats);

    const data = gOrder.map((gKey) => ({
      type: 'bar',
      x: xSorted,
      y: xSorted.map((xk) => counts.get(xk)?.get(gKey) ?? 0),
      name: gKey,
    }));

    return {
      data,
      layout: {
        ...commonLayout,
        barmode: 'stack',
        xaxis: { title: xCol, automargin: true, tickangle: -30 },
        yaxis: { title: '计数', automargin: true },
        legend: { orientation: 'h' },
      },
    };
  }

  if (chartType === 'correlation_heatmap') {
    const numericCols = schema.columns.filter((c) => c.type === 'number').map((c) => c.name);
    const colNames = numericCols.slice(0, 10); // keep compact
    if (colNames.length < 2) {
      return {
        data: [],
        layout: { ...commonLayout, title: { text: '相关性热力图：数值列不足', x: 0.02, xanchor: 'left' } },
      };
    }

    // Build aligned numeric arrays
    const getNumericSeries = (col: string) => {
      const out: number[] = [];
      for (const r of rows) {
        const v = toNumber(r[col]);
        if (v === null || Number.isNaN(v)) continue;
        out.push(v);
      }
      return out;
    };

    const series = colNames.map((c) => getNumericSeries(c));

    const corr = (a: number[], b: number[]) => {
      const n = Math.min(a.length, b.length);
      if (n < 3) return NaN;
      const aa = a.slice(0, n);
      const bb = b.slice(0, n);
      const meanA = aa.reduce((s, x) => s + x, 0) / n;
      const meanB = bb.reduce((s, x) => s + x, 0) / n;
      let num = 0;
      let denA = 0;
      let denB = 0;
      for (let i = 0; i < n; i++) {
        const da = aa[i] - meanA;
        const db = bb[i] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
      }
      const den = Math.sqrt(denA * denB);
      if (den === 0) return NaN;
      return num / den;
    };

    const z: number[][] = [];
    for (let i = 0; i < colNames.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < colNames.length; j++) {
        row.push(corr(series[i], series[j]));
      }
      z.push(row);
    }

    return {
      data: [
        {
          type: 'heatmap',
          z,
          x: colNames,
          y: colNames,
          zmin: -1,
          zmax: 1,
          colorscale: 'Viridis',
          hovertemplate: '%{y} vs %{x}<br>相关性: %{z:.2f}<extra></extra>',
        },
      ],
      layout: {
        ...commonLayout,
        xaxis: { automargin: true, tickangle: -30 },
        yaxis: { automargin: true },
      },
    };
  }

  // Fallback: empty
  const fallback: { data: any[]; layout: any } = { data: [], layout: { ...commonLayout, title } };
  return fallback;
}

