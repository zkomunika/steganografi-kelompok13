// utils/resultHandler.js
// Bridges the Evaluation module's raw numbers and the Presentation
// layer's display strings, so controllers don't format numbers inline
// and evaluation modules don't know about DOM formatting.

export function formatMetricValue(value, { suffix = '', decimals = 2, fallback = '—' } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return `${value.toFixed(decimals)}${suffix}`;
}

export function buildEvaluationResult({ mse = null, psnr = null, fileSizeDeltaKb = null } = {}) {
  return { mse, psnr, fileSizeDeltaKb };
}

export function buildJpegTestRow({ qualityFactor, status, bitAccuracy, psnrJpeg }) {
  return { qualityFactor, status, bitAccuracy, psnrJpeg };
}
