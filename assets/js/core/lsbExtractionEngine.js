// core/lsbExtractionEngine.js
//
// Re-ekspor extractBits dari lsbEmbeddingEngine sebagai interface publik
// untuk controller extraction.
//
// Desain: embedding dan extraction menggunakan fungsi yang simetris.
// extractBits() terdefinisi di lsbEmbeddingEngine.js agar kedua operasi
// berada dalam satu modul yang terdokumentasi bersama (operasi & balik-operasi).
//
// Interface publik:
//   extract(stegoImageData, slotSequence) → Uint8Array (bit 0/1)

export { extractBits as extract } from './lsbEmbeddingEngine.js';
