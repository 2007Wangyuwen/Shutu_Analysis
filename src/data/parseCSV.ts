import Papa from 'papaparse';

/** 根据首行非空行判断分隔符：制表符 / 逗号 / 分号（欧洲 CSV 常见）。 */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  if (tabs > 0 && tabs >= commas && tabs >= semis) return '\t';
  if (semis > commas && semis > tabs) return ';';
  return ',';
}

export function parseCSVText(csvText: string): Array<Record<string, any>> {
  const delimiter = detectDelimiter(csvText);
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: (h) => (typeof h === 'string' ? h.trim() : h),
  });

  if (parsed.errors?.length) {
    // Keep going: we still want best-effort parsing.
    // (App will handle missing values gracefully.)
    console.warn('CSV parse warnings:', parsed.errors);
  }

  const data = parsed.data as Array<Record<string, any>>;

  // Remove completely empty rows (all values null/empty).
  return data.filter((row) => {
    if (!row) return false;
    const keys = Object.keys(row);
    if (keys.length === 0) return false;
    return keys.some((k) => {
      const v = row[k];
      return v !== null && v !== undefined && String(v).trim() !== '';
    });
  });
}

