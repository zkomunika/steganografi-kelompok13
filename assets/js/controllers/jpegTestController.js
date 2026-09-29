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
// ── Pipeline (Alur Wajib) ────────────────────────────────────────────────────
//   Stego Image
//   → JPEG Compression (canvas.toDataURL, QF 10–100)
//   → JPEG Image (pixel buffer nyata, bukan contoh)
//   → Extraction menggunakan Stego-Key yang sama
//   → Bandingkan dengan pesan asli
//   → Hitung Bit Accuracy = N_benar / N_total × 100%
//   → Tampilkan hasil di UI + tabel histori
//
// ── Bit Accuracy ─────────────────────────────────────────────────────────────
//   Bit Accuracy = (bit yang cocok di slot payload) / (total bit payload) × 100%
//
//   Perhitungan menggunakan panjang payload asli (dari state.embeddingResult)
//   sehingga perbandingan dilakukan terhadap jumlah bit yang diketahui, bukan
//   bergantung pada length header yang mungkin sudah rusak akibat JPEG.
//
//   ~100% → JPEG tidak merusak bit → pesan masih bisa diekstrak
//   ~50%  → JPEG merusak seluruh bit (distribusi acak seperti noise)
//   0–50% → JPEG merusak sebagian besar bit
//
// ── Sumber Panjang Payload ────────────────────────────────────────────────────
//   Priority 1: state.embeddingResult.bitsEmbedded (jika user upload stego
//               dari sesi embedding yang sama → paling akurat)
//   Priority 2: Baca header dari stego asli (fallback: jika upload stego
//               dari file eksternal)
//
// ── Multi-QF Test ────────────────────────────────────────────────────────────
//   Run All QF: jalankan pipeline untuk QF = [100, 90, 70, 50, 30]
//   secara berurutan dan tampilkan semua hasil ke tabel sekaligus.

import { getState, setState, batchSetState }      from '../state.js';
import { pickImageFile, readImageFile }            from '../services/fileService.js';
import { decodeImage }                            from '../core/imageHandler.js';
import { generateSlotSequence }                   from '../core/pixelPositionSelector.js';
import { extractBits }                            from '../core/lsbEmbeddingEngine.js';
import { bitsToMessage }                          from '../core/messageBitConverter.js';
import { compressToJPEG, calcBitAccuracy }        from '../evaluation/jpegCompressionTest.js';
import { downloadImage }                          from '../utils/imageFileHandler.js';
import { ERROR, STATUS }                          from '../constants.js';
import { showError, clearError }                  from '../utils/uiHelpers.js';
import { CONFIG }                                 from '../config.js';

// QF yang diuji pada "Run All QF"
const MULTI_QF_LIST = [100, 90, 70, 50, 30];

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
  dom.runAllBtn      = page.querySelector('#jpeg-btn-all');
  dom.downloadJpegBtn = page.querySelector('#jpeg-download-btn');
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
// Resolusi panjang payload
//
// Spesifikasi: gunakan panjang payload asli dari state embedding agar
// perbandingan bit dilakukan terhadap jumlah bit yang diketahui, bukan
// bergantung pada length header yang mungkin sudah rusak akibat JPEG.
//
// Jika state.embeddingResult tidak tersedia (user upload dari file eksternal),
// fallback ke baca header dari stego asli (masih PNG/lossless sehingga
// header dapat dibaca dengan benar dari stegoImageData, bukan dari JPEG).
// ---------------------------------------------------------------------------
function _resolvePayloadBitLen(stegoImageData, totalSlots, key) {
  const st = getState();

  // Priority 1: dari state embedding (sesi yang sama)
  if (st.embeddingResult && st.embeddingResult.bitsEmbedded > 0) {
    return {
      payloadBitLen: st.embeddingResult.bitsEmbedded,
      source: 'state',
    };
  }

  // Priority 2: baca header dari stego asli (masih lossless)
  if (totalSlots < HEADER_BITS) return { payloadBitLen: 0, source: 'none' };

  const headerSlots = generateSlotSequence(key, totalSlots, HEADER_BITS);
  const headerBits  = extractBits(stegoImageData, headerSlots);

  let payloadByteLen = 0;
  for (let i = 0; i < HEADER_BITS; i++) {
    payloadByteLen = (payloadByteLen << 1) | (headerBits[i] & 1);
  }
  payloadByteLen = payloadByteLen >>> 0;

  const maxPayloadBytes = Math.floor((totalSlots - HEADER_BITS) / 8);
  if (payloadByteLen === 0 || payloadByteLen > maxPayloadBytes) {
    return { payloadBitLen: 0, source: 'none' };
  }

  // bitsEmbedded = header (32 bit) + payload (payloadByteLen × 8)
  return {
    payloadBitLen: HEADER_BITS + payloadByteLen * 8,
    source: 'header',
  };
}

// ---------------------------------------------------------------------------
// Core pipeline — satu QF
// ---------------------------------------------------------------------------
/**
 * Jalankan satu pengujian JPEG untuk satu Quality Factor.
 *
 * @param {object}    st              – current state snapshot
 * @param {ImageData} stegoImageData  – pixel buffer stego asli
 * @param {number}    totalSlots      – W × H × 3
 * @param {number}    qf              – Quality Factor 1–100
 * @returns {Promise<object>}         – hasil pengujian untuk satu QF
 */
async function _runOneQF(st, stegoImageData, totalSlots, qf) {
  // ── 1. Kompres ke JPEG dan decode kembali ─────────────────────────────
  const jpegResult = await compressToJPEG(stegoImageData, qf);
  const { jpegImageData, jpegDataUrl, psnr: jpegPsnr, mse: jpegMse } = jpegResult;

  // ── 2. Resolusi panjang payload ───────────────────────────────────────
  const { payloadBitLen, source: lenSource } = _resolvePayloadBitLen(
    stegoImageData, totalSlots, st.jpegKey
  );

  // Jumlah bit yang dibandingkan:
  // Jika panjang diketahui → gunakan itu.
  // Jika tidak → sampling 1000 slot (representatif, bukan klaim kerapuhan).
  const sampleCount = payloadBitLen > 0
    ? payloadBitLen
    : Math.min(1000, totalSlots);

  const sampleSlots = generateSlotSequence(st.jpegKey, totalSlots, sampleCount);

  // ── 3. Hitung Bit Accuracy ────────────────────────────────────────────
  // Bandingkan LSB dari stego asli (referensi) vs LSB dari JPEG
  // Rumus: Akurasi = N_benar / N_total × 100%
  const bitsFromStego = extractBits(stegoImageData, sampleSlots);  // referensi
  const bitsFromJpeg  = extractBits(jpegImageData,  sampleSlots);  // setelah kompresi

  const bitAccBefore = 100;   // stego vs dirinya sendiri selalu 100%
  const bitAccAfter  = calcBitAccuracy(bitsFromStego, bitsFromJpeg);

  // ── 4. Coba ekstrak pesan dari JPEG image ─────────────────────────────
  let extractedMessage = null;
  let extractionStatus = STATUS.FAIL;

  if (payloadBitLen > 0) {
    const allBits = extractBits(jpegImageData, sampleSlots);
    try {
      const decoded = bitsToMessage(allBits);
      if (decoded && decoded.length > 0) {
        extractedMessage = decoded;
        extractionStatus = STATUS.OK;
      }
    } catch (_) {
      // Decode gagal → pesan rusak → extractionStatus tetap FAIL
    }
  }

  return {
    qf,
    jpegDataUrl,
    jpegPsnr,
    jpegMse,
    bitAccBefore,
    bitAccAfter,
    extractedMessage,
    extractionStatus,
    sampleCount,
    lenSource,
  };
}

// ---------------------------------------------------------------------------
// Run JPEG Test — single QF
// ---------------------------------------------------------------------------
async function handleRunTest() {
  clearError(dom.page);

  try {
    validateJpegTestInputs();
  } catch (err) {
    showError(dom.page, err.message);
    return;
  }

  _setButtonState(dom.runBtn, true, 'Menguji…');

  try {
    const st = getState();
    const qf = st.qualityFactor || CONFIG.jpegTest.defaultQuality;

    const stegoDecoded   = decodeImage(st.jpegStegoImage);
    const stegoImageData = stegoDecoded.imageData;
    const totalSlots     = stegoDecoded.width * stegoDecoded.height * 3;

    const result = await _runOneQF(st, stegoImageData, totalSlots, qf);

    // Simpan ke state
    const historyRow = {
      qf,
      status      : result.extractionStatus,
      bitAccAfter : result.bitAccAfter,
      psnr        : isFinite(result.jpegPsnr) ? Number(result.jpegPsnr.toFixed(2)) : null,
      timestamp   : new Date().toLocaleTimeString('id-ID'),
      isBatch     : false,
    };

    const currentHistory = getState().jpegTestHistory || [];
    batchSetState({
      jpegTestResult  : result,
      jpegTestHistory : [historyRow, ...currentHistory],
    });

    // Update UI
    _renderJpegPreview(result.jpegDataUrl, qf);
    _renderResult(result);
    _appendHistoryRow(historyRow);

    // Aktifkan download JPEG setelah pengujian berhasil
    if (dom.downloadJpegBtn) dom.downloadJpegBtn.disabled = false;

  } catch (err) {
    showError(dom.page, err.message);
    console.warn('[JpegTestController] Test gagal:', err.message);
  } finally {
    _setButtonState(dom.runBtn, false, 'Run JPEG Test');
  }
}

// ---------------------------------------------------------------------------
// Run Multi-QF Test — QF [100, 90, 70, 50, 30]
// ---------------------------------------------------------------------------
async function handleRunAllQF() {
  clearError(dom.page);

  try {
    validateJpegTestInputs();
  } catch (err) {
    showError(dom.page, err.message);
    return;
  }

  _setButtonState(dom.runBtn,    true, 'Menguji…');
  _setButtonState(dom.runAllBtn, true, 'Menjalankan semua QF…');

  // Hapus placeholder sebelum batch
  _clearHistoryIfPlaceholder();

  try {
    const st = getState();

    const stegoDecoded   = decodeImage(st.jpegStegoImage);
    const stegoImageData = stegoDecoded.imageData;
    const totalSlots     = stegoDecoded.width * stegoDecoded.height * 3;

    const batchRows = [];

    // Jalankan setiap QF secara berurutan (bukan paralel) agar canvas tidak
    // overlap dan hasil PSNR/bit accuracy dapat dibandingkan secara konsisten.
    for (const qf of MULTI_QF_LIST) {
      // Update label tombol agar user tahu progres
      _setButtonState(dom.runAllBtn, true, `Menguji QF ${qf}…`);

      // eslint-disable-next-line no-await-in-loop
      const result = await _runOneQF(st, stegoImageData, totalSlots, qf);

      const historyRow = {
        qf,
        status      : result.extractionStatus,
        bitAccAfter : result.bitAccAfter,
        psnr        : isFinite(result.jpegPsnr) ? Number(result.jpegPsnr.toFixed(2)) : null,
        timestamp   : new Date().toLocaleTimeString('id-ID'),
        isBatch     : true,
      };
      batchRows.push(historyRow);

      // Render baris langsung saat selesai, sehingga user melihat progress real-time
      _appendHistoryRow(historyRow);

      // Update preview dengan hasil QF saat ini
      _renderJpegPreview(result.jpegDataUrl, qf);
      _renderResult(result);
    }

    // Aktifkan download JPEG (hasil QF terakhir dalam batch)
    if (dom.downloadJpegBtn) dom.downloadJpegBtn.disabled = false;

    // Update state dengan seluruh histori batch
    const currentHistory = getState().jpegTestHistory || [];
    setState('jpegTestHistory', [...batchRows, ...currentHistory]);

  } catch (err) {
    showError(dom.page, err.message);
    console.warn('[JpegTestController] Multi-QF test gagal:', err.message);
  } finally {
    _setButtonState(dom.runBtn,    false, 'Run JPEG Test');
    _setButtonState(dom.runAllBtn, false, 'Run All QF (100/90/70/50/30)');
  }
}

// ---------------------------------------------------------------------------
// Download JPEG
// ---------------------------------------------------------------------------
/**
 * Unduh hasil JPEG terakhir yang ada di preview.
 * Nama file dibuat dinamis dari nama stego image dan QF yang digunakan.
 */
function handleDownloadJpeg() {
  const st = getState();
  const result = st.jpegTestResult;
  if (!result || !result.jpegDataUrl) {
    showError(dom.page, 'Belum ada hasil JPEG untuk diunduh. Jalankan pengujian terlebih dahulu.');
    return;
  }
  const stegoName = st.jpegStegoImage
    ? st.jpegStegoImage.name.replace(/\.[^.]+$/, '')
    : 'stego';
  const filename = `jpeg_qf${result.qf}_${stegoName}.jpg`;
  downloadImage(result.jpegDataUrl, filename);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function _setButtonState(btn, disabled, label) {
  if (!btn) return;
  btn.disabled    = disabled;
  btn.textContent = label;
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

  // Status badge — hanya mencatat hasil, tidak membuat klaim tentang keamanan
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

  // Bit Accuracy — nilai aktual hasil perhitungan
  if (dom.accBefore) {
    dom.accBefore.textContent = bitAccBefore.toFixed(2) + '%';
    dom.accBefore.className   = 'metric-value good';
  }
  if (dom.accAfter) {
    dom.accAfter.textContent = bitAccAfter.toFixed(2) + '%';
    dom.accAfter.className   = 'metric-value';
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

function _clearHistoryIfPlaceholder() {
  if (!dom.historyTbody) return;
  const placeholder = dom.historyTbody.querySelector('tr td[colspan]');
  if (placeholder) dom.historyTbody.innerHTML = '';
}

/**
 * Tambahkan satu baris ke tabel histori pengujian.
 */
function _appendHistoryRow(row) {
  if (!dom.historyTbody) return;

  // Hapus placeholder jika masih ada
  _clearHistoryIfPlaceholder();

  const tr = document.createElement('tr');
  if (row.isBatch) tr.classList.add('batch-row');

  // QF
  const tdQf = document.createElement('td');
  tdQf.className   = 'mono';
  tdQf.textContent = row.qf;
  tr.appendChild(tdQf);

  // Status ekstraksi — faktual, tanpa klaim keamanan/kualitas
  const tdStatus = document.createElement('td');
  tdStatus.innerHTML = row.status === STATUS.OK
    ? '<span class="status ok"><span class="status-dot"></span>Berhasil</span>'
    : '<span class="status fail"><span class="status-dot"></span>Gagal</span>';
  tr.appendChild(tdStatus);

  // Bit Accuracy — nilai aktual
  const tdAcc = document.createElement('td');
  tdAcc.className   = 'mono';
  tdAcc.textContent = row.bitAccAfter + '%';
  // Warna hanya sebagai penanda perbedaan nilai, bukan klaim kualitas
  tdAcc.style.color = row.bitAccAfter >= 90
    ? 'var(--accent)' : row.bitAccAfter >= 70
    ? 'var(--warn)' : '#e55';
  tr.appendChild(tdAcc);

  // PSNR (stego vs JPEG) — nilai aktual dalam dB
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

  if (dom.runBtn)    dom.runBtn.addEventListener('click', handleRunTest);
  if (dom.runAllBtn) dom.runAllBtn.addEventListener('click', handleRunAllQF);
  if (dom.downloadJpegBtn) {
    dom.downloadJpegBtn.addEventListener('click', handleDownloadJpeg);
    dom.downloadJpegBtn.disabled = true;  // aktif hanya setelah test berhasil
  }

  // Init state
  setState('jpegKey', '');
  setState('jpegTestResult', null);
}
