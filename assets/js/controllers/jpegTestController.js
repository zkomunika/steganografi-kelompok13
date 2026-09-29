// controllers/jpegTestController.js
// Application layer for the JPEG Fragility Test page.
//
// Flow:
// Stego Image
// → extract original embedded bits
// → JPEG compression
// → extract bits from JPEG image (or compare bits at known slots if header corrupted)
// → Bit Accuracy
// → MSE & PSNR
// → Secret Message
// → update UI + history table

import { getState, setState, batchSetState } from '../state.js';
import { pickImageFile, readImageFile } from '../services/fileService.js';
import { ERROR } from '../constants.js';
import { showError, clearError } from '../utils/uiHelpers.js';
import { CONFIG } from '../config.js';

import { generateSlotSequence } from '../core/pixelPositionSelector.js';
import { extractBits } from '../core/lsbEmbeddingEngine.js';
import { bitsToMessage } from '../core/messageBitConverter.js';

import { compressToJPEG } from '../evaluation/jpegCompressionTest.js';
import { calculateBitAccuracy } from '../evaluation/bitAccuracyCalculator.js';
import { calculateMSE } from '../evaluation/mseCalculator.js';
import { calculatePSNR, formatPSNR } from '../evaluation/psnrCalculator.js';

import { buildJpegTestRow } from '../utils/resultHandler.js';

const dom = {};

// ---------------------------------------------------------------------------
// DOM Cache
// ---------------------------------------------------------------------------

function cacheDom() {
  const page = document.getElementById('page-jpeg');

  dom.page         = page;
  dom.dropzone     = page.querySelector('#jpeg-dropzone');
  dom.fname        = page.querySelector('#jpeg-fname');
  dom.stegoPreview = page.querySelector('#jpeg-stego-preview');
  dom.stegoLabel   = page.querySelector('#jpeg-stego-dim');
  dom.stegoKey     = page.querySelector('#jpeg-key');
  dom.range        = page.querySelector('#jpeg-qf-range');
  dom.rangeLabel   = page.querySelector('#jpeg-qf-label');
  dom.runBtn       = page.querySelector('#jpeg-btn');

  // Result & preview elements
  dom.jpegPreview       = page.querySelector('#jpeg-jpeg-preview');
  dom.qfBadge           = page.querySelector('#jpeg-qf-badge');
  dom.resultStatus      = page.querySelector('#jpeg-result-status');
  dom.extractionResult  = page.querySelector('#jpeg-result-textarea');
  dom.bitAccuracyBefore = page.querySelector('#jpeg-acc-before');
  dom.bitAccuracyAfter  = page.querySelector('#jpeg-acc-after');
  dom.psnr              = page.querySelector('#jpeg-psnr');
  dom.qfResult          = page.querySelector('#jpeg-qf-result');
  dom.resultTableBody   = page.querySelector('#jpeg-history-tbody');
}

// Image upload & drop
async function handlePickStegoImage() {
  clearError(dom.page);

  try {
    const file = await pickImageFile();
    const meta = await readImageFile(file);

    batchSetState({
      jpegStegoImage: meta,
      jpegTestResult: null
    });

    if (dom.fname) {
      dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
    }

    renderStegoPreview(meta);
    clearJpegResults();

  } catch (err) {
    showError(dom.page, err.message);
  }
}

function handleDrop(event) {
  event.preventDefault();

  if (dom.dropzone) {
    dom.dropzone.classList.remove('dragover');
  }

  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;

  readImageFile(file)
    .then((meta) => {
      batchSetState({
        jpegStegoImage: meta,
        jpegTestResult: null
      });

      if (dom.fname) {
        dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
      }

      renderStegoPreview(meta);
      clearJpegResults();
    })
    .catch((err) => {
      showError(dom.page, err.message);
    });
}

// ---------------------------------------------------------------------------
// Key & Quality Factor handlers
// ---------------------------------------------------------------------------

function handleKeyInput() {
  setState('jpegKey', dom.stegoKey ? dom.stegoKey.value : '');
}

function handleQualityChange(event) {
  const qf = Number(event.target.value);
  setState('qualityFactor', qf);

  if (dom.rangeLabel) {
    dom.rangeLabel.textContent = String(qf);
  }
}

// Validation
function validateJpegTestInputs() {
  const st = getState();

  if (!st.jpegStegoImage || !st.jpegStegoImage.imageData) {
    throw new Error(ERROR.NO_STEGO_IMAGE);
  }

  if (!st.jpegKey || st.jpegKey.trim().length === 0) {
    throw new Error(ERROR.EMPTY_KEY);
  }

  const qf = Number(st.qualityFactor);
  if (!Number.isFinite(qf) || qf < 10 || qf > 100) {
    throw new Error('[JpegTestController] Quality Factor harus berada pada 10–100.');
  }
}

// Extract bits helper
function extractEmbeddedBits(imageData, key) {
  const { width, height } = imageData;
  const totalSlots = width * height * 3;

  // Pass 1: Read 32-bit header
  const headerSlots = generateSlotSequence(key, totalSlots, 32);
  const headerBits = Array.from(extractBits(imageData, headerSlots));

  let byteLength = 0;
  for (let i = 0; i < 32; i++) {
    byteLength = (byteLength << 1) | (headerBits[i] & 1);
  }
  byteLength = byteLength >>> 0;

  const totalBits = (4 + byteLength) * 8;

  if (totalBits > totalSlots || byteLength > 500000) {
    throw new Error('[JpegTestController] Header pesan tidak valid atau Stego-Key salah.');
  }

  // Pass 2: Extract full payload bits
  const slotSequence = generateSlotSequence(key, totalSlots, totalBits);
  const bits = Array.from(extractBits(imageData, slotSequence));

  return {
    bits,
    byteLength,
    totalBits
  };
}

// Run JPEG Fragility Test
async function handleRunTest() {
  clearError(dom.page);

  if (dom.runBtn) {
    dom.runBtn.disabled = true;
    dom.runBtn.textContent = 'Memproses...';
  }

  try {
    validateJpegTestInputs();

    const st = getState();
    const stegoImageData = st.jpegStegoImage.imageData;
    const key = st.jpegKey.trim();
    const qualityFactor = Number(st.qualityFactor || 70);

    // 1. Extract original bits from Stego Image (PNG/BMP)
    const originalExtraction = extractEmbeddedBits(stegoImageData, key);
    const originalBits = originalExtraction.bits;
    const originalMessage = bitsToMessage(originalBits);

    if (!originalMessage) {
      throw new Error('[JpegTestController] Pesan rahasia tidak ditemukan pada Stego Image. Periksa Stego-Key Anda.');
    }

    const bitAccuracyBefore = calculateBitAccuracy(originalBits, originalBits);

    // 2. Compress Stego Image to JPEG
    const jpegResult = await compressToJPEG(stegoImageData, qualityFactor);
    const jpegImageData = jpegResult.imageData;

    // 3. Attempt bit extraction from JPEG image
    let jpegBits = [];
    let extractedMessage = '';
    let bitAccuracyAfter = 0;
    let status = 'Rusak';

    const totalSlots = stegoImageData.width * stegoImageData.height * 3;

    try {
      const jpegExtraction = extractEmbeddedBits(jpegImageData, key);
      jpegBits = jpegExtraction.bits;
      extractedMessage = bitsToMessage(jpegBits);

      bitAccuracyAfter = calculateBitAccuracy(originalBits, jpegBits);
      status = (bitAccuracyAfter === 100 && extractedMessage === originalMessage) ? 'Utuh' : 'Rusak';

    } catch (extractError) {
      console.warn('[JpegTestController] Ekstraksi header JPEG gagal (distorsi kompresi):', extractError);

      // Fallback: extract bits using original bit count sequence to calculate accurate Bit Accuracy
      try {
        const slotSequence = generateSlotSequence(key, totalSlots, originalExtraction.totalBits);
        jpegBits = Array.from(extractBits(jpegImageData, slotSequence));
        bitAccuracyAfter = calculateBitAccuracy(originalBits, jpegBits);
      } catch (e) {
        jpegBits = [];
        bitAccuracyAfter = 0;
      }

      extractedMessage = '[Pesan terdistorsi akibat kompresi JPEG]';
      status = 'Rusak';
    }

    // 4. Calculate MSE & PSNR (Stego vs JPEG)
    const mse = calculateMSE(stegoImageData, jpegImageData);
    const psnrJpeg = calculatePSNR(mse);

    // 5. Build result
    const result = {
      qualityFactor,
      status,
      originalMessage,
      extractedMessage,
      originalBits,
      jpegBits,
      bitAccuracyBefore,
      bitAccuracyAfter,
      mse,
      psnrJpeg,
      psnrFormatted: formatPSNR(psnrJpeg),
      jpegDataUrl: jpegResult.dataUrl,
      width: jpegResult.width,
      height: jpegResult.height
    };

    // 6. Save result & history in state
    const currentState = getState();
    const history = Array.isArray(currentState.jpegTestHistory) ? currentState.jpegTestHistory : [];
    const tableRow = buildJpegTestRow({
      qualityFactor,
      status,
      bitAccuracy: bitAccuracyAfter,
      psnrJpeg
    });

    const newHistory = [...history, tableRow];

    batchSetState({
      jpegTestResult: result,
      jpegTestHistory: newHistory
    });

    // 7. Update UI
    renderJpegPreview(jpegResult, qualityFactor);
    renderResult(result);
    renderHistory(newHistory);

    console.info('[JpegTestController] JPEG Test selesai:', result);

  } catch (err) {
    console.error('[JpegTestController] JPEG Test error:', err);
    showError(dom.page, err.message);
  } finally {
    if (dom.runBtn) {
      dom.runBtn.disabled = false;
      dom.runBtn.textContent = 'Run JPEG Test';
    }
  }
}

// ---------------------------------------------------------------------------
// Render Previews
// ---------------------------------------------------------------------------

function renderStegoPreview(meta) {
  if (!dom.stegoPreview) return;
  dom.stegoPreview.innerHTML = '';

  const img = document.createElement('img');
  img.src = meta.dataUrl;
  img.alt = 'Stego Image';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.stegoPreview.appendChild(img);

  if (dom.stegoLabel) {
    dom.stegoLabel.textContent = `${meta.width}×${meta.height}`;
  }
}

function renderJpegPreview(jpegResult, qf) {
  if (!dom.jpegPreview) return;
  dom.jpegPreview.innerHTML = '';

  const img = document.createElement('img');
  img.src = jpegResult.dataUrl;
  img.alt = 'JPEG Preview';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.jpegPreview.appendChild(img);

  if (dom.qfBadge) {
    dom.qfBadge.textContent = `QF ${qf}`;
  }
}

// Render Results
function renderResult(result) {
  if (dom.resultStatus) {
    dom.resultStatus.textContent = result.status === 'Utuh' ? ' (Utuh)' : ' (Rusak)';
    dom.resultStatus.style.color = result.status === 'Utuh' ? 'var(--accent)' : 'var(--warn)';
  }

  if (dom.extractionResult) {
    dom.extractionResult.value = result.extractedMessage || '—';
  }

  if (dom.bitAccuracyBefore) {
    dom.bitAccuracyBefore.textContent = `${result.bitAccuracyBefore.toFixed(2)}%`;
  }

  if (dom.bitAccuracyAfter) {
    dom.bitAccuracyAfter.textContent = `${result.bitAccuracyAfter.toFixed(2)}%`;
  }

  if (dom.psnr) {
    dom.psnr.textContent = result.psnrFormatted;
  }

  if (dom.qfResult) {
    dom.qfResult.textContent = String(result.qualityFactor);
  }
}

// Render History Table
function renderHistory(history) {
  if (!dom.resultTableBody) return;
  dom.resultTableBody.innerHTML = '';

  if (!history || history.length === 0) {
    dom.resultTableBody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;color:var(--ink-soft);font-size:12px;padding:18px;">Belum ada pengujian dilakukan.</td></tr>';
    return;
  }

  for (const row of history) {
    const tr = document.createElement('tr');

    const qfTd = document.createElement('td');
    qfTd.className = 'mono';
    qfTd.textContent = String(row.qualityFactor);

    const statusTd = document.createElement('td');
    statusTd.textContent = row.status;
    if (row.status === 'Utuh') {
      statusTd.style.color = 'var(--accent)';
      statusTd.style.fontWeight = '600';
    } else {
      statusTd.style.color = 'var(--warn)';
    }

    const accuracyTd = document.createElement('td');
    accuracyTd.className = 'mono';
    accuracyTd.textContent = `${Number(row.bitAccuracy).toFixed(2)}%`;

    const psnrTd = document.createElement('td');
    psnrTd.className = 'mono';
    psnrTd.textContent = formatPSNR(row.psnrJpeg);

    tr.appendChild(qfTd);
    tr.appendChild(statusTd);
    tr.appendChild(accuracyTd);
    tr.appendChild(psnrTd);

    dom.resultTableBody.appendChild(tr);
  }
}

// Reset / Clear
function clearJpegResults() {
  if (dom.jpegPreview) dom.jpegPreview.innerHTML = 'Hasil kompresi';
  if (dom.qfBadge) dom.qfBadge.textContent = 'QF —';
  if (dom.resultStatus) dom.resultStatus.textContent = '';
  if (dom.extractionResult) dom.extractionResult.value = '';
  if (dom.bitAccuracyBefore) dom.bitAccuracyBefore.textContent = '—';
  if (dom.bitAccuracyAfter) dom.bitAccuracyAfter.textContent = '—';
  if (dom.psnr) dom.psnr.textContent = '—';
  if (dom.qfResult) dom.qfResult.textContent = '—';
}

// Init
export function initJpegTestController() {
  cacheDom();

  if (!dom.page) {
    console.warn('[JpegTestController] #page-jpeg tidak ditemukan.');
    return;
  }

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
    dom.stegoKey.value = '';
  }

  if (dom.range) {
    dom.range.addEventListener('input', handleQualityChange);
    dom.range.value = CONFIG.jpegTest.defaultQuality;
    setState('qualityFactor', CONFIG.jpegTest.defaultQuality);
    if (dom.rangeLabel) {
      dom.rangeLabel.textContent = String(CONFIG.jpegTest.defaultQuality);
    }
  }

  if (dom.runBtn) {
    dom.runBtn.addEventListener('click', handleRunTest);
  }
}
