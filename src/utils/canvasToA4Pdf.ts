import { jsPDF } from 'jspdf';

/**
 * 将整张长图按 A4 纵向分页写入 PDF（与 html2canvas 输出配合使用）。
 * 宽度铺满版心，高度按页裁切；背景与导出长图一致为 #f5f2ed。
 */
export function downloadCanvasAsA4Pdf(canvas: HTMLCanvasElement, fileName: string) {
  const marginMm = 10;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  const pageInnerW = pdf.internal.pageSize.getWidth() - 2 * marginMm;
  const pageInnerH = pdf.internal.pageSize.getHeight() - 2 * marginMm;

  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return;

  const slice = document.createElement('canvas');
  const ctx = slice.getContext('2d');
  if (!ctx) return;

  /** 单页在源画布上对应的像素高度（宽度缩放为 pageInnerW 时，一页可容纳的纵向像素） */
  const maxSlicePx = Math.max(1, Math.floor((pageInnerH * w) / pageInnerW));

  let y0 = 0;
  let first = true;
  while (y0 < h) {
    const sh = Math.min(maxSlicePx, h - y0);
    slice.width = w;
    slice.height = sh;
    ctx.fillStyle = '#f5f2ed';
    ctx.fillRect(0, 0, w, sh);
    ctx.drawImage(canvas, 0, y0, w, sh, 0, 0, w, sh);

    const data = slice.toDataURL('image/png', 1.0);
    const sliceHmm = (sh * pageInnerW) / w;

    if (!first) pdf.addPage();
    pdf.addImage(data, 'PNG', marginMm, marginMm, pageInnerW, sliceHmm);
    first = false;
    y0 += sh;
  }

  pdf.save(fileName);
}
