// evaluation/jpegCompressionTest.js
//
// Kompresi JPEG menggunakan Canvas API browser (onscreen canvas).
//
// ── Tujuan ───────────────────────────────────────────────────────────────────
// Menguji ketahanan pesan LSB terhadap kompresi lossy JPEG.
// JPEG mengubah nilai piksel melalui kuantisasi DCT → LSB rusak secara acak.
//
// ── Cara Kerja ───────────────────────────────────────────────────────────────
// 1. ImageData di-render ke <canvas> tersembunyi (off-DOM).
// 2. canvas.toDataURL('image/jpeg', quality/100) → JPEG data URL.
//    quality ∈ [0,1]: di-map dari Quality Factor [1,100].
// 3. JPEG data URL di-load ke <img> → di-draw ke canvas baru → getImageData.
// 4. Pixel data JPEG siap dibaca oleh extractBits.
//
// ── Bit Accuracy ─────────────────────────────────────────────────────────────
// Bit Accuracy = (slot yang LSB-nya cocok / total slot) × 100
// ~100% → JPEG tidak merusak LSB; ~50% → semua bit rusak (noise random).
//
// ── Kompatibilitas ───────────────────────────────────────────────────────────
// Menggunakan HTMLCanvasElement (bukan OffscreenCanvas) agar kompatibel
// dengan semua browser modern termasuk Safari.
//
// ── Interface ─────────────────────────────────────────────────────────────────
//   compressToJPEG(imageData, qualityFactor) → Promise<{jpegImageData, jpegDataUrl, psnr, mse}>
//   calcBitAccuracy(bitsA, bitsB)            → number (0–100)

import { calculateMSE  } from './mseCalculator.js';
import { calculatePSNR } from './psnrCalculator.js';

// ---------------------------------------------------------------------------
// compressToJPEG
// ---------------------------------------------------------------------------
/**
 * Kompres ImageData ke JPEG pada Quality Factor tertentu, lalu decode
 * kembali ke ImageData untuk perbandingan pixel.
 *
 * @param {ImageData} imageData      – pixel buffer (stego image)
 * @param {number}    qualityFactor  – integer 1–100
 * @returns {Promise<{
 *   jpegImageData : ImageData,  – pixel buffer hasil decode JPEG
 *   jpegDataUrl   : string,     – data URL 'image/jpeg' untuk preview
 *   psnr          : number,     – PSNR stego vs JPEG (dB, Infinity jika identik)
 *   mse           : number,     – MSE stego vs JPEG
 * }>}
 */
export function compressToJPEG(imageData, qualityFactor) {
  return new Promise((resolve, reject) => {
    const qf = Math.max(1, Math.min(100, qualityFactor));

    // ── 1. Render ImageData ke canvas ────────────────────────────────────
    const srcCanvas  = document.createElement('canvas');
    srcCanvas.width  = imageData.width;
    srcCanvas.height = imageData.height;
    const srcCtx     = srcCanvas.getContext('2d');
    srcCtx.putImageData(imageData, 0, 0);

    // ── 2. Encode ke JPEG data URL ────────────────────────────────────────
    // canvas.toDataURL('image/jpeg', quality) di mana quality ∈ [0, 1]
    const jpegDataUrl = srcCanvas.toDataURL('image/jpeg', qf / 100);

    if (!jpegDataUrl || jpegDataUrl === 'data:,') {
      return reject(new Error('Browser tidak mendukung output JPEG dari canvas.'));
    }

    // ── 3. Decode JPEG kembali ke ImageData via <img> ─────────────────────
    const img   = new Image();
    img.onload  = () => {
      try {
        const dstCanvas  = document.createElement('canvas');
        dstCanvas.width  = imageData.width;
        dstCanvas.height = imageData.height;
        const dstCtx     = dstCanvas.getContext('2d');
        dstCtx.drawImage(img, 0, 0, imageData.width, imageData.height);
        const jpegImageData = dstCtx.getImageData(0, 0, imageData.width, imageData.height);

        // ── 4. Hitung metrik degradasi ────────────────────────────────────
        const mse  = calculateMSE(imageData, jpegImageData);
        const psnr = calculatePSNR(mse);

        resolve({ jpegImageData, jpegDataUrl, psnr, mse });
      } catch (e) {
        reject(new Error('Gagal mengambil pixel JPEG dari canvas: ' + e.message));
      }
    };
    img.onerror = () => reject(new Error('Gagal memuat JPEG data URL ke <img>.'));
    img.src     = jpegDataUrl;
  });
}

// ---------------------------------------------------------------------------
// calcBitAccuracy
// ---------------------------------------------------------------------------
/**
 * Persentase bit yang cocok antara dua array bit.
 * Bandingkan LSB dari stego asli vs LSB dari JPEG (setelah kompresi).
 *
 * @param {Uint8Array|number[]} bitsA  – bit referensi (dari stego asli)
 * @param {Uint8Array|number[]} bitsB  – bit pembanding (dari JPEG image)
 * @returns {number}  0–100, dua desimal
 */
export function calcBitAccuracy(bitsA, bitsB) {
  if (!bitsA || !bitsB || bitsA.length === 0) return 0;
  const len   = Math.min(bitsA.length, bitsB.length);
  let   match = 0;
  for (let i = 0; i < len; i++) {
    if ((bitsA[i] & 1) === (bitsB[i] & 1)) match++;
  }
  return Number(((match / len) * 100).toFixed(2));
}

/**
 * Load an image from a data URL.
 *
 * @param {string} dataUrl
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };

    image.onerror = () => {
      reject(new Error("Failed to decode JPEG image."));
    };

    image.src = dataUrl;
  });
}