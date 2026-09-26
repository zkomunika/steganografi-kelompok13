// controllers/extractionController.js
// Application layer for the Extraction page. Same responsibility split
// as embeddingController.js: DOM/state in, Core/Evaluation calls out,
// no algorithm logic in this file.

import { getState, setState } from '../state.js';
import { pickImageFile, readImageMeta } from '../services/fileService.js';
import * as imageHandler from '../core/imageHandler.js';
import * as pixelPositionSelector from '../core/pixelPositionSelector.js';
import * as lsbExtractionEngine from '../core/lsbExtractionEngine.js';
import * as messageBitConverter from '../core/messageBitConverter.js';
import { STATUS } from '../constants.js';

const dom = {};

function cacheDom() {
  const page = document.getElementById('page-extraction');
  dom.dropzone = page.querySelector('.dropzone');
  dom.fname = page.querySelector('.dropzone .fname');
  dom.stegoKey = page.querySelector('input[type=password]');
  dom.extractBtn = page.querySelector('.btn-primary');
}

async function handlePickStegoImage() {
  try {
    const file = await pickImageFile();
    const meta = await readImageMeta(file);
    setState('extraction.stegoImage', meta);
    if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
  } catch (err) {
    console.info('[ExtractionController] stego image selection was cancelled or failed:', err.message);
  }
}

function handleExtract() {
  const extractionState = getState().extraction;

  // --- Application layer orchestration (placeholder pipeline) ---
  const stego = imageHandler.decodeImage(extractionState.stegoImage);
  const positions = pixelPositionSelector.generatePixelPositions(extractionState.stegoKey, stego, 0);
  const bits = lsbExtractionEngine.extract(stego, positions, 0);
  const message = messageBitConverter.bitsToMessage(bits);

  setState('extraction.extractedMessage', message || null);
  setState('extraction.status', message ? STATUS.OK : null);

  console.info(
    '[ExtractionController] handleExtract() ran the placeholder pipeline — ' +
      'implement core/* to replace the stub output.'
  );
}

export function initExtractionController() {
  cacheDom();
  if (dom.dropzone) dom.dropzone.addEventListener('click', handlePickStegoImage);
  if (dom.extractBtn) dom.extractBtn.addEventListener('click', handleExtract);
}
