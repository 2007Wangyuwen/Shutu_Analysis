import type { ColumnProfile, ColumnType, InferredSchema } from './types';

function isNilOrEmpty(v: any) {
  return v === null || v === undefined || String(v).trim() === '';
}

function normalizeNumber(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return null;
  const s = String(v).trim();
  if (!s) return null;

  // Percent: 15.96% => 15.96
  const percentMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    const n = Number(percentMatch[1]);
    return Number.isFinite(n) ? n : null;
  }

  // Remove common separators/currency
  const cleaned = s
    .replace(/[,，]/g, '')
    .replace(/[¥￥$£€]/g, '')
    .replace(/\s+/g, '');

  const n = Number(cleaned);
  if (Number.isFinite(n)) return n;
  return null;
}

function excelSerialToDate(n: number): Date | null {
  // Excel serial date numbers start from 1899-12-30.
  if (!Number.isFinite(n)) return null;
  if (n < 20000 || n > 70000) return null; // rough range
  const ms = (n - 25569) * 86400 * 1000; // unix epoch conversion
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeDate(v: any): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number') return excelSerialToDate(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    // quick filters to avoid Date.parse on plain numbers like "123"
    if (!/[0-9]/.test(s) || !(/[年年月日]/.test(s) || /[-/:\.]/.test(s))) {
      // Still allow ISO-like strings
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) && !/^\d{4}\/\d{2}\/\d{2}/.test(s)) return null;
    }
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    const year = d.getFullYear();
    if (year < 1900 || year > 2100) return null;
    return d;
  }
  return null;
}

function scoreColumn(
  name: string,
  values: any[],
  rowCount: number
): { type: ColumnType; profile: ColumnProfile } {
  const sample = values.filter((v) => !isNilOrEmpty(v));
  if (sample.length === 0) {
    const profile: ColumnProfile = { name, type: 'category' };
    return { type: 'category', profile };
  }

  const nonEmptyCount = sample.length;

  let numberLike = 0;
  let timeLike = 0;
  const distinct = new Set<string>();

  for (const v of sample.slice(0, 5000)) {
    if (!isNilOrEmpty(v)) distinct.add(String(v).trim());
    if (normalizeNumber(v) !== null) numberLike++;
    if (normalizeDate(v) !== null) timeLike++;
  }

  const numberScore = numberLike / nonEmptyCount;
  const timeScore = timeLike / nonEmptyCount;
  const distinctRatio = distinct.size / Math.max(1, rowCount);

  const nameHints = /(日期|时间|年月|年月日|年|月|日|timestamp|time)/i.test(name);
  const idHints = /(id|编码|编号|code|batch)/i.test(name);

  // More conservative: time is only if strong evidence or name hints
  if (timeScore >= 0.8 || (nameHints && timeScore >= 0.5)) {
    return { type: 'time', profile: { name, type: 'time' } };
  }

  // Avoid treating "ID-like" numeric codes as pure numeric.
  if (numberScore >= 0.85) {
    if (idHints && distinctRatio >= 0.3) {
      return { type: 'category', profile: { name, type: 'category' } };
    }
    return { type: 'number', profile: { name, type: 'number' } };
  }

  return { type: 'category', profile: { name, type: 'category' } };
}

export function inferSchema(rows: Array<Record<string, any>>): InferredSchema {
  const rowCount = rows.length;

  const columnsSet = new Set<string>();
  for (const r of rows) {
    if (!r) continue;
    for (const k of Object.keys(r)) columnsSet.add(k);
  }

  const columns = Array.from(columnsSet);

  const profiles: ColumnProfile[] = columns.map((col) => {
    const values = rows.map((r) => r?.[col]);
    const { profile } = scoreColumn(col, values, rowCount);
    return profile;
  });

  return { rowCount, columns: profiles };
}

export function schemaToTypeMap(schema: InferredSchema): Record<string, ColumnType> {
  const map: Record<string, ColumnType> = {};
  for (const c of schema.columns) map[c.name] = c.type;
  return map;
}

