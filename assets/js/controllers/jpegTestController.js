// controllers/jpegTestController.js
//
// Application layer untuk halaman JPEG Fragility Test.
//
// ── Tujuan Penelitian ────────────────────────────────────────────────────────
// Menguji apakah pesan yang disisipkan melalui LSB dapat bertahan setelah
// stego image dikompresi menggunakan JPEG pada berbagai Quality Factor (QF).
// JPEG adalah kompresi lossy berbasis DCT yang mengubah nilai piksel secara
// non-linear, sehingga LSB yang disisipkan akan rusak.
//
// ── Pipeline ─────────────────────────────────────────────────────────────────
//   Upload stego image (PNG/BMP hasil embedding)
//   → Input Stego-Key (sama dengan saat embedding)
//   → Atur Quality Factor (slider 10–100)
//   → [Run JPEG Test]
//   → Kompres stego image ke JPEG pada QF tertentu
//   → Decode JPEG kembali ke pixel buffer
//   → Coba ekstrak pesan dari JPEG image dengan key yang sama
//   → Hitung Bit Accuracy: LSB sebelum vs sesudah kompresi
//   → Hitung PSNR antara stego dan JPEG image
//   → Tampilkan hasil di UI + simpan ke tabel histori
//
// ── Bit Accuracy ─────────────────────────────────────────────────────────────
//   Bit Accuracy Sebelum = ekstrak dari stego asli → bandingkan dengan diri sendiri → 100%
//   Bit Accuracy Sesudah = ekstrak dari JPEG → bandingkan LSB-by-LSB dengan stego asli
//
//   ~100% → JPEG tidak merusak bit → pesan masih bisa diekstrak
//   ~50%  → JPEG merusak seluruh bit (distribusi acak → seperti noise)
//   0–50% → JPEG merusak sebagian besar bit

import { getState, setState, batchSetState }      from '../state.js';
import { pickImageFile, readImageFile }            from '../services/fileService.js';
import { decodeImage }                            from '../core/imageHandler.js';
import { generateSlotSequence }                   from '../core/pixelPositionSelector.js';
import { extractBits }                            from '../core/lsbEmbeddingEngine.js';
import { bitsToMessage }                          from '../core/messageBitConverter.js';
import { compressToJPEG, calcBitAccuracy }        from '../evaluation/jpegCompressionTest.js';
import { ERROR, STATUS }                          from '../constants.js';
import { showError, clearError }                  from '../utils/uiHelpers.js';
import { CONFIG }                                 from '../config.js';

const HEADER_BITS  = 32;
const HEADER_BYTES = 4;

const dom = {};

// ---------------------------------------------------------------------------
// DOM cache
// ---------------------------------------------------------------------------
function cacheDom() {
  const page = document.getElementById('page-jpeg');
  dom.page           = page;
  dom.dropzone       = page.querySelector('#jpeg-dropzone');
  dom.fname          = page.querySelector('#jpeg-fname');
  dom.stegoPreview   = page.querySelector('#jpeg-stego-preview');
  dom.stegoLabel     = page.querySelector('#jpeg-stego-dim');
  dom.jpegPreview    = page.querySelector('#jpeg-jpeg-preview');
  dom.jpegQfBadge    = page.querySelector('#jpeg-qf-badge');
  dom.stegoKey       = page.querySelector('#jpeg-key');
  dom.range          = page.querySelector('#jpeg-qf-range');
  dom.rangeLabel     = page.querySelector('#jpeg-qf-label');
  dom.runBtn         = page.querySelector('#jpeg-btn');
  dom.resultStatus   = page.querySelector('#jpeg-result-status');
  dom.resultTextarea = page.querySelector('#jpeg-result-textarea');
  dom.accBefore      = page.querySelector('#jpeg-acc-before');
  dom.accAfter       = page.querySelector('#jpeg-acc-after');
  dom.qfResult       = page.querySelector('#jpeg-qf-result');
  dom.historyTbody   = page.querySelector('#jpeg-history-tbody');
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
    if (!err.message.includes('cancel') && err.message !== 'AbortError') {
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

async function _loadStegoImage(file) {
  const meta = await readImageFile(file);
  batchSetState({ jpegStegoImage: meta, jpegTestResult: null });
  if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
  _renderStegoPreview(meta);
  _clearResult();
}

// ---------------------------------------------------------------------------
// Key + slider
// ---------------------------------------------------------------------------
function handleKeyInput() {
  setState('jpegKey', dom.stegoKey ? dom.stegoKey.value : '');
}

function handleQualityChange(event) {
  const qf = Number(event.target.value);
  setState('qualityFactor', qf);
  if (dom.rangeLabel) dom.rangeLabel.textContent = String(qf);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateJpegTestInputs() {
  const st = getState();
  if (!st.jpegStegoImage) throw new Error('Belum ada stego image yang di-upload.');
  if (!st.jpegStegoImage.imageData) throw new Error('Image tidak dapat diproses. Coba upload ulang.');
  if (!st.jpegKey || st.jpegKey.trim().length === 0) throw new Error(ERROR.EMPTY_KEY);
}

// ---------------------------------------------------------------------------
// Run JPEG Test — pipeline utama
// ---------------------------------------------------------------------------
async function handleRunTest() {
  clearError(dom.page);

  try {
    validateJpegTestInputs();
  } catch (err) {
    showError(dom.page, err.message);
    return;
  }

  _setButtonState(true, 'Menguji…');

  try {
    const st = getState();
    const qf = st.qualityFactor || CONFIG.jpegTest.defaultQuality;

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 1: Decode stego image ke pixel buffer
    // ─────────────────────────────────────────────────────────────────────
    let stegoDecoded;
    try {
      stegoDecoded = decodeImage(st.jpegStegoImage);
    } catch (e) {
      throw new Error('Gagal membaca pixel stego image: ' + e.message);
    }

    const stegoImageData = stegoDecoded.imageData;
    const totalSlots     = stegoDecoded.width * stegoDecoded.height * 3;

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 2: Kompres ke JPEG dan decode kembali
    // ─────────────────────────────────────────────────────────────────────
    let jpegResult;
    try {
      jpegResult = await compressToJPEG(stegoImageData, qf);
    } catch (e) {
      throw new Error('Kompresi JPEG gagal: ' + e.message);
    }

    const { jpegImageData, jpegDataUrl, psnr: jpegPsnr } = jpegResult;

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 3: Baca header dari stego asli untuk mengetahui ukuran pesan
    // ─────────────────────────────────────────────────────────────────────
    if (totalSlots < HEADER_BITS) {
      throw new Error('Image terlalu kecil untuk mengandung header pesan.');
    }

    const headerSlots = generateSlotSequence(st.jpegKey, totalSlots, HEADER_BITS);
    const headerBits  = extractBits(stegoImageData, headerSlots);

    let payloadByteLen = 0;
    for (let i = 0; i < HEADER_BITS; i++) {
      payloadByteLen = (payloadByteLen << 1) | (headerBits[i] & 1);
    }
    payloadByteLen = payloadByteLen >>> 0;

    const maxPayloadBytes = Math.floor(totalSlots / 8) - HEADER_BYTES;
    const hasValidHeader  = payloadByteLen > 0 && payloadByteLen <= maxPayloadBytes;

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 4: Hitung Bit Accuracy — bandingkan LSB stego vs LSB JPEG
    //
    // Gunakan slot sequence yang sama (dari stego asli + key yang sama).
    // Jika header valid, gunakan jumlah bit pesan nyata.
    // Jika tidak, sampling 1000 slot untuk mengukur akurasi.
    // ─────────────────────────────────────────────────────────────────────
    const sampleCount = hasValidHeader
      ? (HEADER_BYTES + payloadByteLen) * 8
      : Math.min(1000, totalSlots);

    const sampleSlots = generateSlotSequence(st.jpegKey, totalSlots, sampleCount);

    // Baca LSB dari stego asli (referensi = 100%)
    const bitsFromStego = extractBits(stegoImageData, sampleSlots);
    // Baca LSB dari JPEG (setelah kompresi)
    const bitsFromJpeg  = extractBits(jpegImageData,  sampleSlots);

    const bitAccBefore = 100;   // stego vs dirinya sendiri selalu 100%
    const bitAccAfter  = calcBitAccuracy(bitsFromStego, bitsFromJpeg);

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 5: Coba ekstrak pesan dari JPEG image
    // ─────────────────────────────────────────────────────────────────────
    let extractedMessage = null;
    let extractionStatus = STATUS.FAIL;

    if (hasValidHeader) {
      const fullSlots = generateSlotSequence(st.jpegKey, totalSlots, sampleCount);
      const allBits   = extractBits(jpegImageData, fullSlots);
      const decoded   = bitsToMessage(allBits);
      if (decoded && decoded.length > 0) {
        extractedMessage = decoded;
        extractionStatus = STATUS.OK;
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 6: Simpan hasil ke state & histori
    // ─────────────────────────────────────────────────────────────────────
    const result = {
      qf             : qf,
      jpegDataUrl    : jpegDataUrl,
      jpegPsnr       : jpegPsnr,
      bitAccBefore   : bitAccBefore,
      bitAccAfter    : bitAccAfter,
      extractedMessage,
      extractionStatus,
    };

    const historyRow = {
      qf,
      status       : extractionStatus,
      bitAccAfter  : bitAccAfter,
      psnr         : isFinite(jpegPsnr) ? Number(jpegPsnr.toFixed(2)) : null,
      timestamp    : new Date().toLocaleTimeString('id-ID'),
    };

    const currentHistory = getState().jpegTestHistory || [];
    batchSetState({
      jpegTestResult  : result,
      jpegTestHistory : [historyRow, ...currentHistory],
    });

    // ─────────────────────────────────────────────────────────────────────
    // Tahap 7: Update UI
    // ─────────────────────────────────────────────────────────────────────
    _renderJpegPreview(jpegDataUrl, qf);
    _renderResult(result);
    _appendHistoryRow(historyRow);

    console.info(
      `[JpegTestController] QF=${qf} | Bit Accuracy: ${bitAccAfter}% | ` +
      `PSNR: ${isFinite(jpegPsnr) ? jpegPsnr.toFixed(2) : '∞'} dB | ` +
      `Extraction: ${extractionStatus}`
    );

  } catch (err) {
    showError(dom.page, err.message);
    console.warn('[JpegTestController] Test gagal:', err.message);
  } finally {
    _setButtonState(false, 'Run JPEG Test');
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function _setButtonState(disabled, label) {
  if (!dom.runBtn) return;
  dom.runBtn.disabled    = disabled;
  dom.runBtn.textContent = label;
}

function _renderStegoPreview(meta) {
  if (!dom.stegoPreview) return;
  dom.stegoPreview.innerHTML = '';
  const img = document.createElement('img');
  img.src   = meta.dataUrl;
  img.alt   = 'Stego Image';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.stegoPreview.appendChild(img);
  if (dom.stegoLabel) dom.stegoLabel.textContent = `${meta.width}×${meta.height}`;
}

function _renderJpegPreview(jpegDataUrl, qf) {
  if (!dom.jpegPreview) return;
  dom.jpegPreview.innerHTML = '';
  const img = document.createElement('img');
  img.src   = jpegDataUrl;
  img.alt   = `JPEG QF${qf}`;
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.jpegPreview.appendChild(img);
  if (dom.jpegQfBadge) dom.jpegQfBadge.textContent = `QF ${qf}`;
}

function _renderResult(result) {
  const { bitAccBefore, bitAccAfter, jpegPsnr, extractedMessage, extractionStatus, qf } = result;

  // Textarea pesan hasil ekstraksi dari JPEG
  if (dom.resultTextarea) {
    dom.resultTextarea.value = extractedMessage || '';
    if (extractedMessage) {
      dom.resultTextarea.style.height = 'auto';
      dom.resultTextarea.style.height =
        Math.min(dom.resultTextarea.scrollHeight, 200) + 'px';
    }
  }

  // Status badge
  if (dom.resultStatus) {
    dom.resultStatus.innerHTML = '';
    if (extractionStatus === STATUS.OK) {
      dom.resultStatus.innerHTML =
        `<span class="status ok"><span class="status-dot"></span>` +
        `Pesan berhasil diekstrak setelah JPEG QF${qf}</span>`;
    } else {
      dom.resultStatus.innerHTML =
        `<span class="status fail"><span class="status-dot"></span>` +
        `Pesan tidak dapat diekstrak setelah JPEG QF${qf}</span>`;
    }
  }

  // Metrik — bit accuracy
  if (dom.accBefore) {
    dom.accBefore.textContent = bitAccBefore.toFixed(2) + '%';
    dom.accBefore.className   = 'metric-value good';
  }
  if (dom.accAfter) {
    const isGood = bitAccAfter >= 90;
    dom.accAfter.textContent = bitAccAfter.toFixed(2) + '%';
    dom.accAfter.className   = 'metric-value' + (isGood ? ' good' : '');
  }

  // QF result
  if (dom.qfResult) {
    dom.qfResult.textContent = String(qf);
    dom.qfResult.className   = 'metric-value';
  }
}

function _clearResult() {
  if (dom.resultTextarea) { dom.resultTextarea.value = ''; dom.resultTextarea.style.height = ''; }
  if (dom.resultStatus)   dom.resultStatus.innerHTML = '';
  if (dom.accBefore)      { dom.accBefore.textContent = '—'; dom.accBefore.className = 'metric-value'; }
  if (dom.accAfter)       { dom.accAfter.textContent  = '—'; dom.accAfter.className  = 'metric-value'; }
  if (dom.qfResult)       { dom.qfResult.textContent  = '—'; dom.qfResult.className  = 'metric-value'; }
  if (dom.jpegPreview)    dom.jpegPreview.innerHTML = 'Hasil kompresi';
  if (dom.jpegQfBadge)    dom.jpegQfBadge.textContent = 'QF —';
}

/**
 * Tambahkan satu baris ke tabel histori pengujian.
 * Jika ini adalah baris pertama, hapus placeholder "Belum ada pengujian".
 */
function _appendHistoryRow(row) {
  if (!dom.historyTbody) return;

  // Hapus placeholder jika masih ada
  const placeholder = dom.historyTbody.querySelector('tr td[colspan]');
  if (placeholder) dom.historyTbody.innerHTML = '';

  const tr = document.createElement('tr');

  // QF
  const tdQf = document.createElement('td');
  tdQf.className   = 'mono';
  tdQf.textContent = row.qf;
  tr.appendChild(tdQf);

  // Status ekstraksi
  const tdStatus = document.createElement('td');
  tdStatus.innerHTML = row.status === STATUS.OK
    ? '<span class="status ok"><span class="status-dot"></span>Berhasil</span>'
    : '<span class="status fail"><span class="status-dot"></span>Gagal</span>';
  tr.appendChild(tdStatus);

  // Bit Accuracy
  const tdAcc = document.createElement('td');
  tdAcc.className   = 'mono';
  tdAcc.textContent = row.bitAccAfter + '%';
  tdAcc.style.color = row.bitAccAfter >= 90
    ? 'var(--accent)' : row.bitAccAfter >= 70
    ? 'var(--warn)' : '#e55';
  tr.appendChild(tdAcc);

  // PSNR
  const tdPsnr = document.createElement('td');
  tdPsnr.className   = 'mono';
  tdPsnr.textContent = row.psnr !== null ? row.psnr + ' dB' : '∞ dB';
  tr.appendChild(tdPsnr);

  // Insert di atas (newest first)
  dom.historyTbody.insertBefore(tr, dom.historyTbody.firstChild);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initJpegTestController() {
  cacheDom();

  if (dom.dropzone) {
    dom.dropzone.addEventListener('click', handlePickStegoImage);
    dom.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.dropzone.classList.add('dragover');
    });
    dom.dropzone.addEventListener('dragleave', () => dom.dropzone.classList.remove('dragover'));
    dom.dropzone.addEventListener('drop', handleDrop);
  }

  if (dom.stegoKey) {
    dom.stegoKey.addEventListener('input', handleKeyInput);
    dom.stegoKey.value = '';
  }

  if (dom.range) {
    dom.range.addEventListener('input', handleQualityChange);
    dom.range.value = String(CONFIG.jpegTest.defaultQuality);
    if (dom.rangeLabel) dom.rangeLabel.textContent = String(CONFIG.jpegTest.defaultQuality);
  }

  if (dom.runBtn) dom.runBtn.addEventListener('click', handleRunTest);

  // Init state
  setState('jpegKey', '');
  setState('jpegTestResult', null);
}
