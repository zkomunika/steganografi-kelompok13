// core/pixelPositionSelector.js
//
// Membuat urutan posisi piksel pseudoacak yang akan digunakan untuk
// menyisipkan bit pesan ke dalam citra. Setiap posisi mengidentifikasi
// satu slot LSB pada satu channel RGB dari satu piksel.
//
// ── Representasi Slot ────────────────────────────────────────────────────
// Sebuah citra W×H memiliki W×H piksel, masing-masing dengan 3 channel RGB.
// Total slot = W × H × 3.
//
// Slot ke-k diinterpretasikan sebagai:
//   pixelIndex   = Math.floor(k / 3)    → piksel ke berapa (0-based)
//   channelIndex = k % 3                → 0=R, 1=G, 2=B
//
// Dalam ImageData (RGBA Uint8ClampedArray):
//   byteOffset = pixelIndex * 4 + channelIndex
//   (channel ke-3, yaitu alpha pada offset +3, tidak pernah digunakan)
//
// ── Metode Pengacakan ────────────────────────────────────────────────────
// Digunakan forward Fisher-Yates partial shuffle dengan PRNG deterministik:
//
//   untuk i dari 0 hingga bitCount-1:
//     j = i + (nextUint32() % (totalSlots - i))   // index acak dalam [i, n-1]
//     tukar arr[i] dengan arr[j]
//
// Properti kunci:
//   • KONSISTENSI: result[0..k] SELALU identik untuk semua bitCount ≥ k
//     karena shuffle maju — setiap posisi ditentukan oleh panggilan PRNG yang sama
//   • Tidak ada duplikasi slot (Fisher-Yates guarantee)
//   • Urutan reproducible untuk key yang sama
//   • Tidak menggunakan Math.random()
//
// ── Konsistensi Forward-Shuffle ──────────────────────────────────────────
// Properti ini KRITIS untuk extraction dua-pass:
//   generateSlotSequence(key, n, 32)   → [s0, s1, …, s31]
//   generateSlotSequence(key, n, 1000) → [s0, s1, …, s31, s32, …, s999]
//
// Slot s0..s31 IDENTIK di kedua panggilan — karena PRNG di-restart dari
// seed yang sama dan setiap panggilan menghasilkan urutan bit-shuffle yang
// sama di posisi awal. Ini memungkinkan extraction membaca header dulu
// lalu membaca seluruh pesan dengan jaminan alignment yang benar.
//
// ── Interface ─────────────────────────────────────────────────────────────
//   generateSlotSequence(stegoKey, totalSlots, bitCount) → Uint32Array

import { createPRNGFromKey } from './prngStegoKeyGenerator.js';

/**
 * Menghasilkan urutan slot RGB yang diacak secara deterministik.
 *
 * Menggunakan forward partial Fisher-Yates: result[0..k] selalu konsisten
 * untuk semua bitCount ≥ k dengan key dan totalSlots yang sama.
 *
 * @param {string} stegoKey    – kunci yang sama menghasilkan urutan yang sama
 * @param {number} totalSlots  – total slot RGB = width × height × 3
 * @param {number} bitCount    – jumlah slot yang dibutuhkan
 * @returns {Uint32Array}      – array index slot sepanjang bitCount, tanpa duplikat
 * @throws {Error}             – jika bitCount > totalSlots
 */
export function generateSlotSequence(stegoKey, totalSlots, bitCount) {
  if (bitCount > totalSlots) {
    throw new Error(
      `[pixelPositionSelector] Kapasitas tidak cukup: dibutuhkan ${bitCount} slot, ` +
      `tersedia ${totalSlots} slot.`
    );
  }

  // Buat PRNG deterministik yang di-seed dari Stego-Key
  const nextUint32 = createPRNGFromKey(stegoKey);

  // Inisialisasi array index 0, 1, 2, …, totalSlots-1
  // Uint32Array: efisien untuk image besar (512×512 × 3 = 786,432 slot)
  const slots = new Uint32Array(totalSlots);
  for (let i = 0; i < totalSlots; i++) slots[i] = i;

  // Forward partial Fisher-Yates shuffle:
  //
  // Untuk setiap posisi i dari 0 hingga bitCount-1:
  //   pilih j acak dalam [i, totalSlots-1]
  //   tukar slots[i] dengan slots[j]
  //
  // Setelah iterasi ke-i selesai, slots[i] berisi nilai final yang tidak
  // akan berubah di iterasi berikutnya → properti konsistensi terpenuhi.
  //
  // Kompleksitas: O(bitCount) — optimal untuk pesan << kapasitas penuh
  for (let i = 0; i < bitCount; i++) {
    // Range [i, totalSlots-1]: totalSlots-i kemungkinan
    // nextUint32() % (totalSlots-i) → random offset dalam range
    const j = i + (nextUint32() % (totalSlots - i));

    // Tukar slots[i] dan slots[j]
    const tmp = slots[i];
    slots[i]  = slots[j];
    slots[j]  = tmp;
  }

  // Kembalikan salinan bitCount slot pertama (bukan view ke buffer yang sama)
  return slots.slice(0, bitCount);
}

/**
 * Konversi slot-index ke koordinat byte pada ImageData.
 *
 * @param {number} slotIndex  – nilai dari generateSlotSequence()
 * @param {number} _width     – lebar image (tidak dipakai, dipertahankan untuk API compatibility)
 * @returns {{ pixelIndex: number, channel: number, byteOffset: number }}
 */
export function slotToCoords(slotIndex, _width) {
  const pixelIndex = Math.floor(slotIndex / 3);
  const channel    = slotIndex % 3;              // 0=R, 1=G, 2=B
  const byteOffset = pixelIndex * 4 + channel;  // RGBA layout, skip alpha (+3)

  return { pixelIndex, channel, byteOffset };
}
