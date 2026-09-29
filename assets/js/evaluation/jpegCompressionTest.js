// evaluation/jpegCompressionTest.js
//
// Kompresi JPEG menggunakan Canvas API browser (onscreen canvas) beserta
// logika metrik uji kerapuhan JPEG.
//
// ── Tujuan ───────────────────────────────────────────────────────────────────
// Menguji ketahanan pesan LSB terhadap kompresi lossy JPEG.
// JPEG mengubah nilai piksel melalui kuantisasi DCT → LSB rusak secara acak.
//
// ── Cara Kerja ───────────────────────────────────────────────────────────────
// 1. ImageData di-render ke <canvas> tersembunyi (off-DOM).
// 2. canvas.toDataURL('image/jpeg', quality/100) → JPEG data URL.
//    quality ∈ [0,1]: di-map dari Quality Factor [1,100].
// 3. JPEG data URL di-load ke <img> → di-draw ke canvas baru → getImageData.
// 4. Pixel data JPEG dibaca dengan slot yang sama (Stego-Key yang sama).
//
// ── Ground Truth & Panjang Payload ───────────────────────────────────────────
// Stego yang diunggah masih lossless (PNG/BMP), sehingga header 32-bit-nya
// dapat dibaca dengan Stego-Key. Dari header itulah panjang payload diketahui;
// tidak ada state dari sesi embedding yang dipakai (state itu bisa basi bila
// stego yang diunggah bukan hasil sesi terakhir).
//
//   bitsRef  = LSB stego unggahan pada slot (header + payload), Stego-Key yang sama
//   bitsJpeg = LSB citra JPEG pada slot yang persis sama
//   Bit Accuracy = (bitsRef == bitsJpeg) / panjang bitsRef × 100
//
// Bila header tidak valid (mis. Stego-Key salah) tidak ada ground truth,
// sehingga Bit Accuracy TIDAK dihitung (null) — bukan angka sampling acak.
//
// ── Status Keberhasilan ──────────────────────────────────────────────────────
// Ditentukan oleh dekripsi AES-256-GCM pada payload yang dibaca dari citra
// JPEG: tag lolos → berhasil; selain itu → gagal (1 bit rusak pun terdeteksi).
// Payload dibaca dengan header dari citra JPEG sendiri, sama seperti halaman
// Extraction, sehingga "berhasil" berarti pesan benar-benar dapat diekstrak.
// Tanpa Kunci Enkripsi status tidak dinilai (STATUS_NA); hanya Bit Accuracy
// yang ditampilkan.
//
// ── Kompatibilitas ───────────────────────────────────────────────────────────
// Menggunakan HTMLCanvasElement (bukan OffscreenCanvas) agar kompatibel
// dengan semua browser modern termasuk Safari. Fungsi metrik (di bawah
// compressToJPEG) tidak menyentuh DOM sehingga dapat diuji di Node.
//
// ── Interface ─────────────────────────────────────────────────────────────────
//   compressToJPEG(imageData, qualityFactor)  → Promise<{jpegImageData, jpegDataUrl, psnr, mse}>
//   calcBitAccuracy(bitsRef, bitsOther)       → number (0–100)
//   readStegoHeader(imageData, stegoKey)      → {valid, payloadByteLen, payloadBitLen, totalSlots, reason}
//   prepareJpegReference({...})               → Promise<reference>   (sekali per run)
//   evaluateJpegImage(reference, jpegImageData, encKey) → Promise<metrik per QF>

import { calculateMSE  } from './mseCalculator.js';
import { calculatePSNR } from './psnrCalculator.js';
import { generateSlotSequence } from '../core/pixelPositionSelector.js';
import { extractBits }          from '../core/lsbEmbeddingEngine.js';
import { bitsToBytes }          from '../core/messageBitConverter.js';
import { decryptMessage, CRYPTO_OVERHEAD_BYTES } from '../core/cryptoService.js';

export const HEADER_BITS  = 32;
export const HEADER_BYTES = 4;

/** Status "tidak dinilai": Kunci Enkripsi tidak diisi, hanya Bit Accuracy yang bermakna. */
export const STATUS_NA = 'na';

const OK   = 'ok';
const FAIL = 'fail';

// ---------------------------------------------------------------------------
// compressToJPEG
// ---------------------------------------------------------------------------
/**
 * Kompres ImageData ke JPEG pada Quality Factor tertentu, lalu decode
 * kembali ke ImageData untuk perbandingan pixel.
 *
 * @param {ImageData} imageData      – pixel buffer (stego image)
 * @param {number}    qualityFactor  – integer 1–100
 * @returns {Promise<{
 *   jpegImageData : ImageData,  – pixel buffer hasil decode JPEG
 *   jpegDataUrl   : string,     – data URL 'image/jpeg' untuk preview
 *   psnr          : number,     – PSNR stego vs JPEG (dB, Infinity jika identik)
 *   mse           : number,     – MSE stego vs JPEG
 * }>}
 */
export function compressToJPEG(imageData, qualityFactor) {
  return new Promise((resolve, reject) => {
    const qf = Math.max(1, Math.min(100, qualityFactor));

    // ── 1. Render ImageData ke canvas ────────────────────────────────────
    const srcCanvas  = document.createElement('canvas');
    srcCanvas.width  = imageData.width;
    srcCanvas.height = imageData.height;
    const srcCtx     = srcCanvas.getContext('2d');
    srcCtx.putImageData(imageData, 0, 0);

    // ── 2. Encode ke JPEG data URL ────────────────────────────────────────
    // canvas.toDataURL('image/jpeg', quality) di mana quality ∈ [0, 1]
    const jpegDataUrl = srcCanvas.toDataURL('image/jpeg', qf / 100);

    if (!jpegDataUrl || jpegDataUrl === 'data:,') {
      return reject(new Error('Browser tidak mendukung output JPEG dari canvas.'));
    }

    // ── 3. Decode JPEG kembali ke ImageData via <img> ─────────────────────
    const img   = new Image();
    img.onload  = () => {
      try {
        const dstCanvas  = document.createElement('canvas');
        dstCanvas.width  = imageData.width;
        dstCanvas.height = imageData.height;
        const dstCtx     = dstCanvas.getContext('2d');
        dstCtx.drawImage(img, 0, 0, imageData.width, imageData.height);
        const jpegImageData = dstCtx.getImageData(0, 0, imageData.width, imageData.height);

        // ── 4. Hitung metrik degradasi ────────────────────────────────────
        const mse  = calculateMSE(imageData, jpegImageData);
        const psnr = calculatePSNR(mse);

        resolve({ jpegImageData, jpegDataUrl, psnr, mse });
      } catch (e) {
        reject(new Error('Gagal mengambil pixel JPEG dari canvas: ' + e.message));
      }
    };
    img.onerror = () => reject(new Error('Gagal memuat JPEG data URL ke <img>.'));
    img.src     = jpegDataUrl;
  });
}

// ---------------------------------------------------------------------------
// calcBitAccuracy
// ---------------------------------------------------------------------------
/**
 * Persentase bit referensi yang cocok dengan bit pembanding.
 * Penyebut = panjang referensi; bit pembanding yang kurang dihitung salah,
 * bukan diabaikan.
 *
 * @param {Uint8Array|number[]} bitsRef    – bit referensi (ground truth)
 * @param {Uint8Array|number[]} bitsOther  – bit pembanding
 * @returns {number}  0–100, dua desimal; 0 bila referensi kosong
 */
export function calcBitAccuracy(bitsRef, bitsOther) {
  if (!bitsRef || !bitsOther || bitsRef.length === 0) return 0;
  const len = Math.min(bitsRef.length, bitsOther.length);
  let match = 0;
  for (let i = 0; i < len; i++) {
    if ((bitsRef[i] & 1) === (bitsOther[i] & 1)) match++;
  }
  return Number(((match / bitsRef.length) * 100).toFixed(2));
}

// ---------------------------------------------------------------------------
// readStegoHeader
// ---------------------------------------------------------------------------
/**
 * Baca header 32-bit (panjang payload dalam byte) dari stego yang diunggah.
 * Validasi identik dengan halaman Extraction.
 *
 * @param {{data:Uint8ClampedArray, width:number, height:number}} imageData
 * @param {string} stegoKey
 * @returns {{
 *   valid: boolean, totalSlots: number,
 *   payloadByteLen: number, payloadBitLen: number,   // payloadBitLen = header + payload (bit)
 *   reason: string|null,
 * }}
 */
export function readStegoHeader(imageData, stegoKey) {
  const totalSlots = imageData.width * imageData.height * 3;
  const invalid = (reason, payloadByteLen = 0) =>
    ({ valid: false, totalSlots, payloadByteLen, payloadBitLen: 0, reason });

  if (totalSlots < HEADER_BITS) {
    return invalid('Citra terlalu kecil untuk memuat header pesan.');
  }

  const headerSlots = generateSlotSequence(stegoKey, totalSlots, HEADER_BITS);
  const headerBits  = extractBits(imageData, headerSlots);

  let payloadByteLen = 0;
  for (let i = 0; i < HEADER_BITS; i++) {
    payloadByteLen = (payloadByteLen << 1) | (headerBits[i] & 1);
  }
  payloadByteLen = payloadByteLen >>> 0;

  const maxPayloadBytes = Math.floor(totalSlots / 8) - HEADER_BYTES;
  const hint = 'Stego-Key salah, atau citra bukan hasil embedding terenkripsi dari aplikasi ini.';

  if (payloadByteLen === 0) {
    return invalid('Header pesan tidak ditemukan. ' + hint);
  }
  if (payloadByteLen <= CRYPTO_OVERHEAD_BYTES) {
    return invalid(`Header tidak valid (${payloadByteLen} byte, minimal ${CRYPTO_OVERHEAD_BYTES + 1}). ` + hint, payloadByteLen);
  }
  if (payloadByteLen > maxPayloadBytes) {
    return invalid(`Header tidak valid (${payloadByteLen} byte, kapasitas citra ${maxPayloadBytes}). ` + hint, payloadByteLen);
  }

  return {
    valid: true,
    totalSlots,
    payloadByteLen,
    payloadBitLen: (HEADER_BYTES + payloadByteLen) * 8,
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// prepareJpegReference
// ---------------------------------------------------------------------------
/**
 * Siapkan ground truth SEKALI per run (tidak bergantung pada QF):
 * baca header stego unggahan, hitung slot, ekstrak bit referensi, dan —
 * bila Kunci Enkripsi diisi — pastikan stego unggahan sendiri dapat didekripsi
 * (baseline). Baseline gagal berarti kegagalan bukan akibat JPEG.
 *
 * @param {{stegoImageData: object, stegoKey: string, encKey?: string}} p
 * @returns {Promise<object>} reference
 */
export async function prepareJpegReference({ stegoImageData, stegoKey, encKey = '' }) {
  const header = readStegoHeader(stegoImageData, stegoKey);
  if (!header.valid) {
    return {
      headerValid: false, reason: header.reason,
      payloadByteLen: header.payloadByteLen, payloadBitLen: 0,
      slots: null, bitsRef: null, bitAccBefore: null,
      baselineStatus: STATUS_NA, baselineReason: null,
    };
  }

  const slots   = generateSlotSequence(stegoKey, header.totalSlots, header.payloadBitLen);
  const bitsRef = extractBits(stegoImageData, slots);

  // "Sebelum" = stego unggahan (lossless) dibaca ulang vs referensi. Dihitung,
  // bukan konstanta; bernilai 100 untuk stego lossless yang utuh.
  const bitAccBefore = calcBitAccuracy(bitsRef, extractBits(stegoImageData, slots));

  let baselineStatus = STATUS_NA;
  let baselineReason = null;
  if (encKey) {
    try {
      await decryptMessage(bitsToBytes(bitsRef), encKey);
      baselineStatus = OK;
    } catch (err) {
      if (err.name !== 'DecryptionError') throw err;
      baselineStatus = FAIL;
      baselineReason =
        'Stego yang diunggah sendiri (sebelum JPEG) tidak dapat didekripsi: Kunci Enkripsi salah ' +
        'atau citra sudah rusak. Kegagalan ini bukan akibat kompresi JPEG.';
    }
  }

  return {
    headerValid: true, reason: null,
    payloadByteLen: header.payloadByteLen, payloadBitLen: header.payloadBitLen,
    slots, bitsRef, bitAccBefore, baselineStatus, baselineReason,
  };
}

// ---------------------------------------------------------------------------
// evaluateJpegImage
// ---------------------------------------------------------------------------
/**
 * Hitung metrik satu citra JPEG terhadap ground truth.
 *
 * @param {object} reference       – keluaran prepareJpegReference()
 * @param {object} jpegImageData   – pixel buffer hasil decode JPEG
 * @param {string} [encKey]        – Kunci Enkripsi; kosong → status tidak dinilai
 * @returns {Promise<{
 *   headerValid: boolean,
 *   accMeaningful: boolean,       – false bila tidak ada ground truth
 *   bitAccBefore: number|null,
 *   bitAccAfter : number|null,
 *   status: 'ok'|'fail'|'na',     – 'ok' hanya bila tag GCM lolos
 *   extractedMessage: string|null,
 *   failReason: string|null,
 *   payloadByteLen: number,
 * }>}
 */
export async function evaluateJpegImage(reference, jpegImageData, encKey = '') {
  if (!reference.headerValid) {
    return {
      headerValid: false, accMeaningful: false,
      bitAccBefore: null, bitAccAfter: null,
      status: FAIL, extractedMessage: null,
      failReason: reference.reason, payloadByteLen: reference.payloadByteLen,
    };
  }

  // Slot sama persis dengan referensi → perbandingan bit-per-bit yang valid.
  const bitsJpeg    = extractBits(jpegImageData, reference.slots);
  const bitAccAfter = calcBitAccuracy(reference.bitsRef, bitsJpeg);

  const base = {
    headerValid: true, accMeaningful: true,
    bitAccBefore: reference.bitAccBefore, bitAccAfter,
    payloadByteLen: reference.payloadByteLen,
  };

  if (!encKey) {
    return { ...base, status: STATUS_NA, extractedMessage: null, failReason: null };
  }

  if (reference.baselineStatus === FAIL) {
    return { ...base, status: FAIL, extractedMessage: null, failReason: reference.baselineReason };
  }

  // Ekstraksi seperti halaman Extraction: header dibaca dari citra JPEG.
  const payload = bitsToBytes(bitsJpeg);
  if (!payload) {
    return {
      ...base, status: FAIL, extractedMessage: null,
      failReason: 'Header pesan pada citra JPEG rusak (panjang payload tidak terbaca).',
    };
  }

  try {
    const message = await decryptMessage(payload, encKey);
    return { ...base, status: OK, extractedMessage: message, failReason: null };
  } catch (err) {
    if (err.name !== 'DecryptionError') throw err;
    return {
      ...base, status: FAIL, extractedMessage: null,
      failReason: 'Tag GCM tidak lolos: bit payload berubah akibat kompresi JPEG.',
    };
  }
}
