import * as XLSX from 'xlsx';

export async function parseExcelFile(file: File): Promise<Array<Record<string, any>>> {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: 'array', cellDates: true });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const json = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
  }) as Array<Record<string, any>>;

  return json.filter((row) => {
    if (!row) return false;
    const keys = Object.keys(row);
    if (keys.length === 0) return false;
    return keys.some((k) => {
      const v = row[k];
      return v !== null && v !== undefined && String(v).trim() !== '';
    });
  });
}

export function excelToSheetName(file: File, workbook: XLSX.WorkBook): string {
  const firstSheetName = workbook.SheetNames[0];
  return firstSheetName || file.name;
}

