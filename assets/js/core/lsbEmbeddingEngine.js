// core/lsbEmbeddingEngine.js
//
// Implementasi inti algoritma LSB (Least Significant Bit) steganografi.
// Modul ini berisi KEDUA operasi: embedding (sisip) dan extraction (baca).
//
// ── Prinsip dari Dokumen Penelitian ──────────────────────────────────────────
//
//   EMBEDDING :  P' = (P & 254) | b
//   EXTRACTION:  b  =  P' & 1
//
// dengan:
//   P   = nilai channel pixel asli (cover image)      integer 0–255
//   P'  = nilai channel pixel setelah embedding        integer 0–255
//   b   = bit pesan (0 atau 1)
//   254 = 0xFE = 11111110₂  → mask yang menghapus LSB, mempertahankan bit 1–7
//   1   = 0x01 = 00000001₂  → mask yang hanya membaca LSB
//
// ── Penjelasan Operasi ────────────────────────────────────────────────────────
//
//   Embedding:
//     (P & 0xFE)  → hapus bit ke-0 (LSB), pertahankan bit ke-1 s.d. ke-7
//     | b         → sisipkan bit pesan b ke posisi LSB
//     Perubahan nilai pixel: maksimum ±1, tidak terlihat mata manusia.
//
//   Extraction:
//     P' & 0x01   → isolasi bit ke-0 saja → menghasilkan kembali b
//     Operasi ini hanya MEMBACA, image tidak dimodifikasi sama sekali.
//
// ── Apa yang TIDAK diubah ─────────────────────────────────────────────────────
//   • Channel Alpha (byte offset +3 dalam RGBA buffer) — tidak pernah disentuh
//   • Piksel di luar slotSequence — bit-nya tidak diubah
//   • Dimensi, format, dan metadata image
//
// ── Interface ─────────────────────────────────────────────────────────────────
//   embedBits(coverImageData, bits, slotSequence)  → ImageData (baru, copy)
//   extractBits(stegoImageData, slotSequence)      → Uint8Array (bit 0/1)

import { slotToCoords } from './pixelPositionSelector.js';

// ---------------------------------------------------------------------------
// embedBits
// ---------------------------------------------------------------------------
/**
 * Sisipkan bit pesan ke dalam ImageData menggunakan rumus P' = (P & 254) | b.
 *
 * TIDAK memutasi coverImageData — membuat salinan pixel buffer baru sehingga
 * cover image di state tetap tidak berubah setelah embedding.
 *
 * @param {ImageData}            coverImageData  – pixel data cover image
 * @param {number[]|Uint8Array}  bits            – bit 0/1, panjang = slotSequence.length
 * @param {Uint32Array}          slotSequence    – slot dari generateSlotSequence()
 * @returns {ImageData}                          – ImageData baru = stego image
 */
export function embedBits(coverImageData, bits, slotSequence) {
  const { width, height } = coverImageData;

  // Salin seluruh RGBA buffer ke array baru → cover image tetap bersih
  const stegoData = new Uint8ClampedArray(coverImageData.data);

  for (let i = 0; i < slotSequence.length; i++) {
    const slotIndex      = slotSequence[i];
    const { byteOffset } = slotToCoords(slotIndex);
    const b              = bits[i] & 1;   // paksa 0 atau 1

    // ── Rumus Embedding: P' = (P & 254) | b ──────────────────────────────
    // (stegoData[byteOffset] & 0xFE) : hapus LSB (bit ke-0)
    // | b                            : tulis bit pesan ke LSB
    stegoData[byteOffset] = (stegoData[byteOffset] & 0xFE) | b;
  }

  return new ImageData(stegoData, width, height);
}

// ---------------------------------------------------------------------------
// extractBits
// ---------------------------------------------------------------------------
/**
 * Baca LSB dari setiap slot dalam slotSequence menggunakan rumus b = P' & 1.
 *
 * Fungsi ini hanya MEMBACA — tidak memodifikasi stegoImageData sama sekali.
 * Dengan slotSequence yang sama (key sama), menghasilkan bit yang identik
 * dengan yang disisipkan saat embedding.
 *
 * @param {ImageData}   stegoImageData  – pixel data stego image (tidak diubah)
 * @param {Uint32Array} slotSequence    – slot dari generateSlotSequence() dengan key sama
 * @returns {Uint8Array}               – bit 0/1, panjang = slotSequence.length
 */
export function extractBits(stegoImageData, slotSequence) {
  const bits = new Uint8Array(slotSequence.length);

  for (let i = 0; i < slotSequence.length; i++) {
    const slotIndex      = slotSequence[i];
    const { byteOffset } = slotToCoords(slotIndex);

    // ── Rumus Extraction: b = P' & 1 ─────────────────────────────────────
    // 0x01 = 00000001₂ → mask yang hanya menyisakan bit ke-0 (LSB)
    // Bit ke-1 sampai ke-7 diabaikan sepenuhnya
    bits[i] = stegoImageData.data[byteOffset] & 0x01;
  }

  return bits;
}
