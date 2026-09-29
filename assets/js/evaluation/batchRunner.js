// evaluation/batchRunner.js
//
// Runner pengujian batch: 5 citra × 3 ukuran pesan = 15 skenario.
// Logika murni — tidak menyentuh DOM, state, atau SheetJS. Satu-satunya hal yang
// bergantung pada browser (encode PNG lalu decode lagi) disuntikkan lewat
// parameter `roundTripPng`, sehingga runner ini juga dapat dijalankan di Node.
//
// ── Pipeline per skenario (sama dengan halaman Embedding → Extraction) ───────
//   pesan uji → enkripsi AES-256-GCM → bytesToBits (header 32 bit)
//   → generateSlotSequence (PRNG dari Stego-Key) → embedBits (P' = (P & 254) | b)
//   → encode PNG → decode PNG → ekstraksi (header, lalu payload) → dekripsi
//   → bandingkan dengan pesan asli.
//
// ── Ukuran pesan ─────────────────────────────────────────────────────────────
//   Tiga pesan berukuran ≈10 %, 50 %, dan 90 % dari kapasitas citra TERKECIL
//   (kapasitas = lebar × tinggi × 3 bit). Yang dihitung adalah seluruh bit yang
//   disisipkan: header 32 bit + overhead enkripsi 44 byte + isi pesan. Pesan yang
//   sama dipakai untuk kelima citra, jadi pada citra yang lebih besar pemakaiannya
//   lebih kecil dari 10/50/90 % (kolom "Pemakaian" mencatat angka sebenarnya).
//
// ── Keterulangan ─────────────────────────────────────────────────────────────
//   Enkripsi memakai salt dan IV acak; itu membuat bit yang berubah berbeda di
//   setiap run sehingga MSE/PSNR ikut bergeser. Untuk batch, salt dan IV
//   diturunkan secara deterministik dari nama citra dan ukuran pesan (PRNG proyek
//   sendiri) — hanya untuk pengujian; jalur Embedding biasa tetap acak.
//   Kunci uji di bawah adalah konstanta pengujian, bukan rahasia pengguna.
//
// ── Interface ────────────────────────────────────────────────────────────────
//   BATCH_CONFIG
//   computeMessageSizes(smallestTotalSlots)         → MessageSpec[3]
//   buildTestMessage(byteLength)                    → string ASCII sepanjang byteLength
//   extractAndDecrypt(imageData, stegoKey, encKey)  → Promise<string>  (throws)
//   runScenario({ image, spec, coverChi, roundTripPng, no })  → Promise<Row>
//   runBatch({ images, roundTripPng, onProgress })  → Promise<Row[]>

import { CONFIG } from '../config.js';
import { encryptMessage, decryptMessage, CRYPTO_OVERHEAD_BYTES, SALT_BYTES, IV_BYTES }
  from '../core/cryptoService.js';
import { bytesToBits, bitsToBytes, getRequiredBitsForBytes } from '../core/messageBitConverter.js';
import { generateSlotSequence } from '../core/pixelPositionSelector.js';
import { embedBits, extractBits } from '../core/lsbEmbeddingEngine.js';
import { createPRNGFromKey } from '../core/prngStegoKeyGenerator.js';
import { calculateMSE } from './mseCalculator.js';
import { calculatePSNR } from './psnrCalculator.js';
import { computeHistogram } from './histogramCalculator.js';
import { analyzeChiSquare } from './chiSquareAnalyzer.js';

export const BATCH_CONFIG = Object.freeze({
  imageCount: 5,

  // Konstanta pengujian (bukan rahasia). Harus berbeda satu sama lain — aturan yang sama
  // dengan halaman Embedding.
  stegoKey:      'batch-uji-stego-key',
  encryptionKey: 'batch-uji-kunci-enkripsi',

  messageSizes: Object.freeze([
    Object.freeze({ id: 'p10', label: '≈10%', ratio: 0.10 }),
    Object.freeze({ id: 'p50', label: '≈50%', ratio: 0.50 }),
    Object.freeze({ id: 'p90', label: '≈90%', ratio: 0.90 }),
  ]),

  // Pembulatan nilai yang disimpan di baris hasil. UI dan ekspor memakai angka yang
  // sama persis, jadi tabel di layar identik dengan isi XLSX.
  decimals: Object.freeze({ mse: 6, psnr: 4, chi2: 4, pct: 4 }),

  // Di atas ini (piksel) pipeline bisa memakai ratusan MB memori di browser.
  warnPixels: 2_000_000,
});

const HEADER_BITS  = 32;
const HEADER_BYTES = 4;

// ---------------------------------------------------------------------------
// Ukuran pesan
// ---------------------------------------------------------------------------
/**
 * Hitung ukuran isi pesan (byte) untuk tiap target pemakaian.
 *
 * @param {number} smallestTotalSlots  – lebar × tinggi × 3 pada citra terkecil
 * @returns {{id:string,label:string,ratio:number,targetBits:number,messageBytes:number}[]}
 * @throws {Error} bila citra terlalu kecil untuk pesan ≥ 1 byte pada target 10 %
 */
export function computeMessageSizes(smallestTotalSlots) {
  return BATCH_CONFIG.messageSizes.map((m) => {
    // Total byte yang boleh dipakai = header 4 + overhead enkripsi 44 + isi pesan.
    const totalBytes   = Math.floor((m.ratio * smallestTotalSlots) / 8);
    const messageBytes = totalBytes - HEADER_BYTES - CRYPTO_OVERHEAD_BYTES;
    if (messageBytes < 1) {
      throw new Error(
        `Citra terkecil terlalu kecil: target ${m.label} hanya menyisakan ${messageBytes} byte ` +
        `setelah header dan overhead enkripsi (${HEADER_BYTES + CRYPTO_OVERHEAD_BYTES} byte).`
      );
    }
    return {
      ...m,
      messageBytes,
      targetBits: getRequiredBitsForBytes(messageBytes + CRYPTO_OVERHEAD_BYTES),
    };
  });
}

const WORDS = [
  'citra', 'piksel', 'kanal', 'warna', 'bit', 'sisip', 'kunci', 'acak', 'posisi', 'pesan',
  'rahasia', 'bagian', 'nilai', 'urutan', 'sebuah', 'hasil', 'uji', 'data', 'gambar', 'tepi',
  'cahaya', 'bayangan', 'garis', 'warna', 'latar', 'objek', 'foto', 'jalan', 'langit', 'daun',
];

/**
 * Pesan uji deterministik: teks ASCII berpola kalimat, tepat `byteLength` byte.
 * Pesan yang lebih pendek selalu merupakan awalan dari yang lebih panjang.
 */
export function buildTestMessage(byteLength) {
  if (!Number.isInteger(byteLength) || byteLength < 1) {
    throw new RangeError('[batchRunner] byteLength harus bilangan bulat ≥ 1.');
  }
  const next = createPRNGFromKey('pesan-uji-batch-v1');
  const parts = [];
  let length = 0;
  while (length < byteLength) {
    const word = WORDS[next() % WORDS.length] + ((next() % 9 === 0) ? '.' : '');
    parts.push(word);
    length += word.length + 1;
  }
  return parts.join(' ').slice(0, byteLength);   // ASCII → 1 karakter = 1 byte
}

// ---------------------------------------------------------------------------
// Salt/IV deterministik (khusus pengujian)
// ---------------------------------------------------------------------------
function _testSaltAndIv(imageName, specId) {
  const next = createPRNGFromKey(`batch-salt-iv|${imageName}|${specId}`);
  const take = (n) => Uint8Array.from({ length: n }, () => next() & 0xff);
  return { salt: take(SALT_BYTES), iv: take(IV_BYTES) };
}

// ---------------------------------------------------------------------------
// Ekstraksi + dekripsi — langkah yang sama dengan halaman Extraction
// ---------------------------------------------------------------------------
/**
 * @param {ImageData} imageData  – stego image (sesudah PNG round-trip)
 * @returns {Promise<string>}    – pesan terdekripsi
 * @throws {Error}               – header tidak valid, kunci salah, atau data rusak
 */
export async function extractAndDecrypt(imageData, stegoKey, encryptionKey) {
  const totalSlots = imageData.width * imageData.height * 3;
  if (totalSlots < HEADER_BITS) throw new Error('Citra terlalu kecil untuk membaca header.');

  const headerBits = extractBits(imageData, generateSlotSequence(stegoKey, totalSlots, HEADER_BITS));
  let payloadByteLen = 0;
  for (let i = 0; i < HEADER_BITS; i++) payloadByteLen = (payloadByteLen << 1) | (headerBits[i] & 1);
  payloadByteLen >>>= 0;

  const maxPayloadBytes = Math.floor(totalSlots / 8) - HEADER_BYTES;
  if (payloadByteLen <= CRYPTO_OVERHEAD_BYTES) {
    throw new Error(`Header tidak valid (${payloadByteLen} byte).`);
  }
  if (payloadByteLen > maxPayloadBytes) {
    throw new Error(`Header menunjukkan ${payloadByteLen} byte, melebihi kapasitas ${maxPayloadBytes} byte.`);
  }

  const totalBitsNeeded = (HEADER_BYTES + payloadByteLen) * 8;
  const allBits = extractBits(imageData, generateSlotSequence(stegoKey, totalSlots, totalBitsNeeded));
  const payload = bitsToBytes(allBits);
  if (!payload) throw new Error('Payload tidak dapat dibaca dari citra.');

  return decryptMessage(payload, encryptionKey);
}

// ---------------------------------------------------------------------------
// Utilitas kecil
// ---------------------------------------------------------------------------
function _round(x, dp) {
  if (!Number.isFinite(x)) return x;          // Infinity (MSE = 0) dibiarkan
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function _chiRow(hist) {
  const c = analyzeChiSquare(hist);
  const dp = BATCH_CONFIG.decimals.chi2;
  return { r: _round(c.r.chi2, dp), g: _round(c.g.chi2, dp), b: _round(c.b.chi2, dp) };
}

/** Bandingkan kanal RGB dua buffer RGBA (alpha diabaikan, seperti MSE). */
function _sameRgb(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  const n = a.width * a.height;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Satu skenario
// ---------------------------------------------------------------------------
/**
 * Jalankan satu skenario. Tidak pernah melempar: kegagalan dicatat pada baris hasil
 * agar skenario lain tetap berjalan.
 *
 * @param {object}   p
 * @param {number}   p.no            – nomor baris (1..15)
 * @param {{name:string,width:number,height:number,imageData:ImageData}} p.image
 * @param {object}   p.spec          – elemen dari computeMessageSizes()
 * @param {{r:number,g:number,b:number}} p.coverChi  – χ² cover (sekali per citra)
 * @param {(img:ImageData)=>Promise<ImageData>} p.roundTripPng  – encode PNG → decode
 */
export async function runScenario({ no, image, spec, coverChi, roundTripPng }) {
  const { imageData } = image;
  const totalSlots = image.width * image.height * 3;
  const dp = BATCH_CONFIG.decimals;

  const row = {
    no,
    imageName: image.name,
    width: image.width,
    height: image.height,
    messageId: spec.id,
    messageLabel: spec.label,
    messageBytes: spec.messageBytes,
    capacityBits: totalSlots,
    usedBits: null,
    usagePct: null,
    mse: null,
    psnr: null,
    psnrOk: false,
    chiCover: coverChi,
    chiStego: null,
    extractionOk: false,
    detail: '',
  };

  try {
    const message = buildTestMessage(spec.messageBytes);
    const encrypted = await encryptMessage(
      message, BATCH_CONFIG.encryptionKey, _testSaltAndIv(image.name, spec.id)
    );
    const bits = bytesToBits(encrypted);
    row.usedBits = bits.length;
    row.usagePct = _round((bits.length / totalSlots) * 100, dp.pct);

    if (bits.length > totalSlots) throw new Error('Pesan melebihi kapasitas citra ini.');

    const slots = generateSlotSequence(BATCH_CONFIG.stegoKey, totalSlots, bits.length);
    const stego = embedBits(imageData, bits, slots);

    const mse = calculateMSE(imageData, stego);
    const psnr = calculatePSNR(mse);
    row.mse = _round(mse, dp.mse);
    row.psnr = _round(psnr, dp.psnr);
    row.psnrOk = psnr >= CONFIG.psnrThresholdDb;
    row.chiStego = _chiRow(computeHistogram(stego));

    // Stego dikirim lewat PNG sungguhan; ekstraksi dilakukan dari hasil decode-nya.
    const decoded = await roundTripPng(stego);
    if (!_sameRgb(stego, decoded)) {
      throw new Error('PNG tidak lossless untuk citra ini (piksel berubah setelah encode/decode).');
    }

    const recovered = await extractAndDecrypt(decoded, BATCH_CONFIG.stegoKey, BATCH_CONFIG.encryptionKey);
    if (recovered !== message) throw new Error('Pesan hasil ekstraksi tidak sama dengan pesan asli.');

    row.extractionOk = true;
  } catch (err) {
    row.detail = err && err.message ? err.message : String(err);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Seluruh batch
// ---------------------------------------------------------------------------
/**
 * @param {object}   p
 * @param {{name:string,width:number,height:number,imageData:ImageData}[]} p.images
 * @param {(img:ImageData)=>Promise<ImageData>} p.roundTripPng
 * @param {(done:number,total:number,row:object)=>void} [p.onProgress]
 * @returns {Promise<object[]>}  imageCount × 3 baris, urut citra lalu ukuran pesan
 */
export async function runBatch({ images, roundTripPng, onProgress }) {
  if (!Array.isArray(images) || images.length !== BATCH_CONFIG.imageCount) {
    throw new Error(`Pengujian batch membutuhkan tepat ${BATCH_CONFIG.imageCount} citra.`);
  }
  if (typeof roundTripPng !== 'function') {
    throw new TypeError('[batchRunner] roundTripPng wajib diberikan.');
  }
  const names = new Set(images.map((i) => i.name));
  if (names.size !== images.length) throw new Error('Nama file citra harus unik.');

  const smallest = Math.min(...images.map((i) => i.width * i.height * 3));
  const specs = computeMessageSizes(smallest);
  const total = images.length * specs.length;

  const rows = [];
  for (const image of images) {
    const coverChi = _chiRow(computeHistogram(image.imageData));
    for (const spec of specs) {
      const row = await runScenario({ no: rows.length + 1, image, spec, coverChi, roundTripPng });
      rows.push(row);
      if (onProgress) onProgress(rows.length, total, row);
    }
  }
  return rows;
}

/** Ringkasan untuk kriteria penerimaan. */
export function summarizeBatch(rows) {
  const ok = rows.filter((r) => r.extractionOk).length;
  const psnrs = rows.filter((r) => Number.isFinite(r.psnr)).map((r) => r.psnr);
  return {
    total: rows.length,
    extractionOk: ok,
    allExtracted: rows.length > 0 && ok === rows.length,
    allPsnrOk: rows.length > 0 && rows.every((r) => r.psnrOk),
    minPsnr: psnrs.length ? Math.min(...psnrs) : null,
  };
}
