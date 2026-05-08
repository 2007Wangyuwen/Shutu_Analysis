/**
 * 从 Plotly figure 提取简短统计描述，供 ECNU 生成人文向解读。
 */
function toArray(v: unknown): unknown[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function flattenZ(z: unknown): number[] {
  const a = toArray(z);
  const out: number[] = [];
  for (const row of a) {
    if (Array.isArray(row)) {
      for (const x of row) {
        const n = Number(x);
        if (Number.isFinite(n)) out.push(n);
      }
    } else {
      const n = Number(row);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

function numericStats(vals: number[]): { min: number; max: number; mean: number } | null {
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
  return { min, max, mean };
}

function countCategories(labels: string[]): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const l of labels) {
    const k = l.trim() || '(空)';
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function summarizePlotlyFigureForInterpretation(figure: {
  data?: any[];
  layout?: any;
}): { chartTitle: string; chartType: string; dataSummary: string } {
  const traces = figure?.data ?? [];
  const layout = figure?.layout ?? {};

  let chartTitle = '未命名图表';
  const t0 = layout.title;
  if (typeof t0 === 'string') chartTitle = t0;
  else if (t0?.text != null) chartTitle = String(t0.text);

  const types = [...new Set(traces.map((tr: any) => tr?.type).filter(Boolean))];
  const chartType = types.length ? types.join('、') : '未知';

  const lines: string[] = [];
  lines.push(`图表含 ${traces.length} 个数据系列（trace）。`);

  let approxPoints = 0;

  traces.forEach((trace: any, ti: number) => {
    const ty = trace?.type || 'unknown';
    const name = trace?.name != null && String(trace.name).trim() !== '' ? String(trace.name) : `系列${ti + 1}`;
    lines.push('');
    lines.push(`— ${name}（类型: ${ty}）`);

    if (ty === 'heatmap' && trace.z != null) {
      const flat = flattenZ(trace.z);
      approxPoints += flat.length;
      const st = numericStats(flat);
      if (st) {
        lines.push(`  热力图数值：约 ${flat.length} 个格点；取值范围约 ${st.min.toFixed(4)}～${st.max.toFixed(4)}，均值约 ${st.mean.toFixed(4)}。`);
      }
      return;
    }

    if (ty === 'histogram') {
      const xs = toArray(trace.x);
      const nums = xs.map((v) => Number(v)).filter((n) => Number.isFinite(n));
      approxPoints += nums.length;
      const st = numericStats(nums);
      if (st && nums.length) {
        lines.push(`  直方图：约 ${nums.length} 个原始样本点；取值范围约 ${st.min.toFixed(4)}～${st.max.toFixed(4)}。`);
      }
      return;
    }

    const xRaw = toArray(trace.x);
    const yRaw = toArray(trace.y);
    const n = Math.max(xRaw.length, yRaw.length);
    approxPoints += n;

    const yNums = yRaw.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (yNums.length) {
      const st = numericStats(yNums);
      if (st) {
        lines.push(
          `  纵轴（Y）数值：有效点 ${yNums.length} 个；范围约 ${st.min.toFixed(4)}～${st.max.toFixed(4)}，均值约 ${st.mean.toFixed(4)}。`
        );
      }
    }

    const xNums = xRaw.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    if (xNums.length >= 2 && (ty === 'scatter' || ty === 'scattergl')) {
      const st = numericStats(xNums);
      if (st) {
        lines.push(`  横轴（X）数值：有效点 ${xNums.length} 个；范围约 ${st.min.toFixed(4)}～${st.max.toFixed(4)}。`);
      }
    }

    const xLabels = xRaw.map((v) => (v == null ? '' : String(v)));
    const looksCategorical =
      ty === 'bar' ||
      (xLabels.length > 0 &&
        xLabels.some((s) => {
          const n = Number(s);
          return s !== '' && (Number.isNaN(n) || /[^\d.\-eE+]/.test(s));
        }));

    if (looksCategorical && xLabels.length) {
      const freq = countCategories(xLabels);
      const top = freq.slice(0, 12);
      lines.push(
        `  横轴类别出现次数（频数，至多列出前 ${top.length} 类）：` +
          top.map((f) => `「${f.label}」×${f.count}`).join('；') +
          (freq.length > top.length ? ` …（共 ${freq.length} 个不同类别）` : '')
      );
      if (yNums.length === xLabels.length && ty === 'bar') {
        lines.push('  （柱状图纵轴多为各类别对应的指标值，可与上表类别按顺序对应理解。）');
      }
    }
  });

  lines.unshift(`估算涉及的数据点总量（各系列主维度合计）：约 ${approxPoints}。`);

  return {
    chartTitle,
    chartType,
    dataSummary: lines.join('\n'),
  };
}
