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
//   • Tidak ada nilai hardcoded atau threshold subjektif di layer UI.
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
// ── State UI ──────────────────────────────────────────────────────────────────
//   NO_DATA  : belum ada embedding → tampilkan panduan "Lakukan embedding dulu"
//   READY    : coverImage + stegoImage + analysisResult tersedia → tampilkan metrik
//
// ── Acceptance Criteria (Checkpoint 5) ────────────────────────────────────────
//   ✓ MSE/PSNR berasal dari pixel asli, bukan hardcoded
//   ✓ Tidak ada klaim keamanan atau kualitas berdasarkan threshold
//   ✓ Cover dan Stego image dapat dibandingkan secara visual
//   ✓ Nilai konsisten setiap kali state yang sama dianalisis
//   ✓ Halaman tidak meminta upload ulang jika data embedding tersedia

import { getState, subscribe } from '../state.js';

const dom = {};

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
      dom.psnrValue.textContent = _formatPSNR(r.psnr);
      dom.psnrValue.className   = 'metric-value';
    } else {
      dom.psnrValue.textContent = '—';
      dom.psnrValue.className   = 'metric-value';
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
