// controllers/batchTestController.js
//
// Halaman "Pengujian Batch": unggah 5 citra, jalankan 15 skenario (5 citra × 3 ukuran
// pesan), tampilkan tabel hasil, dan ekspor ke XLSX (cadangan CSV).
//
// Controller ini hanya mengurus UI dan state. Seluruh perhitungan ada di
// evaluation/batchRunner.js; pembuatan berkas ada di services/exportService.js.

import { getState, setState } from '../state.js';
import { readImageFile } from '../services/fileService.js';
import { encodeImageToPng } from '../core/imageHandler.js';
import { runBatch, summarizeBatch, computeMessageSizes, BATCH_CONFIG } from '../evaluation/batchRunner.js';
import { BATCH_COLUMNS, cellText, exportXlsx, exportCsv, isXlsxAvailable } from '../services/exportService.js';
import { showError, clearError, formatBytes } from '../utils/uiHelpers.js';
import { CONFIG } from '../config.js';

const dom = {};
let _images  = [];      // ImageMetadata[] — hanya di memori, tidak masuk state
let _running = false;

// ---------------------------------------------------------------------------
// PNG round-trip (butuh DOM, karena itu ada di controller — bukan di runner)
// ---------------------------------------------------------------------------
function _decodePngDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      } catch (e) {
        reject(new Error('Gagal membaca piksel PNG hasil encode.'));
      }
    };
    img.onerror = () => reject(new Error('PNG hasil encode tidak dapat didecode oleh browser.'));
    img.src = dataUrl;
  });
}

async function roundTripPng(imageData) {
  return _decodePngDataUrl(await encodeImageToPng(imageData));
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
function cacheDom() {
  const page = document.getElementById('page-batch');
  dom.page       = page;
  dom.dropzone   = page.querySelector('#batch-dropzone');
  dom.fileInput  = page.querySelector('#batch-file-input');
  dom.fileList   = page.querySelector('#batch-file-list');
  dom.sizeInfo   = page.querySelector('#batch-size-info');
  dom.notice     = page.querySelector('#batch-notice');
  dom.runBtn     = page.querySelector('#batch-run-btn');
  dom.progress   = page.querySelector('#batch-progress');
  dom.progressFill = page.querySelector('#batch-progress-fill');
  dom.progressText = page.querySelector('#batch-progress-text');
  dom.summary    = page.querySelector('#batch-summary');
  dom.thead      = page.querySelector('#batch-thead');
  dom.tbody      = page.querySelector('#batch-tbody');
  dom.xlsxBtn    = page.querySelector('#batch-export-xlsx');
  dom.csvBtn     = page.querySelector('#batch-export-csv');
}

// ---------------------------------------------------------------------------
// Tabel
// ---------------------------------------------------------------------------
function _escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHead() {
  // Baris 1: kelompok (χ² Cover / χ² Stego); baris 2: R, G, B.
  const top = [];
  const bottom = [];
  for (let i = 0; i < BATCH_COLUMNS.length; i++) {
    const c = BATCH_COLUMNS[i];
    if (c.group) {
      if (BATCH_COLUMNS[i - 1] && BATCH_COLUMNS[i - 1].group === c.group) continue;
      const span = BATCH_COLUMNS.filter((x) => x.group === c.group).length;
      top.push(`<th colspan="${span}" class="batch-group">${_escape(c.group)}</th>`);
      BATCH_COLUMNS.filter((x) => x.group === c.group)
        .forEach((x) => bottom.push(`<th>${_escape(x.header)}</th>`));
    } else {
      top.push(`<th rowspan="2">${_escape(c.header)}</th>`);
    }
  }
  dom.thead.innerHTML = `<tr>${top.join('')}</tr><tr>${bottom.join('')}</tr>`;
}

function renderRows(rows) {
  if (!rows.length) {
    dom.tbody.innerHTML =
      `<tr><td colspan="${BATCH_COLUMNS.length}" class="ana-empty">Belum ada pengujian dijalankan.</td></tr>`;
    return;
  }
  dom.tbody.innerHTML = rows.map((row) => {
    const cells = BATCH_COLUMNS.map((c) => {
      const text = _escape(cellText(c, row));
      if (c.key === 'status') {
        return `<td><span class="batch-chip ${row.extractionOk ? 'ok' : 'fail'}">${text}</span></td>`;
      }
      if (c.key === 'psnrOk' && !row.psnrOk) return `<td class="batch-bad">${text}</td>`;
      return `<td>${text}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
}

function renderSummary(rows) {
  if (!rows.length) {
    dom.summary.style.display = 'none';
    dom.summary.textContent = '';
    return;
  }
  const s = summarizeBatch(rows);
  const pass = s.allExtracted && s.allPsnrOk;
  dom.summary.style.display = '';
  dom.summary.className = 'batch-summary ' + (pass ? 'ok' : 'fail');
  dom.summary.textContent =
    `${s.extractionOk} dari ${s.total} ekstraksi PNG berhasil · ` +
    `PSNR minimum ${s.minPsnr === null ? '—' : s.minPsnr.toFixed(BATCH_CONFIG.decimals.psnr) + ' dB'} · ` +
    (s.allPsnrOk ? `semua ≥ ${CONFIG.psnrThresholdDb} dB` : `ada yang di bawah ${CONFIG.psnrThresholdDb} dB`);
}

// ---------------------------------------------------------------------------
// Status tombol
// ---------------------------------------------------------------------------
function updateControls() {
  const hasResults = getState().batchResults.length > 0;
  const ready = _images.length === BATCH_CONFIG.imageCount;

  dom.runBtn.disabled = _running || !ready;
  dom.runBtn.textContent = _running ? 'Menjalankan…' : 'Jalankan 15 Skenario';
  // Ekspor hanya aktif bila batch sudah selesai dijalankan.
  dom.xlsxBtn.disabled = _running || !hasResults;
  dom.csvBtn.disabled  = _running || !hasResults;
}

function renderFileList() {
  if (!_images.length) {
    dom.fileList.innerHTML = '<div class="help">Belum ada citra dipilih.</div>';
    dom.sizeInfo.style.display = 'none';
    return;
  }
  dom.fileList.innerHTML = _images.map((m) =>
    `<div class="batch-file"><span class="mono">${_escape(m.name)}</span>` +
    `<span>${m.width}×${m.height} · ${formatBytes(m.size)}</span></div>`
  ).join('');

  const need = BATCH_CONFIG.imageCount;
  const notice = [];
  if (_images.length !== need) {
    notice.push(`Dipilih ${_images.length} citra; dibutuhkan tepat ${need}.`);
  }
  const big = _images.filter((m) => m.width * m.height > BATCH_CONFIG.warnPixels);
  if (big.length) {
    notice.push(
      `${big.length} citra lebih dari ${(BATCH_CONFIG.warnPixels / 1e6).toFixed(0)} megapiksel. ` +
      'Proses bisa lambat dan memakai banyak memori; perkecil citra bila browser terasa macet.'
    );
  }
  dom.notice.style.display = notice.length ? '' : 'none';
  dom.notice.textContent = notice.join(' ');

  // Ukuran pesan yang akan dipakai, dari citra terkecil.
  try {
    const smallest = _images.reduce((a, b) => (a.width * a.height <= b.width * b.height ? a : b));
    const specs = computeMessageSizes(smallest.width * smallest.height * 3);
    dom.sizeInfo.style.display = '';
    dom.sizeInfo.textContent =
      `Citra terkecil: ${smallest.name} (${smallest.width}×${smallest.height}). Isi pesan: ` +
      specs.map((s) => `${s.label} = ${s.messageBytes} byte`).join(' · ') + '.';
  } catch (err) {
    dom.sizeInfo.style.display = '';
    dom.sizeInfo.textContent = err.message;
  }
}

// ---------------------------------------------------------------------------
// Unggah
// ---------------------------------------------------------------------------
async function loadFiles(fileList) {
  clearError(dom.page);
  const files = Array.from(fileList || []);
  if (!files.length) return;

  try {
    const metas = [];
    for (const f of files) metas.push(await readImageFile(f));   // memvalidasi PNG/BMP + decode
    const names = new Set(metas.map((m) => m.name));
    if (names.size !== metas.length) throw new Error('Nama file citra harus unik.');

    _images = metas;
    setState('batchResults', []);      // citra baru → hasil lama tidak berlaku lagi
    renderRows([]);
    renderSummary([]);
    dom.progress.style.display = 'none';
  } catch (err) {
    showError(dom.page, err.message);
  }
  renderFileList();
  updateControls();
}

// ---------------------------------------------------------------------------
// Jalankan
// ---------------------------------------------------------------------------
async function handleRun() {
  clearError(dom.page);
  if (_running) return;
  if (_images.length !== BATCH_CONFIG.imageCount) {
    showError(dom.page, `Pilih tepat ${BATCH_CONFIG.imageCount} citra terlebih dahulu.`);
    return;
  }
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    showError(dom.page, 'Web Crypto tidak tersedia. Jalankan aplikasi lewat http://localhost atau https://.');
    return;
  }

  _running = true;
  setState('batchResults', []);
  renderRows([]);
  renderSummary([]);
  dom.progress.style.display = '';
  dom.progressFill.style.width = '0%';
  dom.progressText.textContent = 'Memulai…';
  updateControls();

  try {
    const total = _images.length * BATCH_CONFIG.messageSizes.length;
    const rows = await runBatch({
      images: _images.map((m) => ({ name: m.name, width: m.width, height: m.height, imageData: m.imageData })),
      roundTripPng,
      onProgress: (done, tot, row) => {
        dom.progressFill.style.width = `${Math.round((done / tot) * 100)}%`;
        dom.progressText.textContent =
          `Skenario ${done}/${tot} selesai (${row.imageName}, ${row.messageLabel})`;
      },
    });
    setState('batchResults', rows);
    renderRows(rows);
    renderSummary(rows);
    dom.progressText.textContent = `Selesai: ${rows.length}/${total} skenario.`;
  } catch (err) {
    showError(dom.page, err.message);
    dom.progressText.textContent = 'Dihentikan karena kesalahan.';
  } finally {
    _running = false;
    updateControls();
  }
}

// ---------------------------------------------------------------------------
// Ekspor
// ---------------------------------------------------------------------------
function handleExportXlsx() {
  clearError(dom.page);
  const rows = getState().batchResults;
  if (!rows.length) return;
  try {
    exportXlsx(rows);
  } catch (err) {
    showError(dom.page, err.message);
    if (!isXlsxAvailable()) dom.csvBtn.focus();
  }
}

function handleExportCsv() {
  const rows = getState().batchResults;
  if (!rows.length) return;
  exportCsv(rows);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initBatchTestController() {
  cacheDom();
  renderHead();
  renderRows([]);
  renderFileList();
  renderSummary([]);
  dom.progress.style.display = 'none';
  updateControls();

  dom.dropzone.addEventListener('click', () => dom.fileInput.click());
  dom.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dom.dropzone.classList.add('dragover'); });
  dom.dropzone.addEventListener('dragleave', () => dom.dropzone.classList.remove('dragover'));
  dom.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.dropzone.classList.remove('dragover');
    loadFiles(e.dataTransfer.files);
  });
  dom.fileInput.addEventListener('change', () => {
    loadFiles(dom.fileInput.files);
    dom.fileInput.value = '';         // izinkan memilih ulang file yang sama
  });

  dom.runBtn.addEventListener('click', handleRun);
  dom.xlsxBtn.addEventListener('click', handleExportXlsx);
  dom.csvBtn.addEventListener('click', handleExportCsv);
}
