/**
 * 通过本地开发代理 / 生产同源接口拉取公开 Google 表格为 CSV 文本。
 */
export async function fetchGoogleSheetCsv(url: string): Promise<string> {
  const res = await fetch('/api/sheets/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url.trim() }),
  });
  const data = (await res.json().catch(() => ({}))) as { csv?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `请求失败（${res.status}）`);
  }
  if (typeof data.csv !== 'string') {
    throw new Error('服务器返回数据异常');
  }
  return data.csv;
}
