// controllers/jpegTestController.js
// Application layer for the JPEG Fragility Test page.
// Wires: stego image upload, key input, quality-factor slider, and test button.

import { getState, setState, batchSetState } from '../state.js';
import { pickImageFile, readImageFile } from '../services/fileService.js';
import { ERROR } from '../constants.js';
import { showError, clearError } from '../utils/uiHelpers.js';
import { CONFIG } from '../config.js';

const dom = {};

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
}

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------
async function handlePickStegoImage() {
  clearError(dom.page);
  try {
    const file = await pickImageFile();
    const meta = await readImageFile(file);

    batchSetState({ jpegStegoImage: meta, jpegTestResult: null });
    if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
    _renderPreview(meta);

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
      batchSetState({ jpegStegoImage: meta, jpegTestResult: null });
      if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
      _renderPreview(meta);
    })
    .catch((err) => showError(dom.page, err.message));
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
  if (!st.jpegStegoImage || !st.jpegStegoImage.imageData) throw new Error(ERROR.NO_STEGO_IMAGE);
  if (!st.jpegKey || st.jpegKey.trim().length === 0) throw new Error(ERROR.EMPTY_KEY);
}

// ---------------------------------------------------------------------------
// Run test button (compression logic added in next checkpoint)
// ---------------------------------------------------------------------------
function handleRunTest() {
  clearError(dom.page);
  try {
    validateJpegTestInputs();
    console.info('[JpegTestController] Validasi input berhasil. QF =', getState().qualityFactor);
  } catch (err) {
    showError(dom.page, err.message);
  }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
function _renderPreview(meta) {
  if (!dom.stegoPreview) return;
  dom.stegoPreview.innerHTML = '';
  const img = document.createElement('img');
  img.src   = meta.dataUrl;
  img.alt   = 'Stego Image';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.stegoPreview.appendChild(img);
  if (dom.stegoLabel) dom.stegoLabel.textContent = `${meta.width}×${meta.height}`;
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
    dom.range.value = CONFIG.jpegTest.defaultQuality;
    if (dom.rangeLabel) dom.rangeLabel.textContent = String(CONFIG.jpegTest.defaultQuality);
  }

  if (dom.runBtn) dom.runBtn.addEventListener('click', handleRunTest);
}
