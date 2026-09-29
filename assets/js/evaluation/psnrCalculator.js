// evaluation/psnrCalculator.js
//
// Menghitung Peak Signal-to-Noise Ratio (PSNR) dari nilai MSE.
//
// ── Rumus dari Dokumen Penelitian ────────────────────────────────────────────
//
//   PSNR = 20 × log₁₀(255 / √MSE)
//
// dengan:
//   255  = nilai pixel maksimum untuk citra 8-bit per channel (MAX)
//   MSE  = Mean Squared Error antara cover image dan stego image
//   √MSE = RMSE (Root Mean Squared Error)
//
// ── Ekuivalensi Matematis ─────────────────────────────────────────────────────
// Rumus di atas identik dengan bentuk lain yang umum:
//
//   PSNR = 10 × log₁₀(MAX² / MSE)
//
// Karena:
//   20 × log₁₀(MAX / √MSE)
//   = 20 × [log₁₀(MAX) - log₁₀(√MSE)]
//   = 20 × [log₁₀(MAX) - ½ × log₁₀(MSE)]
//   = 10 × [2×log₁₀(MAX) - log₁₀(MSE)]
//   = 10 × log₁₀(MAX² / MSE)
//
// Implementasi menggunakan bentuk `10 × log₁₀(MAX² / MSE)` karena
// lebih efisien (satu operasi log, tidak perlu Math.sqrt).
//
// ── Kasus Tepi ───────────────────────────────────────────────────────────────
//   MSE = 0  → Cover dan Stego image identik → PSNR = ∞ (Infinity)
//   MSE > 0  → Kalkulasi normal
//   MSE < 0  → Tidak valid, dilempar Error
//
// ── Interface ─────────────────────────────────────────────────────────────────
//   calculatePSNR(mse, maxPixelValue?) → number | Infinity
//   formatPSNR(psnr, decimals?)        → string  ("74.88 dB" atau "∞ dB")
//   classifyPSNR(psnr, thresholdDb?)   → { meets, label }  (ambang juknis 30 dB)

import { CONFIG } from '../config.js';

/**
 * Hitung PSNR dari nilai MSE menggunakan rumus penelitian:
 *   PSNR = 20 × log₁₀(255 / √MSE)
 *
 * Implementasi internal menggunakan bentuk ekuivalen:
 *   PSNR = 10 × log₁₀(MAX² / MSE)
 *
 * @param {number} mse            – nilai MSE ≥ 0, dari calculateMSE()
 * @param {number} maxPixelValue  – nilai pixel maksimum; default 255 (8-bit)
 * @returns {number}              – PSNR dalam dB; Infinity jika MSE = 0
 * @throws {Error}                – jika MSE negatif
 */
export function calculatePSNR(mse, maxPixelValue = 255) {
  // MSE = 0: cover dan stego image identik secara pixel → PSNR tak terhingga
  if (mse === 0) return Infinity;

  if (mse < 0) {
    throw new Error('[psnrCalculator] MSE tidak boleh negatif, diterima: ' + mse);
  }

  // PSNR = 10 × log₁₀(MAX² / MSE)
  // Ekuivalen dengan: PSNR = 20 × log₁₀(MAX / √MSE)
  return 10 * Math.log10((maxPixelValue * maxPixelValue) / mse);
}

/**
 * Format nilai PSNR untuk tampilan UI.
 * Menampilkan nilai faktual tanpa interpretasi subjektif.
 *
 * @param {number} psnr     – nilai dari calculatePSNR()
 * @param {number} decimals – jumlah desimal (default 2)
 * @returns {string}        – misal "74.88 dB" atau "∞ dB"
 */
export function formatPSNR(psnr, decimals = 2) {
  if (!isFinite(psnr)) return '∞ dB';
  return psnr.toFixed(decimals) + ' dB';
}

/**
 * Klasifikasi kualitas terhadap ambang juknis (default CONFIG.psnrThresholdDb = 30 dB).
 *   PSNR ≥ ambang → "Baik (≥ 30 dB)"
 *   PSNR <  ambang → "Di bawah ambang 30 dB"
 * PSNR = ∞ (citra identik) dianggap memenuhi ambang.
 *
 * @param {number} psnr
 * @param {number} [thresholdDb]
 * @returns {{meets:boolean, label:string, thresholdDb:number}}
 */
export function classifyPSNR(psnr, thresholdDb = CONFIG.psnrThresholdDb) {
  const meets = psnr >= thresholdDb;   // Infinity >= 30 → true
  return {
    meets,
    thresholdDb,
    label: meets
      ? `Baik (≥ ${thresholdDb} dB)`
      : `Di bawah ambang ${thresholdDb} dB`,
  };
}
