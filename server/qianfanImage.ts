type QianfanTokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: QianfanTokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 60_000) {
    return tokenCache.accessToken;
  }

  const apiKey = process.env.QIANFAN_API_KEY;
  const secretKey = process.env.QIANFAN_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error('未配置 QIANFAN_API_KEY / QIANFAN_SECRET_KEY');
  }

  const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`;
  const resp = await fetch(tokenUrl, { method: 'POST' });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(t || `获取千帆 access_token 失败: HTTP ${resp.status}`);
  }
  const json: any = await resp.json();
  const accessToken = json?.access_token;
  const expiresInSec = Number(json?.expires_in || 0);
  if (!accessToken) throw new Error('千帆 access_token 返回为空');

  tokenCache = {
    accessToken,
    expiresAtMs: now + Math.max(60_000, expiresInSec * 1000),
  };
  return accessToken;
}

export async function generateQianfanImage(params: {
  prompt: string;
  negative_prompt?: string;
  n?: number;
  size?: string;
}): Promise<string[]> {
  const { prompt, negative_prompt = '', n = 1, size = '1024x1024' } = params;
  if (!prompt || !prompt.trim()) {
    throw new Error('图片生成 prompt 不能为空');
  }

  const accessToken = await getAccessToken();
  const resp = await fetch('https://qianfan.baidubce.com/v2/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-image',
      prompt: prompt.trim(),
      negative_prompt,
      n: Math.min(4, Math.max(1, n)),
      size,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(t || `千帆图片生成失败: HTTP ${resp.status}`);
  }

  const json: any = await resp.json();
  const urls = (json?.data || [])
    .map((item: any) => item?.url)
    .filter((u: any) => typeof u === 'string' && u.trim());

  if (!urls.length) {
    throw new Error('千帆图片生成成功但未返回可用图片 URL');
  }
  return urls;
}

