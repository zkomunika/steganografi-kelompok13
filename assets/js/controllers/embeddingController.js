// controllers/embeddingController.js
//
// Application layer untuk halaman Embedding.
// Mengorkestrasi seluruh pipeline embedding tanpa mengandung logika algoritma.
//
// Pipeline (sesuai spesifikasi Checkpoint 3):
//   Input validation
//   → Encode message (messageBitConverter)
//   → Generate PRNG sequence from Stego-Key (prngStegoKeyGenerator)
//   → Select pixel positions (pixelPositionSelector)
//   → Embed bits into RGB LSB (lsbEmbeddingEngine)
//   → Encode result to PNG (imageHandler)
//   → Calculate MSE/PSNR (mseCalculator / psnrCalculator)
//   → Update application state
//   → Update UI

import { getState, setState, batchSetState, subscribe } from '../state.js';
import { pickImageFile, readImageFile } from '../services/fileService.js';
import { decodeImage, encodeImageToPng, getCapacityInfo } from '../core/imageHandler.js';
import { messageToBits }                                   from '../core/messageBitConverter.js';
import { generateSlotSequence }                            from '../core/pixelPositionSelector.js';
import { embedBits }                                       from '../core/lsbEmbeddingEngine.js';
import { calculateMSE }                                    from '../evaluation/mseCalculator.js';
import { calculatePSNR, formatPSNR }                       from '../evaluation/psnrCalculator.js';
import { downloadImage }                                   from '../utils/imageFileHandler.js';
import { showError, clearError }                           from '../utils/uiHelpers.js';
import { ERROR }                                           from '../constants.js';
import { CONFIG }                                          from '../config.js';

// ---------------------------------------------------------------------------
// DOM cache
// ---------------------------------------------------------------------------
const dom = {};

function cacheDom() {
  const page = document.getElementById('page-embedding');

  dom.page           = page;
  dom.dropzone       = page.querySelector('#emb-dropzone');
  dom.fname          = page.querySelector('#emb-fname');
  dom.coverPreview   = page.querySelector('#emb-cover-preview');
  dom.coverDimLabel  = page.querySelector('#emb-cover-dim');
  dom.stegoPreview   = page.querySelector('#emb-stego-preview');
  dom.stegoDimLabel  = page.querySelector('#emb-stego-dim');

  dom.message        = page.querySelector('#emb-message');
  dom.stegoKey       = page.querySelector('#emb-key');

  dom.capacityFill   = page.querySelector('#emb-capacity-fill');
  dom.capacityHelp   = page.querySelector('#emb-capacity-help');

  dom.embedBtn       = page.querySelector('#emb-btn');
  dom.downloadBtn    = page.querySelector('#emb-download-btn');
  dom.analysisBtn    = page.querySelector('#emb-analysis-btn');

  // Metadata fields
  dom.metaPanel      = page.querySelector('#emb-meta-panel');
  dom.metaWidth      = page.querySelector('#emb-meta-width');
  dom.metaHeight     = page.querySelector('#emb-meta-height');
  dom.metaFormat     = page.querySelector('#emb-meta-format');
  dom.metaSize       = page.querySelector('#emb-meta-size');
  dom.metaChannels   = page.querySelector('#emb-meta-channels');

  // Result metrics
  dom.mseValue       = page.querySelector('#emb-mse');
  dom.psnrValue      = page.querySelector('#emb-psnr');
  dom.fileSizeValue  = page.querySelector('#emb-filesize');

  // Stepper
  dom.stepper        = page.querySelector('.stepper');
}

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------
async function handlePickCoverImage() {
  clearError(dom.page);
  try {
    const file = await pickImageFile();
    const meta = await readImageFile(file);   // validates + decodes pixels

    batchSetState({
      coverImage:      meta,
      embeddingResult: null,
      stegoImage:      null,
    });

    if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;

    _renderCoverPreview(meta);
    _renderMetadata(meta);
    _resetResultPanel();
    _updateCapacity();

  } catch (err) {
    showError(dom.page, err.message);
    console.warn('[EmbeddingController] cover image error:', err.message);
  }
}

function handleDrop(event) {
  event.preventDefault();
  dom.dropzone.classList.remove('dragover');
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;

  readImageFile(file)
    .then((meta) => {
      batchSetState({ coverImage: meta, embeddingResult: null, stegoImage: null });
      if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
      _renderCoverPreview(meta);
      _renderMetadata(meta);
      _resetResultPanel();
      _updateCapacity();
    })
    .catch((err) => showError(dom.page, err.message));
}

// ---------------------------------------------------------------------------
// Message & key inputs
// ---------------------------------------------------------------------------
function handleMessageInput() {
  const message = dom.message ? dom.message.value : '';
  const bits    = message.length > 0 ? messageToBits(message) : [];

  batchSetState({ secretMessage: message, messageBits: bits });
  _updateCapacity();
}

function handleKeyInput() {
  setState('stegoKey', dom.stegoKey ? dom.stegoKey.value : '');
}

// ---------------------------------------------------------------------------
// Capacity bar
// ---------------------------------------------------------------------------
function _updateCapacity() {
  const st = getState();

  let decodedImage = null;
  try {
    if (st.coverImage) decodedImage = decodeImage(st.coverImage);
  } catch { /* no image yet */ }

  const info = getCapacityInfo(decodedImage, st.messageBits);
  setState('capacity', info);
  _renderCapacityBar(info, st.secretMessage, decodedImage);
}

function _renderCapacityBar(info, message, decodedImage) {
  if (!dom.capacityFill || !dom.capacityHelp) return;

  const pct        = info.pct;
  const usedChars  = message ? message.length : 0;
  const totalChars = decodedImage
    ? Math.floor((decodedImage.width * decodedImage.height * 3) / 8) - 4
    : 0;

  let colour = 'var(--accent)';
  if (pct >= CONFIG.capacityThresholds.danger) colour = 'var(--warn)';
  else if (pct >= CONFIG.capacityThresholds.warn) colour = '#D08B3A';

  dom.capacityFill.style.width      = `${Math.min(pct, 100)}%`;
  dom.capacityFill.style.background = colour;

  if (!decodedImage) {
    dom.capacityHelp.textContent = 'Upload cover image untuk melihat kapasitas.';
    return;
  }
  if (usedChars === 0) {
    dom.capacityHelp.textContent = `Kapasitas tersedia: ~${totalChars.toLocaleString()} karakter.`;
    return;
  }

  dom.capacityHelp.textContent = info.valid
    ? `${usedChars.toLocaleString()} / ${totalChars.toLocaleString()} karakter (${pct}% kapasitas)`
    : `⚠ Pesan terlalu panjang (${usedChars.toLocaleString()} / ${totalChars.toLocaleString()} karakter)`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function validateEmbeddingInputs() {
  const st = getState();
  if (!st.coverImage || !st.coverImage.imageData) throw new Error(ERROR.NO_IMAGE);
  if (!st.secretMessage || st.secretMessage.trim().length === 0) throw new Error(ERROR.EMPTY_MESSAGE);
  if (!st.stegoKey || st.stegoKey.trim().length === 0) throw new Error(ERROR.EMPTY_KEY);
  if (st.capacity && !st.capacity.valid && st.capacity.usedBits > 0) throw new Error(ERROR.MESSAGE_TOO_LONG);
}

// ---------------------------------------------------------------------------
// Embed pipeline
// ---------------------------------------------------------------------------
async function handleEmbed() {
  clearError(dom.page);

  // 1. Input validation
  try {
    validateEmbeddingInputs();
  } catch (err) {
    showError(dom.page, err.message);
    return;
  }

  // Disable button selama proses berjalan
  if (dom.embedBtn) {
    dom.embedBtn.disabled    = true;
    dom.embedBtn.textContent = 'Memproses…';
  }

  try {
    const st = getState();

    // 2. Decode cover image ke pixel buffer
    const coverDecoded  = decodeImage(st.coverImage);
    const coverImageData = coverDecoded.imageData;
    const totalSlots    = coverDecoded.width * coverDecoded.height * 3;

    // 3. Encode message → bit array
    //    Skema: [32-bit length prefix][UTF-8 payload] — MSB first per byte
    const bits      = messageToBits(st.secretMessage);
    const bitCount  = bits.length;

    // 4. Generate PRNG-based slot sequence dari Stego-Key
    //    (Fisher-Yates dengan Xorshift32 — tidak ada Math.random())
    const slotSequence = generateSlotSequence(st.stegoKey, totalSlots, bitCount);

    // 5. LSB Embedding: P' = (P & 254) | b
    //    Menghasilkan ImageData baru; cover image tidak termutasi
    const stegoImageData = embedBits(coverImageData, bits, slotSequence);

    // 6. Encode stego ImageData → PNG data URL
    const stegoDataUrl = await encodeImageToPng(stegoImageData);

    // 7. Hitung MSE dan PSNR
    const mse  = calculateMSE(coverImageData, stegoImageData);
    const psnr = calculatePSNR(mse);

    // 8. Bangun metadata stego image
    const stegoMeta = {
      name:      'stego_' + st.coverImage.name.replace(/\.[^.]+$/, '') + '.png',
      // Ukuran file stego (estimasi dari data URL length)
      size:      Math.round(stegoDataUrl.length * 0.75),  // base64 → bytes approx
      width:     coverDecoded.width,
      height:    coverDecoded.height,
      format:    'png',
      channels:  3,
      dataUrl:   stegoDataUrl,
      imageData: stegoImageData,
    };

    // 9. Update state
    const embeddingResult = {
      success:         true,
      mse,
      psnr,
      bitsEmbedded:    bitCount,
      totalSlots,
      stegoImageData,
    };

    batchSetState({
      stegoImage:      stegoMeta,
      embeddingResult,
      analysisResult: {
        mse,
        psnr,
        fileSizeDeltaKb: ((stegoMeta.size - st.coverImage.size) / 1024).toFixed(1) * 1,
        summary: _buildAnalysisSummary(mse, psnr, bitCount, coverDecoded),
      },
    });

    // 10. Update UI
    _renderStegoPreview(stegoMeta);
    _renderResultMetrics(mse, psnr, stegoMeta, st.coverImage);
    _updateStepperToResult();

    if (dom.downloadBtn) dom.downloadBtn.disabled = false;

    console.info(
      `[EmbeddingController] Embedding selesai — ` +
      `${bitCount} bit disisipkan ke ${bitCount} slot acak dari ${totalSlots} slot tersedia. ` +
      `MSE=${mse.toFixed(4)}, PSNR=${formatPSNR(psnr)}`
    );

  } catch (err) {
    showError(dom.page, err.message);
    console.error('[EmbeddingController] Pipeline error:', err);
  } finally {
    if (dom.embedBtn) {
      dom.embedBtn.disabled    = false;
      dom.embedBtn.textContent = 'Embed Message';
    }
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
function handleDownload() {
  const st = getState();
  if (!st.stegoImage || !st.stegoImage.dataUrl) {
    showError(dom.page, 'Stego image belum tersedia. Lakukan embedding terlebih dahulu.');
    return;
  }
  downloadImage(st.stegoImage.dataUrl, st.stegoImage.name);
}

// ---------------------------------------------------------------------------
// UI render helpers
// ---------------------------------------------------------------------------
function _renderCoverPreview(meta) {
  if (!dom.coverPreview) return;
  dom.coverPreview.innerHTML = '';
  const img = document.createElement('img');
  img.src   = meta.dataUrl;
  img.alt   = 'Cover Image';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.coverPreview.appendChild(img);
  if (dom.coverDimLabel) dom.coverDimLabel.textContent = `${meta.width}×${meta.height}`;
}

function _renderStegoPreview(meta) {
  if (!dom.stegoPreview) return;
  dom.stegoPreview.innerHTML = '';
  const img = document.createElement('img');
  img.src   = meta.dataUrl;
  img.alt   = 'Stego Image';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.stegoPreview.appendChild(img);
  if (dom.stegoDimLabel) dom.stegoDimLabel.textContent = `${meta.width}×${meta.height}`;
}

function _renderMetadata(meta) {
  const fmt = (el, val) => { if (el) el.textContent = val; };
  fmt(dom.metaWidth,    meta.width  + ' px');
  fmt(dom.metaHeight,   meta.height + ' px');
  fmt(dom.metaFormat,   meta.format.toUpperCase());
  fmt(dom.metaSize,     _fmtBytes(meta.size));
  fmt(dom.metaChannels, 'RGB (3 ch)');
  if (dom.metaPanel) dom.metaPanel.style.display = 'block';
}

function _renderResultMetrics(mse, psnr, stegoMeta, coverMeta) {
  const fmt = (el, val, cls) => {
    if (!el) return;
    el.textContent = val;
    if (cls) el.className = 'metric-value ' + cls;
  };

  const psnrGood = psnr > 50;
  fmt(dom.mseValue,      mse.toFixed(4),  psnrGood ? 'good' : '');
  fmt(dom.psnrValue,     formatPSNR(psnr), psnrGood ? 'good' : '');

  const deltaKb = ((stegoMeta.size - coverMeta.size) / 1024).toFixed(1);
  const deltaStr = deltaKb >= 0 ? `+${deltaKb} KB` : `${deltaKb} KB`;
  fmt(dom.fileSizeValue, deltaStr, '');
}

function _resetResultPanel() {
  const fmt = (el, val) => { if (el) { el.textContent = val; el.className = 'metric-value'; } };
  fmt(dom.mseValue,      '—');
  fmt(dom.psnrValue,     '—');
  fmt(dom.fileSizeValue, '—');

  if (dom.stegoPreview) {
    dom.stegoPreview.innerHTML = 'Hasil embedding';
  }
  if (dom.stegoDimLabel) dom.stegoDimLabel.textContent = '—';
  if (dom.downloadBtn)   dom.downloadBtn.disabled = true;
}

function _updateStepperToResult() {
  // Tandai stepper: step Input → done, step Process → done, step Result → current
  if (!dom.stepper) return;
  const steps = dom.stepper.querySelectorAll('.step');
  // steps[0]=Input, steps[1]=Process, steps[2]=Result, steps[3]=Analysis
  steps.forEach((s, i) => {
    s.classList.remove('done', 'current');
    if (i < 2)      { s.classList.add('done');    s.querySelector('.step-dot').textContent = '✓'; }
    else if (i === 2) { s.classList.add('current'); }
  });
}

function _buildAnalysisSummary(mse, psnr, bitCount, decoded) {
  const totalPx   = decoded.width * decoded.height;
  const totalSlot = totalPx * 3;                      // 3 channel RGB
  const charCount = Math.round(bitCount / 8) - 4;    // dikurangi 4-byte header
  const psnrStr   = isFinite(psnr) ? psnr.toFixed(2) + ' dB' : '∞ dB';
  const usedPct   = ((bitCount / totalSlot) * 100).toFixed(2);

  // Ringkasan faktual — tidak mengandung klaim kualitas atau threshold
  return (
    `Embedding selesai pada citra ${decoded.width}×${decoded.height} px ` +
    `(${totalPx.toLocaleString()} piksel, ${totalSlot.toLocaleString()} slot RGB tersedia). ` +
    `Jumlah bit yang disisipkan: ${bitCount.toLocaleString()} bit (${charCount} karakter + 4-byte header), ` +
    `menggunakan ${usedPct}% kapasitas slot. ` +
    `Hasil kalkulasi: MSE = ${_formatMSEValue(mse)}, PSNR = ${psnrStr}.`
  );
}

function _formatMSEValue(mse) {
  if (mse === 0)    return '0';
  if (mse < 0.001)  return mse.toExponential(4);
  if (mse < 1)      return mse.toFixed(6);
  return mse.toFixed(4);
}

function _fmtBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------
// State subscription → sync UI bila state berubah dari luar (mis. analisis)
// ---------------------------------------------------------------------------
function onStateChange(state, path) {
  if (path === 'stegoImage' && state.stegoImage && dom.stegoPreview) {
    _renderStegoPreview(state.stegoImage);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initEmbeddingController() {
  cacheDom();

  if (dom.dropzone) {
    dom.dropzone.addEventListener('click', handlePickCoverImage);
    dom.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dom.dropzone.classList.add('dragover'); });
    dom.dropzone.addEventListener('dragleave', () => dom.dropzone.classList.remove('dragover'));
    dom.dropzone.addEventListener('drop', handleDrop);
  }

  if (dom.message) {
    dom.message.addEventListener('input', handleMessageInput);
    dom.message.value = getState().secretMessage;
    handleMessageInput();
  }

  if (dom.stegoKey) {
    dom.stegoKey.addEventListener('input', handleKeyInput);
    dom.stegoKey.value = '';
  }

  if (dom.embedBtn)    dom.embedBtn.addEventListener('click', handleEmbed);
  if (dom.downloadBtn) {
    dom.downloadBtn.addEventListener('click', handleDownload);
    dom.downloadBtn.disabled = true;   // aktif hanya setelah embedding berhasil
  }
  if (dom.analysisBtn) {
    // analysisBtn sudah punya data-goto="analysis" dari HTML, ditangani navigationService
  }

  subscribe(onStateChange);
}
