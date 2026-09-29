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
//   Stego Image (diunggah, lossless)
//   → Baca header 32-bit dengan Stego-Key → panjang payload + bit referensi
//   → JPEG Compression (canvas.toDataURL) → JPEG Image (pixel buffer nyata)
//   → Ekstraksi bit dengan slot yang sama
//   → Bit Accuracy = bit cocok / total bit referensi × 100%
//   → Status = hasil dekripsi AES-256-GCM (tag lolos), bila Kunci Enkripsi diisi
//   → Tampilkan hasil di UI + tabel histori
//
// ── Sumber Panjang Payload ───────────────────────────────────────────────────
//   Selalu dari header stego yang benar-benar diunggah (bukan dari state sesi
//   embedding, yang bisa basi). Bila header tidak valid (mis. Stego-Key salah)
//   tidak ada ground truth: status gagal dan Bit Accuracy tidak disajikan.
//
// ── Status ───────────────────────────────────────────────────────────────────
//   ok   : tag GCM lolos pada payload hasil ekstraksi dari JPEG
//   fail : header tidak valid, baseline gagal, atau tag GCM tidak lolos
//   na   : Kunci Enkripsi kosong → hanya Bit Accuracy yang ditampilkan
//
// ── Riwayat ──────────────────────────────────────────────────────────────────
//   Dikosongkan setiap kali gambar, Stego-Key, atau Kunci Enkripsi berganti;
//   setiap baris mencatat nama gambar yang diuji.
//
// ── Multi-QF Test ────────────────────────────────────────────────────────────
//   Run All QF: jalankan pipeline untuk QF = [100, 90, 70, 50, 30] secara
//   berurutan. jpegTestResult diperbarui di setiap QF sehingga tombol Download
//   selalu mengunduh hasil QF terakhir yang selesai.

import { getState, setState, batchSetState } from '../state.js';
import { pickImageFile, readImageFile }       from '../services/fileService.js';
import { decodeImage }                        from '../core/imageHandler.js';
import {
  compressToJPEG, prepareJpegReference, evaluateJpegImage, STATUS_NA,
} from '../evaluation/jpegCompressionTest.js';
import { downloadImage }                      from '../utils/imageFileHandler.js';
import { ERROR, STATUS }                      from '../constants.js';
import { showError, clearError }              from '../utils/uiHelpers.js';
import { CONFIG }                             from '../config.js';

// QF yang diuji pada "Run All QF"
const MULTI_QF_LIST = [100, 90, 70, 50, 30];

const HISTORY_COLSPAN = 5;

const dom = {};

// Bertambah setiap ada run baru atau reset; run lama yang tertinggal berhenti
// menulis state/UI (mis. kunci diganti saat batch masih berjalan).
let runToken = 0;

// ---------------------------------------------------------------------------
// DOM cache
// ---------------------------------------------------------------------------
function cacheDom() {
  const page = document.getElementById('page-jpeg');
  dom.page            = page;
  dom.dropzone        = page.querySelector('#jpeg-dropzone');
  dom.fname           = page.querySelector('#jpeg-fname');
  dom.stegoPreview    = page.querySelector('#jpeg-stego-preview');
  dom.stegoLabel      = page.querySelector('#jpeg-stego-dim');
  dom.jpegPreview     = page.querySelector('#jpeg-jpeg-preview');
  dom.jpegQfBadge     = page.querySelector('#jpeg-qf-badge');
  dom.stegoKey        = page.querySelector('#jpeg-key');
  dom.encKey          = page.querySelector('#jpeg-enc-key');
  dom.range           = page.querySelector('#jpeg-qf-range');
  dom.rangeLabel      = page.querySelector('#jpeg-qf-label');
  dom.runBtn          = page.querySelector('#jpeg-btn');
  dom.runAllBtn       = page.querySelector('#jpeg-btn-all');
  dom.downloadJpegBtn = page.querySelector('#jpeg-download-btn');
  dom.resultStatus    = page.querySelector('#jpeg-result-status');
  dom.resultTextarea  = page.querySelector('#jpeg-result-textarea');
  dom.accBefore       = page.querySelector('#jpeg-acc-before');
  dom.accAfter        = page.querySelector('#jpeg-acc-after');
  dom.qfResult        = page.querySelector('#jpeg-qf-result');
  dom.historyTbody    = page.querySelector('#jpeg-history-tbody');
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
  setState('jpegStegoImage', meta);
  _resetTestState();                 // gambar baru → riwayat & hasil lama tidak berlaku
  if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
  _renderStegoPreview(meta);
}

// ---------------------------------------------------------------------------
// Key + slider
// ---------------------------------------------------------------------------
function handleKeyInput() {
  const value = dom.stegoKey ? dom.stegoKey.value : '';
  if (value === getState().jpegKey) return;
  setState('jpegKey', value);
  _resetTestState();                 // hasil lama dihitung dengan kunci lain
}

function handleEncKeyInput() {
  const value = dom.encKey ? dom.encKey.value : '';
  if (value === getState().jpegEncKey) return;
  setState('jpegEncKey', value);
  _resetTestState();
}

function handleQualityChange(event) {
  const qf = Number(event.target.value);
  setState('qualityFactor', qf);
  if (dom.rangeLabel) dom.rangeLabel.textContent = String(qf);
}

// ---------------------------------------------------------------------------
// Reset — dipanggil saat gambar atau kunci berganti
// ---------------------------------------------------------------------------
function _resetTestState() {
  runToken++;                        // hentikan run yang sedang berjalan
  batchSetState({ jpegTestResult: null, jpegTestHistory: [] });
  _clearResult();
  _renderHistory();
  if (dom.downloadJpegBtn) dom.downloadJpegBtn.disabled = true;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateJpegTestInputs() {
  const st = getState();
  if (!st.jpegStegoImage) throw new Error('Belum ada stego image yang di-upload.');
  if (!st.jpegStegoImage.imageData) throw new Error('Image tidak dapat diproses. Coba upload ulang.');
  if (!st.jpegKey || st.jpegKey.trim().length === 0) throw new Error(ERROR.EMPTY_KEY);
  // Kunci Enkripsi opsional; bila diisi harus berbeda dari Stego-Key.
  if (st.jpegEncKey && st.jpegEncKey.trim().length > 0 && st.jpegEncKey === st.jpegKey) {
    throw new Error(ERROR.SAME_KEYS);
  }
}

// ---------------------------------------------------------------------------
// Core pipeline — satu atau beberapa QF
// ---------------------------------------------------------------------------
/**
 * Jalankan pengujian untuk daftar QF. Setiap QF yang selesai langsung
 * menulis jpegTestResult + riwayat, sehingga Download berfungsi walau run
 * berhenti di tengah jalan.
 */
async function _executeRun(qfList, isBatch) {
  clearError(dom.page);

  try {
    validateJpegTestInputs();
  } catch (err) {
    showError(dom.page, err.message);
    return;
  }

  const token = ++runToken;
  const alive = () => token === runToken;

  _setButtonState(dom.runBtn,    true, 'Menguji…');
  _setButtonState(dom.runAllBtn, true, isBatch ? 'Menjalankan semua QF…' : 'Run All QF (100 / 90 / 70 / 50 / 30)');

  try {
    const st = getState();
    const stegoImageData = decodeImage(st.jpegStegoImage).imageData;
    const imageName      = st.jpegStegoImage.name;
    const stegoKey       = st.jpegKey;
    const encKey         = st.jpegEncKey && st.jpegEncKey.trim().length > 0 ? st.jpegEncKey : '';

    // Ground truth sekali per run: header dibaca dari stego yang diunggah.
    const reference = await prepareJpegReference({ stegoImageData, stegoKey, encKey });
    if (!alive()) return;

    // Berurutan (bukan paralel) agar canvas tidak overlap.
    for (const qf of qfList) {
      if (isBatch) _setButtonState(dom.runAllBtn, true, `Menguji QF ${qf}…`);

      // eslint-disable-next-line no-await-in-loop
      const jpeg = await compressToJPEG(stegoImageData, qf);
      if (!alive()) return;
      // eslint-disable-next-line no-await-in-loop
      const metrics = await evaluateJpegImage(reference, jpeg.jpegImageData, encKey);
      if (!alive()) return;

      const result = {
        qf,
        imageName,
        jpegDataUrl : jpeg.jpegDataUrl,
        jpegPsnr    : jpeg.psnr,
        jpegMse     : jpeg.mse,
        ...metrics,
      };

      const row = {
        imageName,
        qf,
        status        : result.status,
        accMeaningful : result.accMeaningful,
        bitAccAfter   : result.bitAccAfter,
        psnr          : isFinite(jpeg.psnr) ? Number(jpeg.psnr.toFixed(2)) : null,
        timestamp     : new Date().toLocaleTimeString('id-ID'),
        isBatch,
      };

      batchSetState({
        jpegTestResult  : result,
        jpegTestHistory : [row, ...(getState().jpegTestHistory || [])],
      });

      _renderJpegPreview(result.jpegDataUrl, qf);
      _renderResult(result);
      _renderHistory();
      if (dom.downloadJpegBtn) dom.downloadJpegBtn.disabled = false;
    }
  } catch (err) {
    if (alive()) showError(dom.page, err.message);
    console.warn('[JpegTestController] Test gagal:', err.message);
  } finally {
    _setButtonState(dom.runBtn,    false, 'Run JPEG Test');
    _setButtonState(dom.runAllBtn, false, 'Run All QF (100 / 90 / 70 / 50 / 30)');
  }
}

function handleRunTest() {
  const qf = getState().qualityFactor || CONFIG.jpegTest.defaultQuality;
  return _executeRun([qf], false);
}

function handleRunAllQF() {
  return _executeRun(MULTI_QF_LIST, true);
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
  const stegoName = (result.imageName || 'stego').replace(/\.[^.]+$/, '');
  downloadImage(result.jpegDataUrl, `jpeg_qf${result.qf}_${stegoName}.jpg`);
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

/** Badge status (teks lewat textContent agar aman dari injeksi HTML). */
function _statusBadge(kind, text) {
  const span = document.createElement('span');
  span.className = `status ${kind}`;
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  span.appendChild(dot);
  span.appendChild(document.createTextNode(text));
  return span;
}

function _fmtAcc(value, meaningful) {
  return meaningful && value !== null && value !== undefined ? value.toFixed(2) + '%' : '—';
}

function _renderResult(result) {
  const { qf, status, extractedMessage, failReason, accMeaningful } = result;

  // Pesan hanya ditampilkan bila tag GCM lolos.
  if (dom.resultTextarea) {
    dom.resultTextarea.value = status === STATUS.OK && extractedMessage ? extractedMessage : '';
    dom.resultTextarea.style.height = 'auto';
    if (dom.resultTextarea.value) {
      dom.resultTextarea.style.height = Math.min(dom.resultTextarea.scrollHeight, 200) + 'px';
    } else {
      dom.resultTextarea.style.height = '';
    }
  }

  if (dom.resultStatus) {
    dom.resultStatus.innerHTML = '';
    if (status === STATUS.OK) {
      dom.resultStatus.appendChild(_statusBadge('ok', `Berhasil: tag GCM lolos setelah JPEG QF${qf}`));
    } else if (status === STATUS_NA) {
      dom.resultStatus.appendChild(_statusBadge('', 'Kunci Enkripsi kosong: hanya bit accuracy yang ditampilkan'));
    } else {
      dom.resultStatus.appendChild(_statusBadge('fail', `Gagal setelah JPEG QF${qf}` + (failReason ? `: ${failReason}` : '')));
    }
  }

  if (dom.accBefore) {
    dom.accBefore.textContent = _fmtAcc(result.bitAccBefore, accMeaningful);
    dom.accBefore.className   = accMeaningful ? 'metric-value good' : 'metric-value';
  }
  if (dom.accAfter) {
    dom.accAfter.textContent = _fmtAcc(result.bitAccAfter, accMeaningful);
    dom.accAfter.className   = 'metric-value';
  }
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
 * Render ulang seluruh tabel riwayat dari state (sumber kebenaran tunggal);
 * tampilkan placeholder bila kosong.
 */
function _renderHistory() {
  if (!dom.historyTbody) return;
  dom.historyTbody.innerHTML = '';
  const rows = getState().jpegTestHistory || [];

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = HISTORY_COLSPAN;
    td.style.cssText = 'text-align:center;color:var(--ink-soft);font-size:12px;padding:18px;';
    td.textContent = 'Belum ada pengujian dilakukan.';
    tr.appendChild(td);
    dom.historyTbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => dom.historyTbody.appendChild(_buildHistoryRow(row)));
}

function _buildHistoryRow(row) {
  const tr = document.createElement('tr');
  if (row.isBatch) tr.classList.add('batch-row');

  // Gambar
  const tdName = document.createElement('td');
  tdName.textContent = row.imageName || '—';
  tdName.title = row.imageName || '';
  tdName.style.cssText = 'max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  tr.appendChild(tdName);

  // QF
  const tdQf = document.createElement('td');
  tdQf.className   = 'mono';
  tdQf.textContent = row.qf;
  tr.appendChild(tdQf);

  // Status — hasil dekripsi GCM; "—" bila Kunci Enkripsi tidak diisi
  const tdStatus = document.createElement('td');
  if (row.status === STATUS.OK) {
    tdStatus.appendChild(_statusBadge('ok', 'Berhasil'));
  } else if (row.status === STATUS_NA) {
    tdStatus.textContent = '—';
    tdStatus.title = 'Kunci Enkripsi tidak diisi';
  } else {
    tdStatus.appendChild(_statusBadge('fail', 'Gagal'));
  }
  tr.appendChild(tdStatus);

  // Bit Accuracy — "—" bila tidak ada ground truth (header tidak valid)
  const tdAcc = document.createElement('td');
  tdAcc.className   = 'mono';
  tdAcc.textContent = _fmtAcc(row.bitAccAfter, row.accMeaningful);
  if (row.accMeaningful) {
    // Warna hanya penanda perbedaan nilai, bukan klaim kualitas
    tdAcc.style.color = row.bitAccAfter >= 90
      ? 'var(--accent)' : row.bitAccAfter >= 70
      ? 'var(--warn)' : '#e55';
  }
  tr.appendChild(tdAcc);

  // PSNR (stego vs JPEG)
  const tdPsnr = document.createElement('td');
  tdPsnr.className   = 'mono';
  tdPsnr.textContent = row.psnr !== null ? row.psnr + ' dB' : '∞ dB';
  tr.appendChild(tdPsnr);

  return tr;
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

  if (dom.encKey) {
    dom.encKey.addEventListener('input', handleEncKeyInput);
    dom.encKey.value = '';
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
    dom.downloadJpegBtn.disabled = true;  // aktif hanya setelah ada hasil
  }

  // Init state
  batchSetState({ jpegKey: '', jpegEncKey: '', jpegTestResult: null, jpegTestHistory: [] });
  _renderHistory();
}
