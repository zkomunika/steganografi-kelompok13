// core/prngStegoKeyGenerator.js
//
// Mengubah Stego-Key string menjadi seeded deterministic Pseudo-Random
// Number Generator (PRNG) yang menghasilkan urutan bilangan yang sama
// setiap kali key yang sama digunakan.
//
// ── Pilihan Algoritma PRNG ─────────────────────────────────────────────────
// Dokumen penelitian menyatakan bahwa algoritma PRNG spesifik masih perlu
// ditentukan pada implementasi. Implementasi ini menggunakan Xorshift32
// (George Marsaglia, 2003), sebuah PRNG deterministik berbasis XOR dan bit-
// shift yang:
//   • Cepat — hanya tiga operasi XOR + shift per call
//   • Deterministik — seed yang sama selalu menghasilkan urutan yang sama
//   • Distribusi yang baik — melewati test Diehard dan BigCrush
//   • Tidak menggunakan Math.random() (sesuai spesifikasi)
//   • Reproducible di semua platform karena menggunakan integer 32-bit
//     dengan unsigned right-shift yang perilakunya identik di JS
//
// ── Key-to-Seed Conversion ────────────────────────────────────────────────
// Stego-Key (string arbitrary) diubah menjadi seed integer 32-bit melalui
// algoritma hash djb2:
//   hash = 5381
//   for each char: hash = ((hash << 5) + hash) + charCode
// djb2 dipilih karena sederhana, reproducible, dan menghasilkan distribusi
// seed yang baik untuk string pendek (typical stego-key length).
// Seed 0 ditolak (Xorshift32 dengan seed=0 tidak valid) → diganti 0x5EEDBEEF.
//
// ── Interface ──────────────────────────────────────────────────────────────
//   createPRNGFromKey(stegoKey) → nextUint32 : () → number  (0 … 2³²-1)

/**
 * Konversi Stego-Key string menjadi seed integer 32-bit menggunakan djb2.
 *
 * @param {string} key
 * @returns {number}  seed (unsigned 32-bit integer, dijamin ≠ 0)
 */
function keyToSeed(key) {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    // hash = hash * 33 + charCode  (djb2 formula)
    hash = Math.imul(hash, 33) + key.charCodeAt(i);
    hash |= 0;  // paksa 32-bit signed integer
  }
  // Xorshift32 tidak valid untuk seed = 0; gunakan fallback seed
  const seed = (hash >>> 0) || 0x5EEDBEEF;
  return seed;
}

/**
 * Membuat fungsi PRNG deterministik dari Stego-Key.
 *
 * Algoritma: Xorshift32 (Marsaglia, 2003)
 *   state ^= state << 13
 *   state ^= state >> 17
 *   state ^= state << 5
 *
 * @param {string} stegoKey  – kunci yang dimasukkan pengguna
 * @returns {function(): number}  nextUint32() → bilangan bulat [1, 2³²-1]
 */
export function createPRNGFromKey(stegoKey) {
  if (typeof stegoKey !== 'string' || stegoKey.length === 0) {
    throw new Error('[prngStegoKeyGenerator] stegoKey harus berupa string tidak kosong.');
  }

  let state = keyToSeed(stegoKey);

  /**
   * Menghasilkan bilangan acak semu berikutnya (unsigned 32-bit).
   * Dijamin deterministik: urutan yang sama selalu dihasilkan dari seed yang sama.
   *
   * @returns {number}  integer antara 1 dan 4294967295 (0xFFFFFFFF)
   */
  function nextUint32() {
    // Xorshift32: tiga langkah XOR + bit-shift
    state ^= state << 13;
    state ^= state >>> 17;  // unsigned right-shift penting agar JS tidak overflow
    state ^= state << 5;
    return state >>> 0;     // konversi ke unsigned 32-bit
  }

  return nextUint32;
}

/**
 * Ekspor fungsi keyToSeed untuk keperluan debugging / pengujian.
 * @param {string} key
 * @returns {number}
 */
export { keyToSeed };
