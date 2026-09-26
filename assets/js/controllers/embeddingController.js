// controllers/embeddingController.js
// Application layer for the Embedding page. Reads input from the DOM
// and state, delegates the actual work to Core/Evaluation/Utils, and
// writes results back to state. Never contains steganography logic
// itself — see assets/js/core and assets/js/evaluation.

import { getState, setState } from '../state.js';
import { pickImageFile, readImageMeta } from '../services/fileService.js';
import * as imageHandler from '../core/imageHandler.js';
import * as messageBitConverter from '../core/messageBitConverter.js';
import * as pixelPositionSelector from '../core/pixelPositionSelector.js';
import * as lsbEmbeddingEngine from '../core/lsbEmbeddingEngine.js';
import * as mseCalculator from '../evaluation/mseCalculator.js';
import * as psnrCalculator from '../evaluation/psnrCalculator.js';
import * as resultHandler from '../utils/resultHandler.js';
import * as imageFileHandler from '../utils/imageFileHandler.js';

const dom = {};

function cacheDom() {
  const page = document.getElementById('page-embedding');
  dom.dropzone = page.querySelector('.dropzone');
  dom.fname = page.querySelector('.dropzone .fname');
  dom.message = page.querySelector('textarea');
  dom.stegoKey = page.querySelector('input[type=password]');
  dom.embedBtn = page.querySelector('.btn-primary');
  dom.downloadBtn = page.querySelector('.btn-secondary')?.previousElementSibling || null;
}

async function handlePickCoverImage() {
  try {
    const file = await pickImageFile();
    const meta = await readImageMeta(file);
    setState('embedding.coverImage', meta);
    if (dom.fname) dom.fname.textContent = `${meta.name} · ${meta.width}×${meta.height}`;
  } catch (err) {
    // User cancelled the file picker, or the file could not be read.
    console.info('[EmbeddingController] cover image selection was cancelled or failed:', err.message);
  }
}

function handleEmbed() {
  const embeddingState = getState().embedding;

  // --- Application layer orchestration ---
  // The pipeline below is wired end-to-end (Core -> Evaluation -> Utils)
  // so the architecture is ready to receive the real algorithms. Every
  // call currently hits a stub, so the UI keeps showing its static demo
  // values until the next checkpoint implements them for real.
  const cover = imageHandler.decodeImage(embeddingState.coverImage);
  const bits = messageBitConverter.messageToBits(embeddingState.secretMessage);
  const positions = pixelPositionSelector.generatePixelPositions(
    embeddingState.stegoKey,
    cover,
    bits.length
  );
  const stegoPixels = lsbEmbeddingEngine.embed(cover, bits, positions);
  const mse = mseCalculator.calculateMSE(cover, stegoPixels);
  const psnr = psnrCalculator.calculatePSNR(mse);

  setState('embedding.evaluation', resultHandler.buildEvaluationResult({ mse, psnr }));

  console.info(
    '[EmbeddingController] handleEmbed() ran the placeholder pipeline — ' +
      'implement core/* and evaluation/* to replace the stub output.'
  );
}

function handleDownload() {
  const { stegoImage } = getState().embedding;
  imageFileHandler.downloadImage(stegoImage, 'stego_output.png');
}

export function initEmbeddingController() {
  cacheDom();
  if (dom.dropzone) dom.dropzone.addEventListener('click', handlePickCoverImage);
  if (dom.embedBtn) dom.embedBtn.addEventListener('click', handleEmbed);
  if (dom.downloadBtn) dom.downloadBtn.addEventListener('click', handleDownload);
}
