// core/messageBitConverter.js
//
// Konversi dua arah antara string UTF-8 dan flat bit array (0/1).
//
// ── Skema Framing Deterministik ──────────────────────────────────────────────
//
//   Layout bit stream:
//   ┌──────────────────────────────────┬───────────────────────────────────┐
//   │  HEADER (32 bit, big-endian)     │  PAYLOAD (N bytes × 8 bit)        │
//   │  = panjang payload dalam byte    │  = UTF-8 encoded message           │
//   └──────────────────────────────────┴───────────────────────────────────┘
//
//   • Header berisi jumlah byte payload sebagai unsigned 32-bit integer
//     big-endian, memungkinkan payload hingga ~4 GB.
//   • Setiap byte di-flatten MSB-first (bit ke-7 → bit ke-0).
//   • Ini memungkinkan ekstraksi mengetahui panjang persis tanpa null-terminator.
//
// ── Bit Order ─────────────────────────────────────────────────────────────────
//   Byte 0x41 ('A') → bits = [0, 1, 0, 0, 0, 0, 0, 1]
//                             ↑                       ↑
//                           MSB (bit 7)           LSB (bit 0)
//
// ── Interface ─────────────────────────────────────────────────────────────────
//   messageToBits(message)  → number[]   (flat 0/1 array)
//   bitsToMessage(bits)     → string     (UTF-8 decoded, empty on error)
//   getRequiredBits(message)→ number     (total bit count termasuk header)
//   getMessageByteLength(m) → number     (byte count payload saja)

const HEADER_BYTES = 4;   // 32-bit unsigned length prefix

// ---------------------------------------------------------------------------
// messageToBits — Encode string ke flat bit array
// ---------------------------------------------------------------------------
/**
 * Encode UTF-8 string ke flat bit array dengan 32-bit length header.
 *
 * @param {string} message
 * @returns {number[]}  flat array of 0/1 values, MSB first per byte
 * @throws {TypeError}  jika message bukan string
 */
export function messageToBits(message) {
  if (typeof message !== 'string') {
    throw new TypeError('[messageBitConverter] message harus berupa string.');
  }

  // Encode ke UTF-8 menggunakan TextEncoder (selalu UTF-8 di browser)
  const encoder = new TextEncoder();
  const payload = encoder.encode(message);  // Uint8Array

  // Bangun header: 4 byte big-endian, menyimpan panjang payload dalam byte
  const byteLen = payload.length;
  const header  = new Uint8Array(HEADER_BYTES);
  header[0] = (byteLen >>> 24) & 0xff;
  header[1] = (byteLen >>> 16) & 0xff;
  header[2] = (byteLen >>>  8) & 0xff;
  header[3] =  byteLen         & 0xff;

  // Gabung header + payload menjadi satu byte array
  const all = new Uint8Array(HEADER_BYTES + byteLen);
  all.set(header,  0);
  all.set(payload, HEADER_BYTES);

  // Flatten setiap byte menjadi 8 bit, MSB (bit ke-7) lebih dahulu
  // Contoh: 0x41 → [0,1,0,0,0,0,0,1]
  const bits = new Array(all.length * 8);
  let   idx  = 0;
  for (let b = 0; b < all.length; b++) {
    for (let shift = 7; shift >= 0; shift--) {
      bits[idx++] = (all[b] >> shift) & 1;
    }
  }

  return bits;
}

// ---------------------------------------------------------------------------
// bitsToMessage — Decode flat bit array ke string UTF-8
// ---------------------------------------------------------------------------
/**
 * Rekonstruksi UTF-8 string dari bit array yang dihasilkan oleh messageToBits().
 * Membaca 32-bit length header terlebih dahulu, lalu mengekstrak payload.
 *
 * Fungsi ini menerima plain Array maupun Uint8Array (typed array).
 *
 * @param {number[]|Uint8Array} bits  – flat 0/1 array, minimal 32 elemen
 * @returns {string}                  – decoded string, atau '' jika invalid
 */
export function bitsToMessage(bits) {
  // Terima plain Array dan typed array (Uint8Array dari extractBits)
  if (bits == null || typeof bits.length !== 'number' || bits.length < HEADER_BYTES * 8) {
    return '';
  }

  // ── 1. Baca 32-bit header (big-endian) ───────────────────────────────────
  // Header menyimpan jumlah byte payload.
  // Bit di posisi 0 = MSB dari byte pertama header, dst.
  let payloadByteLen = 0;
  for (let i = 0; i < 32; i++) {
    payloadByteLen = (payloadByteLen << 1) | (bits[i] & 1);
  }
  payloadByteLen = payloadByteLen >>> 0;   // paksa unsigned 32-bit

  // ── 2. Validasi panjang payload ───────────────────────────────────────────
  if (payloadByteLen === 0) return '';

  const totalBitsNeeded = (HEADER_BYTES + payloadByteLen) * 8;
  if (bits.length < totalBitsNeeded) return '';

  // ── 3. Rekonstruksi payload bytes dari bit array ──────────────────────────
  // Setiap byte terdiri dari 8 bit berurutan, MSB lebih dahulu.
  // payloadStart = 32 (lewati 4 byte header = 32 bit)
  const payloadStart = HEADER_BYTES * 8;
  const payloadBytes = new Uint8Array(payloadByteLen);

  for (let i = 0; i < payloadByteLen; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      // bits[payloadStart + i*8 + j] adalah bit ke-(7-j) dari byte ke-i
      // (j=0 → MSB = bit7, j=7 → LSB = bit0)
      byte |= (bits[payloadStart + i * 8 + j] & 1) << (7 - j);
    }
    payloadBytes[i] = byte;
  }

  // ── 4. Decode UTF-8 → string ──────────────────────────────────────────────
  // Gunakan fatal=true dulu untuk mendeteksi sequence yang tidak valid;
  // fallback ke fatal=false (U+FFFD replacement) jika karakter non-UTF8.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
  } catch {
    // Key salah → byte yang terekstrak bukan UTF-8 valid → kembalikan ''
    // agar caller dapat membedakan "gagal" vs "pesan kosong"
    try {
      const fallback = new TextDecoder('utf-8', { fatal: false }).decode(payloadBytes);
      // Jika hasil mengandung replacement character → kemungkinan key salah
      if (fallback.includes('\uFFFD')) return '';
      return fallback;
    } catch {
      return '';
    }
  }
}

// ---------------------------------------------------------------------------
// getMessageByteLength
// ---------------------------------------------------------------------------
/**
 * Jumlah byte UTF-8 yang dibutuhkan pesan (tanpa header).
 * @param {string} message
 * @returns {number}
 */
export function getMessageByteLength(message) {
  if (!message) return 0;
  return new TextEncoder().encode(message).length;
}

// ---------------------------------------------------------------------------
// getRequiredBits
// ---------------------------------------------------------------------------
/**
 * Total bit yang dibutuhkan untuk embed pesan (header + payload).
 * Lebih cepat dari messageToBits(m).length karena tidak membuat array penuh.
 *
 * @param {string} message
 * @returns {number}
 */
export function getRequiredBits(message) {
  if (!message) return 0;
  const payloadBytes = new TextEncoder().encode(message).length;
  return (HEADER_BYTES + payloadBytes) * 8;
}
