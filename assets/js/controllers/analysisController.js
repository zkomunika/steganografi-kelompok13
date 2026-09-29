// controllers/analysisController.js
//
// Application layer untuk halaman Image Analysis.
//
// ── Tanggung Jawab ────────────────────────────────────────────────────────────
// Halaman ini TIDAK menghitung MSE/PSNR sendiri. Ia hanya membaca hasil
// komputasi yang sudah dilakukan oleh embeddingController dan disimpan ke
// state.analysisResult. Dengan demikian:
//   • Nilai MSE/PSNR selalu konsisten (dihitung satu kali, ditampilkan di mana saja).
//   • Tidak ada upload ulang yang diperlukan selama sesi browser yang sama.
//   • Ambang PSNR tidak di-hardcode di UI; berasal dari CONFIG.psnrThresholdDb.
//
// ── Sumber Data ───────────────────────────────────────────────────────────────
//   state.coverImage      → preview cover image + ukuran file asli
//   state.stegoImage      → preview stego image + ukuran file stego
//   state.analysisResult  → { mse, psnr, fileSizeDeltaKb, summary }
//     Diisi oleh embeddingController.js setelah embedding berhasil.
//     mse dan psnr berasal langsung dari calculateMSE() dan calculatePSNR().
//
// ── Rumus yang Digunakan (dari dokumen penelitian) ────────────────────────────
//   MSE  = (1/(W×H×C)) × Σ [I(c) − K(c)]²
//   PSNR = 20 × log₁₀(255 / √MSE)
//
// ── Steganalisis (Checkpoint 3) ───────────────────────────────────────────────
// Histogram RGB, bidang LSB, dan chi-square Westfeld–Pfitzmann dihitung dari
// piksel cover (state.coverImage.imageData) dan stego (state.stegoImage.imageData)
// oleh modul murni di evaluation/ dan core/; controller ini hanya memanggil dan
// menampilkan. Hasil di-cache per pasangan imageData agar ketikan di halaman
// lain (yang memicu subscribe) tidak menghitung ulang.
//
// ── State UI ──────────────────────────────────────────────────────────────────
//   NO_DATA  : belum ada embedding → tampilkan panduan "Lakukan embedding dulu"
//   READY    : coverImage + stegoImage + analysisResult tersedia → tampilkan metrik
//
// ── Acceptance Criteria (Checkpoint 5) ────────────────────────────────────────
//   ✓ MSE/PSNR berasal dari pixel asli, bukan hardcoded
//   ✓ Label kualitas PSNR memakai ambang juknis (CONFIG.psnrThresholdDb = 30 dB)
//   ✓ Tidak ada klaim keamanan; chi-square ditampilkan sebagai indikator statistik
//   ✓ Cover dan Stego image dapat dibandingkan secara visual
//   ✓ Nilai konsisten setiap kali state yang sama dianalisis
//   ✓ Halaman tidak meminta upload ulang jika data embedding tersedia

import { getState, subscribe } from '../state.js';
import { PAGES } from '../constants.js';
import { classifyPSNR } from '../evaluation/psnrCalculator.js';
import { computeHistogram, compareHistograms, CHANNEL_KEYS } from '../evaluation/histogramCalculator.js';
import { analyzeChiSquare } from '../evaluation/chiSquareAnalyzer.js';
import { lsbPlaneToImage, lsbDiffToImage, compareLsbPlanes } from '../core/lsbPlaneExtractor.js';
import { drawHistogram, drawImagePlane, clearCanvas, CHANNEL_COLORS } from '../utils/chartRenderer.js';

const dom = {};

// Cache steganalisis: dihitung ulang hanya bila referensi imageData berganti.
let _cache = { cover: null, stego: null, hist: null, histDiff: null, chi: null };
let _lsbChannel = 'rgb';

// ---------------------------------------------------------------------------
// DOM cache
// ---------------------------------------------------------------------------
function cacheDom() {
  const page = document.getElementById('page-analysis');
  dom.page           = page;
  dom.coverPreview   = page.querySelector('#ana-cover-preview');
  dom.stegoPreview   = page.querySelector('#ana-stego-preview');
  dom.coverSizeLabel = page.querySelector('#ana-cover-size');
  dom.stegoSizeLabel = page.querySelector('#ana-stego-size');
  dom.mseValue       = page.querySelector('#ana-mse');
  dom.psnrValue      = page.querySelector('#ana-psnr');
  dom.fileDeltaValue = page.querySelector('#ana-filedelta');
  dom.summaryText    = page.querySelector('#ana-summary');
  dom.psnrNote       = page.querySelector('#ana-psnr-note');

  dom.histSummary    = page.querySelector('#ana-hist-summary');
  dom.histTotal      = page.querySelector('#ana-hist-total');
  dom.histCanvas     = {};
  for (const ch of CHANNEL_KEYS) {
    dom.histCanvas[ch] = {
      cover: page.querySelector('#ana-hist-cover-' + ch),
      stego: page.querySelector('#ana-hist-stego-' + ch),
    };
  }

  dom.lsbTabs        = page.querySelector('#ana-lsb-tabs');
  dom.lsbCover       = page.querySelector('#ana-lsb-cover');
  dom.lsbStego       = page.querySelector('#ana-lsb-stego');
  dom.lsbDiff        = page.querySelector('#ana-lsb-diff');
  dom.lsbPct         = page.querySelector('#ana-lsb-pct');
  dom.lsbCount       = page.querySelector('#ana-lsb-count');
  dom.lsbPerCh       = page.querySelector('#ana-lsb-perch');
  dom.lsbSpread      = page.querySelector('#ana-lsb-spread');

  dom.chiBody        = page.querySelector('#ana-chi-body');
}

// ---------------------------------------------------------------------------
// Render utama — dipanggil setiap state berubah
// ---------------------------------------------------------------------------
function _render(state) {
  const hasCover    = !!state.coverImage;
  const hasStego    = !!state.stegoImage;
  const hasAnalysis = !!state.analysisResult;

  // ── Previews ──────────────────────────────────────────────────────────────
  _renderImagePreview(dom.coverPreview, state.coverImage, 'Cover Image');
  _renderImagePreview(dom.stegoPreview, state.stegoImage, 'Stego Image');

  // ── Ukuran file ───────────────────────────────────────────────────────────
  if (dom.coverSizeLabel) {
    dom.coverSizeLabel.textContent = hasCover
      ? _formatBytes(state.coverImage.size) : '—';
  }
  if (dom.stegoSizeLabel) {
    dom.stegoSizeLabel.textContent = hasStego
      ? _formatBytes(state.stegoImage.size) : '—';
  }

  // ── Steganalisis (histogram, bidang LSB, chi-square) ──────────────────────
  _renderSteganalysis(state);

  // ── Metrik kualitas ───────────────────────────────────────────────────────
  if (!hasAnalysis) {
    _renderNoData();
    return;
  }

  const r = state.analysisResult;

  // MSE — tampilkan nilai aktual tanpa label interpretatif
  if (dom.mseValue) {
    if (r.mse !== null && r.mse !== undefined) {
      // Format 6 desimal untuk presisi pada nilai MSE kecil (< 1)
      dom.mseValue.textContent = _formatMSE(r.mse);
      dom.mseValue.className   = 'metric-value';
    } else {
      dom.mseValue.textContent = '—';
      dom.mseValue.className   = 'metric-value';
    }
  }

  // PSNR — tampilkan nilai dB aktual; ∞ jika MSE = 0
  if (dom.psnrValue) {
    if (r.psnr !== null && r.psnr !== undefined) {
      const q = classifyPSNR(r.psnr);
      dom.psnrValue.textContent = _formatPSNR(r.psnr);
      dom.psnrValue.className   = 'metric-value ' + (q.meets ? 'good' : 'warn');
      if (dom.psnrNote) dom.psnrNote.textContent = q.label;
    } else {
      dom.psnrValue.textContent = '—';
      dom.psnrValue.className   = 'metric-value';
      if (dom.psnrNote) dom.psnrNote.textContent = '';
    }
  }

  // Selisih ukuran file
  if (dom.fileDeltaValue) {
    if (r.fileSizeDeltaKb !== null && r.fileSizeDeltaKb !== undefined) {
      const delta    = Number(r.fileSizeDeltaKb);
      const sign     = delta >= 0 ? '+' : '';
      const absStr   = Math.abs(delta) < 0.1 && delta !== 0
        ? (delta > 0 ? '<+0.1' : '<-0.1')
        : sign + delta.toFixed(1);
      dom.fileDeltaValue.textContent = absStr + ' KB';
    } else {
      dom.fileDeltaValue.textContent = '—';
    }
  }

  // Ringkasan — teks faktual dari state, bukan dihasilkan di sini
  if (dom.summaryText) {
    dom.summaryText.textContent = r.summary
      || 'Tidak ada ringkasan tersedia.';
  }
}

// ---------------------------------------------------------------------------
// No-data state
// ---------------------------------------------------------------------------
function _renderNoData() {
  const dash = (el) => { if (el) { el.textContent = '—'; el.className = 'metric-value'; } };
  dash(dom.mseValue);
  dash(dom.psnrValue);
  dash(dom.fileDeltaValue);
  if (dom.psnrNote) dom.psnrNote.textContent = '';
  if (dom.summaryText) {
    dom.summaryText.textContent =
      'Lakukan proses Embedding terlebih dahulu untuk melihat ringkasan analisis citra.';
  }
}

// ---------------------------------------------------------------------------
// Image preview
// ---------------------------------------------------------------------------
/**
 * Render satu preview image ke dalam container .pixel-frame.
 * Jika data tidak tersedia, tampilkan placeholder teks.
 *
 * @param {Element|null} container  – DOM element .pixel-frame
 * @param {object|null}  imageMeta  – ImageMetadata dari state
 * @param {string}       label      – label fallback
 */
function _renderImagePreview(container, imageMeta, label) {
  if (!container) return;

  if (!imageMeta || !imageMeta.dataUrl) {
    // Hanya update teks jika belum ada gambar (hindari flicker)
    if (!container.querySelector('img')) {
      container.textContent = 'Belum tersedia';
    }
    return;
  }

  // Cek apakah sudah menampilkan gambar yang sama (hindari re-render tidak perlu)
  const existingImg = container.querySelector('img');
  if (existingImg && existingImg.dataset.src === imageMeta.dataUrl) return;

  container.innerHTML = '';
  const img          = document.createElement('img');
  img.src            = imageMeta.dataUrl;
  img.alt            = label;
  img.dataset.src    = imageMeta.dataUrl;   // marker untuk skip re-render
  img.style.cssText  = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  container.appendChild(img);
}


// ---------------------------------------------------------------------------
// Steganalisis
// ---------------------------------------------------------------------------
const CH_LABEL = { r: 'R', g: 'G', b: 'B' };
const nf = new Intl.NumberFormat('id-ID');

function _hasPixels(meta) {
  return !!(meta && meta.imageData && meta.imageData.data);
}

function _clearSteganalysis() {
  _cache = { cover: null, stego: null, hist: null, histDiff: null, chi: null };
  for (const ch of CHANNEL_KEYS) {
    clearCanvas(dom.histCanvas[ch].cover);
    clearCanvas(dom.histCanvas[ch].stego);
  }
  [dom.lsbCover, dom.lsbStego, dom.lsbDiff].forEach(clearCanvas);
  const empty = (n) => `<tr><td colspan="${n}" class="ana-empty">Belum ada data.</td></tr>`;
  if (dom.histSummary) dom.histSummary.innerHTML = empty(4);
  if (dom.chiBody)     dom.chiBody.innerHTML     = empty(7);
  if (dom.histTotal)   dom.histTotal.textContent = '';
  [dom.lsbPct, dom.lsbPerCh, dom.lsbSpread].forEach((el) => { if (el) el.textContent = '—'; });
  if (dom.lsbCount) dom.lsbCount.textContent = '';
}

function _renderSteganalysis(state) {
  // Hitungan berat hanya saat halaman Analysis aktif.
  if (state.navigation.currentPage !== PAGES.ANALYSIS) return;

  if (!_hasPixels(state.coverImage) || !_hasPixels(state.stegoImage)) {
    _clearSteganalysis();
    return;
  }

  const cover = state.coverImage.imageData;
  const stego = state.stegoImage.imageData;

  if (cover.width !== stego.width || cover.height !== stego.height) {
    _clearSteganalysis();
    if (dom.histTotal) dom.histTotal.textContent = 'Dimensi cover dan stego berbeda; steganalisis dilewati.';
    return;
  }

  if (_cache.cover !== cover || _cache.stego !== stego) {
    const hc = computeHistogram(cover);
    const hs = computeHistogram(stego);
    _cache = {
      cover, stego,
      hist:     { cover: hc, stego: hs },
      histDiff: compareHistograms(hc, hs),
      chi:      { cover: analyzeChiSquare(hc), stego: analyzeChiSquare(hs) },
    };
    _drawHistograms();
    _renderHistogramSummary();
    _renderChiSquare();
  }
  _renderLsbPlanes(cover, stego);
}

function _drawHistograms() {
  const { cover, stego } = _cache.hist;
  for (const ch of CHANNEL_KEYS) {
    // skala vertikal bersama agar cover & stego sebanding
    let yMax = 0;
    for (let i = 0; i < 256; i++) yMax = Math.max(yMax, cover[ch][i], stego[ch][i]);
    drawHistogram(dom.histCanvas[ch].cover, cover[ch], { color: CHANNEL_COLORS[ch], label: CH_LABEL[ch] + ' — cover', yMax });
    drawHistogram(dom.histCanvas[ch].stego, stego[ch], { color: CHANNEL_COLORS[ch], label: CH_LABEL[ch] + ' — stego', yMax });
  }
}

function _renderHistogramSummary() {
  const d = _cache.histDiff;
  dom.histSummary.innerHTML = CHANNEL_KEYS.map((ch) =>
    `<tr><td>${CH_LABEL[ch]}</td>` +
    `<td>${d[ch].changedBins} / 256</td>` +
    `<td>${nf.format(d[ch].maxAbsDiff)}</td>` +
    `<td>${nf.format(d[ch].totalAbsDiff)}</td></tr>`
  ).join('');
  dom.histTotal.textContent =
    `Total bin berubah: ${d.totalChangedBins} dari ${d.totalBins} (3 kanal × 256). ` +
    `Jumlah bin per kanal = ${nf.format(_cache.hist.cover.pixelCount)} piksel (lebar × tinggi).`;
}

function _renderLsbPlanes(cover, stego) {
  const ch = _lsbChannel;
  drawImagePlane(dom.lsbCover, lsbPlaneToImage(cover, ch));
  drawImagePlane(dom.lsbStego, lsbPlaneToImage(stego, ch));
  drawImagePlane(dom.lsbDiff,  lsbDiffToImage(cover, stego, ch));

  const cmp = compareLsbPlanes(cover, stego, ch);
  const unit = ch === 'rgb' ? 'bit LSB (R+G+B)' : 'bit LSB kanal ' + CH_LABEL[ch];
  dom.lsbPct.textContent   = _formatPct(cmp.selected.pct);
  dom.lsbCount.textContent = `${nf.format(cmp.selected.changed)} dari ${nf.format(cmp.selected.total)} ${unit}`;
  dom.lsbPerCh.textContent = CHANNEL_KEYS.map((k) => _formatPct(cmp.perChannel[k].pct)).join(' / ');
  dom.lsbSpread.textContent = `${cmp.grid.nonEmptyCells} / ${cmp.grid.totalCells}`;

  dom.lsbTabs.querySelectorAll('.ana-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.channel === ch));
}

function _renderChiSquare() {
  const { cover, stego } = _cache.chi;
  const cells = (r) =>
    `<td>${_formatChi(r.chi2)}</td><td>${r.df}</td><td>${_formatP(r.pValue)}</td>`;
  dom.chiBody.innerHTML = CHANNEL_KEYS.map((ch) =>
    `<tr><td>${CH_LABEL[ch]}</td>${cells(cover[ch])}${cells(stego[ch])}</tr>`
  ).join('');
}

function _formatPct(pct) {
  if (pct === 0) return '0%';
  if (pct < 0.01) return '<0,01%';
  return pct.toFixed(pct < 10 ? 3 : 2).replace('.', ',') + '%';
}

function _formatChi(x) {
  if (x === 0) return '0';
  return x >= 1e6 ? x.toExponential(3) : x.toFixed(2);
}

function _formatP(p) {
  if (p === null || p === undefined) return '—';
  if (p === 0) return '<1e-300';
  if (p < 1e-4) return p.toExponential(2);
  return p.toFixed(4);
}

// ---------------------------------------------------------------------------
// Format helpers — nilai faktual, tanpa interpretasi
// ---------------------------------------------------------------------------

/**
 * Format nilai MSE.
 * Nilai LSB-steganography biasanya kecil (0.001 – 0.5), sehingga
 * ditampilkan dengan 6 desimal untuk presisi.
 * Jika MSE = 0, tampilkan "0" (cover dan stego identik).
 */
function _formatMSE(mse) {
  if (mse === 0) return '0';
  if (mse < 0.001)  return mse.toExponential(4);
  if (mse < 1)      return mse.toFixed(6);
  if (mse < 10)     return mse.toFixed(4);
  return mse.toFixed(2);
}

/**
 * Format nilai PSNR dalam satuan dB.
 * Menampilkan nilai aktual hasil perhitungan tanpa label interpretatif.
 */
function _formatPSNR(psnr) {
  if (!isFinite(psnr)) return '∞ dB';
  return psnr.toFixed(2) + ' dB';
}

function _formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024)          return bytes + ' B';
  if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initAnalysisController() {
  cacheDom();

  // Pemilih kanal bidang LSB
  if (dom.lsbTabs) {
    dom.lsbTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.ana-tab');
      if (!btn) return;
      _lsbChannel = btn.dataset.channel;
      _render(getState());
    });
  }

  // Render awal dari state yang mungkin sudah ada
  // (misalnya user navigasi ke halaman Analysis setelah embedding selesai)
  _render(getState());

  // Langganan state — re-render otomatis setiap kali embeddingController
  // atau controller lain memperbarui state.coverImage, stegoImage, analysisResult
  subscribe((state) => _render(state));
}

// Diekspos untuk debugging / testing eksternal (tidak diperlukan oleh pipeline)
export function getAnalysisMetrics() {
  return getState().analysisResult;
}
