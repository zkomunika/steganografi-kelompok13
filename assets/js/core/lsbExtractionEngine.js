// core/lsbExtractionEngine.js
//
// Public interface untuk operasi extraction LSB.
//
// ── Rumus Extraction (dari dokumen penelitian) ────────────────────────────
//   b = P' & 1
//
//   P' = nilai channel pixel dari stego image  (integer 0–255)
//   b  = bit pesan yang disisipkan saat embedding  (0 atau 1)
//   &1 = 0x01 = 00000001₂ → mask yang mengisolasi bit ke-0 (LSB) saja
//
// Operasi ini adalah KEBALIKAN TEPAT dari embedding:
//   Embedding:   P' = (P & 0xFE) | b   → tulis b ke LSB
//   Extraction:  b  =  P' & 0x01       → baca b dari LSB
//
// ── Properti ─────────────────────────────────────────────────────────────
//   • Image TIDAK dimodifikasi — hanya operasi baca
//   • Key yang sama → slot sequence yang sama → bit yang sama
//   • Key berbeda → slot sequence berbeda → hasil noise (header invalid)
//
// ── Interface ─────────────────────────────────────────────────────────────
//   extract(stegoImageData, slotSequence) → Uint8Array (bit 0/1)
//
// extractBits di-re-ekspor dari lsbEmbeddingEngine.js agar kedua operasi
// (embedding dan extraction) terdokumentasi di satu tempat.

export { extractBits as extract } from './lsbEmbeddingEngine.js';
