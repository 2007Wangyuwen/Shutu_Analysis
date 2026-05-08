export type ColumnType = 'number' | 'category' | 'time';

export interface ColumnProfile {
  name: string;
  type: ColumnType;
}

export interface InferredSchema {
  rowCount: number;
  columns: ColumnProfile[];
}

export type Aggregation = 'count' | 'sum' | 'mean' | 'median';

export type ChartType =
  | 'time_series'
  | 'bar_aggregate'
  | 'scatter_xy'
  | 'histogram'
  | 'stacked_bar_counts'
  | 'correlation_heatmap';

export interface BuilderOptions {
  chartType: ChartType;
  x?: string;
  y?: string;
  groupBy?: string;
  agg?: Aggregation;
  title?: string;
}

export interface ChartRecommendation {
  chartType: ChartType;
  reason: string;
  defaultOptions: BuilderOptions;
}

