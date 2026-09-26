// controllers/jpegTestController.js
// Application layer for the JPEG Fragility Test page. Binds the
// Quality Factor slider and the "Run JPEG Test" button to the
// Evaluation module — no compression/accuracy logic lives here.

import { getState, setState } from '../state.js';
import * as jpegCompressionTest from '../evaluation/jpegCompressionTest.js';
import * as lsbExtractionEngine from '../core/lsbExtractionEngine.js';
import * as bitAccuracyCalculator from '../evaluation/bitAccuracyCalculator.js';
import * as resultHandler from '../utils/resultHandler.js';

const dom = {};

function cacheDom() {
  const page = document.getElementById('page-jpeg');
  dom.range = page.querySelector('input[type=range]');
  dom.rangeLabel = page.querySelector('.field label b');
  dom.runBtn = page.querySelector('.btn-primary');
}

function handleQualityChange(event) {
  const qualityFactor = Number(event.target.value);
  setState('jpegTest.qualityFactor', qualityFactor);
  if (dom.rangeLabel) dom.rangeLabel.textContent = String(qualityFactor);
}

function handleRunTest() {
  const jpegTestState = getState().jpegTest;

  // --- Application layer orchestration (placeholder pipeline) ---
  const jpegResult = jpegCompressionTest.compressToJPEG(jpegTestState.stegoImage, jpegTestState.qualityFactor);
  const extractedBits = lsbExtractionEngine.extract(jpegResult, [], 0);
  const bitAccuracy = bitAccuracyCalculator.calculateBitAccuracy([], extractedBits);

  const row = resultHandler.buildJpegTestRow({
    qualityFactor: jpegTestState.qualityFactor,
    status: null,
    bitAccuracy,
    psnrJpeg: null,
  });
  setState('jpegTest.history', [...jpegTestState.history, row]);

  console.info(
    '[JpegTestController] handleRunTest() ran the placeholder pipeline for QF',
    jpegTestState.qualityFactor,
    '— implement evaluation/jpegCompressionTest.js and bitAccuracyCalculator.js to replace the stub output.'
  );
}

export function initJpegTestController() {
  cacheDom();
  if (dom.range) dom.range.addEventListener('input', handleQualityChange);
  if (dom.runBtn) dom.runBtn.addEventListener('click', handleRunTest);
}
