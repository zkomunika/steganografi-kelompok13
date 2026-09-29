// utils/chartRenderer.js
//
// Menggambar histogram dan bidang LSB ke <canvas> memakai Canvas 2D murni
// (tanpa library grafik). Modul ini hanya menggambar; semua angka dihitung
// oleh evaluation/ dan core/.

export const HIST_CANVAS_W = 512;
export const HIST_CANVAS_H = 150;

export const CHANNEL_COLORS = { r: '#C0392B', g: '#2F8F5B', b: '#2F6FB0' };

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Gambar histogram 256 bin ke canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {ArrayLike<number>} bins           256 frekuensi
 * @param {{color?:string,label?:string,yMax?:number}} [opts]
 *        yMax: skala vertikal bersama (agar cover & stego sebanding)
 */
export function drawHistogram(canvas, bins, { color = '#2F6F5E', label = '', yMax } = {}) {
  canvas.width  = HIST_CANVAS_W;
  canvas.height = HIST_CANVAS_H;
  const ctx = canvas.getContext('2d');
  const W = HIST_CANVAS_W, H = HIST_CANVAS_H;
  const padL = 6, padR = 6, padT = 18, padB = 16;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const ink  = cssVar('--ink-soft', '#565D6B');
  const line = cssVar('--line', '#E2E5EA');

  ctx.clearRect(0, 0, W, H);

  let max = yMax || 0;
  if (!max) for (let i = 0; i < bins.length; i++) if (bins[i] > max) max = bins[i];
  if (max === 0) max = 1;

  // garis dasar + tick sumbu-x
  ctx.strokeStyle = line; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH + 0.5); ctx.lineTo(padL + plotW, padT + plotH + 0.5);
  ctx.stroke();
  ctx.fillStyle = ink; ctx.font = '10px monospace'; ctx.textBaseline = 'top';
  for (const t of [0, 64, 128, 192, 255]) {
    const x = padL + (t / 255) * plotW;
    ctx.textAlign = t === 0 ? 'left' : t === 255 ? 'right' : 'center';
    ctx.fillText(String(t), x, padT + plotH + 3);
  }

  // batang
  const barW = plotW / 256;
  ctx.fillStyle = color;
  for (let i = 0; i < 256; i++) {
    const h = (bins[i] / max) * plotH;
    if (h <= 0) continue;
    ctx.fillRect(padL + i * barW, padT + plotH - h, Math.max(barW - 0.2, 0.8), h);
  }

  // label
  ctx.fillStyle = ink; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  if (label) ctx.fillText(label, padL, 3);
  ctx.textAlign = 'right';
  ctx.fillText('maks ' + Math.round(max).toLocaleString('id-ID'), W - padR, 3);
}

/**
 * Gambar citra RGBA ({width,height,data}) apa adanya ke canvas
 * (satu piksel citra = satu piksel canvas; CSS yang menskalakan).
 */
export function drawImagePlane(canvas, image) {
  canvas.width  = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  const data = image.data instanceof Uint8ClampedArray ? image.data : new Uint8ClampedArray(image.data);
  ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0);
}

/** Kosongkan canvas. */
export function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
