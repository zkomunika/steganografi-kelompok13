// controllers/analysisController.js
// Application layer for the Image Analysis page. This page has no
// inputs of its own — it displays whatever the Embedding pipeline
// produced. At this checkpoint that pipeline is still a stub, so this
// controller only confirms it is wired up; the actual re-render of the
// metrics cards from state.analysis is left for the checkpoint that
// implements the real MSE/PSNR calculations.

import { getState } from '../state.js';

export function initAnalysisController() {
  console.info(
    '[AnalysisController] ready — will render Cover/Stego comparison from ' +
      'state.analysis once evaluation/mseCalculator.js and psnrCalculator.js are implemented.'
  );
}

export function getAnalysisMetrics() {
  return getState().analysis.metrics;
}
