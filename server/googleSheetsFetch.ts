/**
 * 从公开 Google 表格拉取 CSV（无需 googleapis：使用官方 export 接口，由服务端 fetch 避免浏览器 CORS）。
 * 表格需「知道链接的任何人可查看」或已发布到网络。
 */

const MAX_CSV_BYTES = 8 * 1024 * 1024;

export function parseSpreadsheetIdAndGid(input: string): { id: string; gid: string } | null {
  const trimmed = input.trim();
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const gidMatch = trimmed.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return { id, gid };
}

export async function fetchPublicGoogleSheetAsCsv(urlOrId: string): Promise<string> {
  const parsed = parseSpreadsheetIdAndGid(urlOrId);
  if (!parsed) {
    throw new Error('无法识别 Google 表格链接，请粘贴包含 /spreadsheets/d/.../ 的完整地址。');
  }
  const { id, gid } = parsed;
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid)}`;

  const res = await fetch(exportUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; ShutuAnalysis/1.0; +https://localhost) AppleWebKit/537.36 (KHTML, like Gecko)',
      Accept: 'text/csv,*/*',
    },
    redirect: 'follow',
  });

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_CSV_BYTES) {
    throw new Error('表格过大（超过约 8MB），请缩小范围或改用文件上传。');
  }

  const text = new TextDecoder('utf-8').decode(buf);

  if (!res.ok) {
    throw new Error(`Google 返回 HTTP ${res.status}，请确认链接有效且表格已公开可读。`);
  }

  const head = text.slice(0, 200).toLowerCase();
  if (head.includes('<!doctype') || head.includes('<html')) {
    throw new Error(
      '未获取到 CSV（可能为登录页）。请将表格共享为「知道链接的任何人可查看」或使用「发布到网络」后再试。'
    );
  }

  if (!text.trim()) {
    throw new Error('表格内容为空。');
  }

  return text;
}
