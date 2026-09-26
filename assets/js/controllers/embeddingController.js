// controllers/embeddingController.js
// Application layer for the Embedding page.
//
// Responsibilities:
//   • Wire all DOM inputs (dropzone, textarea, password, button) to handlers.
//   • Read real files via fileService and store decoded ImageData in state.
//   • Update preview images, metadata labels, and the capacity bar reactively.
//   • Validate all inputs before allowing the Embed button to proceed.
//   • Does NOT implement embedding logic — that belongs to core/.

import { getState, setState, batchSetState, subscribe } from '../state.js';
import { pickImageFile, readImageFile } from '../services/fileService.js';
import { decodeImage, getCapacityInfo } from '../core/imageHandler.js';
import { getRequiredBits, messageToBits } from '../core/messageBitConverter.js';
import { ERROR } from '../constants.js';
import { CONFIG } from '../config.js';
import { showError, clearError } from '../utils/uiHelpers.js';

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
}

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------
async function handlePickCoverImage() {
  clearError(dom.page);
  try {
    const file = await pickImageFile();
    const meta = await readImageFile(file);   // validates + decodes pixels

    // Store in state
    batchSetState({
      coverImage:      meta,
      embeddingResult: null,
      stegoImage:      null,
    });

    // Update dropzone label
    if (dom.fname) {
      dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
    }

    // Show real image preview
    _renderCoverPreview(meta);

    // Update metadata panel
    _renderMetadata(meta);

    // Re-evaluate capacity (message may already be typed)
    _updateCapacity();

  } catch (err) {
    showError(dom.page, err.message);
    console.warn('[EmbeddingController] cover image error:', err.message);
  }
}

// Drag-and-drop support
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
      _updateCapacity();
    })
    .catch((err) => {
      showError(dom.page, err.message);
    });
}

// ---------------------------------------------------------------------------
// Message input
// ---------------------------------------------------------------------------
function handleMessageInput() {
  const message = dom.message ? dom.message.value : '';
  const bits    = message.length > 0 ? messageToBits(message) : [];

  batchSetState({
    secretMessage: message,
    messageBits:   bits,
  });

  _updateCapacity();
}

// ---------------------------------------------------------------------------
// Stego-Key input (in-memory only; never persisted)
// ---------------------------------------------------------------------------
function handleKeyInput() {
  const key = dom.stegoKey ? dom.stegoKey.value : '';
  setState('stegoKey', key);
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

  const pct          = info.pct;
  const usedChars    = message ? message.length : 0;
  const totalChars   = decodedImage
    ? Math.floor((decodedImage.width * decodedImage.height * 3) / 8) - 4  // minus 4-byte header
    : 0;

  // Colour thresholds
  let colour = 'var(--accent)';
  if (pct >= CONFIG.capacityThresholds.danger) colour = 'var(--warn)';
  else if (pct >= CONFIG.capacityThresholds.warn) colour = '#D08B3A';

  dom.capacityFill.style.width      = `${Math.min(pct, 100)}%`;
  dom.capacityFill.style.background = colour;

  if (decodedImage === null) {
    dom.capacityHelp.textContent = 'Upload cover image untuk melihat kapasitas.';
    return;
  }

  if (usedChars === 0) {
    dom.capacityHelp.textContent =
      `Kapasitas tersedia: ~${totalChars.toLocaleString()} karakter.`;
    return;
  }

  const status = info.valid
    ? `${usedChars.toLocaleString()} / ${totalChars.toLocaleString()} karakter (${pct}% kapasitas)`
    : `⚠ Pesan terlalu panjang (${usedChars.toLocaleString()} / ${totalChars.toLocaleString()} karakter)`;

  dom.capacityHelp.textContent = status;
}

// ---------------------------------------------------------------------------
// Preview helpers
// ---------------------------------------------------------------------------
function _renderCoverPreview(meta) {
  if (!dom.coverPreview) return;

  // Replace placeholder text with a real <img>
  dom.coverPreview.innerHTML = '';
  const img  = document.createElement('img');
  img.src    = meta.dataUrl;
  img.alt    = 'Cover Image';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
  dom.coverPreview.appendChild(img);

  if (dom.coverDimLabel) {
    dom.coverDimLabel.textContent = `${meta.width}×${meta.height}`;
  }
}

function _renderMetadata(meta) {
  const fmt = (el, val) => { if (el) el.textContent = val; };

  fmt(dom.metaWidth,    meta.width  + ' px');
  fmt(dom.metaHeight,   meta.height + ' px');
  fmt(dom.metaFormat,   meta.format.toUpperCase());
  fmt(dom.metaSize,     _formatBytes(meta.size));
  fmt(dom.metaChannels, 'RGB (3 ch)');

  // Reveal the metadata panel (it starts hidden)
  if (dom.metaPanel) dom.metaPanel.style.display = 'block';
}

function _formatBytes(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------
// Validation (called before embedding)
// ---------------------------------------------------------------------------
export function validateEmbeddingInputs() {
  const st = getState();

  if (!st.coverImage || !st.coverImage.imageData) {
    throw new Error(ERROR.NO_IMAGE);
  }
  if (!st.secretMessage || st.secretMessage.trim().length === 0) {
    throw new Error(ERROR.EMPTY_MESSAGE);
  }
  if (!st.stegoKey || st.stegoKey.trim().length === 0) {
    throw new Error(ERROR.EMPTY_KEY);
  }
  if (st.capacity && !st.capacity.valid && st.capacity.usedBits > 0) {
    throw new Error(ERROR.MESSAGE_TOO_LONG);
  }
}

// ---------------------------------------------------------------------------
// Embed button  (embedding logic will be added in next checkpoint)
// ---------------------------------------------------------------------------
function handleEmbed() {
  clearError(dom.page);
  try {
    validateEmbeddingInputs();
    // Embedding logic (core/lsbEmbeddingEngine.js) will be called here
    // in the next checkpoint. For now we confirm inputs are valid.
    console.info('[EmbeddingController] Validasi input berhasil. Siap untuk embedding.');
    // Show a "not yet implemented" note without error styling
    if (dom.capacityHelp) {
      dom.capacityHelp.textContent += ' — ✓ Siap embed (implementasi berikutnya).';
    }
  } catch (err) {
    showError(dom.page, err.message);
  }
}

// ---------------------------------------------------------------------------
// State subscription → keep UI in sync when state changes from outside
// ---------------------------------------------------------------------------
function onStateChange(state, path) {
  // If stegoImage is set by the embedding pipeline (future checkpoint)
  if (path === 'stegoImage' || path === '_batch') {
    const meta = state.stegoImage;
    if (meta && dom.stegoPreview) {
      dom.stegoPreview.innerHTML = '';
      const img  = document.createElement('img');
      img.src    = meta.dataUrl;
      img.alt    = 'Stego Image';
      img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:4px;';
      dom.stegoPreview.appendChild(img);
      if (dom.stegoDimLabel) dom.stegoDimLabel.textContent = `${meta.width}×${meta.height}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function initEmbeddingController() {
  cacheDom();

  if (dom.dropzone) {
    dom.dropzone.addEventListener('click', handlePickCoverImage);
    dom.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dom.dropzone.classList.add('dragover');
    });
    dom.dropzone.addEventListener('dragleave', () => {
      dom.dropzone.classList.remove('dragover');
    });
    dom.dropzone.addEventListener('drop', handleDrop);
  }

  if (dom.message) {
    dom.message.addEventListener('input', handleMessageInput);
    // Initialise from current state (should be empty)
    dom.message.value = getState().secretMessage;
    handleMessageInput();
  }

  if (dom.stegoKey) {
    dom.stegoKey.addEventListener('input', handleKeyInput);
    dom.stegoKey.value = getState().stegoKey;
  }

  if (dom.embedBtn)    dom.embedBtn.addEventListener('click', handleEmbed);

  subscribe(onStateChange);
}
