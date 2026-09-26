// evaluation/psnrCalculator.js
//
// Menghitung Peak Signal-to-Noise Ratio (PSNR) dari nilai MSE.
//
// ── Definisi PSNR ────────────────────────────────────────────────────────
// PSNR adalah metrik kualitas citra yang mengukur seberapa mirip stego
// image dengan cover image aslinya, dinyatakan dalam satuan desibel (dB):
//
//   PSNR = 10 × log₁₀(MAX² / MSE)
//
// dengan:
//   MAX = nilai pixel maksimum = 255 (untuk 8-bit per channel)
//   MSE = Mean Squared Error antara cover dan stego image
//
// Apabila MSE = 0 (image identik), PSNR = ∞ (tak terhingga).
//
// ── Interpretasi Nilai PSNR ─────────────────────────────────────────────
//   PSNR > 40 dB : Perbedaan tidak terlihat oleh mata manusia
//   PSNR > 50 dB : Kualitas sangat tinggi, distorsi sangat minimal
//   PSNR > 60 dB : Hampir identik secara visual
//
// Untuk LSB 1-bit pada seluruh pixel 512×512 (kasus embedding penuh):
//   MSE teoritis ≈ 0.25  →  PSNR ≈ 54 dB  (kualitas sangat baik)
//
// ── Implementasi ──────────────────────────────────────────────────────────
//   calculatePSNR(mse, maxPixelValue?) → number (dB) | Infinity

/**
 * Hitung PSNR dari nilai MSE.
 *
 * @param {number} mse            – nilai MSE dari calculateMSE()
 * @param {number} maxPixelValue  – nilai pixel maksimum (default 255 untuk 8-bit)
 * @returns {number}              – PSNR dalam dB; Infinity jika MSE = 0
 */
export function calculatePSNR(mse, maxPixelValue = 255) {
  // MSE = 0 berarti kedua image identik → PSNR tak terhingga
  if (mse === 0) return Infinity;

  // MSE negatif tidak valid
  if (mse < 0) {
    throw new Error('[psnrCalculator] MSE tidak boleh negatif.');
  }

  // PSNR = 10 × log₁₀(MAX² / MSE)
  const psnr = 10 * Math.log10((maxPixelValue * maxPixelValue) / mse);
  return psnr;
}

/**
 * Format nilai PSNR untuk tampilan UI.
 *
 * @param {number} psnr  – nilai dari calculatePSNR()
 * @param {number} decimals  – jumlah desimal (default 2)
 * @returns {string}     – misal "74.88 dB" atau "∞ dB"
 */
export function formatPSNR(psnr, decimals = 2) {
  if (!isFinite(psnr)) return '∞ dB';
  return psnr.toFixed(decimals) + ' dB';
}
