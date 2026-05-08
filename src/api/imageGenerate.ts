export async function generateImageViaQianfan(params: {
  prompt: string;
  negative_prompt?: string;
  n?: number;
  size?: string;
}): Promise<string[]> {
  const res = await fetch('/api/images/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: params.prompt,
      negative_prompt: params.negative_prompt || '',
      n: params.n ?? 1,
      size: params.size ?? '1024x1024',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `图片生成请求失败：HTTP ${res.status}`);
  }

  const json: any = await res.json();
  const urls = (json?.data || [])
    .map((d: any) => d?.url)
    .filter((u: any) => typeof u === 'string' && u.trim());
  if (!urls.length) {
    throw new Error('图片生成完成，但未拿到可用图片链接');
  }
  return urls;
}

