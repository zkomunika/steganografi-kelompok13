// core/lsbEmbeddingEngine.js
//
// Implementasi inti algoritma LSB (Least Significant Bit) steganografi.
//
// ── Prinsip LSB dari Dokumen Penelitian ────────────────────────────────────
//
//   P' = (P & 254) | b
//
// dengan:
//   P  = nilai channel pixel sebelum embedding   (integer 0–255)
//   P' = nilai channel pixel setelah embedding   (integer 0–255)
//   b  = bit pesan: 0 atau 1
//   254 = 0xFE = 11111110 (binary) → mask untuk menghapus LSB
//
// Penjelasan operasi:
//   (P & 254) : Menghapus bit ke-0 (LSB) dari nilai channel,
//               sementara bit ke-1 sampai ke-7 tetap tidak berubah.
//   | b       : Menyisipkan bit pesan (0 atau 1) ke posisi LSB.
//
// Perubahan nilai pixel: maksimum ±1, tidak terlihat oleh mata manusia.
//
// ── Operasi yang TIDAK diubah ─────────────────────────────────────────────
//   • Channel Alpha (offset +3 dalam RGBA)
//   • Piksel yang tidak masuk dalam slot embedding (di luar bitCount)
//   • Dimensi dan format image
//
// ── Interface ──────────────────────────────────────────────────────────────
//   embedBits(imageData, bits, slotSequence) → ImageData (baru, tidak mutate asli)
//   extractBits(imageData, slotSequence)     → Uint8Array (bit 0/1)

import { slotToCoords } from './pixelPositionSelector.js';

/**
 * Sisipkan bit pesan ke dalam ImageData menggunakan algoritma LSB.
 *
 * Fungsi ini TIDAK memutasi imageData asli — ia membuat salinan baru
 * sehingga cover image di state tetap tidak berubah.
 *
 * @param {ImageData}   coverImageData  – pixel data citra asli
 * @param {number[]}    bits            – array 0/1, panjang = slotSequence.length
 * @param {Uint32Array} slotSequence    – urutan slot dari generateSlotSequence()
 * @returns {ImageData}                 – ImageData baru dengan bit tersisipkan
 */
export function embedBits(coverImageData, bits, slotSequence) {
  const { width, height } = coverImageData;

  // Salin seluruh pixel data ke buffer baru agar cover image tidak termutasi
  const stegoData = new Uint8ClampedArray(coverImageData.data);

  // Sisipkan setiap bit ke slot yang ditentukan oleh slotSequence
  for (let i = 0; i < slotSequence.length; i++) {
    const slotIndex  = slotSequence[i];
    const { byteOffset } = slotToCoords(slotIndex, width);
    const bit        = bits[i] & 1;   // pastikan hanya nilai 0 atau 1

    // ──────────────────────────────────────────────────────────────────────
    // Rumus LSB dari dokumen penelitian:
    //   P' = (P & 254) | b
    //
    // (stegoData[byteOffset] & 0xFE) → hapus LSB, pertahankan bit 1–7
    // | bit                          → sisipkan bit pesan ke posisi LSB
    // ──────────────────────────────────────────────────────────────────────
    stegoData[byteOffset] = (stegoData[byteOffset] & 0xFE) | bit;
  }

  return new ImageData(stegoData, width, height);
}

/**
 * Ekstraksi bit dari ImageData berdasarkan urutan slot yang sama.
 * Digunakan pada tahap extraction — fungsi ini adalah kebalikan dari embedBits().
 *
 * @param {ImageData}   stegoImageData  – pixel data stego image
 * @param {Uint32Array} slotSequence    – urutan slot yang sama dengan saat embedding
 * @returns {Uint8Array}               – array bit 0/1, panjang = slotSequence.length
 */
export function extractBits(stegoImageData, slotSequence) {
  const { width } = stegoImageData;
  const bits = new Uint8Array(slotSequence.length);

  for (let i = 0; i < slotSequence.length; i++) {
    const slotIndex      = slotSequence[i];
    const { byteOffset } = slotToCoords(slotIndex, width);

    // Baca LSB dari channel:  nilai & 1  → mengambil bit ke-0 saja
    bits[i] = stegoImageData.data[byteOffset] & 1;
  }

  return bits;
}
