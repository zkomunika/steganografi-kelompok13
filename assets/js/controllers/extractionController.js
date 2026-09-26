// controllers/extractionController.js
//
// Application layer untuk halaman Extraction.
//
// ── Pipeline (sesuai spesifikasi Checkpoint 4) ────────────────────────────
//   Upload Stego Image
//   → Input Stego-Key
//   → Validasi input
//   → Decode image → pixel buffer (ImageData)
//   → Generate PRNG slot sequence dari Stego-Key (IDENTIK dengan embedding)
//   → Baca LSB menggunakan rumus: b = P' & 1
//   → Rekonstruksi length header (32 bit pertama)
//   → Validasi panjang payload
//   → Ekstrak payload bits
//   → Gabungkan bits → bytes → decode UTF-8
//   → Update state & UI
//
// ── Prinsip Extraction dari Dokumen Penelitian ───────────────────────────
//   b = P' & 1
//   → Membaca bit ke-0 (LSB) dari nilai channel P'
//   → Image TIDAK dimodifikasi selama proses extraction
//   → Key yang sama menghasilkan slot sequence yang sama (PRNG deterministik)
//   → Key berbeda menghasilkan urutan yang berbeda → header tidak valid
//
// ── Validasi Berlapis ─────────────────────────────────────────────────────
//   1. Image wajib diupload dan berhasil di-decode (imageData harus ada)
//   2. Key tidak boleh kosong
//   3. Image harus cukup besar untuk menampung header (≥ 32 slot)
//   4. Header yang terekstrak harus berisi panjang yang masuk akal
//   5. Total bit yang dibutuhkan tidak melebihi kapasitas image
//   6. Hasil decode UTF-8 tidak boleh kosong atau mengandung garbage
//   7. Key yang berbeda → header invalid → error message yang informatif

import { getState, setState, batchSetState } from '../state.js';
import { pickImageFile, readImageFile }       from '../services/fileService.js';
import { decodeImage }                        from '../core/imageHandler.js';
import { generateSlotSequence }               from '../core/pixelPositionSelector.js';
import { extractBits }                        from '../core/lsbEmbeddingEngine.js';
import { bitsToMessage }                      from '../core/messageBitConverter.js';
import { ERROR, STATUS }                      from '../constants.js';
import { showError, clearError }              from '../utils/uiHelpers.js';

// Panjang header dalam bit (32-bit unsigned int = panjang payload dalam byte)
// HARUS sama persis dengan HEADER_BYTES * 8 di messageBitConverter.js
const HEADER_BITS  = 32;
const HEADER_BYTES = 4;

const dom = {};

// ---------------------------------------------------------------------------
// DOM cache
// ---------------------------------------------------------------------------
function cacheDom() {
  const page = document.getElementById('page-extraction');
  dom.page           = page;
  dom.dropzone       = page.querySelector('#ext-dropzone');
  dom.fname          = page.querySelector('#ext-fname');
  dom.stegoPreview   = page.querySelector('#ext-stego-preview');
  dom.dimLabel       = page.querySelector('#ext-stego-dim');
  dom.stegoKey       = page.querySelector('#ext-key');
  dom.extractBtn     = page.querySelector('#ext-btn');
  dom.resultBox      = page.querySelector('#ext-result-box');
  dom.resultTextarea = page.querySelector('#ext-result-textarea');
  dom.resultStatus   = page.querySelector('#ext-result-status');
  dom.stepper        = page.querySelector('.stepper');
}

// ---------------------------------------------------------------------------
// Image upload & drag-drop
// ---------------------------------------------------------------------------
async function handlePickStegoImage() {
  clearError(dom.page);
  try {
    const file = await pickImageFile();
    await _loadStegoImage(file);
  } catch (err) {
    if (err.message !== 'AbortError' && !err.message.includes('cancel')) {
      showError(dom.page, err.message);
    }
  }
}

function handleDrop(event) {
  event.preventDefault();
  dom.dropzone.classList.remove('dragover');
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  _loadStegoImage(file).catch((err) => showError(dom.page, err.message));
}

/**
 * Membaca file image, menyimpan ke state, dan merender preview.
 * Digunakan bersama oleh handlePickStegoImage dan handleDrop.
 */
async function _loadStegoImage(file) {
  const meta = await readImageFile(file);  // throws jika format tidak valid

  batchSetState({
    extractionImage:  meta,
    extractionResult: null,
  });

  if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
  _renderPreview(meta);
  _clearResult();
}

// ---------------------------------------------------------------------------
// Key input
// ---------------------------------------------------------------------------
function handleKeyInput() {
  // Key disimpan di memori selama sesi; tidak pernah ditulis ke storage
  setState('extractionKey', dom.stegoKey ? dom.stegoKey.value : '');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
/**
 * Validasi input sebelum pipeline dimulai.
 * @throws {Error} dengan pesan user-friendly
 */
function validateExtractionInputs() {
  const st = getState();

  // Validasi 1: image wajib ada dan berhasil di-decode
  if (!st.extractionImage) {
    throw new Error('Belum ada stego image yang di-upload.');
  }
  if (!st.extractionImage.imageData) {
    throw new Error('Image tidak dapat diproses. Coba upload ulang file.');
  }

  // Validasi 2: key tidak boleh kosong
  if (!st.extractionKey || st.extractionKey.trim().length === 0) {
    throw new Error(ERROR.EMPTY_KEY);
  }
}

// ---------------------------------------------------------------------------
// Extract pipeline
// ---------------------------------------------------------------------------
async function handleExtract() {
  clearError(dom.page);

  // Tahap 1: Validasi input
  try {
    validateExtractionInputs();
  } catch (err) {
    showError(dom.page, err.message);
    return;
  }

  // Disable tombol selama proses berjalan
  _setButtonState(true, 'Mengekstrak…');

  try {
    const st = getState();

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 2: Decode stego image ke pixel buffer
    // ─────────────────────────────────────────────────────────────────────
    let stegoDecoded;
    try {
      stegoDecoded = decodeImage(st.extractionImage);
    } catch (err) {
      throw new Error('Gagal membaca pixel image: ' + err.message);
    }

    const stegoImageData = stegoDecoded.imageData;
    const totalPixels    = stegoDecoded.width * stegoDecoded.height;
    const totalSlots     = totalPixels * 3;   // 3 channel RGB per piksel

    // Validasi 3: image harus cukup besar untuk header
    if (totalSlots < HEADER_BITS) {
      throw new Error(
        `Image terlalu kecil (${stegoDecoded.width}×${stegoDecoded.height}). ` +
        `Dibutuhkan setidaknya ${Math.ceil(HEADER_BITS / 3)} piksel.`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 3: Baca header (32 bit) menggunakan b = P' & 1
    //
    // generateSlotSequence dipanggil FRESH dengan key yang sama.
    // Karena PRNG di-restart dari seed yang sama setiap panggilan,
    // 32 slot pertama yang dihasilkan IDENTIK dengan 32 slot pertama
    // dari sequence penuh — properti forward Fisher-Yates.
    // ─────────────────────────────────────────────────────────────────────
    const headerSlots = generateSlotSequence(st.extractionKey, totalSlots, HEADER_BITS);

    // Baca LSB dari setiap slot header: b = P' & 1
    const headerBits  = extractBits(stegoImageData, headerSlots);  // Uint8Array[32]

    // Rekonstruksi panjang payload dari header bits (big-endian, MSB first)
    let payloadByteLen = 0;
    for (let i = 0; i < HEADER_BITS; i++) {
      payloadByteLen = (payloadByteLen << 1) | (headerBits[i] & 1);
    }
    payloadByteLen = payloadByteLen >>> 0;   // paksa unsigned 32-bit

    // Validasi 4: panjang header harus masuk akal
    // Jika key salah, urutan slot berbeda → header akan berisi noise acak
    // → payloadByteLen akan sangat besar atau 0
    const maxPayloadBytes = Math.floor(totalSlots / 8) - HEADER_BYTES;
    if (payloadByteLen === 0) {
      throw new Error(
        'Tidak ada pesan yang ditemukan. ' +
        'Pastikan image ini adalah hasil embedding dan bukan image biasa.'
      );
    }
    if (payloadByteLen > maxPayloadBytes) {
      throw new Error(
        'Stego-Key tidak valid atau image bukan hasil embedding dari aplikasi ini. ' +
        `(Header menunjukkan ${payloadByteLen} byte, kapasitas maksimal ${maxPayloadBytes} byte)`
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 4: Baca seluruh bit (header + payload) dengan key yang sama
    //
    // generateSlotSequence dipanggil ulang — PRNG di-restart dari awal
    // sehingga slot 0..31 IDENTIK dengan headerSlots (konsistensi forward shuffle).
    // ─────────────────────────────────────────────────────────────────────
    const totalBitsNeeded = (HEADER_BYTES + payloadByteLen) * 8;

    // Validasi 5: total bit tidak melebihi kapasitas image
    if (totalBitsNeeded > totalSlots) {
      throw new Error(
        `Payload yang terindikasi (${payloadByteLen} byte) melebihi kapasitas image ` +
        `(${Math.floor(totalSlots / 8)} byte). Image mungkin telah dimodifikasi.`
      );
    }

    const fullSlots = generateSlotSequence(st.extractionKey, totalSlots, totalBitsNeeded);

    // Baca seluruh bit menggunakan b = P' & 1 pada setiap slot
    const allBits = extractBits(stegoImageData, fullSlots);   // Uint8Array

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 5: Gabungkan bit → byte → decode UTF-8
    // ─────────────────────────────────────────────────────────────────────
    const message = bitsToMessage(allBits);

    // Validasi 6: pesan hasil decode tidak boleh kosong atau garbage
    if (message === null || message === undefined || message === '') {
      throw new Error(
        'Gagal mendekode pesan. Stego-Key mungkin salah, atau karakter non-UTF8 terdeteksi. ' +
        'Pastikan Stego-Key sama persis dengan yang digunakan saat embedding.'
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 6: Update state (image tidak diubah, hanya state result)
    // ─────────────────────────────────────────────────────────────────────
    batchSetState({
      extractionResult: { message, status: STATUS.OK },
    });

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 7: Update UI
    // ─────────────────────────────────────────────────────────────────────
    _renderResult(message, STATUS.OK, payloadByteLen);
    _updateStepper();

    console.info(
      `[ExtractionController] Berhasil mengekstrak ${message.length} karakter ` +
      `(${payloadByteLen} byte UTF-8) dari ${stegoDecoded.width}×${stegoDecoded.height} image.`
    );

  } catch (err) {
    // Tampilkan error + status gagal
    showError(dom.page, err.message);
    _renderResult(null, STATUS.FAIL, 0);
    batchSetState({ extractionResult: { message: null, status: STATUS.FAIL } });
    console.warn('[ExtractionController] Extraction gagal:', err.message);
  } finally {
    _setButtonState(false, 'Extract Message');
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function _setButtonState(disabled, label) {
  if (!dom.extractBtn) return;
  dom.extractBtn.disabled    = disabled;
  dom.extractBtn.textContent = label;
}

function _renderPreview(meta) {
  if (!dom.stegoPreview) return;
  dom.stegoPreview.innerHTML = '';

  const img = document.createElement('img');
  img.src   = meta.dataUrl;
  img.alt   = 'Stego Image';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.stegoPreview.appendChild(img);

  if (dom.dimLabel) dom.dimLabel.textContent = `${meta.width}×${meta.height}`;
}

/**
 * Render hasil extraction ke textarea dan status badge.
 *
 * @param {string|null} message        – pesan yang berhasil diekstrak, atau null
 * @param {string}      status         – STATUS.OK atau STATUS.FAIL
 * @param {number}      payloadBytes   – panjang payload dalam byte (untuk info)
 */
function _renderResult(message, status, payloadBytes) {
  // Textarea: isi dengan pesan, jangan pernah pre-fill sample data
  if (dom.resultTextarea) {
    dom.resultTextarea.value = (status === STATUS.OK && message) ? message : '';
    // Sesuaikan tinggi textarea dengan konten
    if (status === STATUS.OK && message) {
      dom.resultTextarea.style.height = 'auto';
      dom.resultTextarea.style.height =
        Math.min(dom.resultTextarea.scrollHeight, 320) + 'px';
    }
  }

  // Status badge
  if (!dom.resultStatus) return;
  dom.resultStatus.innerHTML = '';

  if (status === STATUS.OK) {
    const charCount = message ? message.length : 0;
    const byteInfo  = payloadBytes > 0 ? ` · ${payloadBytes} byte UTF-8` : '';
    dom.resultStatus.innerHTML =
      `<span class="status ok">` +
      `<span class="status-dot"></span>` +
      `Berhasil · ${charCount} karakter${byteInfo}` +
      `</span>`;
  } else if (status === STATUS.FAIL) {
    dom.resultStatus.innerHTML =
      `<span class="status fail">` +
      `<span class="status-dot"></span>` +
      `Ekstraksi gagal` +
      `</span>`;
  }
}

function _clearResult() {
  if (dom.resultTextarea) {
    dom.resultTextarea.value = '';
    dom.resultTextarea.style.height = '';
  }
  if (dom.resultStatus) dom.resultStatus.innerHTML = '';
}

/**
 * Update stepper: step 1 (Input) dan 2 (Process) → done, step 3 (Result) → current.
 */
function _updateStepper() {
  if (!dom.stepper) return;
  const steps = dom.stepper.querySelectorAll('.step');
  // Extraction page: 3 step (Input, Process, Result)
  steps.forEach((s, i) => {
    s.classList.remove('done', 'current');
    const dot = s.querySelector('.step-dot');
    if (i < 2) {
      s.classList.add('done');
      if (dot) dot.textContent = '✓';
    } else if (i === 2) {
      s.classList.add('current');
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initExtractionController() {
  cacheDom();

  if (dom.dropzone) {
    dom.dropzone.addEventListener('click', handlePickStegoImage);
    dom.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.dropzone.classList.add('dragover');
    });
    dom.dropzone.addEventListener('dragleave', () => {
      dom.dropzone.classList.remove('dragover');
    });
    dom.dropzone.addEventListener('drop', handleDrop);
  }

  if (dom.stegoKey) {
    dom.stegoKey.addEventListener('input', handleKeyInput);
    // Key selalu dimulai kosong — tidak ada nilai default atau pre-fill
    dom.stegoKey.value = '';
  }

  if (dom.extractBtn) {
    dom.extractBtn.addEventListener('click', handleExtract);
  }

  // Inisialisasi state key ke kosong
  setState('extractionKey', '');
  setState('extractionResult', null);
}
