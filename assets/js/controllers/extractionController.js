// controllers/extractionController.js
//
// Application layer untuk halaman Extraction.
// Mengorkestrasi pipeline extraction menggunakan komponen yang sudah
// diimplementasikan pada Checkpoint 3.
//
// Pipeline extraction:
//   Input validation
//   → Decode stego image → pixel buffer
//   → Read 32-bit length prefix from LSB (baca header saja)
//   → Generate PRNG slot sequence dari Stego-Key (SAMA dengan saat embedding)
//   → Extract bits dari RGB LSB
//   → Decode bits → UTF-8 message
//   → Update state + UI

import { getState, setState, batchSetState } from '../state.js';
import { pickImageFile, readImageFile }       from '../services/fileService.js';
import { decodeImage }                        from '../core/imageHandler.js';
import { generateSlotSequence }               from '../core/pixelPositionSelector.js';
import { extractBits }                        from '../core/lsbEmbeddingEngine.js';
import { bitsToMessage }                      from '../core/messageBitConverter.js';
import { ERROR, STATUS }                      from '../constants.js';
import { showError, clearError }              from '../utils/uiHelpers.js';

// Panjang header (32-bit / 4 byte = 32 bit) — harus sama dengan messageBitConverter
const HEADER_BITS = 32;

const dom = {};

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
// Image upload
// ---------------------------------------------------------------------------
async function handlePickStegoImage() {
  clearError(dom.page);
  try {
    const file = await pickImageFile();
    const meta = await readImageFile(file);

    batchSetState({ extractionImage: meta, extractionResult: null });

    if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
    _renderPreview(meta);
    _clearResult();

  } catch (err) {
    showError(dom.page, err.message);
  }
}

function handleDrop(event) {
  event.preventDefault();
  dom.dropzone.classList.remove('dragover');
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;

  readImageFile(file)
    .then((meta) => {
      batchSetState({ extractionImage: meta, extractionResult: null });
      if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
      _renderPreview(meta);
      _clearResult();
    })
    .catch((err) => showError(dom.page, err.message));
}

function handleKeyInput() {
  setState('extractionKey', dom.stegoKey ? dom.stegoKey.value : '');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateExtractionInputs() {
  const st = getState();
  if (!st.extractionImage || !st.extractionImage.imageData) throw new Error(ERROR.NO_STEGO_IMAGE);
  if (!st.extractionKey || st.extractionKey.trim().length === 0) throw new Error(ERROR.EMPTY_KEY);
}

// ---------------------------------------------------------------------------
// Extract pipeline
// ---------------------------------------------------------------------------
async function handleExtract() {
  clearError(dom.page);

  try {
    validateExtractionInputs();
  } catch (err) {
    showError(dom.page, err.message);
    return;
  }

  if (dom.extractBtn) {
    dom.extractBtn.disabled    = true;
    dom.extractBtn.textContent = 'Mengekstrak…';
  }

  try {
    const st = getState();

    // 1. Decode stego image ke pixel buffer
    const stegoDecoded   = decodeImage(st.extractionImage);
    const stegoImageData = stegoDecoded.imageData;
    const totalSlots     = stegoDecoded.width * stegoDecoded.height * 3;

    if (totalSlots < HEADER_BITS) {
      throw new Error('Image terlalu kecil untuk mengandung header pesan.');
    }

    // 2. Baca header dulu (32 bit pertama) untuk mengetahui panjang payload.
    //    generateSlotSequence dipanggil dengan bitCount=32 menggunakan key yang sama.
    //    Karena PRNG dibuat ulang dari awal setiap panggilan (seed deterministik),
    //    32 slot pertama yang dihasilkan SELALU identik dengan 32 slot pertama
    //    dari sequence penuh — ini adalah properti deterministik PRNG.
    const headerSlots = generateSlotSequence(st.extractionKey, totalSlots, HEADER_BITS);
    const headerBits  = Array.from(extractBits(stegoImageData, headerSlots));

    // Rekonstruksi panjang payload dari header bits (big-endian 32-bit unsigned)
    let payloadByteLen = 0;
    for (let i = 0; i < 32; i++) {
      payloadByteLen = (payloadByteLen << 1) | (headerBits[i] & 1);
    }
    payloadByteLen = payloadByteLen >>> 0;   // pastikan unsigned

    // Validasi: panjang yang terbaca harus masuk akal
    const maxBytes = Math.floor(totalSlots / 8) - 4;
    if (payloadByteLen === 0 || payloadByteLen > maxBytes) {
      throw new Error(
        `Header tidak valid atau pesan tidak ditemukan. ` +
        `Pastikan Stego-Key yang digunakan sama dengan saat embedding.`
      );
    }

    // 3. Generate slot sequence LENGKAP (header + payload) dengan key yang sama.
    //    Karena PRNG selalu di-restart dari seed yang sama, N slot pertama dari
    //    sequence ini IDENTIK dengan headerSlots di atas — konsistensi terjaga.
    const totalBitsNeeded = (4 + payloadByteLen) * 8;
    if (totalBitsNeeded > totalSlots) {
      throw new Error('Pesan yang tersimpan melebihi kapasitas image — image mungkin salah.');
    }

    const fullSlots = generateSlotSequence(st.extractionKey, totalSlots, totalBitsNeeded);
    const allBits   = Array.from(extractBits(stegoImageData, fullSlots));


    // 4. Decode bits → UTF-8 string (termasuk header)
    const message = bitsToMessage(allBits);

    if (!message) {
      throw new Error(
        'Gagal mendekode pesan. ' +
        'Stego-Key mungkin salah atau image bukan hasil embedding dari aplikasi ini.'
      );
    }

    // 5. Update state
    const result = { message, status: STATUS.OK };
    batchSetState({ extractionResult: result });

    // 6. Update UI
    _renderResult(message, STATUS.OK);
    _updateStepperToResult();

    console.info(`[ExtractionController] Berhasil mengekstrak ${message.length} karakter.`);

  } catch (err) {
    showError(dom.page, err.message);
    _renderResult(null, STATUS.FAIL);
    console.warn('[ExtractionController] Extraction gagal:', err.message);
  } finally {
    if (dom.extractBtn) {
      dom.extractBtn.disabled    = false;
      dom.extractBtn.textContent = 'Extract Message';
    }
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
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

function _renderResult(message, status) {
  if (dom.resultTextarea) {
    dom.resultTextarea.value = message || '';
  }
  if (dom.resultStatus) {
    dom.resultStatus.innerHTML = '';
    if (status === STATUS.OK) {
      dom.resultStatus.innerHTML =
        '<span class="status ok"><span class="status-dot"></span>Berhasil diekstrak</span>';
    } else if (status === STATUS.FAIL) {
      dom.resultStatus.innerHTML =
        '<span class="status fail"><span class="status-dot"></span>Ekstraksi gagal</span>';
    }
  }
}

function _clearResult() {
  if (dom.resultTextarea) dom.resultTextarea.value = '';
  if (dom.resultStatus)   dom.resultStatus.innerHTML = '';
}

function _updateStepperToResult() {
  if (!dom.stepper) return;
  const steps = dom.stepper.querySelectorAll('.step');
  steps.forEach((s, i) => {
    s.classList.remove('done', 'current');
    if (i < 2)       { s.classList.add('done'); s.querySelector('.step-dot').textContent = '✓'; }
    else if (i === 2) s.classList.add('current');
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initExtractionController() {
  cacheDom();

  if (dom.dropzone) {
    dom.dropzone.addEventListener('click', handlePickStegoImage);
    dom.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dom.dropzone.classList.add('dragover'); });
    dom.dropzone.addEventListener('dragleave', () => dom.dropzone.classList.remove('dragover'));
    dom.dropzone.addEventListener('drop', handleDrop);
  }

  if (dom.stegoKey) {
    dom.stegoKey.addEventListener('input', handleKeyInput);
    dom.stegoKey.value = '';
  }

  if (dom.extractBtn) dom.extractBtn.addEventListener('click', handleExtract);
}
