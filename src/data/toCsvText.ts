import { BuilderOptions } from './types';

function escapeCsvCell(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  const needsQuotes = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function toCsvText(
  rows: Array<Record<string, any>>,
  opts?: { maxRows?: number; columns?: string[] }
): { csvText: string; columns: string[] } {
  const maxRows = opts?.maxRows ?? 200;
  const columns =
    opts?.columns ??
    (() => {
      const set = new Set<string>();
      for (const r of rows) {
        for (const k of Object.keys(r || {})) set.add(k);
      }
      return Array.from(set);
    })();

  const header = columns.map((c) => escapeCsvCell(c)).join(',');
  const body = rows
    .slice(0, maxRows)
    .map((r) => columns.map((c) => escapeCsvCell(r?.[c])).join(','))
    .join('\n');

  const csvText = body ? `${header}\n${body}` : `${header}\n`;
  return { csvText, columns };
}

export function builderOptionsToLabel(o: BuilderOptions): string {
  switch (o.chartType) {
    case 'time_series':
      return `时间序列：${o.x ?? '-'} -> ${o.y ?? '-'}`;
    case 'bar_aggregate':
      return `聚合柱状图：${o.x ?? '-'} / ${o.y ?? '-'} (${o.agg ?? 'mean'})`;
    case 'scatter_xy':
      return `散点图：${o.x ?? '-'} vs ${o.y ?? '-'}`;
    case 'histogram':
      return `直方图：${o.x ?? o.y ?? '-'}`;
    case 'stacked_bar_counts':
      return `堆叠计数：${o.x ?? '-'} by ${o.groupBy ?? '-'}`;
    case 'correlation_heatmap':
      return `相关性热力图`;
    default:
      return '图表概览';
  }
}

