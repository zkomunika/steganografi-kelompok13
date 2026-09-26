// evaluation/mseCalculator.js
//
// Menghitung Mean Squared Error (MSE) antara Cover Image dan Stego Image.
//
// ── Definisi MSE ─────────────────────────────────────────────────────────
// MSE mengukur rata-rata kuadrat selisih nilai pixel antara dua citra:
//
//   MSE = (1 / (M × N × C)) × Σ Σ Σ [P_cover(i,j,c) - P_stego(i,j,c)]²
//
// dengan:
//   M, N = dimensi citra (tinggi × lebar)
//   C    = jumlah channel yang dibandingkan (3 untuk RGB)
//   P    = nilai pixel pada posisi dan channel tertentu (0–255)
//
// Untuk LSB 1-bit, MSE teoritis:
//   MSE = (total_bit_diubah × 1²) / (M × N × 3)
//   karena setiap bit yang diubah hanya menggeser nilai pixel sebesar ±1.
//
// Semakin rendah MSE, semakin mirip stego image dengan cover image (baik).
//
// ── Implementasi ─────────────────────────────────────────────────────────
// Hanya channel RGB (R, G, B) yang dibandingkan; channel Alpha diabaikan
// karena tidak dimodifikasi selama embedding.
//
//   calculateMSE(coverData, stegoData) → number

/**
 * Hitung MSE antara dua ImageData (cover dan stego).
 * Hanya channel R, G, B yang dihitung (alpha dikecualikan).
 *
 * @param {ImageData} coverData  – pixel data cover image asli
 * @param {ImageData} stegoData  – pixel data stego image hasil embedding
 * @returns {number}             – nilai MSE (float, ≥ 0)
 * @throws {Error}               – jika dimensi kedua image tidak sama
 */
export function calculateMSE(coverData, stegoData) {
  if (coverData.width !== stegoData.width || coverData.height !== stegoData.height) {
    throw new Error('[mseCalculator] Dimensi cover dan stego image harus sama.');
  }

  const cover = coverData.data;  // Uint8ClampedArray, layout RGBA
  const stego = stegoData.data;
  const totalPixels = coverData.width * coverData.height;

  let sumSquaredDiff = 0;

  for (let px = 0; px < totalPixels; px++) {
    const base = px * 4;  // byte offset ke pixel ke-px (RGBA = 4 byte per pixel)

    // Hitung selisih untuk channel R, G, B (index base+0, base+1, base+2)
    // Channel Alpha (base+3) dikecualikan
    for (let ch = 0; ch < 3; ch++) {
      const diff = cover[base + ch] - stego[base + ch];
      sumSquaredDiff += diff * diff;
    }
  }

  // Normalisasi: dibagi total elemen yang dibandingkan (M × N × 3)
  return sumSquaredDiff / (totalPixels * 3);
}
