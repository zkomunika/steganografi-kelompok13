// controllers/extractionController.js
// Application layer for the Extraction page.
//
// Responsibilities:
//   • Wire stego image upload, key input, and extract button.
//   • Show real preview of uploaded stego image.
//   • Validate inputs before extraction.
//   • (Extraction logic will be added in next checkpoint.)

import { getState, setState, batchSetState } from '../state.js';
import { pickImageFile, readImageFile } from '../services/fileService.js';
import { ERROR } from '../constants.js';
import { showError, clearError } from '../utils/uiHelpers.js';

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
}

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------
async function handlePickStegoImage() {
  clearError(dom.page);
  try {
    const file = await pickImageFile();
    const meta = await readImageFile(file);

    batchSetState({
      extractionImage:  meta,
      extractionResult: null,
    });

    if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
    _renderPreview(meta);

  } catch (err) {
    showError(dom.page, err.message);
    console.warn('[ExtractionController]', err.message);
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
    })
    .catch((err) => showError(dom.page, err.message));
}

// ---------------------------------------------------------------------------
// Key input (in-memory only)
// ---------------------------------------------------------------------------
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
// Extract button  (extraction logic added in next checkpoint)
// ---------------------------------------------------------------------------
function handleExtract() {
  clearError(dom.page);
  try {
    validateExtractionInputs();
    console.info('[ExtractionController] Validasi input berhasil. Siap untuk extraction.');
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
  if (dom.dimLabel) dom.dimLabel.textContent = `${meta.width}×${meta.height}`;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initExtractionController() {
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

  if (dom.extractBtn) dom.extractBtn.addEventListener('click', handleExtract);
}
